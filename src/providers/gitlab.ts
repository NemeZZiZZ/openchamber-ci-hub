// GitLab CI adapter: the API core. Adapted from the user's openchamber-gitlab
// extension (~/Repository/openchamber-gitlab/src/gitlab/client.ts): one request
// helper over /api/v4 with pagination totals and Retry-After mapping. Unlike
// that client this core does not retry a 429 itself — the engine blocks a
// throttled host — and it throws the provider-neutral ProviderError. Pure over
// an injected fetch, like github.ts.
import { formatRepoKey, parseRepoKey, type RepoRef } from '../domain/repoKey.ts';
import type { Capabilities, Conclusion, Job, LogWindow, ProviderWords, Run, RunStatus, WorkflowRef } from '../domain/types.ts';
import { ProviderError, type FetchLike } from './errors.ts';
import { byteLength, sliceByBytes } from '../domain/log.ts';
import type { CiClient, ClientOptions, ListRunsOptions, Provider } from './types.ts';

export type GitLabApiOptions = { fetch: FetchLike; token: string; host: string; now?: () => number };

export class GitLabApi {
  private readonly fetchLike: FetchLike;
  private readonly token: string;
  private readonly origin: string;
  private readonly now: () => number;

  constructor(options: GitLabApiOptions) {
    this.fetchLike = options.fetch;
    this.token = options.token;
    this.origin = `https://${options.host}/api/v4`;
    this.now = options.now ?? Date.now;
  }

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const text = params.toString();
    return text === '' ? `${this.origin}${path}` : `${this.origin}${path}?${text}`;
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchLike(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ProviderError(
        err instanceof Error ? `GitLab unreachable: ${err.message}` : 'GitLab unreachable',
        { kind: 'network' },
      );
    }

    if (response.status === 401) {
      throw new ProviderError('GitLab rejected the token (401). Reconnect the account.', { kind: 'auth', status: 401 });
    }
    if (response.status === 403) {
      throw new ProviderError('GitLab refused the request (403). The token may lack the api scope.', {
        kind: 'forbidden',
        status: 403,
      });
    }
    if (response.status === 404) {
      throw new ProviderError('GitLab answered 404.', { kind: 'not-found', status: 404 });
    }
    if (response.status === 429) {
      throw new ProviderError('GitLab rate limit reached.', {
        kind: 'rate-limit',
        status: 429,
        rateLimitReset: this.retryAt(response),
      });
    }
    if (response.status >= 500) {
      throw new ProviderError(`GitLab had a server error (${response.status}).`, {
        kind: 'server',
        status: response.status,
      });
    }
    return response;
  }

  /** Retry-After is seconds or an HTTP-date; without it, guess a minute. */
  private retryAt(response: Response): number {
    const value = response.headers.get('Retry-After');
    if (value !== null) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && value.trim() !== '' && seconds >= 0) return this.now() + seconds * 1000;
      const date = Date.parse(value);
      if (Number.isFinite(date)) return date;
    }
    return this.now() + 60_000;
  }

  async request<T>(
    method: string,
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<{ data: T; total: number | null }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.send(method, this.url(path, query), headers, body);
    const totalHeader = response.headers.get('X-Total');
    const totalNumber = totalHeader === null ? NaN : Number(totalHeader);
    const total = totalHeader !== null && totalHeader !== '' && Number.isFinite(totalNumber) ? totalNumber : null;
    // Writes answer 201 with a body, but an empty body (201/204) is not a parse error.
    const text = await response.text();
    if (text === '') return { data: undefined as T, total };
    try {
      return { data: JSON.parse(text) as T, total };
    } catch {
      // A proxy or captive portal can answer 200 with HTML; report the shape
      // instead of leaking a SyntaxError the service turns into a bare failure.
      throw new ProviderError(`GitLab answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
  }

  async requestRaw(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; bodyBytes: Uint8Array; bodyText: string; header(name: string): string | null }> {
    const response = await this.send(method, this.url(path), headers);
    // The trace walk needs the bytes as served: a Range can end mid code point,
    // and decoding each window on its own would turn that split into U+FFFD.
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      bodyBytes,
      bodyText: new TextDecoder().decode(bodyBytes),
      header: (name: string) => response.headers.get(name),
    };
  }
}

// ---- pipeline and job mapping -------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const time = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Finished GitLab states; everything else is a form of waiting. */
const STATE: Record<string, { status: RunStatus; conclusion: Conclusion }> = {
  created: { status: 'queued', conclusion: null },
  preparing: { status: 'queued', conclusion: null },
  waiting_for_resource: { status: 'queued', conclusion: null },
  pending: { status: 'queued', conclusion: null },
  scheduled: { status: 'queued', conclusion: null },
  running: { status: 'in_progress', conclusion: null },
  manual: { status: 'waiting', conclusion: null },
  success: { status: 'completed', conclusion: 'success' },
  failed: { status: 'completed', conclusion: 'failure' },
  canceled: { status: 'completed', conclusion: 'cancelled' },
  skipped: { status: 'completed', conclusion: 'skipped' },
};

/** Job-only spellings: `canceling` is still moving. */
const JOB_STATE: Record<string, { status: RunStatus; conclusion: Conclusion }> = {
  ...STATE,
  canceling: { status: 'in_progress', conclusion: null },
};

const stateOf = (table: Record<string, { status: RunStatus; conclusion: Conclusion }>, value: unknown) => {
  const found = table[asString(value)];
  if (found) return found;
  return { status: 'unknown' as RunStatus, conclusion: null as Conclusion };
};

/** Run-filter status → GitLab's `status` query value. */
const STATUS_QUERY: Record<string, string> = {
  in_progress: 'running',
  failure: 'failed',
  success: 'success',
  cancelled: 'canceled',
};

const webUrlOf = (ref: RepoRef): string => `https://${ref.host}/${ref.path}`;

/** A byte tail may start mid-line; drop the partial first line, keep a complete one. */
const dropPartialFirstLine = (text: string): string => {
  const cut = text.indexOf('\n');
  return cut !== -1 && cut < 4096 && cut < text.length - 1 ? text.slice(cut + 1) : text;
};

export const mapRun = (ref: RepoRef, raw: unknown): Run | null => {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const sha = asString(raw.sha);
  const state = stateOf(STATE, raw.status);
  const name = asString(raw.name).trim() || asString(raw.source) || 'pipeline';
  return {
    id: String(id),
    provider: 'gitlab',
    repo: formatRepoKey(ref),
    number: typeof raw.iid === 'number' ? raw.iid : 0,
    workflow: name,
    workflowId: name,
    // MR refs like `refs/merge-requests/7/head` are the panel's exact-match filter.
    branch: asString(raw.ref),
    sha,
    title: '',
    event: asString(raw.source),
    attempt: 1,
    status: state.status,
    conclusion: state.conclusion,
    createdAt: time(raw.created_at) ?? 0,
    startedAt: time(raw.started_at),
    finishedAt: state.status === 'completed' ? time(raw.finished_at) : null,
    actor: isObject(raw.user) ? asString(raw.user.username) : '',
    url: asString(raw.web_url),
    commitUrl: sha === '' ? null : `${webUrlOf(ref)}/-/commit/${sha}`,
  };
};

export const mapJob = (runId: string, raw: unknown): Job | null => {
  if (!isObject(raw) || raw.id === undefined) return null;
  const state = stateOf(JOB_STATE, raw.status);
  const name = asString(raw.name) || `job ${String(raw.id)}`;
  return {
    id: String(raw.id),
    runId,
    // A failed job that was allowed to fail stays a warning: the pipeline
    // conclusion comes from the pipeline, so the suffix carries the meaning.
    name: state.conclusion === 'failure' && raw.allow_failure === true ? `${name} (allowed to fail)` : name,
    status: state.status,
    conclusion: state.conclusion,
    startedAt: time(raw.started_at),
    finishedAt: time(raw.finished_at),
    // GitLab groups its jobs into stages; the stage is the job's single step row.
    steps: asString(raw.stage).trim() === ''
      ? []
      : [{
          number: 1,
          name: asString(raw.stage).trim(),
          status: state.status,
          conclusion: state.conclusion,
          startedAt: time(raw.started_at),
          finishedAt: time(raw.finished_at),
        }],
    url: asString(raw.web_url),
  };
};

// ---- the CiClient ---------------------------------------------------------------

export const TRACE_WINDOW_BYTES = 65_536;
export const FULL_TRACE_CAP_BYTES = 1_048_576;
const TAIL_BYTES = 131_072;
/** How many 100-item pages listWorkflowRuns will walk (so history caps at ~500). */
const GROUP_PAGE_CAP = 5;

/** Numeric project ids go verbatim; paths need the %2F encoding. */
const encodeProjectId = (id: string): string => (id.includes('/') ? encodeURIComponent(id) : id);

export const createGitLabClient = (options: ClientOptions): CiClient => {
  const api = new GitLabApi({ fetch: options.fetch, token: options.token, host: options.host, now: options.now });
  const project = (ref: RepoRef) => encodeProjectId(ref.path);
  const pipelines = (ref: RepoRef) => `/projects/${project(ref)}/pipelines`;

  const runOrFail = (ref: RepoRef, raw: unknown, what: string): Run => {
    const run = mapRun(ref, raw);
    if (!run) throw new ProviderError(`GitLab returned an unusable ${what}.`, { kind: 'unknown' });
    return run;
  };

  const client: CiClient = {
    async listRuns(ref, listOptions = {}) {
      const status = listOptions.status === undefined ? undefined : STATUS_QUERY[listOptions.status];
      const { data } = await api.request<unknown[]>('GET', pipelines(ref), {
        ref: listOptions.branch,
        username: listOptions.actor,
        status: status === undefined || status === '' ? undefined : status,
        per_page: listOptions.perPage,
        page: listOptions.page,
      });
      return (Array.isArray(data) ? data : []).map((raw) => mapRun(ref, raw)).filter((run) => run !== null);
    },

    async listWorkflowRuns(ref, workflowId, listOptions = {}) {
      const page = Math.max(1, listOptions.page ?? 1);
      const perPage = listOptions.perPage ?? 20;
      const pages = Math.min(GROUP_PAGE_CAP, Math.ceil((page * perPage) / 100));
      const status = listOptions.status === undefined ? undefined : STATUS_QUERY[listOptions.status];
      const statusQuery = status === undefined || status === '' ? undefined : status;
      const group: Run[] = [];
      let lastPageFull = false;
      for (let underlying = 1; underlying <= pages; underlying += 1) {
        const { data } = await api.request<unknown[]>('GET', pipelines(ref), {
          ref: listOptions.branch,
          username: listOptions.actor,
          status: statusQuery,
          per_page: 100,
          page: underlying,
        });
        const items = Array.isArray(data) ? data : [];
        lastPageFull = items.length >= 100;
        for (const raw of items) {
          const run = mapRun(ref, raw);
          if (run && (run.workflowId || run.workflow) === workflowId) group.push(run);
        }
      }
      // A full last window says nothing about the end of history. Without a peek
      // at the next page, a workflow whose runs fill the window exactly would
      // report its own count as the total and the panel would stop early.
      let total = group.length;
      if (lastPageFull && pages < GROUP_PAGE_CAP) {
        const { data } = await api.request<unknown[]>('GET', pipelines(ref), {
          ref: listOptions.branch,
          username: listOptions.actor,
          status: statusQuery,
          per_page: 100,
          page: pages + 1,
        });
        const more = (Array.isArray(data) ? data : []).some((raw) => {
          const run = mapRun(ref, raw);
          return run !== null && (run.workflowId || run.workflow) === workflowId;
        });
        if (more) total = group.length + 1;
      }
      return { runs: group.slice((page - 1) * perPage, page * perPage), total };
    },

    async getRun(ref, runId) {
      const { data } = await api.request<unknown>('GET', `${pipelines(ref)}/${encodeURIComponent(runId)}`);
      const run = runOrFail(ref, data, 'pipeline');
      if (run.sha === '') return run;
      // Lists do not carry the commit title; one best-effort read fills it.
      try {
        const commit = await api.request<{ title?: unknown }>(
          'GET',
          `/projects/${project(ref)}/repository/commits/${encodeURIComponent(run.sha)}`,
        );
        const title = asString(commit.data?.title).trim();
        if (title !== '') run.title = title;
      } catch {
        // A gone commit or a missing scope is not worth failing the run for.
      }
      return run;
    },

    async listJobs(ref, runId) {
      const { data } = await api.request<unknown[]>('GET', `${pipelines(ref)}/${encodeURIComponent(runId)}/jobs`, {
        per_page: 100,
        include_retried: 'false',
      });
      return (Array.isArray(data) ? data : []).map((raw) => mapJob(String(runId), raw)).filter((job) => job !== null);
    },

    async getJobLog(ref, jobId, logOptions = {}) {
      const path = `/projects/${project(ref)}/jobs/${encodeURIComponent(jobId)}/trace`;
      if (logOptions.full) {
        let text = '';
        let offset = 0;
        let truncated = false;
        // One decoder across the walk: a code point split by a window edge is
        // completed by the next window instead of becoming a replacement char.
        const decoder = new TextDecoder();
        while (offset < FULL_TRACE_CAP_BYTES) {
          const window = await api.requestRaw('GET', path, {
            Range: `bytes=${offset}-${offset + TRACE_WINDOW_BYTES - 1}`,
          });
          if (window.status === 416) break; // past the end: the walk has everything
          if (window.status === 200) {
            // No range support: this body is the whole trace — keep only the cap.
            text = byteLength(window.bodyText) > FULL_TRACE_CAP_BYTES
              ? sliceByBytes(window.bodyText, 0, FULL_TRACE_CAP_BYTES)
              : window.bodyText;
            truncated = byteLength(window.bodyText) > FULL_TRACE_CAP_BYTES;
            return { text, truncated };
          }
          if (window.bodyBytes.length === 0) break;
          text += decoder.decode(window.bodyBytes, { stream: true });
          // The Range walks bytes; multibyte text is longer on the wire than its
          // char count, so advance by what the server says it sent (or UTF-8 size).
          const served = /^bytes (\d+)-(\d+)/.exec(window.header('Content-Range') ?? '');
          offset += served ? Number(served[2]) - Number(served[1]) + 1 : window.bodyBytes.length;
        }
        text += decoder.decode();
        if (byteLength(text) > FULL_TRACE_CAP_BYTES) {
          text = sliceByBytes(text, 0, FULL_TRACE_CAP_BYTES);
          truncated = true;
        }
        if (offset >= FULL_TRACE_CAP_BYTES) truncated = true;
        return { text, truncated };
      }

      const tailBytes = logOptions.tailBytes ?? TAIL_BYTES;
      const probe = await api.requestRaw('GET', path, { Range: 'bytes=0-0' });
      const contentRange = probe.header('Content-Range');
      const total = contentRange === null ? null : Number(/^bytes 0-0\/(\d+)$/.exec(contentRange)?.[1]);
      if (contentRange === null) {
        // No range support: the probe body is the whole trace — keep only the cap.
        const body = probe.bodyText;
        const size = byteLength(body);
        const text = size > tailBytes ? sliceByBytes(body, size - tailBytes, size) : body;
        return { text: size > tailBytes ? dropPartialFirstLine(text) : text, truncated: size > tailBytes };
      }
      if (total === null || !Number.isFinite(total)) return { text: probe.bodyText, truncated: false };
      if (total === 0) return { text: '', truncated: false };
      if (total <= tailBytes) {
        const whole = await api.requestRaw('GET', path, { Range: `bytes=0-${total - 1}` });
        return { text: whole.bodyText, truncated: false };
      }
      const tail = await api.requestRaw('GET', path, { Range: `bytes=${total - tailBytes}-${total - 1}` });
      // A tail may start inside a code point; drop the orphaned continuation bytes.
      let from = 0;
      while (from < tail.bodyBytes.length && (tail.bodyBytes[from]! & 0xc0) === 0x80) from += 1;
      const text = new TextDecoder().decode(tail.bodyBytes.subarray(from));
      return { text: dropPartialFirstLine(text), truncated: true };
    },

    async rerunAll(ref, runId) {
      const { data } = await api.request<unknown>('GET', `${pipelines(ref)}/${encodeURIComponent(runId)}`);
      const refName = asString((isObject(data) ? data.ref : undefined)).trim();
      // A merge-request or detached pipeline carries no ref; posting one would
      // only get a 400 back. Say what a person can act on instead.
      if (refName === '') {
        throw new ProviderError(
          'This pipeline has no branch (a merge request or detached pipeline), so GitLab cannot re-run it. Start a new pipeline on a branch.',
          { kind: 'unknown' },
        );
      }
      await api.request('POST', `/projects/${project(ref)}/pipeline`, undefined, { ref: refName });
    },

    async rerunFailed(ref, runId) {
      await api.request('POST', `${pipelines(ref)}/${encodeURIComponent(runId)}/retry`);
    },

    async cancel(ref, runId) {
      await api.request('POST', `${pipelines(ref)}/${encodeURIComponent(runId)}/cancel`);
    },

    async listWorkflows() {
      // GitLab has one pipeline list; the group filter happens client-side.
      return [{ id: 'pipelines', name: 'Pipelines', path: '.gitlab-ci.yml', file: '.gitlab-ci.yml' }];
    },

    async getDispatchInputs() {
      // Custom pipeline variables are deferred; a bare ref is always runnable.
      return { dispatchable: true, inputs: [], refusal: null };
    },

    async dispatch(ref, _workflowId, branch, _inputs) {
      await api.request('POST', `/projects/${project(ref)}/pipeline`, undefined, { ref: branch });
    },

    async defaultBranch(ref) {
      const { data } = await api.request<{ default_branch?: unknown }>('GET', `/projects/${project(ref)}`);
      return asString(data?.default_branch).trim() || 'main';
    },
  };

  return client;
};


// ---- the registry entry ---------------------------------------------------------

const GITLAB_CAPABILITIES: Capabilities = {
  rerunAll: 'new-pipeline',
  rerunFailed: true,
  cancel: true,
  // Neither endpoint is wired yet; advertising them would show inert buttons.
  retryJob: false,
  playManualJob: false,
  dispatch: 'pipeline-variables',
  jobDetail: 'stages',
  approve: false,
  groupHistory: true,
};

const GITLAB_WORDS: ProviderWords = {
  run: 'pipeline',
  runs: 'pipelines',
  workflow: 'pipeline',
  workflows: 'pipelines',
  rerunFailed: 'Retry failed jobs',
  rerunFailedShort: 'Retry failed',
  rerunAll: 'Run pipeline again',
  rerunAllShort: 'Run again',
  cancelDelay: 'GitLab takes a few seconds to stop it.',
  logPending: 'GitLab streams the trace while the job runs.',
  logMissing: 'GitLab has no trace for this job (it may have been skipped or erased).',
  dispatchHelp: 'Pick a branch or tag; GitLab starts a new pipeline on it.',
  repoPlaceholder: 'group/project or a GitLab URL',
  tokenOrder:
    'CI Hub looks for a token in this order: the GitLab account connected in OpenChamber, the token pasted on the CI Hub card, then the glab CLI (glab auth login). Reading pipelines needs the read_api scope; retry, cancel and starting pipelines need api.',
  noAccount: 'No GitLab account. Connect GitLab in OpenChamber, paste a token on the CI Hub card, or run glab auth login.',
};

const PIPELINE_URL = /^https?:\/\/([^/]+)\/([^/]+(?:\/[^/]+)+)\/-\/pipelines\/(\d+)/;

export const gitlab: Provider = {
  id: 'gitlab',
  label: 'GitLab',
  words: GITLAB_WORDS,
  capabilities: GITLAB_CAPABILITIES,
  logDialect: 'gitlab',
  publicHosts: ['gitlab.com'],
  hostPattern: /^gitlab\./,
  storeKey: 'gitlab',
  settingKey: 'gitlab-token',
  serverSetting: null,
  authSetting: null,
  cli: { program: 'glab', tokenArgs: (host) => ['config', 'get', 'token', '--host', host] },
  apiOrigin: (host) => `https://${host.toLowerCase()}/api/v4`,
  // GitLab paths are group/project with any depth of subgroups.
  repoPath: (segments) => (segments.length >= 2 ? segments.join('/') : null),
  webUrl: (ref) => webUrlOf(ref),
  ciUrl: (ref) => `${webUrlOf(ref)}/-/pipelines`,
  parseRunUrl: (url) => {
    const match = PIPELINE_URL.exec(url);
    if (!match) return null; // job URLs and everything else stay unparsed
    const key = formatRepoKey({ provider: 'gitlab', host: match[1]!, path: match[2]! });
    return parseRepoKey(key) ? { repo: key, runId: match[3]! } : null;
  },
  createClient: (options) => createGitLabClient(options),
};
