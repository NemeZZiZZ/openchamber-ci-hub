// Forgejo Actions adapter. Forgejo forked before Gitea's GitHub-shaped run API
// landed, so its shapes differ: one `status` word carries state and result
// (success/failure/... vs waiting/running/blocked), runs carry
// `index_in_repo`/`prettyref`/`workflow_id` (the workflow file), the job list
// is a bare array without steps (each single-job GET has them), and cancel and
// re-run exist while rerun-failed-jobs does not. Pure over an injected fetch,
// so tests replay recorded payloads and the service decides where the token
// comes from.
import { formatRepoKey, type RepoRef } from '../domain/repoKey.ts';
import { byteLength, sliceByBytes } from '../domain/log.ts';
import type { Capabilities, Conclusion, Job, Run, RunStatus, WorkflowRef } from '../domain/types.ts';
import { asString, isObject, time, workflowFileOf } from './compat.ts';
import { ProviderError, type FetchLike } from './errors.ts';
import { hasDispatchTrigger, parseDispatchInputs } from './github.ts';
import type { CiClient, ClientOptions, ListRunsOptions, Provider } from './types.ts';

const WINDOW = 50;
const GROUP_PAGE_CAP = 5;
const TAIL_BYTES = 128 * 1024;
const FULL_TRACE_CAP_BYTES = 1024 * 1024;
const STEPS_CAP = 20;
const WORKFLOW_DIRS = ['.gitea/workflows', '.github/workflows'];

const apiOriginFor = (host: string): string => `https://${host.toLowerCase()}/api/v1`;

const webUrlOf = (ref: RepoRef): string => `https://${ref.host}/${ref.path}`;

/** One status word carries both the state and the result on Forgejo. */
const STATE: Record<string, { status: RunStatus; conclusion: Conclusion }> = {
  unknown: { status: 'queued', conclusion: null },
  waiting: { status: 'queued', conclusion: null },
  blocked: { status: 'queued', conclusion: null },
  running: { status: 'in_progress', conclusion: null },
  success: { status: 'completed', conclusion: 'success' },
  failure: { status: 'completed', conclusion: 'failure' },
  cancelled: { status: 'completed', conclusion: 'cancelled' },
  skipped: { status: 'completed', conclusion: 'skipped' },
};

const stateOf = (value: unknown): { status: RunStatus; conclusion: Conclusion } =>
  STATE[asString(value)] ?? { status: 'unknown', conclusion: null };

const STATUS_QUERY: Record<string, string> = {
  in_progress: 'running',
  failed: 'failure',
  succeeded: 'success',
  cancelled: 'cancelled',
};

const RUN_URL = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/;

class ForgejoApi {
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
      throw new ProviderError(err instanceof Error ? `Forgejo unreachable: ${err.message}` : 'Forgejo unreachable', {
        kind: 'network',
      });
    }
    if (response.status === 401) {
      throw new ProviderError('Forgejo rejected the token (401). Reconnect the account.', { kind: 'auth', status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError('Forgejo refused the request (403). The token may lack the scopes it needs.', {
        kind: 'forbidden',
        status: 403,
      });
    }
    if (response.status === 404) {
      throw new ProviderError('Not found on Forgejo (404).', { kind: 'not-found', status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`Forgejo answered ${response.status}.`, { kind: 'server', status: response.status });
    }
    if (!response.ok) {
      throw new ProviderError(`Forgejo answered ${response.status}.`, { kind: 'unknown', status: response.status });
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
      throw new ProviderError(`Forgejo answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
  }

  /** A 404 that never returns is sent as null; the runs probe turns it into a refusal. */
  async jsonOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
    return await this.json<T>(path, init).catch((err) => {
      if (err instanceof ProviderError && err.kind === 'not-found') return null;
      throw err;
    });
  }
}

/** `content` is base64 for the default contents answer; tolerate a raw string too. */
const contentsText = (body: unknown): string => {
  if (!isObject(body)) return '';
  const content = body.content;
  if (typeof content !== 'string') return '';
  return asString(body.encoding) === 'base64' ? atob(content.replace(/\s+/g, '')) : content;
};

export const mapForgejoRun = (ref: RepoRef, raw: unknown): Run | null => {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const sha = asString(raw.commit_sha);
  const started = time(raw.started);
  const state = stateOf(raw.status);
  return {
    id: String(id),
    provider: 'forgejo',
    repo: formatRepoKey(ref),
    number: typeof raw.index_in_repo === 'number' ? raw.index_in_repo : 0,
    workflow: asString(raw.title) || workflowFileOf(asString(raw.workflow_id)) || 'workflow',
    workflowId: asString(raw.workflow_id),
    branch: asString(raw.prettyref),
    sha,
    title: asString(raw.title),
    event: asString(raw.event),
    attempt: 1,
    status: state.status,
    conclusion: state.conclusion,
    createdAt: time(raw.created) ?? started ?? 0,
    startedAt: started,
    finishedAt: time(raw.stopped),
    actor: isObject(raw.trigger_user) ? asString(raw.trigger_user.login) : '',
    url: asString(raw.html_url),
    commitUrl: sha === '' ? null : `${webUrlOf(ref)}/commit/${sha}`,
  };
};

const runsOf = (ref: RepoRef, body: unknown): Run[] => {
  const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return runs.map((raw) => mapForgejoRun(ref, raw)).filter((run): run is Run => run !== null);
};

const minTime = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.min(...present);
};

const maxTime = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};

export const mapForgejoJob = (runId: string, raw: unknown, steps: unknown): Job | null => {
  if (!isObject(raw) || raw.id === undefined) return null;
  const state = stateOf(raw.status);
  const stepList = Array.isArray(steps)
    ? steps.filter(isObject).map((step, index) => ({
        number: typeof step.number === 'number' ? step.number : index + 1,
        name: asString(step.name) || `step ${index + 1}`,
        status: stateOf(step.status).status,
        conclusion: stateOf(step.status).conclusion,
        startedAt: time(step.started),
        finishedAt: time(step.stopped),
      }))
    : [];
  return {
    id: String(raw.id),
    runId,
    name: asString(raw.name) || `job ${String(raw.id)}`,
    status: state.status,
    conclusion: state.conclusion,
    startedAt: minTime(stepList.map((step) => step.startedAt)),
    finishedAt: maxTime(stepList.map((step) => step.finishedAt)),
    steps: stepList,
    url: asString(raw.html_url),
  };
};

export const createForgejoClient = (options: ClientOptions): CiClient => {
  const api = new ForgejoApi(options);
  const host = options.host;

  const base = (repo: RepoRef) => `/repos/${repo.path.split('/').map(encodeURIComponent).join('/')}`;

  const runParams = (opts: ListRunsOptions, page: number, limit: number): string => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (opts.event) params.set('event', opts.event);
    if (opts.branch) params.set('ref', opts.branch.startsWith('refs/') ? opts.branch : `refs/heads/${opts.branch}`);
    if (opts.status) {
      const query = STATUS_QUERY[opts.status];
      if (query) params.set('status', query);
    }
    return params.toString();
  };

  /** The runs list endpoint is what tells an old Forgejo apart; a 404 there refuses clearly. */
  const runsList = async (repo: RepoRef, opts: ListRunsOptions, page: number, limit: number): Promise<Run[]> => {
    const body = await api
      .json(`${base(repo)}/actions/runs?${runParams(opts, page, limit)}`)
      .catch((err) => {
        if (err instanceof ProviderError && err.kind === 'not-found') {
          throw new ProviderError(
            'This Forgejo does not expose the Actions runs API; CI Hub needs a Forgejo with Actions runs and logs.',
            { kind: 'unsupported' },
          );
        }
        throw err;
      });
    return runsOf(repo, body);
  };

  const client: CiClient = {
    async listRuns(repo, opts = {}) {
      const runs = await runsList(repo, opts, opts.page ?? 1, opts.perPage ?? 50);
      return opts.actor ? runs.filter((run) => run.actor === opts.actor) : runs;
    },

    async listWorkflowRuns(repo, workflowId, opts = {}) {
      const page = Math.max(1, opts.page ?? 1);
      const perPage = opts.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP, Math.ceil((page * perPage) / WINDOW));
      const group: Run[] = [];
      let lastPageFull = false;
      for (let underlying = 1; underlying <= pages; underlying += 1) {
        const runs = await runsList(repo, opts, underlying, WINDOW);
        lastPageFull = runs.length >= WINDOW;
        for (const run of runs) {
          const file = workflowFileOf(run.workflowId);
          if (file === workflowId || run.workflowId === workflowId) group.push(run);
        }
      }
      // A full last window says nothing about the end of history; peek once so
      // the panel's hasMore stays honest (same as gitlab.ts).
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP) {
        const more = (await runsList(repo, opts, pages + 1, WINDOW)).some((run) => {
          const file = workflowFileOf(run.workflowId);
          return file === workflowId || run.workflowId === workflowId;
        });
        if (more) total = group.length + 1;
      }
      const actor = opts.actor;
      const filtered = actor ? group.filter((run) => run.actor === actor) : group;
      return { runs: filtered.slice((page - 1) * perPage, page * perPage), total };
    },

    async getRun(repo, runId) {
      const direct = await api
        .json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`)
        .then((raw) => mapForgejoRun(repo, raw))
        .catch((err) => {
          if (err instanceof ProviderError && err.kind === 'not-found') return null;
          throw err;
        });
      if (direct) return direct;
      // Forgejo's web URLs carry the run index while the API reads by id; map
      // one to the other through the newest page of runs.
      if (!/^\d+$/.test(runId)) throw new ProviderError('That run is not readable.', { kind: 'unknown' });
      const wanted = Number(runId);
      const newest = await this.listRuns(repo, { perPage: 50 });
      const hit = newest.find((run) => run.number === wanted);
      if (hit) return hit;
      throw new ProviderError('That run is not readable.', { kind: 'unknown' });
    },

    async listJobs(repo, runId) {
      const list = await api
        .json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?limit=50`)
        .then((body) => (Array.isArray(body) ? body : []));
      const kept = list.slice(0, STEPS_CAP);
      const jobs = await Promise.all(
        list.map(async (raw, index) => {
          // Steps only come back with a single job; enrich the first STEPS_CAP
          // so the detail view shows them without spending a call per step.
          const steps = index < kept.length ? await api.jsonOrNull(`${base(repo)}/actions/jobs/${String((raw as Record<string, unknown>).id)}`).then((job) => isObject(job) && Array.isArray(job.steps) ? job.steps : []) : [];
          return mapForgejoJob(runId, raw, steps);
        }),
      );
      return jobs.filter((job): job is Job => job !== null);
    },

    async getJobLog(repo, jobId, opts = {}) {
      const tailBytes = opts.tailBytes ?? TAIL_BYTES;
      const response = await api.send(`${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`, {}, opts.full ? {} : { Range: `bytes=-${tailBytes}` });
      let text = await response.text();
      let truncated = response.status === 206;
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
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' });
    },

    async rerunFailed() {
      throw new ProviderError('Forgejo has no re-run-failed-jobs API; re-run the whole run instead.', {
        kind: 'unsupported',
      });
    },

    async cancel(repo, runId) {
      await api.send(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    },

    async listWorkflows(repo) {
      const found: WorkflowRef[] = [];
      for (const dir of WORKFLOW_DIRS) {
        const listing = await api.jsonOrNull<unknown>(`${base(repo)}/contents/${dir}`);
        if (!Array.isArray(listing)) continue;
        for (const raw of listing.filter(isObject)) {
          const name = asString(raw.name);
          if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
          if (found.some((entry) => entry.id === name)) continue;
          const stem = name.replace(/\.(yml|yaml)$/, '');
          found.push({ id: name, name: stem, path: asString(raw.path) || `${dir}/${name}`, file: name });
        }
      }
      return found;
    },

    async getDispatchInputs(repo, workflow, ref) {
      let yaml = '';
      for (const dir of WORKFLOW_DIRS) {
        const body = await api.jsonOrNull(`${base(repo)}/contents/${dir}/${encodeURIComponent(workflow.file)}`, {
          headers: {},
        });
        const text = contentsText(body);
        if (text !== '') {
          yaml = text;
          break;
        }
      }
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable
          ? null
          : `This workflow has no workflow_dispatch trigger on ${ref}, so Forgejo will refuse to start it.`,
      };
    },

    async dispatch(repo, workflowId, ref, inputs) {
      const file = workflowFileOf(workflowId);
      await api.send(`${base(repo)}/actions/workflows/${encodeURIComponent(file)}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs }),
        headers: { 'Content-Type': 'application/json' },
      });
    },

    async defaultBranch(repo) {
      const body = await api.json(`${base(repo)}`);
      return isObject(body) ? asString(body.default_branch, 'main') : 'main';
    },
  };
  return client;
};

const CAPABILITIES: Capabilities = {
  rerunAll: 'same-run',
  rerunFailed: false,
  cancel: true,
  retryJob: true,
  playManualJob: false,
  dispatch: 'workflow-inputs',
  jobDetail: 'steps',
  approve: false,
  groupHistory: true,
};

export const forgejo: Provider = {
  id: 'forgejo',
  label: 'Forgejo',
  words: {
    run: 'run',
    runs: 'runs',
    workflow: 'workflow',
    workflows: 'workflows',
    rerunFailed: 'Re-run failed jobs',
    rerunFailedShort: 'Re-run failed',
    rerunAll: 'Re-run all jobs',
    rerunAllShort: 'Re-run all',
    cancelDelay: 'Forgejo takes a few seconds to stop it.',
    logPending: 'Forgejo publishes the log while the job runs.',
    logMissing: 'Forgejo has no log for this job (it may have been skipped or cleaned up).',
    dispatchHelp: 'Workflows with a workflow_dispatch trigger can be started here.',
    repoPlaceholder: 'owner/name or a Forgejo URL',
    tokenOrder:
      'CI Hub looks for a token in this order: the Forgejo account connected in OpenChamber, then the token pasted on the CI Hub card (codeberg.org only). Watching needs read access; cancel, re-run and starting workflows need repo write.',
    noAccount: 'No Forgejo account. Connect Forgejo in OpenChamber or paste a token on the CI Hub card.',
  },
  capabilities: CAPABILITIES,
  logDialect: 'github',
  publicHosts: ['codeberg.org'],
  hostPattern: /^forgejo\./,
  storeKey: 'forgejo',
  settingKey: 'forgejo-token',
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
    return { repo: formatRepoKey({ provider: 'forgejo', host, path }), runId };
  },
  createClient: createForgejoClient,
};
