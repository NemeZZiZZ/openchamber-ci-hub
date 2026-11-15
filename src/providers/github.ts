// GitHub Actions adapter. Pure over an injected fetch, so tests replay recorded
// payloads and the service decides where the token comes from.
import { formatRepoKey, type RepoRef } from '../domain/repoKey.ts';
import type {
  Capabilities,
  DispatchInput,
  Job,
  Run,
  Step,
  WorkflowRef,
} from '../domain/types.ts';
import { asString, conclusionOf, isObject, statusOf, time } from './compat.ts';
import { ProviderError } from './errors.ts';
import type { CiClient, ClientOptions, ListRunsOptions, Provider } from './types.ts';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

const apiOriginFor = (host: string): string =>
  host.toLowerCase() === 'github.com' ? GITHUB_API_ORIGIN : `https://${host.toLowerCase()}/api/v3`;

const webUrlOf = (ref: RepoRef): string => `https://${ref.host}/${ref.path}`;

export const mapRun = (ref: RepoRef, raw: unknown): Run | null => {
  if (!isObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const number = typeof raw.run_number === 'number' ? raw.run_number : 0;
  const attempt = typeof raw.run_attempt === 'number' && raw.run_attempt > 0 ? raw.run_attempt : 1;
  const sha = asString(raw.head_sha);
  return {
    id: String(id),
    provider: 'github',
    repo: formatRepoKey(ref),
    number,
    workflow: asString(raw.name) || asString(raw.display_title) || 'workflow',
    workflowId: raw.workflow_id === undefined ? '' : String(raw.workflow_id),
    branch: asString(raw.head_branch),
    sha,
    title: asString(raw.display_title) || asString(raw.head_commit && isObject(raw.head_commit) ? raw.head_commit.message : ''),
    event: asString(raw.event),
    attempt,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    createdAt: time(raw.created_at) ?? 0,
    startedAt: time(raw.run_started_at) ?? time(raw.created_at) ?? null,
    finishedAt: statusOf(raw.status) === "completed" ? (time(raw.updated_at) ?? null) : null,
    actor: isObject(raw.actor) ? asString(raw.actor.login) : '',
    url: asString(raw.html_url),
    commitUrl: sha === '' ? null : `${webUrlOf(ref)}/commit/${sha}`,
  };
};

export const mapJob = (runId: string, raw: unknown): Job | null => {
  if (!isObject(raw) || raw.id === undefined) return null;
  const steps: Step[] = Array.isArray(raw.steps)
    ? raw.steps.filter(isObject).map((step, index) => ({
        number: typeof step.number === 'number' ? step.number : index + 1,
        name: asString(step.name) || `step ${index + 1}`,
        status: statusOf(step.status),
        conclusion: conclusionOf(step.conclusion),
        startedAt: time(step.started_at),
        finishedAt: time(step.completed_at),
      }))
    : [];
  return {
    id: String(raw.id),
    runId,
    name: asString(raw.name) || `job ${String(raw.id)}`,
    status: statusOf(raw.status),
    conclusion: conclusionOf(raw.conclusion),
    startedAt: time(raw.started_at),
    finishedAt: time(raw.completed_at),
    steps,
    url: asString(raw.html_url),
  };
};

const WORKFLOW_DIR = '.github/workflows/';

export const createGitHubClient = (options: ClientOptions): CiClient => {
  const apiOrigin = apiOriginFor(options.host);
  const now = options.now ?? (() => Date.now());

  const request = async (
    path: string,
    init: RequestInit = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> => {
    const url = path.startsWith('http') ? path : `${apiOrigin}${path}`;
    let response: Response;
    try {
      response = await options.fetch(url, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': 'openchamber-ci-hub',
          Authorization: `Bearer ${options.token}`,
          ...extraHeaders,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (err) {
      throw new ProviderError(
        err instanceof Error ? `GitHub unreachable: ${err.message}` : 'GitHub unreachable',
        { kind: 'network' },
      );
    }

    if (response.status === 401) {
      throw new ProviderError('GitHub rejected the token (401). Reconnect the account.', { kind: 'auth', status: 401 });
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    const retryAfter = Number(response.headers.get('retry-after'));
    if (
      response.status === 429 ||
      (response.status === 403 && (remaining === '0' || Number.isFinite(retryAfter) && retryAfter > 0))
    ) {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const resetAt =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? now() + retryAfter * 1000
          : Number.isFinite(reset) && reset > 0
            ? reset * 1000
            : now() + 60_000;
      throw new ProviderError('GitHub rate limit reached.', {
        kind: 'rate-limit',
        status: response.status,
        rateLimitReset: resetAt,
      });
    }
    if (response.status === 403) {
      throw new ProviderError('GitHub refused the request (403). The token may lack the workflow scope.', {
        kind: 'forbidden',
        status: 403,
      });
    }
    if (response.status === 404) {
      throw new ProviderError('Not found on GitHub (404).', { kind: 'not-found', status: 404 });
    }
    if (response.status >= 500) {
      throw new ProviderError(`GitHub answered ${response.status}.`, { kind: 'server', status: response.status });
    }
    if (!response.ok && response.status !== 304) {
      throw new ProviderError(`GitHub answered ${response.status}.`, { kind: 'unknown', status: response.status });
    }
    return response;
  };

  // Conditional GETs: a 304 does not count against the rate limit. The cache
  // is a small LRU: a Map keeps insertion order, so a hit moves to the end.
  const ETAG_LIMIT = 200;
  const etags = new Map<string, { etag: string; body: unknown }>();
  const json = async (path: string, init?: RequestInit): Promise<unknown> => {
    const conditional = init?.method === undefined;
    const cached = conditional ? etags.get(path) : undefined;
    const response = await request(path, init, cached ? { 'If-None-Match': cached.etag } : {});
    if (response.status === 304 && cached) {
      etags.delete(path);
      etags.set(path, cached);
      return cached.body;
    }
    // 204, a 304 we did not ask for, or an empty body: nothing to parse.
    const text = response.status === 204 || response.status === 304 ? '' : await response.text();
    if (text.trim() === '') return null;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError(`GitHub answered ${response.status} with a body that is not JSON.`, {
        kind: 'unknown',
        status: response.status,
      });
    }
    const etag = response.headers.get('etag');
    if (etag && conditional) {
      etags.delete(path);
      etags.set(path, { etag, body });
      if (etags.size > ETAG_LIMIT) etags.delete(etags.keys().next().value!);
    }
    return body;
  };

  const base = (repo: RepoRef) => `/repos/${repo.path.split('/').map(encodeURIComponent).join('/')}`;

  const runParams = (opts: ListRunsOptions, perPage: number): string => {
    const params = new URLSearchParams();
    params.set('per_page', String(opts.perPage ?? perPage));
    params.set('page', String(opts.page ?? 1));
    if (opts.branch) params.set('branch', opts.branch);
    if (opts.event) params.set('event', opts.event);
    if (opts.status) params.set('status', opts.status);
    if (opts.actor) params.set('actor', opts.actor);
    return params.toString();
  };

  const runsOf = (repo: RepoRef, body: unknown): Run[] => {
    const runs = isObject(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    return runs.map((raw) => mapRun(repo, raw)).filter((run): run is Run => run !== null);
  };

  return {

    async listRuns(repo, opts = {}) {
      const body = await json(`${base(repo)}/actions/runs?${runParams(opts, 40)}`);
      return runsOf(repo, body);
    },

    async listWorkflowRuns(repo, workflowId, opts = {}) {
      const id = encodeURIComponent(workflowId);
      const body = await json(`${base(repo)}/actions/workflows/${id}/runs?${runParams(opts, 20)}`);
      const total = isObject(body) && typeof body.total_count === 'number' ? body.total_count : 0;
      return { runs: runsOf(repo, body), total };
    },

    async getRun(repo, runId) {
      const raw = await json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}`);
      const run = mapRun(repo, raw);
      if (run === null) throw new ProviderError('That run is not readable.', { kind: 'unknown' });
      return run;
    },

    async listJobs(repo, runId) {
      const body = await json(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
      const jobs = isObject(body) && Array.isArray(body.jobs) ? body.jobs : [];
      return jobs.map((raw) => mapJob(runId, raw)).filter((job): job is Job => job !== null);
    },

    async getJobLog(repo, jobId, opts = {}) {
      // GitHub answers a redirect to a signed blob; the Range header survives
      // it, and a suffix range keeps the tail without downloading tens of MB.
      const tailBytes = opts.tailBytes ?? 256 * 1024;
      const path = `${base(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`;
      let response: Response;
      try {
        response = await request(path, { redirect: 'follow' }, opts.full ? {} : { Range: `bytes=-${tailBytes}` });
      } catch (err) {
        // Some blob stores refuse suffix ranges (416); fall back to the whole file.
        if (!(err instanceof ProviderError) || err.status !== 416) throw err;
        response = await request(path, { redirect: 'follow' });
      }
      let text = await response.text();
      let truncated = response.status === 206;
      const cap = opts.full ? 4 * 1024 * 1024 : tailBytes;
      if (text.length > cap) {
        text = text.slice(text.length - cap);
        truncated = true;
      }
      if (truncated) {
        // Drop the partial first line of a tail window.
        const cut = text.indexOf('\n');
        if (cut !== -1 && cut < 4096) text = text.slice(cut + 1);
      }
      return { text, truncated };
    },

    async rerunAll(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' });
    },

    async rerunFailed(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/rerun-failed-jobs`, {
        method: 'POST',
      });
    },

    async cancel(repo, runId) {
      await request(`${base(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    },

    async listWorkflows(repo) {
      const body = await json(`${base(repo)}/actions/workflows?per_page=100`);
      const list = isObject(body) && Array.isArray(body.workflows) ? body.workflows : [];
      return list
        .filter(isObject)
        .map((raw) => {
          const path = asString(raw.path);
          return {
            id: String(raw.id ?? ''),
            name: asString(raw.name) || path,
            path,
            file: path.startsWith(WORKFLOW_DIR) ? path.slice(WORKFLOW_DIR.length) : path,
          };
        })
        .filter((workflow) => workflow.id !== '');
    },

    async getDispatchInputs(repo, workflow, ref) {
      const path = `${base(repo)}/contents/${workflow.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      const response = await request(
        `${path}?ref=${encodeURIComponent(ref)}`,
        { headers: { Accept: 'application/vnd.github.raw' } },
      );
      const yaml = await response.text();
      const dispatchable = hasDispatchTrigger(yaml);
      return {
        dispatchable,
        inputs: parseDispatchInputs(yaml),
        refusal: dispatchable
          ? null
          : `This workflow has no workflow_dispatch trigger on ${ref}, so GitHub will refuse to start it.`,
      };
    },

    async dispatch(repo, workflowId, ref, inputs) {
      await request(`${base(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs }),
        headers: { 'Content-Type': 'application/json' },
      });
    },

    async defaultBranch(repo) {
      const body = await json(base(repo));
      return isObject(body) ? asString(body.default_branch, 'main') : 'main';
    },
  };
};

// --- workflow_dispatch inputs -------------------------------------------------
// The REST API does not expose dispatch inputs, so read the workflow file. This
// is a tolerant reader for the block people actually write, not a YAML parser:
// it ignores anything it does not recognise instead of refusing the workflow.

const indentOf = (line: string): number => line.length - line.trimStart().length;

const unquote = (value: string): string => {
  let text = value.trim();
  const comment = /^([^#'"]*?)\s+#.*$/.exec(text);
  if (comment) text = comment[1]!.trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length > 1) ||
    (text.startsWith("'") && text.endsWith("'") && text.length > 1)
  ) {
    text = text.slice(1, -1);
  }
  return text;
};

/** `on: workflow_dispatch`, `on: [push, workflow_dispatch]` or a `workflow_dispatch:` key. */
export const hasDispatchTrigger = (yaml: string): boolean =>
  yaml
    .replace(/\r\n/g, '\n')
    .split('\n')
    .some((line) => !/^\s*#/.test(line) && /(^|[\s\[,:])workflow_dispatch\b/.test(line));

export const parseDispatchInputs = (yaml: string): DispatchInput[] => {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const significant = lines.filter((line) => line.trim() !== '' && !/^\s*#/.test(line));
  if (significant.length === 0) return [];

  // Find `workflow_dispatch:` and the indentation it sits at.
  const startIndex = significant.findIndex((line) => /^\s*workflow_dispatch\s*:\s*$/.test(line));
  if (startIndex === -1) return [];
  const dispatchIndent = indentOf(significant[startIndex]!);

  let inputsIndent = -1;
  const inputs: DispatchInput[] = [];
  let current: DispatchInput | null = null;
  let inOptions = false;
  let optionsIndent = -1;
  let nameIndent = -1;

  for (let i = startIndex + 1; i < significant.length; i += 1) {
    const line = significant[i]!;
    const indent = indentOf(line);
    const trimmed = line.trim();

    if (indent <= dispatchIndent) break;

    if (inputsIndent === -1) {
      const match = /^inputs\s*:\s*$/.exec(trimmed);
      if (match) inputsIndent = indent;
      continue;
    }

    if (inOptions && indent > optionsIndent && trimmed.startsWith('-')) {
      if (current !== null) current.options.push(unquote(trimmed.replace(/^-\s*/, '')));
      continue;
    }
    inOptions = false;

    if (indent <= inputsIndent) break;

    const keyMatch = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!keyMatch) continue;
    const key = keyMatch[1]!;
    const value = keyMatch[2] ?? "";

    // The first key under `inputs:` sets the indentation of input names.
    if (nameIndent === -1) nameIndent = indent;
    if (indent <= nameIndent) {
      if (value === '') {
        current = {
          name: key,
          description: '',
          required: false,
          default: '',
          type: 'string',
          options: [],
        };
        inputs.push(current);
        continue;
      }
      // List form: `- name: x` inside an `inputs:` list — rare, ignored.
      current = null;
      continue;
    }

    if (current === null) continue;

    if (key === 'description') current.description = unquote(value);
    else if (key === 'required') current.required = unquote(value) === 'true';
    else if (key === 'default') current.default = unquote(value);
    else if (key === 'type') {
      const type = unquote(value);
      if (type === 'boolean' || type === 'choice' || type === 'environment') current.type = type;
      else current.type = 'string';
    } else if (key === 'options') {
      const inline = value.trim();
      if (inline.startsWith('[')) {
        current.options.push(
          ...inline
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map((entry) => unquote(entry))
            .filter((entry) => entry !== ''),
        );
      } else {
        inOptions = true;
        optionsIndent = indent;
      }
    }
  }

  return inputs;
};

// --- the provider ---------------------------------------------------------------

const CAPABILITIES: Capabilities = {
  rerunAll: 'same-run',
  rerunFailed: true,
  cancel: true,
  retryJob: false,
  playManualJob: false,
  dispatch: 'workflow-inputs',
  jobDetail: 'steps',
  approve: false,
  groupHistory: true,
};

const RUN_URL = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/;

export const github: Provider = {
  id: 'github',
  label: 'GitHub',
  words: {
    run: 'run',
    runs: 'runs',
    workflow: 'workflow',
    workflows: 'workflows',
    rerunFailed: 'Re-run failed jobs',
    rerunFailedShort: 'Re-run failed',
    rerunAll: 'Re-run all jobs',
    rerunAllShort: 'Re-run all',
    cancelDelay: 'GitHub takes a few seconds to stop it.',
    logPending: 'GitHub publishes the log when the job finishes.',
    logMissing: 'GitHub has no log for this job (it may have been skipped or the log expired).',
    dispatchHelp: 'Only workflows with a workflow_dispatch trigger can be started here.',
    repoPlaceholder: 'owner/name or a GitHub URL',
    tokenOrder:
      'CI Hub looks for a token in this order: the GitHub account connected in OpenChamber, the token pasted on the CI Hub card in Extensions, then the gh CLI (gh auth login). Re-runs, cancel and workflow runs need the repo and workflow scopes.',
    noAccount: 'No GitHub account. Connect GitHub in OpenChamber, paste a token on the CI Hub card, or run gh auth login.',
  },
  capabilities: CAPABILITIES,
  logDialect: 'github',
  publicHosts: ['github.com'],
  hostPattern: /^github\./,
  storeKey: 'github',
  settingKey: 'github-token',
  serverSetting: null,
  authSetting: null,
  cli: { program: 'gh', tokenArgs: (host) => ['auth', 'token', '--hostname', host] },
  apiOrigin: apiOriginFor,
  repoPath: (segments) => (segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null),
  webUrl: webUrlOf,
  ciUrl: (ref) => `${webUrlOf(ref)}/actions`,
  parseRunUrl: (url) => {
    const match = RUN_URL.exec(url.trim());
    if (!match) return null;
    return {
      repo: formatRepoKey({ provider: 'github', host: match[1]!, path: match[2]! }),
      runId: match[3]!,
    };
  },
  createClient: createGitHubClient,
};
