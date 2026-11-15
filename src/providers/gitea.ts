// Gitea Actions adapter (1.25+). Gitea copies GitHub's Actions API under
// /api/v1 with token auth; the run JSON differs (a `file@ref` path instead of
// a workflow id, started_at/completed_at instead of created/updated), and the
// write surface depends on the server version: 1.26 added the re-run
// endpoints, and there is no cancel API yet. Pure over an injected fetch, so
// tests replay recorded payloads and the service decides where the token
// comes from.
import { formatRepoKey, type RepoRef } from '../domain/repoKey.ts';
import { byteLength, sliceByBytes } from '../domain/log.ts';
import type { Capabilities, Run, WorkflowRef } from '../domain/types.ts';
import { asString, conclusionOf, isObject, statusOf, time, workflowFileOf } from './compat.ts';
import { ProviderError, type FetchLike } from './errors.ts';
import { hasDispatchTrigger, mapJob, parseDispatchInputs } from './github.ts';
import type { CiClient, ClientOptions, ListRunsOptions, Provider } from './types.ts';

const WINDOW = 50;
const GROUP_PAGE_CAP = 5;
const TAIL_BYTES = 128 * 1024;
const FULL_TRACE_CAP_BYTES = 1024 * 1024;

const apiOriginFor = (host: string): string => `https://${host.toLowerCase()}/api/v1`;

const webUrlOf = (ref: RepoRef): string => `https://${ref.host}/${ref.path}`;

const STATUS_QUERY: Record<string, string> = {
  in_progress: 'in_progress',
  failed: 'failure',
  succeeded: 'success',
  cancelled: 'cancelled',
};

const RUN_URL = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/;

class GiteaApi {
  private readonly fetch: FetchLike;
  private readonly token: string;
  readonly origin: string;
  readonly host: string;

  constructor(options: ClientOptions) {
    this.fetch = options.fetch;
    this.token = options.token;
    this.host = options.host;
    this.origin = apiOriginFor(options.host);
  }

  async send(path: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.origin}${path}`;
    let response: Response;
    try {
      response = await this.fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'openchamber-ci-hub',
          Authorization: `token ${this.token}`,
          ...extraHeaders,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `Gitea unreachable: ${err.message}` : 'Gitea unreachable', {
        kind: 'network',
      });
    }
    if (response.status === 401) {
      throw new ProviderError('Gitea rejected the token (401). Reconnect the account.', { kind: 'auth', status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError('Gitea refused the request (403). The token may lack the scopes it needs.', {
        kind: 'forbidden',
        status: 403,
      });
    }
    if (response.status === 404) {
      throw new ProviderError('Not found on Gitea (404).', { kind: 'not-found', status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`Gitea answered ${response.status}.`, { kind: 'server', status: response.status });
    }
    if (!response.ok) {
      throw new ProviderError(`Gitea answered ${response.status}.`, { kind: 'unknown', status: response.status });
    }
    return response;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.send(path, init);
    const text = await response.text();
    if (text.trim() === '') return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(`Gitea answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
  }
}

/** `content` is base64 for the default contents answer; tolerate a raw string too. */
const contentsText = (body: unknown): string => {
  if (!isObject(body)) return '';
  const content = body.content;
  if (typeof content !== 'string') return '';
  return asString(body.encoding) === 'base64' ? atob(content.replace(/\s+/g, '')) : content;
};

export const mapGiteaRun = (ref: RepoRef, raw: unknown): Run | null => {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const workflowId = workflowFileOf(asString(raw.path));
  const sha = asString(raw.head_sha);
  const started = time(raw.started_at);
  return {
    id: String(id),
    provider: 'gitea',
    repo: formatRepoKey(ref),
    number: typeof raw.run_number === 'number' ? raw.run_number : 0,
    workflow: asString(raw.display_title) || workflowId || 'workflow',
    workflowId,
    branch: asString(raw.head_branch),
    sha,
    title: asString(raw.display_title),
    event: asString(raw.event),
    attempt: typeof raw.run_attempt === 'number' && raw.run_attempt > 0 ? raw.run_attempt : 1,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    createdAt: started ?? 0,
    startedAt: started,
    finishedAt: statusOf(raw.status) === 'completed' ? time(raw.completed_at) : null,
    actor: isObject(raw.actor) ? asString(raw.actor.login) : '',
    url: asString(raw.html_url),
    commitUrl: sha === '' ? null : `${webUrlOf(ref)}/commit/${sha}`,
  };
};

const runsOf = (ref: RepoRef, body: unknown): Run[] => {
  const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return runs.map((raw) => mapGiteaRun(ref, raw)).filter((run): run is Run => run !== null);
};

export const createGiteaClient = (options: ClientOptions): CiClient => {
  const api = new GiteaApi(options);
  const host = options.host;

  // The write surface depends on the server version, which is read once and
  // cached for the client's life. A failed probe keeps reads on a 1.25
  // baseline and refuses writes, saying the version could not be verified.
  let gate: Promise<string | null> | null = null;
  const versionOnce = (): Promise<string | null> => {
    if (!gate) {
      gate = api
        .json<{ version?: unknown }>('/version')
        .then((body) => (isObject(body) && typeof body.version === 'string' ? body.version : null))
        .catch(() => null);
    }
    return gate;
  };

  const versionParts = async (): Promise<[string, number, number] | null> => {
    const version = await versionOnce();
    if (version === null) return null;
    const match = /^(\d+)\.(\d+)/.exec(version);
    return match ? [version, Number(match[1]), Number(match[2])] : null;
  };

  const requireRuns = async (): Promise<void> => {
    const parsed = await versionParts();
    if (parsed === null) return;
    const [version, major, minor] = parsed;
    if (major < 1 || (major === 1 && minor < 25)) {
      throw new ProviderError(`CI Hub needs Gitea 1.25 or newer; ${host} answers ${version}.`, {
        kind: 'unsupported',
      });
    }
  };

  const requireReRun = async (): Promise<void> => {
    const parsed = await versionParts();
    if (parsed === null) {
      throw new ProviderError(`CI Hub could not verify the Gitea version on ${host}, so re-run is refused.`, {
        kind: 'unsupported',
      });
    }
    const [version, major, minor] = parsed;
    if (major < 1 || (major === 1 && minor < 26)) {
      throw new ProviderError(`Gitea added the re-run APIs in 1.26; ${host} answers ${version}.`, {
        kind: 'unsupported',
      });
    }
  };

  const base = (repo: RepoRef) => `/repos/${repo.path.split('/').map(encodeURIComponent).join('/')}`;

  const runParams = (opts: ListRunsOptions, page: number, limit: number): string => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (opts.branch) params.set('branch', opts.branch);
    if (opts.event) params.set('event', opts.event);
    if (opts.actor) params.set('actor', opts.actor);
    if (opts.status) {
      const query = STATUS_QUERY[opts.status];
      if (query) params.set('status', query);
    }
    return params.toString();
  };

  const runPathPrefix = (raw: unknown): string => (isObject(raw) ? asString(raw.path).split('@')[0] ?? '' : '');

  const client: CiClient = {
    async listRuns(repo, opts = {}) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, opts.page ?? 1, opts.perPage ?? 50)}`);
      return runsOf(repo, body);
    },

    async listWorkflowRuns(repo, workflowId, opts = {}) {
      await requireRuns();
      const page = Math.max(1, opts.page ?? 1);
      const perPage = opts.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP, Math.ceil((page * perPage) / WINDOW));
      const group: Run[] = [];
      let lastPageFull = false;
      for (let underlying = 1; underlying <= pages; underlying += 1) {
        const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, underlying, WINDOW)}`);
        const items = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        lastPageFull = items.length >= WINDOW;
        for (const raw of items) {
          const run = mapGiteaRun(repo, raw);
          if (run && run.workflowId === workflowId) group.push(run);
        }
      }
      // A full last window says nothing about the end of history; peek once so
      // the panel's hasMore stays honest (same as gitlab.ts).
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP) {
        const body = await api.json(`${base(repo)}/actions/runs?${runParams(opts, pages + 1, WINDOW)}`);
        const items = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        const more = items.some((raw) => {
          const prefix = runPathPrefix(raw);
          return prefix === workflowId || prefix.endsWith(`/${workflowId}`);
        });
        if (more) total = group.length + 1;
      }
      return { runs: group.slice((page - 1) * perPage, page * perPage), total };
    },

    async getRun(repo, runId) {
      await requireRuns();
      const direct = await api
        .json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`)
        .then((raw) => mapGiteaRun(repo, raw))
        .catch((err: unknown) => {
          // A server error is news; only a genuinely missing run falls back
          // to the list (forgejo mirrors this).
          if (err instanceof ProviderError && err.kind === 'not-found') return null;
          throw err;
        });
      if (direct) return direct;
      // Gitea's web URLs carry the run index while the API reads by id; map
      // one to the other through the newest page of runs.
      if (!/^\d+$/.test(runId)) throw new ProviderError('That run is not readable.', { kind: 'unknown' });
      const wanted = Number(runId);
      const body = await api.json(`${base(repo)}/actions/runs?${runParams({}, 1, 50)}`);
      const hit = runsOf(repo, body).find((run) => run.number === wanted);
      if (hit) return hit;
      throw new ProviderError('That run is not readable.', { kind: 'unknown' });
    },

    async listJobs(repo, runId) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?limit=50`);
      const jobs = isObject(body) && Array.isArray(body.jobs) ? body.jobs : [];
      return jobs.map((raw) => mapJob(runId, raw)).filter((job): job is NonNullable<typeof job> => job !== null);
    },

    async getJobLog(repo, jobId, opts = {}) {
      await requireRuns();
      // The whole log comes back as the body; no redirect, no documented Range.
      const tailBytes = opts.tailBytes ?? TAIL_BYTES;
      const response = await api.send(`${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`);
      let text = await response.text();
      let truncated = false;
      const cap = opts.full ? FULL_TRACE_CAP_BYTES : tailBytes;
      // The cap is bytes on the wire; UTF-16 length would both under-cut the
      // window and risk cutting a surrogate pair in half.
      const size = byteLength(text);
      if (size > cap) {
        text = sliceByBytes(text, size - cap, size);
        truncated = true;
      }
      if (truncated) {
        // Drop the partial first line of a tail window, but keep it when the
        // window holds no complete line (a tail cut inside the last line).
        const cut = text.indexOf('\n');
        if (cut !== -1 && cut < 4096 && cut < text.length - 1) text = text.slice(cut + 1);
      }
      return { text, truncated };
    },

    async rerunAll(repo, runId) {
      await requireReRun();
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' });
    },

    async rerunFailed(repo, runId) {
      await requireReRun();
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun-failed-jobs`, { method: 'POST' });
    },

    async cancel() {
      throw new ProviderError('Gitea has no cancel API; stop the workflow on the server.', { kind: 'unsupported' });
    },

    async listWorkflows(repo) {
      await requireRuns();
      const body = await api.json(`${base(repo)}/actions/workflows?limit=50`);
      const list = isObject(body) && Array.isArray(body.workflows) ? body.workflows : [];
      return list
        .filter(isObject)
        .map((raw) => {
          const path = asString(raw.path);
          const id = asString(raw.id);
          return { id, name: asString(raw.name) || path || id, path, file: id };
        })
        .filter((workflow) => workflow.id !== '');
    },

    async getDispatchInputs(repo, workflow, ref) {
      await requireRuns();
      const path = `${base(repo)}/contents/${workflow.path.split('/').map(encodeURIComponent).join('/')}`;
      const body = await api.json(`${path}?ref=${encodeURIComponent(ref)}`);
      const yaml = contentsText(body);
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable
          ? null
          : `This workflow has no workflow_dispatch trigger on ${ref}, so Gitea will refuse to start it.`,
      };
    },

    async dispatch(repo, workflowId, ref, inputs) {
      await requireRuns();
      await api.send(`${base(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs }),
        headers: { 'Content-Type': 'application/json' },
      });
    },

    async defaultBranch(repo) {
      await requireRuns();
      const body = await api.json(`${base(repo)}`);
      return isObject(body) ? asString(body.default_branch, 'main') : 'main';
    },
  };
  return client;
};

const CAPABILITIES: Capabilities = {
  rerunAll: 'same-run',
  rerunFailed: true,
  cancel: false,
  retryJob: false,
  playManualJob: false,
  dispatch: 'workflow-inputs',
  jobDetail: 'steps',
  approve: false,
  groupHistory: true,
};

export const gitea: Provider = {
  id: 'gitea',
  label: 'Gitea',
  words: {
    run: 'run',
    runs: 'runs',
    workflow: 'workflow',
    workflows: 'workflows',
    rerunFailed: 'Re-run failed jobs',
    rerunFailedShort: 'Re-run failed',
    rerunAll: 'Re-run all jobs',
    rerunAllShort: 'Re-run all',
    cancelDelay: 'Gitea takes a few seconds to stop it.',
    logPending: 'Gitea publishes the log while the job runs.',
    logMissing: 'Gitea has no log for this job (it may have been skipped or cleaned up).',
    dispatchHelp: 'Workflows with a workflow_dispatch trigger can be started here.',
    repoPlaceholder: 'owner/name or a Gitea URL',
    tokenOrder:
      'CI Hub looks for a token in this order: the Gitea account connected in OpenChamber, then the token pasted on the CI Hub card (gitea.com only). Watching needs read access; re-runs and starting workflows need repo write.',
    noAccount: 'No Gitea account. Connect Gitea in OpenChamber or paste a token on the CI Hub card.',
  },
  capabilities: CAPABILITIES,
  logDialect: 'github',
  publicHosts: ['gitea.com'],
  hostPattern: /^gitea\./,
  storeKey: 'gitea',
  settingKey: 'gitea-token',
  serverSetting: null,
  authSetting: null,
  cli: null,
  apiOrigin: apiOriginFor,
  repoPath: (segments) => (segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null),
  webUrl: webUrlOf,
  ciUrl: (ref) => `${webUrlOf(ref)}/actions`,
  parseRunUrl: (url) => {
    const match = url.trim().match(RUN_URL);
    if (!match) return null;
    const host = match[1] ?? '';
    const path = match[2] ?? '';
    const runId = match[3] ?? '';
    if (host === '' || path === '' || runId === '') return null;
    return { repo: formatRepoKey({ provider: 'gitea', host, path }), runId };
  },
  createClient: createGiteaClient,
};
