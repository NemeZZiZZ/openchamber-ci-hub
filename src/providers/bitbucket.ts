// Bitbucket Cloud Pipelines: Basic-auth client over the 2.0 REST API, with
// pipelines mapped to runs and steps mapped to jobs (one step, one job).

import type { Capabilities, Conclusion, DispatchInput, Job, LogWindow, ProviderWords, Run, RunStatus, WorkflowRef } from '../domain/types.ts';
import type { RepoRef } from '../domain/repoKey.ts';
import { byteLength, sliceByBytes } from '../domain/log.ts';
import { formatRepoKey, parseRepoKey } from '../domain/repoKey.ts';
import { ProviderError, type FetchLike } from './errors.ts';
import type { ClientOptions, CiClient, ListRunsOptions } from './types.ts';
import type { Provider } from './types.ts';
import { asString, isObject, parseVariablesObject, time } from './compat.ts';

const WINDOW = 50;
const TAIL_BYTES = 128 * 1024;
const BASE = 'https://api.bitbucket.org/2.0';

/** Our filter words reach the API in its own status vocabulary. */
const STATUS_QUERY: Record<string, string> = {
  queued: 'PENDING',
  in_progress: 'IN_PROGRESS',
  succeeded: 'SUCCESSFUL',
  failed: 'FAILED',
  cancelled: 'STOPPED',
};

const stateOf = (raw: unknown): { status: RunStatus; conclusion: Conclusion } => {
  const state = isObject(raw) ? raw : {};
  const name = asString(state['name']);
  if (name === 'IN_PROGRESS') return { status: 'in_progress', conclusion: null };
  if (name === 'PENDING') return { status: 'queued', conclusion: null };
  if (name === 'NOT_RUN') return { status: 'completed', conclusion: 'skipped' };
  if (name !== 'COMPLETED') return { status: 'unknown', conclusion: null };
  const result = isObject(state['result']) ? asString(state['result']['name']) : '';
  const conclusion: Conclusion =
    result === 'SUCCESSFUL' ? 'success'
    : result === 'FAILED' || result === 'ERROR' || result === 'EXPIRED' ? 'failure'
    : result === 'STOPPED' ? 'cancelled'
    : result === 'NOT_RUN' ? 'skipped'
    : null;
  return { status: 'completed', conclusion };
};

/** Bitbucket serializes uuids braced; the engine's id gate takes bare words. */
const unbraced = (value: unknown): string => asString(value).replace(/^\{/, '').replace(/\}$/, '');

const valuesOf = (data: unknown): unknown[] => {
  const envelope = isObject(data) ? data : {};
  return Array.isArray(envelope['values']) ? envelope['values'] : [];
};

const webUrlOf = (ref: RepoRef): string => `https://${ref.host}/${ref.path}`;

const slug = (ref: RepoRef): string => ref.path;

const targetOf = (raw: unknown): Record<string, unknown> => {
  const source = isObject(raw) ? raw : {};
  return isObject(source['target']) ? source['target'] : {};
};

export const mapBitbucketRun = (raw: unknown, ref: RepoRef, web: string): Run => {
  const source = isObject(raw) ? raw : {};
  const id = unbraced(source['uuid']);
  const target = targetOf(raw);
  const commit = isObject(target['commit']) ? target['commit'] : {};
  const links = isObject(commit['links']) && isObject((commit['links'] as Record<string, unknown>)['html'])
    ? ((commit['links'] as Record<string, unknown>)['html'] as Record<string, unknown>)
    : {};
  const creator = isObject(source['creator']) ? source['creator'] : {};
  const number = typeof source['build_number'] === 'number' ? source['build_number'] : 0;
  const branch = asString(target['ref_name']);
  const { status, conclusion } = stateOf(source['state']);
  return {
    id,
    provider: 'bitbucket',
    repo: formatRepoKey(ref),
    number,
    workflow: 'Pipelines',
    workflowId: 'pipelines',
    branch,
    sha: asString(commit['hash']),
    title: `#${number}${branch ? ` ${branch}` : ''}`,
    event: asString((isObject(source['trigger']) ? source['trigger'] : {})['name']),
    attempt: 1,
    status,
    conclusion,
    createdAt: time(source['created_on']) ?? 0,
    // A pipeline payload carries no started_on: the clock reads from the steps.
    startedAt: null,
    finishedAt: time(source['completed_on']),
    actor: asString(creator['nickname']) || asString(creator['display_name']),
    url: web ? `${web}/pipelines/${id}` : '',
    commitUrl: asString(links['href']) || null,
  };
};

export const mapBitbucketJobs = (raw: unknown, runId: string): Job[] => {
  // The swagger types image as an object ({name, …}); older dumps and
  // hand-made payloads carry a plain string. Both name the row when set.
  const imageOf = (value: unknown): string =>
    typeof value === 'string' ? value : asString(isObject(value) ? value['name'] : '');
  const jobs: Job[] = [];
  const steps = valuesOf(raw);
  for (const [index, step] of steps.entries()) {
    if (!isObject(step)) continue;
    const { status, conclusion } = stateOf(step['state']);
    const stepId = unbraced(step['uuid']);
    if (!stepId) continue;
    // The log path needs the pipeline uuid and the step uuid; the client
    // splits the pair back apart.
    jobs.push({
      id: `${runId}:${stepId}`,
      runId,
      name: imageOf(step['image']) || `step ${index + 1}`,
      status,
      conclusion,
      startedAt: time(step['started_on']),
      finishedAt: time(step['completed_on']),
      steps: [],
      url: '',
    });
  }
  return jobs;
};

class BitbucketApi {
  private readonly fetch: FetchLike;
  private readonly user: string;
  private readonly token: string;

  constructor(options: ClientOptions) {
    this.fetch = options.fetch;
    this.user = options.user ?? '';
    this.token = options.token;
  }

  private auth(): Record<string, string> {
    let encoded: string;
    try {
      encoded = btoa(`${this.user}:${this.token}`);
    } catch {
      // btoa rejects anything outside Latin-1 — a stray pasted character.
      throw new ProviderError(
        'The pasted credentials contain characters Basic auth cannot carry (non-Latin letters or symbols). Check bitbucket-email and bitbucket-token on the CI Hub card.',
        { kind: 'unknown' },
      );
    }
    return { Authorization: `Basic ${encoded}` };
  }

  async send(method: string, url: string, extraHeaders: Record<string, string> = {}, body?: string): Promise<Response> {
    // Credentials are built outside the try: an auth-helper throw is a card
    // problem (its own ProviderError), not a network failure.
    const headers = { ...this.auth(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders };
    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        ...(body ? { body } : {}),
      });
    } catch (err) {
      throw new ProviderError(err instanceof Error ? `Bitbucket unreachable: ${err.message}` : 'Bitbucket unreachable', {
        kind: 'network',
      });
    }
    if (response.status === 401)
      throw new ProviderError('Bitbucket rejected the credentials (401). Check bitbucket-email and bitbucket-token on the CI Hub card.', {
        kind: 'auth',
        status: 401,
      });
    if (response.status === 403)
      throw new ProviderError('Bitbucket refused the request (403). The token or branch permissions may not allow it.', {
        kind: 'forbidden',
        status: 403,
      });
    if (response.status === 404) throw new ProviderError('Not found on Bitbucket (404).', { kind: 'not-found', status: 404 });
    if (response.status === 429)
      throw new ProviderError('Bitbucket is rate limiting this account (429). Try again shortly.', {
        kind: 'rate-limit',
        status: 429,
      });
    if (response.status >= 500) throw new ProviderError(`Bitbucket answered ${response.status}.`, { kind: 'server', status: response.status });
    if (!response.ok) throw new ProviderError(`Bitbucket answered ${response.status}.`, { kind: 'unknown', status: response.status });
    return response;
  }

  async request<T>(method: string, url: string, extraHeaders: Record<string, string> = {}, body?: string): Promise<T> {
    const response = await this.send(method, url, extraHeaders, body);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderError(`Bitbucket answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
  }

  async requestRaw(
    method: string,
    url: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; bodyBytes: Uint8Array; bodyText: string; header(name: string): string | null }> {
    const response = await this.send(method, url, extraHeaders);
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      bodyBytes,
      bodyText: new TextDecoder().decode(bodyBytes),
      header: (name: string) => response.headers.get(name),
    };
  }

  async fetchRuns(
    ref: RepoRef,
    options: ListRunsOptions,
  ): Promise<{ runs: Run[]; page: number; full: boolean; next: boolean }> {
    const page = options.page ?? 1;
    const query = new URLSearchParams({ page: String(page), pagelen: String(WINDOW) });
    if (options.branch) query.set('target.ref_name', options.branch);
    if (options.event) query.set('trigger_type', options.event);
    const native = options.status ? STATUS_QUERY[options.status] : undefined;
    if (native) query.set('status', native);
    const data = await this.request<unknown>('GET', `${BASE}/repositories/${slug(ref)}/pipelines?${query}`);
    const web = webUrlOf(ref);
    const values = valuesOf(data);
    return { runs: values.map((raw) => mapBitbucketRun(raw, ref, web)), page, full: values.length >= WINDOW, next: Boolean((isObject(data) ? data : {})['next']) };
  }
}

export const createBitbucketClient = (options: ClientOptions): CiClient => {
  const api = new BitbucketApi(options);

  return {
    async listRuns(repo, listOptions = {}) {
      const { runs } = await api.fetchRuns(repo, listOptions);
      return runs;
    },

    async listWorkflowRuns(repo, _workflowId, listOptions = {}) {
      const { runs, page, full, next } = await api.fetchRuns(repo, listOptions);
      // A full page followed by a next link means more pages exist; the API
      // carries no size header, so the count is a floor plus one hint.
      const total = full && next ? page * WINDOW + 1 : (page - 1) * WINDOW + runs.length;
      return { runs, total };
    },

    async getRun(repo, runId) {
      const data = await api.request<unknown>('GET', `${BASE}/repositories/${slug(repo)}/pipelines/${encodeURIComponent(runId)}`);
      return mapBitbucketRun(data, repo, webUrlOf(repo));
    },

    async listJobs(repo, runId) {
      const data = await api.request<unknown>(
        'GET',
        `${BASE}/repositories/${slug(repo)}/pipelines/${encodeURIComponent(runId)}/steps?pagelen=100`,
      );
      return mapBitbucketJobs(data, runId);
    },

    async getJobLog(repo, composite, logOptions = {}) {
      const at = composite.indexOf(':');
      const runId = at === -1 ? '' : composite.slice(0, at);
      const jobId = at === -1 ? '' : composite.slice(at + 1);
      if (!runId || !jobId) throw new ProviderError('That job is not readable.', { kind: 'not-found' });
      const url = `${BASE}/repositories/${slug(repo)}/pipelines/${encodeURIComponent(runId)}/steps/${encodeURIComponent(jobId)}/log`;
      const tailBytes = logOptions.tailBytes ?? TAIL_BYTES;
      let probe: Awaited<ReturnType<BitbucketApi['requestRaw']>>;
      try {
        probe = await api.requestRaw('GET', url, { Range: 'bytes=0-0' });
      } catch (err) {
        // An empty log answers an unsatisfiable range (bytes */0); an empty
        // window reads as no output, not as an error.
        if (err instanceof ProviderError && err.status === 416) return { text: '', truncated: false };
        throw err;
      }
      const contentRange = probe.header('Content-Range');
      const total = contentRange === null ? null : Number(/^bytes 0-0\/(\d+)$/.exec(contentRange)?.[1]);
      if (contentRange === null) {
        // No range support: the probe body is the whole log — keep the budget.
        const body = probe.bodyText;
        const size = byteLength(body);
        const text = size > tailBytes ? sliceByBytes(body, size - tailBytes, size) : body;
        return { text, truncated: size > tailBytes };
      }
      if (total === null || !Number.isFinite(total)) return { text: probe.bodyText, truncated: false };
      if (total === 0) return { text: '', truncated: false };
      if (total <= tailBytes) {
        const whole = await api.requestRaw('GET', url, { Range: 'bytes=0-' });
        return { text: whole.bodyText, truncated: false };
      }
      const tail = await api.requestRaw('GET', url, { Range: `bytes=${total - tailBytes}-` });
      // A tail may start inside a code point; drop the orphaned continuation bytes.
      let from = 0;
      while (from < tail.bodyBytes.length && (tail.bodyBytes[from]! & 0xc0) === 0x80) from += 1;
      return { text: new TextDecoder().decode(tail.bodyBytes.subarray(from)), truncated: true };
    },

    // No rerun endpoint exists: a re-run is a fresh pipeline for the same target.
    async rerunAll(repo, runId) {
      const data = await api.request<unknown>('GET', `${BASE}/repositories/${slug(repo)}/pipelines/${encodeURIComponent(runId)}`);
      await api.request<unknown>('POST', `${BASE}/repositories/${slug(repo)}/pipelines`, {}, JSON.stringify({ target: targetOf(data) }));
    },
    async rerunFailed() {
      throw new ProviderError('Bitbucket has no re-run-failed API; start a new pipeline instead.', { kind: 'unsupported' });
    },
    async cancel(repo, runId) {
      await api.request<unknown>('POST', `${BASE}/repositories/${slug(repo)}/pipelines/${encodeURIComponent(runId)}/stopPipeline`);
    },

    async listWorkflows() {
      // No API lists the definitions in bitbucket-pipelines.yml; one group,
      // the GitLab/Woodpecker precedent.
      return [{ id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }];
    },

    async getDispatchInputs() {
      // Manual runs take a branch and variables; a custom-pipeline picker
      // needs a definitions list the API does not expose.
      const inputs: DispatchInput[] = [
        { name: 'variables', type: 'variables', description: 'Pipeline variables, as key/value pairs.', required: false, default: '', options: [] },
      ];
      return { dispatchable: true, inputs, refusal: null };
    },

    async dispatch(repo, _workflowId, ref, inputs) {
      const variables = Object.entries(parseVariablesObject(inputs?.['variables'])).map(([key, value]) => ({ key, value }));
      await api.request<unknown>(
        'POST',
        `${BASE}/repositories/${slug(repo)}/pipelines`,
        {},
        JSON.stringify({ target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: ref }, variables }),
      );
    },

    async defaultBranch(repo) {
      const data = await api.request<unknown>('GET', `${BASE}/repositories/${slug(repo)}`);
      const branch = asString((isObject(data) ? data : {})['main_branch']);
      if (!branch) throw new ProviderError('Bitbucket did not say which branch is the main one.', { kind: 'unknown' });
      return branch;
    },
  };
};



const BITBUCKET_CAPABILITIES: Capabilities = {
  rerunAll: 'new-pipeline',
  rerunFailed: false,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: 'pipeline-variables',
  jobDetail: 'none',
  approve: false,
  groupHistory: true,
};

const BITBUCKET_WORDS: ProviderWords = {
  run: 'pipeline',
  runs: 'pipelines',
  workflow: 'pipeline',
  workflows: 'pipelines',
  rerunFailed: 'Retry failed jobs',
  rerunFailedShort: 'Retry failed',
  rerunAll: 'Run pipeline again',
  rerunAllShort: 'Run again',
  cancelDelay: 'Bitbucket takes a few seconds to stop it.',
  logPending: 'Bitbucket shows the log while the step runs.',
  logMissing: 'Bitbucket has no log for this step (it may have been skipped or erased).',
  dispatchHelp: 'Pick a branch; Bitbucket starts a pipeline on it.',
  repoPlaceholder: 'workspace/slug or a Bitbucket URL',
  tokenOrder:
    'CI Hub reads bitbucket-token together with bitbucket-email on the CI Hub card. Reading needs the pipeline scope; stopping and starting pipelines need pipeline:write.',
  noAccount: 'No Bitbucket credentials. Paste bitbucket-email and bitbucket-token on the CI Hub card.',
};

const RUN_URL = /^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pipelines\/(\{?[0-9a-fA-F-]+\}?)$/;

export const bitbucket: Provider = {
  id: 'bitbucket',
  label: 'Bitbucket',
  words: BITBUCKET_WORDS,
  capabilities: BITBUCKET_CAPABILITIES,
  logDialect: 'gitlab',
  publicHosts: ['bitbucket.org'],
  hostPattern: null,
  storeKey: null,
  settingKey: 'bitbucket-token',
  serverSetting: null,
  authSetting: 'bitbucket-email',
  cli: null,
  apiOrigin: () => `${BASE}`,
  // Bitbucket repositories are exactly workspace/slug.
  repoPath: (segments) => (segments.length === 2 ? segments.join('/') : null),
  webUrl: (ref) => webUrlOf(ref),
  ciUrl: (ref) => `${webUrlOf(ref)}/pipelines`,
  parseRunUrl: (url) => {
    const match = RUN_URL.exec(url);
    if (!match) return null;
    const key = formatRepoKey({ provider: 'bitbucket', host: 'bitbucket.org', path: `${match[1]!}/${match[2]!}` });
    const runId = match[3]!.replace(/^\{/, '').replace(/\}$/, '');
    return parseRepoKey(key) && runId ? { repo: key, runId } : null;
  },
  createClient: (options) => createBitbucketClient(options),
};

export type { WorkflowRef };
