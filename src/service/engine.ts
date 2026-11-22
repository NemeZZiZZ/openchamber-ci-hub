// The service's state: which repositories we watch, the newest runs of each,
// one poll loop, the tokens, and every write we make on a CI provider.
// Everything that touches the outside world comes in through `EngineDeps`, so
// tests drive it with fakes.

import { formatDuration, isActive, isFailed, parseRemote, remoteIdentity, runDuration } from '../domain/format.ts';
import { buildHandoff, failedJobs, focusJob } from '../domain/handoff.ts';
import { errorExcerpt } from '../domain/log.ts';
import { formatRepoKey, legacyRepoKey, parseRepoKey, repoKeyId, repoName, type RepoKey, type RepoRef } from '../domain/repoKey.ts';
import { buildStatusView, readStatusActionId, type RepoSnapshot } from '../domain/statusView.ts';
import type {
  AccountView,
  Config,
  Handoff,
  Job,
  OverviewProject,
  OverviewRepo,
  OverviewView,
  RateLimitInfo,
  RepoConfig,
  RepoView,
  Run,
  StateView,
  TokenSource,
} from '../domain/types.ts';
import { judgeWait, readWaitArgs, readWaitState, waitLabel, waitSummary, type WaitArgs, type WaitState } from '../domain/waits.ts';
import { ProviderError, type FetchLike } from '../providers/errors.ts';
import { detectRemote, PROVIDERS, providerFor, providerView, resolveRepoInput, type KnownInstance } from '../providers/index.ts';
import type { CiClient, Provider } from '../providers/types.ts';
import { knownInstances, resolveToken, serverOf, sourceLabel, type AuthDeps } from './auth.ts';

import type { ServerRepo } from '../providers/types.ts';
import type { AuditEntry, ConfigStore } from './configStore.ts';
import { createMarkSync, latestOnBranch } from './marks.ts';
import type { Prefs, PrefsStore } from './prefs.ts';
import { agentJobsView, agentRunsView, agentRunView, AGENT_LOG_MAX } from './agentView.ts';
import type { GuestSessionEventRequest, GuestStatusView, GuestWaitCheckOutcome, GuestWaitStartResult, JsonValue, ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface EngineDeps {
  config: ConfigStore;
  prefs: PrefsStore;
  audit: (entry: AuditEntry) => Promise<void>;
  auth: AuthDeps;
  fetch: FetchLike;
  /** Runs `git` with arguments; resolves code -1 when git is missing. */
  git: (args: string[], cwd: string) => Promise<ExecResult>;
  emit: (topic: string, data?: JsonValue) => void;
  needsConfiguration: (message: string | null) => void;
  setMark?: (target: ServiceMarkTarget, mark: ServiceMark | null) => Promise<unknown>;
  now?: () => number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

export class EngineError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const POLL_FAST_MS = 20_000;
export const POLL_SLOW_MS = 180_000;
// Nothing open, but sidebar marks still want fresh state: one slow tick a minute.
export const POLL_IDLE_MS = 60_000;
/** The panel counts as open this long after its last read. */
const PANEL_WINDOW_MS = 75_000;
/** The status section counts as on screen this long after its last read. */
const STATUS_WINDOW_MS = 60_000;
/** A repository counts as busy while a run is active or one finished this recently. */
const RECENT_MS = 60 * 60_000;
/** A failing host is retried after 30 s, then twice as long each time, at most 10 min. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
/** How long a filtered list (branch, actor, status) is served from memory. */
const QUERY_TTL_MS = 15_000;
/** How long the list of servers connected in OpenChamber is reused. */
const KNOWN_TTL_MS = 15_000;

export type { AccountView, OverviewProject, OverviewRepo, OverviewView, RepoConfig, RepoView, StateView };

export interface WorkflowRunsView {
  runs: Run[];
  hasMore: boolean;
}

export type RunActionKind = 'rerun-all' | 'rerun-failed' | 'cancel' | 'approve' | 'decline';

export const HISTORY_PAGE = 20;

/** Characters of log tail a resolved mention carries. */
const MENTION_TAIL = 2_000;
/** The SDK caps one mention's context at 16 000 characters. */
const MENTION_TEXT = 16_000;

type Detected = { key: RepoKey; branch: string | null } | null;

interface RepoCache {
  runs: Run[];
  polledAt: number | null;
  error: string | null;
  defaultBranch: string | null;
}

interface AuthState {
  ok: boolean;
  source: TokenSource | null;
  sourceLabel: string | null;
  message: string | null;
}

/** One watched repository, resolved: its provider, its place and its view. */
interface Target {
  key: RepoKey;
  ref: RepoRef;
  provider: Provider;
  /** `provider:host`: what clients, tokens and rate limits are kept per. */
  account: string;
  view: RepoView;
}

/** One row CI Hub offers the composer's @-menu. */
interface MentionHit {
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

const describe = (err: unknown): string =>
  err instanceof ProviderError || err instanceof EngineError
    ? err.message
    : err instanceof Error
      ? err.message
      : 'Something went wrong.';

const accountOf = (provider: Provider, host: string) => `${provider.id}:${host.toLowerCase()}`;

const CAPABLE: Record<RunActionKind, (provider: Provider) => boolean> = {
  'rerun-all': (provider) => provider.capabilities.rerunAll !== null,
  'rerun-failed': (provider) => provider.capabilities.rerunFailed,
  cancel: (provider) => provider.capabilities.cancel,
  approve: (provider) => provider.capabilities.approve,
  decline: (provider) => provider.capabilities.approve,
};

const LABELS = PROVIDERS.map((provider) => provider.label).join(' or ');

export const createEngine = (deps: EngineDeps) => {
  const now = deps.now ?? (() => Date.now());
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    },
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  const cache = new Map<string, RepoCache>();
  // Both maps grow with directories/repos a session touches; a long-lived
  // service process must not hold them forever.
  const CACHE_CAP = 256;
  const evictOldest = (map: Map<unknown, unknown>): void => {
    // JS Maps keep insertion order: the first key is the oldest entry.
    while (map.size > CACHE_CAP) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };
  const detected = new Map<string, { value: Detected; at: number }>();
  const clients = new Map<string, { token: string; client: CiClient; origin: string | undefined; user: string | undefined }>();
  const auths = new Map<string, AuthState>();
  const rates = new Map<string, RateLimitInfo>();
  /** Accounts whose host failed (5xx, no answer): background polls wait until `until`. */
  const backoffs = new Map<string, { failures: number; until: number }>();
  let known: { at: number; list: KnownInstance[] } | null = null;

  let panelSeenAt = 0;
  let statusSeenAt = 0;
  // Button ids of the status view last served; the host posts them back verbatim.
  const statusActions: Map<string, { repo: RepoKey; runId: string }> = new Map();
  let statusRepos = new Set<RepoKey>();
  /** Repositories the panel has expanded (by `repoKeyId`); they are polled fast while it is open. */
  let panelRepos = new Set<string>();
  const historyCache = new Map<string, { at: number; view: WorkflowRunsView }>();
  let loop: unknown = null;
  let loopDueAt = 0;
  let polling: Promise<void> | null = null;
  let lastConfigMessage: string | null | undefined;
  // One request resolves a token, a server and a user: each would ask the
  // host for its settings again. A short-lived copy answers them all.
  const SETTINGS_TTL_MS = 2_000;
  let settingsCache: { at: number; value: Promise<Record<string, string>> } | null = null;
  const readSettings = (): Promise<Record<string, string>> => {
    if (settingsCache && now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
    const value = deps.auth.readSettings().catch(() => ({}) as Record<string, string>);
    settingsCache = { at: now(), value };
    return value;
  };
  const authDeps: AuthDeps = { ...deps.auth, readSettings };
  /** The latest `servers()` answer; setAuth reads it without awaiting. */
  let serverList: { provider: Provider; origin: string; host: string }[] = [];

  // ---- repository identity ------------------------------------------------

  /** Servers connected in OpenChamber; a remote on one of them is recognised. */
  const knownHosts = async (): Promise<KnownInstance[]> => {
    if (known && now() - known.at < KNOWN_TTL_MS) return known.list;
    const raw = await deps.auth.readStore().catch(() => undefined);
    known = { at: now(), list: knownInstances(raw) };
    return known.list;
  };

  const viewOf = (key: RepoKey, directory: string | null, enabled: boolean, origin: RepoView['origin']): RepoView | null => {
    const ref = parseRepoKey(key);
    if (!ref) return null;
    const provider = providerFor(ref.provider);
    const forgeUrl = forgeUrls.get(`${ref.host.toLowerCase()}/${ref.path.toLowerCase()}`);
    return {
      key: formatRepoKey(ref),
      provider: ref.provider,
      name: ref.path,
      webUrl: forgeUrl ?? provider.webUrl(ref),
      ciUrl: provider.ciUrl(ref),
      directory,
      enabled,
      origin,
    };
  };

  const targetOf = (view: RepoView): Target => {
    const ref = parseRepoKey(view.key)!;
    const provider = providerFor(ref.provider);
    return { key: view.key, ref, provider, account: accountOf(provider, ref.host), view };
  };

  // ---- auth and clients -------------------------------------------------

  /**
   * Self-hosted servers the settings configure (`woodpecker-server`), one per
   * provider that has a `serverSetting` and a value set. Their host answers
   * tokens from the settings and shows up as an account on its own.
   */
  const servers = async (): Promise<{ provider: Provider; origin: string; host: string }[]> => {
    const settings = await readSettings();
    const out: { provider: Provider; origin: string; host: string }[] = [];
    for (const provider of PROVIDERS) {
      const server = serverOf(settings, provider);
      if (server) out.push({ provider, origin: server.origin, host: server.host });
    }
    serverList = out;
    return out;
  };

  const setAuth = (provider: Provider, host: string, state: AuthState) => {
    auths.set(accountOf(provider, host), state);
    // The card's setting stands for the provider's public host, or for the
    // self-hosted server its settings configure.
    const lower = host.toLowerCase();
    const ownsHost = provider.publicHosts.includes(lower) || serverList.some((s) => s.provider.id === provider.id && s.host === lower);
    if (!provider.settingKey || !ownsHost) return;
    const message = state.ok ? null : state.message;
    if (message !== lastConfigMessage) {
      lastConfigMessage = message;
      deps.needsConfiguration(message ? message.slice(0, 200) : null);
    }
  };

  /** The token a host last answered 401 to; it stays rejected until the source hands us another. */
  const rejected = new Map<string, string>();

  const rejectedMessage = (provider: Provider, source: TokenSource) =>
    `${provider.label} rejected the ${sourceLabel(source, provider)}. Reconnect ${provider.label} in OpenChamber or paste a new token on the CI Hub card.`;

  const clientFor = async (provider: Provider, host: string): Promise<CiClient> => {
    const account = accountOf(provider, host);
    const result = await resolveToken(authDeps, provider, host);
    if (result.token === null) {
      setAuth(provider, host, { ok: false, source: null, sourceLabel: null, message: result.message });
      throw new EngineError(result.message, 401);
    }
    const label = sourceLabel(result.source, provider);
    if (rejected.get(account) === result.token) {
      const message = rejectedMessage(provider, result.source);
      setAuth(provider, host, { ok: false, source: result.source, sourceLabel: label, message });
      throw new EngineError(message, 401);
    }
    setAuth(provider, host, { ok: true, source: result.source, sourceLabel: label, message: null });
    const server = (await servers()).find(
      (entry) => entry.provider.id === provider.id && entry.host === host.toLowerCase(),
    );
    const origin = server?.origin;
    // A user:secret provider (Bitbucket's email) carries its other half on
    // the card too; a change there must not reuse the old client.
    const settings = await readSettings();
    const user = provider.authSetting ? settings[provider.authSetting]?.trim() || undefined : undefined;
    const existing = clients.get(account);
    // Same token on a re-pointed server (scheme flip) must not reuse the old client.
    if (existing && existing.token === result.token && existing.origin === origin && existing.user === user) return existing.client;
    const client = provider.createClient({
      fetch: deps.fetch,
      token: result.token,
      host,
      now,
      ...(origin ? { origin } : {}),
      ...(user ? { user } : {}),
    });
    clients.set(account, { token: result.token, client, origin, user });
    return client;
  };

  // ---- server-backed discovery (woodpecker and future self-hosted CIs) --

  const SERVER_REPOS_TTL_MS = 15_000;
  /** `account` → last fetched repo list; null while nothing ever loaded. */
  const serverRepoCache = new Map<string, { at: number; list: ServerRepo[] | null }>();
  const serverRepoBusy = new Map<string, Promise<ServerRepo[] | null>>();
  /** `<host>/<path>` → the forge page the server list reported. */
  const forgeUrls = new Map<string, string>();

  /**
   * Per configured server: the user's repo list from `listServerRepos`,
   * cached 15 s, deduplicated in flight. A failed refresh keeps the last
   * good list; `list: null` only while nothing ever loaded.
   */
  const serverRepos = async (): Promise<{ provider: Provider; host: string; origin: string; list: ServerRepo[] | null }[]> => {
    const list = await servers();
    return Promise.all(
      list.map(async (server) => {
        const account = accountOf(server.provider, server.host);
        const cached = serverRepoCache.get(account);
        // A rate-limited server is not contacted at all: its last good list
        // (or null) is the answer until the block lifts.
        if (blockOf(account)) return { ...server, list: cached?.list ?? null };
        if (cached && now() - cached.at < SERVER_REPOS_TTL_MS) return { ...server, list: cached.list };
        let busy = serverRepoBusy.get(account);
        if (!busy) {
          busy = (async () => {
            try {
              const client = await clientFor(server.provider, server.host);
              const repos = (await client.listServerRepos?.()) ?? [];
              serverRepoCache.set(account, { at: now(), list: repos });
              for (const repo of repos) {
                if (repo.forgeUrl) forgeUrls.set(`${server.host.toLowerCase()}/${repo.path.toLowerCase()}`, repo.forgeUrl);
              }
              evictOldest(forgeUrls);
              return repos;
            } catch (err) {
              // Discovery hits the same limits as polling: record a 429 so
              // repo detection stops hammering the server too.
              if (err instanceof ProviderError && (err.kind === 'rate-limit' || err.status === 429)) {
                rates.set(account, {
                  remaining: 0,
                  resetAt: err.rateLimitReset,
                  blockedUntil: err.rateLimitReset ?? now() + 60_000,
                  message: err.message,
                });
              }
              // Keep the last good list through a failed refresh; a failure
              // with nothing loaded counts as a (negative) cached answer, so
              // every action does not re-try the server within the ttl.
              serverRepoCache.set(account, { at: now(), list: serverRepoCache.get(account)?.list ?? null });
              return serverRepoCache.get(account)?.list ?? null;
            }
          })().finally(() => serverRepoBusy.delete(account));
          serverRepoBusy.set(account, busy);
        }
        const repos = await busy;
        return { ...server, list: repos };
      }),
    );
  };

  /** The same host/owner/name a git remote collapses to (`remoteIdentity`). */
  const identityOf = (remote: string): string | null => remoteIdentity(remote);

  const hitByIdentity = (identity: string, repos: ServerRepo[]): ServerRepo | null =>
    repos.find((repo) => repo.cloneUrls.some((url) => remoteIdentity(url) === identity)) ?? null;

  const hitByPath = (path: string, repos: ServerRepo[]): ServerRepo | null =>
    repos.find((repo) => repo.path.toLowerCase() === path.toLowerCase()) ?? null;

  /**
   * Woodpecker-first claim for a git remote: the CI server that actually
   * builds the repo wins over the forge's own CI. `'pending'` when a server
   * is configured but its list never loaded — callers must not cache it.
   */
  const claim = async (remote: string): Promise<RepoKey | null | 'pending'> => {
    const all = await serverRepos();
    if (all.length === 0) return null;
    const identity = identityOf(remote);
    for (const server of all) {
      if (!server.list) continue;
      const hit = identity ? hitByIdentity(identity, server.list) : null;
      if (hit) return formatRepoKey({ provider: server.provider.id, host: server.host, path: hit.path });
    }
    if (all.every((entry) => entry.list === null)) return 'pending';
    return null;
  };

  /** Typed-input resolution with Woodpecker-first matching (spec §7). */
  const resolveInput = async (input: string): Promise<RepoKey | null> => {
    const trimmed = input.trim();
    const asKey = parseRepoKey(trimmed);
    if (asKey) return formatRepoKey(asKey);
    // A pasted run URL (`…/repos/42/pipeline/128`) names a repo through the
    // server's own resolver, not through path segments.
    if (/\/pipeline\/\d+/.test(trimmed) || /#\//.test(trimmed)) {
      const runParsed = await parseRunUrl(trimmed, await knownHosts());
      if (runParsed) return runParsed.repo;
    }
    const all = await serverRepos();
    if (all.length > 0) {
      // A bare `host/owner/name` spells a URL without the scheme.
      const candidate = /^[\w.-]+\.[\w.-:]+\//.test(trimmed) ? `https://${trimmed}` : trimmed;
      const parsed = parseRemote(candidate);
      if (parsed) {
        const host = parsed.host.toLowerCase().replace(/:\d+$/, '');
        const segments = (parsed.segments ?? []).filter((segment) => segment.toLowerCase() !== 'repos');
        const server = all.find((entry) => entry.host === host);
        // A URL on the configured server host names the repo outright.
        if (server && segments.length >= 2) {
          return formatRepoKey({ provider: server.provider.id, host: server.host, path: segments.slice(0, 2).join('/') });
        }
        // A forge URL: match the remote identity against the listed clone URLs.
        const identity = identityOf(trimmed);
        if (identity) {
          for (const entry of all) {
            if (!entry.list) continue;
            const hit = hitByIdentity(identity, entry.list);
            if (hit) return formatRepoKey({ provider: entry.provider.id, host: entry.host, path: hit.path });
          }
        }
      } else {
        // Bare owner/name: match the server list case-insensitively.
        const bare = trimmed.replace(/\.git$/i, '').replace(/\/+$/, '');
        if (/^[\w.-]+\/[\w.-]+$/.test(bare)) {
          for (const entry of all) {
            if (!entry.list) continue;
            const hit = hitByPath(bare, entry.list);
            if (hit) return formatRepoKey({ provider: entry.provider.id, host: entry.host, path: hit.path });
          }
        }
      }
    }
    return resolveRepoInput(trimmed, await knownHosts());
  };

  /** Records what a host told us about limits and tokens. */
  const observe = (target: Target, err: unknown) => {
    if (!(err instanceof ProviderError)) return;
    if (err.kind === 'network' || err.kind === 'server') {
      const failures = (backoffs.get(target.account)?.failures ?? 0) + 1;
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
      backoffs.set(target.account, { failures, until: now() + wait });
    } else if (err.kind === 'rate-limit') {
      rates.set(target.account, {
        remaining: 0,
        resetAt: err.rateLimitReset,
        blockedUntil: err.rateLimitReset ?? now() + 60_000,
        message: err.message,
      });
    } else if (err.kind === 'auth') {
      const current = clients.get(target.account);
      const source = auths.get(target.account)?.source ?? null;
      if (current) rejected.set(target.account, current.token);
      if (source) {
        setAuth(target.provider, target.ref.host, {
          ok: false,
          source,
          sourceLabel: sourceLabel(source, target.provider),
          message: rejectedMessage(target.provider, source),
        });
      }
    }
  };

  /** The limit a host set on us, while it lasts. */
  const blockOf = (account: string): RateLimitInfo | null => {
    const rate = rates.get(account);
    return rate && rate.blockedUntil !== null && rate.blockedUntil > now() ? rate : null;
  };

  const call = async <T>(target: Target, work: (client: CiClient) => Promise<T>): Promise<T> => {
    if (blockOf(target.account)) {
      throw new EngineError(`${target.provider.label} rate limit reached; try again after it resets.`, 429);
    }
    const client = await clientFor(target.provider, target.ref.host);
    try {
      const result = await work(client);
      backoffs.delete(target.account);
      return result;
    } catch (err) {
      observe(target, err);
      throw err;
    }
  };

  /**
   * Every host with a watched repository. With none yet, each provider's public
   * host, so the panel can say how to sign in; a server-only setup is never
   * asked for a public account it does not use.
   */
  const accountsFor = async (views: RepoView[], extra: RepoKey[] = []): Promise<AccountView[]> => {
    const hosts = new Map<string, { provider: Provider; host: string }>();
    for (const key of [...views.filter((view) => view.enabled).map((view) => view.key), ...extra]) {
      const ref = parseRepoKey(key);
      if (!ref) continue;
      const provider = providerFor(ref.provider);
      hosts.set(accountOf(provider, ref.host), { provider, host: ref.host });
    }
    if (hosts.size === 0) {
      for (const provider of PROVIDERS) {
        const host = provider.publicHosts[0];
        if (host) hosts.set(accountOf(provider, host), { provider, host });
      }
    }
    // A configured self-hosted server (woodpecker-server) is an account on
    // its own, so its card, notes and rate state work before any repo exists.
    for (const server of await servers()) {
      hosts.set(accountOf(server.provider, server.host), { provider: server.provider, host: server.host });
    }
    return Promise.all(
      [...hosts].map(async ([account, { provider, host }]) => {
        await clientFor(provider, host).catch(() => undefined);
        const auth = auths.get(account) ?? { ok: false, source: null, sourceLabel: null, message: null };
        const rate = blockOf(account);
        return { provider: provider.id, host, label: provider.label, ...auth, rateLimit: rate ? { ...rate } : null };
      }),
    );
  };

  // ---- repositories -----------------------------------------------------

  const detect = async (directory: string, fresh = false): Promise<Detected> => {
    const cached = detected.get(directory);
    if (!fresh && cached && now() - cached.at < 60_000) return cached.value;
    const remote = await deps.git(['remote', 'get-url', 'origin'], directory).catch(() => null);
    const remoteUrl = remote && remote.code === 0 ? remote.stdout.trim() : null;
    let key: RepoKey | null | 'pending' = null;
    if (remoteUrl) key = await claim(remoteUrl);
    // A pending server list must not stick: the directory may claim later.
    if (key === 'pending') return null;
    if (!key && remoteUrl) key = detectRemote(remoteUrl, await knownHosts());
    let value: Detected = null;
    if (key) {
      const head = await deps.git(['rev-parse', '--abbrev-ref', 'HEAD'], directory).catch(() => null);
      const branch = head && head.code === 0 && head.stdout.trim() !== 'HEAD' ? head.stdout.trim() : null;
      value = { key, branch };
    }
    detected.set(directory, { value, at: now() });
    evictOldest(detected);
    return value;
  };

  const settingsRepos = async (): Promise<RepoKey[]> => {
    const settings = await readSettings();
    const entries = (settings.repos ?? '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const keys = await Promise.all(entries.map((entry) => resolveInput(entry)));
    return keys.filter((key): key is RepoKey => key !== null);
  };

  const listRepos = async (config?: Config, includeSettings = true): Promise<RepoView[]> => {
    const current = config ?? (await deps.config.load());
    const out = new Map<string, RepoView>();
    for (const repo of current.repos) {
      const view = viewOf(repo.key, repo.directory ?? null, repo.enabled, repo.directory ? 'detected' : 'manual');
      if (view && !out.has(repoKeyId(view.key))) out.set(repoKeyId(view.key), view);
    }
    if (includeSettings) {
      for (const key of await settingsRepos()) {
        const view = viewOf(key, null, true, 'settings');
        if (view && !out.has(repoKeyId(view.key))) out.set(repoKeyId(view.key), view);
      }
    }
    return [...out.values()];
  };

  /** The repository for a folder: a manual mapping wins over the git remote. */
  const repoForDirectory = async (
    directory: string | null,
    fresh = false,
  ): Promise<{ key: RepoKey; branch: string | null } | null> => {
    if (!directory) return null;
    const config = await deps.config.load();
    const mapped = config.directoryMap[directory];
    const found = await detect(directory, fresh);
    if (mapped) return { key: mapped, branch: found?.branch ?? null };
    if (!found) return null;
    if (!config.repos.some((entry) => repoKeyId(entry.key) === repoKeyId(found.key))) {
      config.repos.push({ key: found.key, directory, enabled: true, addedAt: now() });
      await deps.config.save(config);
    }
    return found;
  };

  /**
   * A key as is; an `owner/name` from before repo keys (old waits, status
   * buttons, panels) is the watched repository with that path, on whichever
   * host, and github.com only when none matches.
   */
  const keyFor = (input: string, repos: RepoView[]): RepoKey | null => {
    if (parseRepoKey(input)) return input;
    const legacy = legacyRepoKey(input);
    if (!legacy) return null;
    const path = input.toLowerCase();
    const matches = repos.filter((repo) => parseRepoKey(repo.key)?.path.toLowerCase() === path);
    const exact = matches.find((repo) => repoKeyId(repo.key) === repoKeyId(legacy));
    return (exact ?? matches[0])?.key ?? legacy;
  };

  /** Keeps an old `owner/name` for `keyFor`, which knows the watched hosts. */
  const keepLegacy = (input: string): RepoKey | null => (parseRepoKey(input) || legacyRepoKey(input) ? input : null);

  const repoInfo = async (input: string): Promise<Target> => {
    const repos = await listRepos();
    const key = keyFor(input, repos);
    if (!key) throw new EngineError('Unknown repository.');
    const known = repos.find((repo) => repoKeyId(repo.key) === repoKeyId(key));
    return targetOf(known ?? viewOf(key, null, true, 'manual')!);
  };

  const addRepo = async (input: string, directory: string | null = null): Promise<RepoView[]> => {
    const key = await resolveInput(input.trim());
    if (!key) throw new EngineError('Enter the repository as owner/name, a repository URL or a CI Hub repo key.');
    const config = await deps.config.load();
    const existing = config.repos.find((repo) => repoKeyId(repo.key) === repoKeyId(key));
    const target = targetOf(viewOf(existing?.key ?? key, null, true, 'manual')!);
    // Config changes are writes too: they belong in the same action log.
    await record('add-repo', target.key, directory ?? input.trim(), async () => {
      // Make sure it exists and the token can see it before we keep it.
      await call(target, (client) => client.defaultBranch(target.ref));
      if (existing) existing.enabled = true;
      else config.repos.push({ key: target.key, enabled: true, addedAt: now() });
      if (directory) config.directoryMap[directory] = target.key;
      await deps.config.save(config);
      void pollRepo(target.key);
    });
    return listRepos(config);
  };

  const removeRepo = async (input: RepoKey): Promise<RepoView[]> => {
    const config = await deps.config.load();
    const id = repoKeyId(keyFor(input, await listRepos(config)) ?? input);
    const key = config.repos.find((repo) => repoKeyId(repo.key) === id)?.key ?? input;
    await record('remove-repo', key, input, async () => {
      // A repository found through a project's remote would be found again on
      // the next overview, so it is kept switched off instead of forgotten.
      config.repos = config.repos.flatMap((repo) => {
        if (repoKeyId(repo.key) !== id) return [repo];
        return repo.directory ? [{ ...repo, enabled: false }] : [];
      });
      for (const [dir, mapped] of Object.entries(config.directoryMap)) {
        if (repoKeyId(mapped) === id) delete config.directoryMap[dir];
      }
      await deps.config.save(config);
      cache.delete(id);
    });
    return listRepos(config);
  };

  // ---- polling ----------------------------------------------------------

  const slotFor = (key: RepoKey): RepoCache => {
    const id = repoKeyId(key);
    let value = cache.get(id);
    if (!value) {
      value = { runs: [], polledAt: null, error: null, defaultBranch: null };
      cache.set(id, value);
    }
    return value;
  };

  /** Polls one repo; true when the cached runs are fresh, false on a provider error. */
  const pollRepo = async (key: RepoKey): Promise<boolean> => {
    const target = await repoInfo(key);
    const slot = slotFor(target.key);
    let fresh = true;
    try {
      slot.runs = await call(target, (client) => client.listRuns(target.ref, { perPage: 40 }));
      slot.error = null;
      if (!slot.defaultBranch) {
        slot.defaultBranch = await call(target, (client) => client.defaultBranch(target.ref)).catch(() => null);
      }
    } catch (err) {
      fresh = false;
      if (!(err instanceof ProviderError && err.kind === 'rate-limit') && !(err instanceof EngineError && err.status === 429)) {
        slot.error = describe(err);
      }
    }
    slot.polledAt = now();
    deps.emit('runs', { repo: target.key, polledAt: slot.polledAt });
    return fresh;
  };

  const busy = (slot: RepoCache): boolean => {
    const t = now();
    return slot.runs.some((run) => isActive(run) || t - (run.finishedAt ?? run.createdAt) < RECENT_MS);
  };

  /**
   * Repositories due for a poll. With the panel open, the one it shows and any
   * with recent activity go every tick; quiet ones only every POLL_SLOW_MS.
   */
  const watched = async (): Promise<Target[]> => {
    const t = now();
    const due = new Map<string, Target>();
    const repos = await listRepos();
    const panelOpen = t - panelSeenAt < PANEL_WINDOW_MS;
    const statusOpen = t - statusSeenAt < STATUS_WINDOW_MS;
    if (panelOpen) {
      for (const repo of repos) {
        if (!repo.enabled) continue;
        const slot = slotFor(repo.key);
        const hot = slot.polledAt === null || busy(slot) || panelRepos.has(repoKeyId(repo.key));
        if (hot || t - slot.polledAt! >= POLL_SLOW_MS) due.set(repoKeyId(repo.key), targetOf(repo));
      }
    }
    if (statusOpen) {
      for (const key of statusRepos) {
        const slot = slotFor(key);
        if (slot.polledAt !== null && t - slot.polledAt < POLL_SLOW_MS - 2_000) continue;
        const target = await repoInfo(key).catch(() => null);
        if (target) due.set(repoKeyId(target.key), target);
      }
    }
    // Idle: marks stay fresh even with every frame closed. Hot repos every
    // tick, quiet ones on the slow cadence; blocked accounts skipped later.
    if (!panelOpen && !statusOpen && (prefsCache?.marks ?? true)) {
      for (const repo of repos) {
        if (!repo.enabled) continue;
        const slot = slotFor(repo.key);
        const hot = slot.polledAt === null || busy(slot);
        if (hot || t - slot.polledAt! >= POLL_SLOW_MS) due.set(repoKeyId(repo.key), targetOf(repo));
      }
    }
    return [...due.values()];
  };

  const interval = (): number | null => {
    const t = now();
    if (t - panelSeenAt < PANEL_WINDOW_MS) return POLL_FAST_MS;
    if (t - statusSeenAt < STATUS_WINDOW_MS) return POLL_SLOW_MS;
    if (prefsCache?.marks ?? true) return POLL_IDLE_MS;
    return null;
  };

  const pollAll = async () => {
    if (polling) return polling;
    polling = (async () => {
      // A host that asked us to wait, or keeps failing, is skipped; the others carry on.
      for (const target of await watched()) {
        if (blockOf(target.account)) continue;
        if ((backoffs.get(target.account)?.until ?? 0) > now()) continue;
        await pollRepo(target.key);
      }
      await refreshMarks().catch(() => undefined);
    })().finally(() => {
      polling = null;
    });
    return polling;
  };

  // Directories that asked for a mark beyond the configured repos: session
  // events add theirs here, so a project never opened in the panel still gets one.
  const extraDirs = new Set<string>();
  // A Set keeps insertion order too; re-adding moves an entry to the newest end.
  const remember = (set: Set<string>, value: string): void => {
    set.delete(value);
    set.add(value);
    while (set.size > CACHE_CAP) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  };
  let markSync: ReturnType<typeof createMarkSync> | null = null;

  const refreshMarks = async (): Promise<void> => {
    if (!deps.setMark) return;
    markSync ??= createMarkSync({ setMark: deps.setMark, timers, now });
    if (!(await getPrefs()).marks) {
      await markSync.clear();
      return;
    }
    const config = await deps.config.load();
    const dirs = new Set<string>(extraDirs);
    for (const repo of config.repos) if (repo.enabled && repo.directory) dirs.add(repo.directory);
    for (const dir of Object.keys(config.directoryMap)) dirs.add(dir);
    const rows = [];
    for (const directory of dirs) {
      const found = await repoForDirectory(directory).catch(() => null);
      if (!found) continue;
      rows.push({ directory, branch: found.branch, runs: slotFor(found.key).runs });
    }
    await markSync.sync(rows);
  };

  // ---- session events ---------------------------------------------------

  const notifiedTurns = new Set<string>();

  /**
   * A turn ended: refresh that project's CI and its mark, then tell the open
   * frames once per failed run attempt. Never writes to the chat itself.
   */
  const sessionEvent = async (request: GuestSessionEventRequest): Promise<{ ok: true }> => {
    if (request.event.type !== 'turn-finished' && request.event.type !== 'turn-failed') return { ok: true };
    const directory = request.event.project?.directory ?? null;
    if (!directory) return { ok: true };
    remember(extraDirs, directory);
    // The turn may have switched branches: the cached branch cannot be trusted.
    const found = await repoForDirectory(directory, true).catch(() => null);
    if (!found) return { ok: true };
    const fresh = await pollRepo(found.key).catch(() => false);
    await refreshMarks().catch(() => undefined);
    // Never toast a failure that a failed refresh left in the cache.
    if (!fresh) return { ok: true };
    const run = latestOnBranch(slotFor(found.key).runs, found.branch);
    if (!run || !isFailed(run)) return { ok: true };
    const key = `${run.repo}#${run.id}:${run.attempt}`;
    if (notifiedTurns.has(key)) return { ok: true };
    remember(notifiedTurns, key);
    if ((await getPrefs()).toastOnTurnFailure) {
      deps.emit('turn-ci', {
        directory,
        repo: run.repo,
        branch: run.branch,
        runId: run.id,
        number: run.number,
        workflow: run.workflow,
        conclusion: run.conclusion,
        attempt: run.attempt,
      });
    }
    return { ok: true };
  };

  function reschedule() {
    const every = interval();
    if (every === null) {
      if (loop) timers.clear(loop);
      loop = null;
      loopDueAt = 0;
      return;
    }
    const due = now() + every;
    if (loop && loopDueAt <= due) return;
    if (loop) timers.clear(loop);
    loopDueAt = due;
    loop = timers.set(() => {
      loop = null;
      loopDueAt = 0;
      void pollAll().finally(reschedule);
    }, every);
  }

  /** Waits for `work` at most `ms`; the timer goes away with whichever ends first. */
  const raceTimer = async (work: Promise<unknown>, ms: number): Promise<void> => {
    let handle: unknown;
    try {
      await Promise.race([work, new Promise<void>((resolve) => (handle = timers.set(resolve, ms)))]);
    } finally {
      timers.clear(handle);
    }
  };

  /** Waits for a fresh read when the cache is older than `maxAge`, briefly. */
  const ensureFresh = async (target: Target, maxAge: number, waitMs: number) => {
    const slot = slotFor(target.key);
    if (slot.polledAt !== null && now() - slot.polledAt < maxAge) return;
    if (blockOf(target.account)) return;
    await raceTimer(pollRepo(target.key), waitMs);
  };

  const providers = () => PROVIDERS.map(providerView);

  // ---- reads for the panel ----------------------------------------------

  const state = async (directory: string | null): Promise<StateView> => {
    panelSeenAt = now();
    reschedule();
    const here = await repoForDirectory(directory);
    const repos = await listRepos();
    // Resolve the tokens now so the panel can say how we are signed in.
    const accounts = await accountsFor(repos, here ? [here.key] : []);
    const activeKey = here?.key ?? repos.find((repo) => repo.enabled)?.key ?? null;
    const active = activeKey ? await repoInfo(activeKey).catch(() => null) : null;
    let defaultBranch = active ? slotFor(active.key).defaultBranch : null;
    if (active && !defaultBranch && auths.get(active.account)?.ok && !blockOf(active.account)) {
      defaultBranch = await call(active, (client) => client.defaultBranch(active.ref)).catch(() => null);
      slotFor(active.key).defaultBranch = defaultBranch;
    }
    return {
      providers: providers(),
      repos,
      current: here?.key ?? null,
      currentBranch: here?.branch ?? null,
      defaultBranch,
      accounts,
    };
  };

  /**
   * Everything the panel's tree needs in one read: every project folder whose
   * remote is on a known CI host, plus repositories added by hand or in
   * settings, each with its cached newest runs.
   */
  const overview = async (input: {
    directory: string | null;
    projects: OverviewProject[];
    expanded: RepoKey[];
  }): Promise<OverviewView> => {
    panelSeenAt = now();
    panelRepos = new Set(input.expanded.map(repoKeyId));
    reschedule();

    const folders = new Map<string, OverviewProject | null>();
    for (const project of input.projects) if (!folders.has(project.directory)) folders.set(project.directory, project);
    if (input.directory && !folders.has(input.directory)) folders.set(input.directory, null);
    const found = await Promise.all(
      [...folders].map(async ([directory, project]) => ({ directory, project, repo: await detect(directory).catch(() => null) })),
    );

    // Register new remotes in one write; concurrent saves would drop entries.
    const config = await deps.config.load();
    let changed = false;
    for (const { directory, repo } of found) {
      if (!repo || config.directoryMap[directory]) continue;
      if (config.repos.some((entry) => repoKeyId(entry.key) === repoKeyId(repo.key))) continue;
      config.repos.push({ key: repo.key, directory, enabled: true, addedAt: now() });
      changed = true;
    }
    if (changed) await deps.config.save(config);

    const owners = new Map<string, { project: OverviewProject | null; branch: string | null }>();
    let current: RepoKey | null = null;
    for (const { directory, project, repo } of found) {
      const key = config.directoryMap[directory] ?? repo?.key;
      if (!key) continue;
      if (directory === input.directory) current = key;
      const id = repoKeyId(key);
      const known = owners.get(id);
      if (!known || (!known.project && project)) owners.set(id, { project, branch: repo?.branch ?? null });
    }

    const views = (await listRepos(config)).filter((repo) => repo.enabled);
    const targets = views.map(targetOf);
    const accounts = await accountsFor(views);
    const currentView = views.find((repo) => repoKeyId(repo.key) === repoKeyId(current ?? ''));

    // Repositories never read yet get a short chance to fill before we answer.
    const empty = targets.filter(
      (target) => slotFor(target.key).polledAt === null && auths.get(target.account)?.ok && !blockOf(target.account),
    );
    if (empty.length > 0) {
      await raceTimer(Promise.all(empty.map((target) => pollRepo(target.key).catch(() => undefined))), 8_000);
    }

    const repos: OverviewRepo[] = views.map((repo) => {
      const slot = slotFor(repo.key);
      const owner = owners.get(repoKeyId(repo.key));
      return {
        key: repo.key,
        provider: repo.provider,
        name: repo.name,
        webUrl: repo.webUrl,
        ciUrl: repo.ciUrl,
        project: owner?.project ?? null,
        defaultBranch: slot.defaultBranch,
        currentBranch: owner?.branch ?? null,
        polledAt: slot.polledAt,
        error: slot.error,
        runs: slot.runs,
      };
    });
    return { providers: providers(), repos, current: currentView?.key ?? null, accounts };
  };

  /** One page of a workflow's history, for a tree branch the user scrolled to the end of. */
  const workflowRuns = async (query: {
    repo: RepoKey;
    workflowId: string;
    branch?: string;
    actor?: string;
    page: number;
  }): Promise<WorkflowRunsView> => {
    if (!query.workflowId.trim()) throw new EngineError('Unknown workflow.');
    const target = await repoInfo(query.repo);
    if (!target.provider.capabilities.groupHistory) {
      throw new EngineError(`${target.provider.label} has no per-${target.provider.words.workflow} history.`);
    }
    const page = Math.max(1, Math.floor(query.page) || 1);
    panelSeenAt = now();
    const key = JSON.stringify([repoKeyId(target.key), 'workflow', query.workflowId, query.branch ?? '', query.actor ?? '', page]);
    const hit = historyCache.get(key);
    if (hit && now() - hit.at < QUERY_TTL_MS) return hit.view;
    const { runs, total } = await call(target, (client) =>
      client.listWorkflowRuns(target.ref, query.workflowId, {
        branch: query.branch,
        actor: query.actor,
        perPage: HISTORY_PAGE,
        page,
      }),
    );
    const view = { runs, hasMore: page * HISTORY_PAGE < total && runs.length > 0 };
    const at = now();
    for (const [k, v] of historyCache) if (at - v.at >= QUERY_TTL_MS) historyCache.delete(k);
    historyCache.set(key, { at, view });
    return view;
  };

  const runDetail = async (repo: RepoKey, runId: string): Promise<{ run: Run; jobs: Job[] }> => {
    panelSeenAt = now();
    const target = await repoInfo(repo);
    const [run, jobs] = await call(target, (client) =>
      Promise.all([client.getRun(target.ref, runId), client.listJobs(target.ref, runId)]),
    );
    // Keep the list in step with what the detail just saw.
    const slot = slotFor(target.key);
    const index = slot.runs.findIndex((entry) => entry.id === run.id);
    if (index >= 0) slot.runs[index] = run;
    return { run, jobs };
  };

  const log = async (repo: RepoKey, jobId: string, full: boolean) => {
    const target = await repoInfo(repo);
    const window = await call(target, (client) => client.getJobLog(target.ref, jobId, { full }));
    return { text: window.text, truncated: window.truncated };
  };

  // ---- mentions (@run in the composer) ----------------------------------------
  // Search reads only what the service has already polled; resolve may fetch
  // the run detail and one log tail. Both are read-only.

  const mentionsSearch = async (query: string): Promise<MentionHit[]> => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches: { hit: MentionHit; createdAt: number }[] = [];
    for (const view of (await listRepos(undefined, false)).filter((repo) => repo.enabled)) {
      const slot = slotFor(view.key);
      if (slot.error !== null || slot.runs.length === 0) continue;
      for (const run of slot.runs) {
        const match =
          String(run.number) === q ||
          [run.title, run.branch, run.workflow, view.name].some((part) => part.toLowerCase().includes(q));
        if (!match) continue;
        matches.push({
          createdAt: run.createdAt,
          hit: {
            id: `${view.key}|${run.id}`.slice(0, 256),
            title: `${run.title} · #${run.number}`.slice(0, 120),
            subtitle: `${view.name} · ${run.workflow} · ${run.branch}`.slice(0, 120),
            url: run.url,
          },
        });
      }
    }
    // Newest first across every repository, so one busy repo cannot starve the rest.
    return matches.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((entry) => entry.hit);
  };

  const mentionsResolve = async (id: string): Promise<string> => {
    const cut = id.lastIndexOf('|');
    if (cut <= 0 || cut >= id.length - 1) throw new EngineError('That mention does not name a run.');
    let detail: Awaited<ReturnType<typeof runDetail>>;
    try {
      detail = await runDetail(id.slice(0, cut), id.slice(cut + 1));
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'not-found') throw new EngineError('That run is not readable.', 404);
      // A repo the service cannot even resolve is the same dead end for the reader.
      if (err instanceof EngineError) throw new EngineError('That run is not readable.', 404);
      throw err;
    }
    const { run, jobs } = detail;
    const lines = [
      `${repoName(run.repo)} · ${run.workflow} #${run.number}`,
      `branch ${run.branch} · status ${run.status}${run.conclusion ? ` · ${run.conclusion}` : ''}`,
    ];
    const took = runDuration(run, now());
    if (took !== null) lines.push(`duration ${formatDuration(took)}`);
    lines.push(run.url, '');
    const pick =
      jobs.find((job) => job.conclusion === 'failure' || job.conclusion === 'timed_out' || job.conclusion === 'startup_failure') ??
      jobs.find((job) => job.status !== 'completed') ??
      null;
    if (!pick) lines.push('No failing or running job.');
    else {
      const window = await log(run.repo, pick.id, false).catch(() => null);
      if (!window) lines.push(`The log of job "${pick.name}" could not be read.`);
      else {
        const clipped = window.text.length > MENTION_TAIL ? `…${window.text.slice(-MENTION_TAIL)}` : window.text;
        lines.push(`Last of the job "${pick.name}":`, clipped);
      }
    }
    return lines.join('\n').slice(0, MENTION_TEXT);
  };

  // ---- writes -----------------------------------------------------------

  const record = async (action: string, repo: RepoKey, target: string, work: () => Promise<void>) => {
    try {
      await work();
      await deps.audit({ at: now(), action, repo, target, ok: true });
    } catch (err) {
      await deps.audit({ at: now(), action, repo, target, ok: false, message: describe(err) });
      throw err;
    }
  };

  /** A host takes a moment to show a new run or attempt; look again shortly. */
  const followUp = (key: RepoKey) => {
    const prefix = JSON.stringify([repoKeyId(key)]).slice(0, -1);
    for (const entry of historyCache.keys()) if (entry.startsWith(prefix)) historyCache.delete(entry);
    void pollRepo(key).catch(() => undefined);
    timers.set(() => void pollRepo(key).catch(() => undefined), 5_000);
    timers.set(() => void pollRepo(key).catch(() => undefined), 15_000);
  };

  const runAction = async (kind: RunActionKind, repo: RepoKey, runId: string) => {
    if (!/^[\w-]+$/.test(runId)) throw new EngineError('Unknown run.');
    const target = await repoInfo(repo);
    if (!CAPABLE[kind](target.provider)) throw new EngineError(`${target.provider.label} cannot ${kind} runs.`, 400);
    await record(kind, target.key, runId, () =>
      call(target, (client) => {
        if (kind === 'rerun-all') return client.rerunAll(target.ref, runId);
        if (kind === 'rerun-failed') return client.rerunFailed(target.ref, runId);
        if (kind === 'cancel') return client.cancel(target.ref, runId);
        if (kind === 'approve') {
          if (!client.approve) throw new EngineError(`${target.provider.label} cannot approve runs.`, 400);
          return client.approve(target.ref, runId);
        }
        if (!client.decline) throw new EngineError(`${target.provider.label} cannot decline runs.`, 400);
        return client.decline(target.ref, runId);
      }),
    );
    followUp(target.key);
  };

  const workflows = async (repo: RepoKey) => {
    const target = await repoInfo(repo);
    const [list, branch] = await call(target, (client) =>
      Promise.all([client.listWorkflows(target.ref), client.defaultBranch(target.ref)]),
    );
    return { workflows: list, defaultBranch: branch };
  };

  const dispatchInputs = async (repo: RepoKey, workflowId: string, ref: string) => {
    const target = await repoInfo(repo);
    return call(target, async (client) => {
      const list = await client.listWorkflows(target.ref);
      const workflow = list.find((entry) => entry.id === workflowId);
      if (!workflow) throw new EngineError(`That ${target.provider.words.workflow} no longer exists.`, 404);
      return client.getDispatchInputs(target.ref, workflow, ref);
    });
  };

  const dispatch = async (repo: RepoKey, workflowId: string, ref: string, inputs: Record<string, string>) => {
    if (!ref.trim()) throw new EngineError('Choose a branch or tag to run on.');
    const target = await repoInfo(repo);
    if (!target.provider.capabilities.dispatch) {
      throw new EngineError(`${target.provider.label} ${target.provider.words.workflows} cannot be started from CI Hub.`);
    }
    await record('dispatch', target.key, `${workflowId}@${ref}`, () =>
      call(target, (client) => client.dispatch(target.ref, workflowId, ref.trim(), inputs)),
    );
    followUp(target.key);
  };

  const handoff = async (repo: RepoKey, runId: string, jobId: string | null, mode: 'read' | 'fix' = 'read') => {
    const { run, jobs } = await runDetail(repo, runId);
    const job = (jobId ? jobs.find((entry) => entry.id === jobId) : null) ?? focusJob(jobs);
    const target = await repoInfo(repo);
    let text: string | null = null;
    let truncated = false;
    if (job) {
      const window = await call(target, (client) => client.getJobLog(target.ref, job.id, {})).catch(() => null);
      text = window?.text ?? null;
      truncated = window?.truncated ?? false;
    }
    const built: Handoff = buildHandoff({ run, jobs, job, log: text, logTruncated: truncated, mode });
    return { ...built, id: `${run.repo}#${run.id}`, branch: run.branch, sha: run.sha, directory: target.view.directory };
  };

  // ---- status section ---------------------------------------------------

  const status = async (directory: string | null): Promise<GuestStatusView> => {
    statusSeenAt = now();
    const here = await repoForDirectory(directory).catch(() => null);
    const target = here ? await repoInfo(here.key).catch(() => null) : null;
    statusRepos = new Set(target ? [target.key] : []);
    reschedule();
    const provider = target?.provider ?? PROVIDERS[0]!;
    const host = target?.ref.host ?? provider.publicHosts[0] ?? '';
    let authProblem: string | null = null;
    try {
      await clientFor(provider, host);
      const auth = auths.get(accountOf(provider, host));
      if (auth && !auth.ok) authProblem = auth.message;
    } catch (err) {
      authProblem = describe(err);
    }
    if (!authProblem && target) {
      await ensureFresh(target, POLL_SLOW_MS, 4_000).catch(() => undefined);
    }
    // The section answers "is my branch or main broken?": other branches stay in the panel.
    const slot = target ? slotFor(target.key) : null;
    const branches = new Set([slot?.defaultBranch, here?.branch].filter((b): b is string => !!b));
    const snapshots: RepoSnapshot[] =
      target && slot
        ? [
            {
              key: target.key,
              runs: branches.size > 0 ? slot.runs.filter((run) => branches.has(run.branch)) : slot.runs,
              polledAt: slot.polledAt,
              error: slot.error,
            },
          ]
        : [];
    const rate = blockOf(accountOf(provider, host));
    const built = buildStatusView({
      authProblem,
      repos: snapshots,
      blocked: rate ? { label: provider.label, until: rate.blockedUntil! } : null,
      noRepoText: `No ${LABELS} repository for this project. Open CI Hub in the sidebar to add one.`,
      now: now(),
    });
    // The host's charset cannot carry a repo key, so button ids decode through here.
    statusActions.clear();
    for (const [id, target] of built.actions) statusActions.set(id, target);
    return built.view;
  };

  const statusAction = async (id: string): Promise<void> => {
    const mapped = statusActions.get(id);
    if (mapped) {
      await runAction('rerun-failed', mapped.repo, mapped.runId);
      return;
    }
    const action = readStatusActionId(id, keepLegacy);
    if (!action) throw new EngineError('Unknown action.');
    if (action.kind === 'refresh') {
      for (const key of statusRepos) await pollRepo(key);
      return;
    }
    await runAction('rerun-failed', action.repo, action.runId);
  };

  // ---- waits ------------------------------------------------------------

  /**
   * Run URLs of different providers share a shape (`/actions/runs/7`), so a
   * provider only claims a URL for a host it owns: its public hosts, its name
   * pattern, or a server the user connected.
   */
  const parseRunUrl = async (url: string, hosts: KnownInstance[] = []) => {
    let host: string | null = null;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      return null;
    }
    // Same priority as remote detection (hostOwner): an exact public host,
    // then a server connected in OpenChamber — a github.* host running Gitea
    // must not lose its run URLs to github's name pattern — then patterns.
    const instance = hosts.find((entry) => entry.host === host);
    const candidates = [
      ...PROVIDERS.filter((provider) => provider.publicHosts.includes(host)),
      ...(instance ? [providerFor(instance.provider)] : []),
      ...PROVIDERS.filter((provider) => provider.hostPattern?.test(host) ?? false),
    ];
    for (const provider of candidates) {
      const found = provider.parseRunUrl(url);
      if (found) return found;
    }
    // A self-hosted CI server owns its configured host; its client turns a
    // repo-id URL into owner/name (`ci.codeberg.org/repos/42/pipeline/128`).
    for (const server of await servers()) {
      if (server.host !== host) continue;
      const client = await clientFor(server.provider, server.host);
      const found = await client.resolveRunUrl?.(url);
      if (found) return { repo: formatRepoKey({ provider: server.provider.id, host: server.host, path: found.path }), runId: found.runId };
    }
    return null;
  };

  const waitStart = async (args: Record<string, unknown>, directory: string | null = null): Promise<GuestWaitStartResult> => {
    const hosts = await knownHosts();
    let parsed: WaitArgs;
    try {
      parsed = await readWaitArgs(
        args,
        (url) => parseRunUrl(url, hosts),
        (input) => resolveInput(input),
      );
    } catch (err) {
      return { ok: false, error: describe(err).slice(0, 500) };
    }
    try {
      const key = parsed.repo ?? (await repoForDirectory(directory).catch(() => null))?.key;
      if (!key) {
        return {
          ok: false,
          error: `This session's folder has no ${LABELS} remote; pass repo as owner/name or a repository URL.`,
        };
      }
      const target = await repoInfo(key);
      const run = await call(target, (client) => client.getRun(target.ref, parsed.runId));
      const state: WaitState = {
        repo: target.key,
        runId: run.id,
        conclusion: parsed.conclusion,
        attempt: run.attempt,
        number: run.number,
        workflow: run.workflow,
      };
      return { ok: true, state: state as unknown as JsonValue, label: waitLabel(run) };
    } catch (err) {
      return { ok: false, error: describe(err).slice(0, 500) };
    }
  };

  const checkOne = async (id: string, rawState: unknown): Promise<GuestWaitCheckOutcome> => {
    const state = readWaitState(rawState, keepLegacy);
    if (!state) return { id, fired: true, summary: `CI Hub lost track of this wait; check the run on ${LABELS}.` };
    const target = await repoInfo(state.repo).catch(() => null);
    if (!target) return { id, fired: true, summary: `CI Hub lost track of this wait; check the run on ${LABELS}.` };
    try {
      const run = await call(target, (client) => client.getRun(target.ref, state.runId));
      const jobs =
        state.conclusion || run.status === 'completed'
          ? await call(target, (client) => client.listJobs(target.ref, state.runId)).catch(() => null)
          : null;
      const verdict = judgeWait(state, run, jobs);
      if (!verdict.fired) return { id, fired: false };
      let excerpt: string[] | null = null;
      const failed = jobs ? focusJob(jobs) : null;
      if (failed && failed.conclusion && failed.conclusion !== 'success') {
        const window = await call(target, (client) => client.getJobLog(target.ref, failed.id, {})).catch(() => null);
        if (window) excerpt = errorExcerpt(window.text, { maxLines: 30, context: 3 }, target.provider.logDialect).lines;
      }
      return { id, fired: true, summary: waitSummary(run, jobs ?? [], verdict.early, excerpt) };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'not-found') {
        return {
          id,
          fired: true,
          summary: `CI run ${state.runId} on ${repoName(state.repo)} is gone (${target.provider.label} answered 404).`,
        };
      }
      // Rate limits, network trouble and a missing token are passing states: keep waiting.
      return { id, fired: false };
    }
  };

  const waitCheck = async (waits: { id: string; state: unknown }[]): Promise<GuestWaitCheckOutcome[]> => {
    const results: GuestWaitCheckOutcome[] = [];
    for (const wait of waits) results.push(await checkOne(wait.id, wait.state));
    return results;
  };

  let prefsCache: Prefs | null = null;
  const getPrefs = async (): Promise<Prefs> => {
    if (!prefsCache) prefsCache = await deps.prefs.load();
    return { ...prefsCache };
  };
  const setPrefs = async (patch: Partial<Prefs>): Promise<Prefs> => {
    const next = await getPrefs();
    if (typeof patch.marks === 'boolean') next.marks = patch.marks;
    if (typeof patch.toastOnTurnFailure === 'boolean') next.toastOnTurnFailure = patch.toastOnTurnFailure;
    await deps.prefs.save(next);
    prefsCache = next;
    reschedule();
    await refreshMarks().catch(() => undefined);
    return { ...next };
  };

  // ---- agent-facing views (OpenCode plugin, slash commands) -----------------
  // Compact and capped: an agent's context should never pay for a full log.

  const agentRuns = async (args: {
    directory?: string | undefined;
    repo?: string | undefined;
    branch?: string | undefined;
    limit?: number | undefined;
    scope?: 'branch' | undefined;
  }) => {
    const found = args.repo
      ? { key: args.repo, branch: null }
      : await repoForDirectory(args.directory ?? null, args.scope === 'branch');
    if (!found) return null;
    // `scope: branch` means the folder's own branch; a detached HEAD has none.
    const branch = args.branch ?? (args.scope === 'branch' ? found.branch : null);
    const fresh = await pollRepo(found.key);
    if (!fresh) {
      throw new EngineError(slotFor(found.key).error ?? 'The CI provider is rate-limited right now; no fresh data.', 502);
    }
    const runs = slotFor(found.key).runs.filter((run) => !branch || run.branch === branch);
    return agentRunsView(runs, args.limit);
  };

  const agentRun = async (repo: RepoKey, runId: string) => {
    const { run, jobs } = await runDetail(repo, runId);
    return { ...agentRunView(run), jobs: agentJobsView(jobs) };
  };

  const agentLog = async (repo: RepoKey, runId: string, jobId?: string | undefined) => {
    const target = await repoInfo(repo);
    const { jobs } = await runDetail(repo, runId);
    const job = jobId ? jobs.find((entry) => entry.id === jobId) : (failedJobs(jobs)[0] ?? jobs[0]);
    if (!job) throw new EngineError(jobId ? 'No such job in this run.' : 'This run has no jobs.', 404);
    const window = await log(repo, job.id, true);
    const excerpt = errorExcerpt(window.text, { maxBytes: AGENT_LOG_MAX, maxLines: 400 }, target.provider.logDialect);
    const joined = excerpt.lines.join('\n');
    return {
      job: { id: job.id, name: job.name },
      excerpt: joined.slice(0, AGENT_LOG_MAX),
      truncated: window.truncated || excerpt.truncated || joined.length > AGENT_LOG_MAX,
    };
  };

  const stop = () => {
    if (loop) timers.clear(loop);
    loop = null;
  };

  return {
    start: () => {
      // Prefs first: a persisted marks:false must not cost an idle-poll cycle.
      void getPrefs()
        .catch(() => undefined)
        .then(() => pollAll())
        .finally(reschedule);
    },
    getPrefs,
    setPrefs,
    agentRuns,
    agentRun,
    agentLog,
    refreshMarks,
    extraDirs,
    sessionEvent,
    state,
    overview,
    workflowRuns,
    runDetail,
    log,
    mentionsSearch,
    mentionsResolve,
    addRepo,
    removeRepo,
    runAction,
    workflows,
    dispatchInputs,
    dispatch,
    handoff,
    status,
    statusAction,
    waitStart,
    waitCheck,
    pollAll,
    stop,
    /** For tests and /health. */
    debug: () => ({
      panelSeenAt,
      statusSeenAt,
      interval: interval(),
      rates: Object.fromEntries([...rates].map(([account, rate]) => [account, { ...rate }])),
      active: [...cache.keys()],
    }),
  };
};

export type Engine = ReturnType<typeof createEngine>;
