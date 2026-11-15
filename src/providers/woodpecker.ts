// The Woodpecker CI adapter: pipelines, steps and logs over the v3 JSON API.
// Woodpecker runs on its own server next to the forge, so the base URL comes
// from the configured `woodpecker-server` setting, not from the git remote.

import type { RepoKey, RepoRef } from '../domain/repoKey.ts';
import { formatRepoKey } from '../domain/repoKey.ts';
import type { Conclusion, Capabilities, DispatchInput, Job, ProviderWords, Run, RunStatus, WorkflowRef } from '../domain/types.ts';
import { asString, isObject, parseVariablesObject } from './compat.ts';
import type { ClientOptions, CiClient, ListRunsOptions, Provider, ServerRepo } from './types.ts';
import { ProviderError } from './errors.ts';
import type { FetchLike } from './errors.ts';

const WINDOW = 50;
const TAIL_BYTES = 128 * 1024;
const FULL_LOG_CAP_BYTES = 1024 * 1024;
const MAX_JOBS = 100;

/** Our status word → the Woodpecker `status` filter value. */
const STATUS_FILTER: Record<string, string> = {
  in_progress: 'running',
  failed: 'failure',
  succeeded: 'success',
  cancelled: 'killed',
};

const stateOf = (value: string): { status: RunStatus; conclusion: Conclusion } => {
  switch (value) {
    case 'pending':
    case 'created':
      return { status: 'queued', conclusion: null };
    // Waiting for approval: the panel offers Approve/Decline while it waits.
    case 'blocked':
      return { status: 'waiting', conclusion: null };
    case 'declined':
      return { status: 'completed', conclusion: 'cancelled' };
    case 'running':
      return { status: 'in_progress', conclusion: null };
    case 'success':
      return { status: 'completed', conclusion: 'success' };
    case 'failure':
    case 'error':
      return { status: 'completed', conclusion: 'failure' };
    case 'killed':
    case 'canceled':
      return { status: 'completed', conclusion: 'cancelled' };
    case 'skipped':
      return { status: 'completed', conclusion: 'skipped' };
    default:
      return { status: 'unknown', conclusion: null };
  }
};

const unixMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null;

/** The run's own page: live UIs route without the `#/` fragment. */
const runUrl = (web: string, repoId: string, number: string): string =>
  `${web}/repos/${repoId}/pipeline/${number}`;

/** The job id encodes both numbers the log path needs. */
const jobIdOf = (number: unknown, stepId: unknown): string | null => {
  if (typeof number !== 'number' || typeof stepId !== 'number') return null;
  return `${number}-${stepId}`;
};

/** `<pipeline_number>-<step_id>`; the parts feed the log path verbatim. */
const splitJobId = (jobId: string): { number: string; stepId: string } | null => {
  const cut = jobId.indexOf('-');
  if (cut <= 0 || cut === jobId.length - 1) return null;
  return { number: jobId.slice(0, cut), stepId: jobId.slice(cut + 1) };
};

const decodeEntry = (data: unknown): string => {
  if (typeof data !== 'string') return '';
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

export const decodeWoodpeckerLog = (raw: unknown): string => {
  if (!Array.isArray(raw)) return '';
  const lines: string[] = [];
  for (const entry of raw) {
    // Types: 0 stdout, 1 stderr, 2 exit-code, 3 metadata, 4 progress.
    if (!isObject(entry)) continue;
    const type = entry['type'];
    if (type !== 0 && type !== 1 && type !== 2) continue;
    lines.push(decodeEntry(entry['data']));
  }
  return lines.join('\n');
};

export const mapWoodpeckerRun = (raw: unknown, web: string, ref: RepoRef, repoId: string): Run => {
  const source = isObject(raw) ? raw : {};
  const { status, conclusion } = stateOf(asString(source['status']));
  const number = typeof source['number'] === 'number' ? source['number'] : 0;
  const message = asString(source['message']) || asString(source['title']);
  return {
    id: String(number),
    provider: 'woodpecker',
    repo: formatRepoKey(ref),
    number,
    workflow: 'Pipelines',
    workflowId: 'pipelines',
    branch: asString(source['branch']),
    sha: asString(source['commit']),
    title: message.split('\n', 1)[0] ?? '',
    event: asString(source['event']),
    attempt: 1,
    status,
    conclusion,
    createdAt: unixMs(source['created']) ?? 0,
    startedAt: unixMs(source['started']),
    finishedAt: unixMs(source['finished']),
    actor: asString(source['sender']),
    url: number ? runUrl(web, repoId, String(number)) : '',
    commitUrl: asString(source['forge_url']) || null,
  };
};

export const mapWoodpeckerJobs = (raw: unknown, web: string, repoId: string): Job[] => {
  const source = isObject(raw) ? raw : {};
  const number = typeof source['number'] === 'number' ? String(source['number']) : '';
  const jobs: Job[] = [];
  const workflows = Array.isArray(source['workflows']) ? source['workflows'] : [];
  for (const workflow of workflows) {
    const children = isObject(workflow) && Array.isArray(workflow['children']) ? workflow['children'] : [];
    for (const step of children) {
      if (!isObject(step)) continue;
      // Clone and service containers are scaffolding, not the pipeline's work.
      if (step['type'] === 'clone' || step['type'] === 'service') continue;
      const { status, conclusion } = stateOf(asString(step['state']));
      const id = jobIdOf(source['number'], step['id']);
      if (!id) continue;
      jobs.push({
        id,
        runId: number,
        name: asString(step['name']),
        status,
        conclusion,
        startedAt: unixMs(step['started']),
        finishedAt: unixMs(step['finished']),
        steps: [],
        url: number ? runUrl(web, repoId, number) : '',
      });
      if (jobs.length >= MAX_JOBS) return jobs;
    }
  }
  return jobs;
};

class WoodpeckerApi {
  private readonly base: string;
  private readonly fetch: FetchLike;
  private readonly token: string;
  /** `owner/name` → repo id, learned from lookup and the server list. */
  private readonly repoIds = new Map<string, string>();
  private readonly branches = new Map<string, string>();

  constructor(opts: ClientOptions) {
    this.base = `${opts.origin ?? `https://${opts.host}`}/api`;
    this.fetch = opts.fetch;
    this.token = opts.token;
  }

  async send<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(`${this.base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...(init?.headers ?? {}) },
      });
    } catch (cause) {
      throw new ProviderError(`Woodpecker is unreachable: ${String(cause)}`, { kind: 'network' });
    }
    if (response.status === 401) {
      throw new ProviderError('The Woodpecker token was rejected (CI Hub card, woodpecker-token).', {
        kind: 'auth',
        status: response.status,
      });
    }
    if (response.status === 403) {
      throw new ProviderError('The Woodpecker token may not see this repository.', {
        kind: 'forbidden',
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new ProviderError('Woodpecker does not know this repository.', {
        kind: 'not-found',
        status: response.status,
      });
    }
    if (response.status >= 500) {
      throw new ProviderError('The Woodpecker server failed on this request.', {
        kind: 'server',
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new ProviderError(`Woodpecker answered ${response.status}.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
    try {
      return (await response.json()) as T;
    } catch {
      // A proxy or captive portal answering HTML must not crash the call.
      throw new ProviderError(`Woodpecker answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
  }

  private path(segments: string[]): string {
    return segments.map((segment) => encodeURIComponent(segment)).join('/');
  }

  private lookupPath(repo: RepoRef): string {
    return `/repos/lookup/${this.path(repo.path.split('/'))}`;
  }

  /** The numeric repo id every other path needs, cached per owner/name. */
  async repoId(repo: RepoRef): Promise<string> {
    const known = this.repoIds.get(repo.path);
    if (known) return known;
    const found = await this.send<Record<string, unknown>>(this.lookupPath(repo));
    const id = typeof found['id'] === 'number' ? String(found['id']) : '';
    if (!id) throw new ProviderError('Woodpecker does not know this repository.', { kind: 'not-found' });
    this.repoIds.set(repo.path, id);
    this.branches.set(repo.path, asString(found['default_branch']));
    return id;
  }

  async pipelinesPath(repo: RepoRef): Promise<string> {
    return `/repos/${await this.repoId(repo)}/pipelines`;
  }

  seedRepos(repos: ServerRepo[]): void {
    for (const repo of repos) this.repoIds.set(repo.path, repo.id);
  }

  /** The id after a warm-up call; callers invoke this only after one. */
  repoIdSync(repo: RepoRef): string {
    return this.repoIds.get(repo.path) ?? '';
  }

  branchSync(repo: RepoRef): string | undefined {
    return this.branches.get(repo.path);
  }
}

export const createWoodpeckerClient = (opts: ClientOptions): CiClient => {
  const web = opts.origin ?? `https://${opts.host}`;
  const api = new WoodpeckerApi(opts);

  const client: CiClient = {
    async listRuns(repo, options) {
      const base = await api.pipelinesPath(repo);
      const params = new URLSearchParams();
      if (options?.branch) params.set('branch', options.branch);
      if (options?.event) params.set('event', options.event);
      if (options?.status) params.set('status', STATUS_FILTER[options.status] ?? options.status);
      const perPage = options?.perPage ?? WINDOW;
      params.set('perPage', String(perPage));
      params.set('page', String(options?.page ?? 1));
      const query = params.toString();
      const list = await api.send<unknown[]>(`${base}${query ? `?${query}` : ''}`);
      return (Array.isArray(list) ? list : []).map((raw) => mapWoodpeckerRun(raw, web, repo, api.repoIdSync(repo)));
    },

    async listWorkflowRuns(repo, workflowId, options) {
      if (workflowId !== 'pipelines') return { runs: [], total: 0 };
      const perPage = options?.perPage ?? WINDOW;
      const runs = await this.listRuns(repo, { ...options, perPage });
      // The list answers no total: a full page means "maybe more".
      const total = runs.length === perPage ? perPage * (options?.page ?? 1) + 1 : runs.length;
      return { runs, total };
    },

    async getRun(repo, runId) {
      const base = await api.pipelinesPath(repo);
      const found = await api.send<Record<string, unknown>>(`${base}/${encodeURIComponent(runId)}`);
      return mapWoodpeckerRun(found, web, repo, api.repoIdSync(repo));
    },

    async listJobs(repo, runId) {
      const base = await api.pipelinesPath(repo);
      const found = await api.send<Record<string, unknown>>(`${base}/${encodeURIComponent(runId)}`);
      return mapWoodpeckerJobs(found, web, api.repoIdSync(repo));
    },

    async getJobLog(repo, jobId, options) {
      const parts = splitJobId(jobId);
      if (!parts) throw new ProviderError('That job id is not a Woodpecker step.', { kind: 'not-found' });
      const repoId = await api.repoId(repo);
      const path = `/repos/${repoId}/logs/${encodeURIComponent(parts.number)}/${encodeURIComponent(parts.stepId)}`;
      const log = await api.send<unknown>(path);
      let text = decodeWoodpeckerLog(log);
      let truncated = false;
      const tailBytes = options?.tailBytes ?? TAIL_BYTES;
      const cap = options?.full ? FULL_LOG_CAP_BYTES : tailBytes;
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength > cap) {
        const cut = bytes.byteLength - cap;
        text = new TextDecoder('utf-8').decode(bytes.slice(cut));
        truncated = true;
      }
      if (truncated) {
        // Drop the partial first line of a tail window, but keep it when the
        // window holds no complete line (a tail cut inside the last line).
        const newline = text.indexOf('\n');
        if (newline !== -1 && newline < 4096 && newline < text.length - 1) text = text.slice(newline + 1);
      }
      return { text, truncated };
    },

    async rerunAll(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}`, { method: 'POST' });
    },

    async rerunFailed() {
      throw new ProviderError('Woodpecker has no re-run-failed API; restart the pipeline instead.', {
        kind: 'unsupported',
      });
    },

    async cancel(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    },

    async approve(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/approve`, { method: 'POST' });
    },

    async decline(repo, runId) {
      const base = await api.pipelinesPath(repo);
      await api.send(`${base}/${encodeURIComponent(runId)}/decline`, { method: 'POST' });
    },

    async listWorkflows() {
      // Woodpecker lists no workflow files; one group, the GitLab precedent.
      return [{ id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }];
    },

    async getDispatchInputs(repo) {
      const repoId = await api.repoId(repo);
      const list = await api.send<unknown[]>(`/repos/${repoId}/workflows`);
      const names = (Array.isArray(list) ? list : [])
        .map((entry) => (isObject(entry) ? asString(entry['name']) : null))
        .filter((name): name is string => Boolean(name));
      const inputs: DispatchInput[] = [];
      if (names.length > 1) {
        inputs.push({
          name: 'workflow',
          description: 'Which pipeline to run; empty runs all of them.',
          required: false,
          default: '',
          type: 'choice',
          options: names,
        });
      }
      inputs.push({
        name: 'variables',
        description: 'Pipeline variables, as key/value pairs.',
        required: false,
        default: '',
        type: 'variables',
        options: [],
      });
      return { dispatchable: true, inputs, refusal: null };
    },

    async dispatch(repo, _workflowId, branch, inputs) {
      const base = await api.pipelinesPath(repo);
      const workflow = inputs?.['workflow']?.trim();
      await api.send(base, {
        method: 'POST',
        body: JSON.stringify({ branch, variables: parseVariablesObject(inputs?.['variables']), ...(workflow ? { workflow } : {}) }),
      });
    },

    async defaultBranch(repo) {
      const cached = api.branchSync(repo);
      if (cached) return cached;
      await api.repoId(repo);
      return api.branchSync(repo) ?? 'main';
    },

    async resolveRunUrl(url) {
      // Live UIs route by history (…/repos/42/pipeline/128); older builds
      // keep the hash form. Both carry the repo id, which the API resolves.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      const target = parsed.hash.startsWith('#/') ? parsed.hash.slice(1) : parsed.pathname;
      const match = /^\/repos\/(\d+)(?:\/pipeline\/(\d+))?$/.exec(target);
      if (!match || !match[2]) return null;
      const found = await api.send<Record<string, unknown>>(`/repos/${match[1]}`);
      const path = asString(found['full_name']);
      if (!path) return null;
      return { path, runId: match[2] };
    },

    async listServerRepos() {
      const list = await api.send<unknown[]>('/user/repos');
      const repos: ServerRepo[] = [];
      for (const entry of Array.isArray(list) ? list : []) {
        if (!isObject(entry)) continue;
        const path = asString(entry['full_name']);
        const id = typeof entry['id'] === 'number' ? String(entry['id']) : '';
        if (!path || !id) continue;
        const cloneUrls = [asString(entry['clone_url']), asString(entry['clone_url_ssh'])].filter(Boolean);
        repos.push({ path, id, cloneUrls, forgeUrl: asString(entry['forge_url']) || null });
      }
      api.seedRepos(repos);
      return repos;
    },
  };
  return client;
};

const WOODPECKER_CAPABILITIES: Capabilities = {
  rerunAll: 'new-pipeline',
  rerunFailed: false,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: 'pipeline-variables',
  jobDetail: 'none',
  approve: true,
  groupHistory: true,
};

const WOODPECKER_WORDS: ProviderWords = {
  run: 'pipeline',
  runs: 'pipelines',
  workflow: 'pipeline',
  workflows: 'pipelines',
  rerunFailed: 'Retry failed jobs',
  rerunFailedShort: 'Retry failed',
  rerunAll: 'Restart pipeline',
  rerunAllShort: 'Restart',
  cancelDelay: 'Woodpecker takes a few seconds to stop it.',
  logPending: 'Woodpecker shows the log while the step runs.',
  logMissing: 'Woodpecker has no log for this step (it may have been skipped or erased).',
  dispatchHelp: 'Pick a branch; Woodpecker starts a manual pipeline on it.',
  repoPlaceholder: 'owner/name or a Woodpecker repository URL',
  tokenOrder:
    'CI Hub reads the woodpecker-token on the CI Hub card for the server set as woodpecker-server. Reading needs a token with repository scope; restart, cancel and manual runs need write.',
  noAccount:
    'No Woodpecker server. Set woodpecker-server and paste a woodpecker-token on the CI Hub card.',
};

export const woodpecker: Provider = {
  id: 'woodpecker',
  label: 'Woodpecker',
  words: WOODPECKER_WORDS,
  capabilities: WOODPECKER_CAPABILITIES,
  logDialect: 'github',
  publicHosts: [],
  hostPattern: null,
  storeKey: null,
  settingKey: 'woodpecker-token',
  serverSetting: 'woodpecker-server',
  authSetting: null,
  cli: null,
  apiOrigin: (host) => `https://${host.toLowerCase()}/api`,
  repoPath: (segments) => (segments.length === 2 ? segments.join('/') : null),
  webUrl: (ref) => `https://${ref.host.toLowerCase()}/repos/${ref.path}`,
  ciUrl: (ref) => `https://${ref.host.toLowerCase()}/repos/${ref.path}`,
  // Run URLs carry a repo id, not owner/name; the client resolves them.
  parseRunUrl: () => null,
  createClient: (options) => createWoodpeckerClient(options),
};
