// The Woodpecker client, against hand-built fixtures of the live 3.20 shapes.

import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../src/providers/errors.ts';
import { ProviderError } from '../src/providers/errors.ts';
import { createWoodpeckerClient, mapWoodpeckerRun } from '../src/providers/woodpecker.ts';
import type { RepoRef } from '../src/domain/repoKey.ts';
import type { Run } from '../src/domain/types.ts';

const NOW = 1_789_000_000_000;

const REF: RepoRef = { provider: 'woodpecker', host: 'ci.codeberg.org', path: 'alicia/pixelflare' };

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Bun.file(`test/fixtures/woodpecker/${name}`).text()) as T;

const fakeFetch = (responder: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
};

const client = (fetch: FetchLike) =>
  createWoodpeckerClient({ fetch, token: 't', host: 'ci.codeberg.org', now: () => NOW });

const authOf = (call: { init?: RequestInit } | undefined) =>
  (call?.init?.headers as Record<string, string>)?.Authorization ?? '';

const respond = (json: unknown, status = 200) =>
  new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });

const route = (map: Record<string, () => Response>) => (url: string) => {
  for (const [part, answer] of Object.entries(map)) if (url.includes(part)) return answer();
  throw new Error(`unexpected fetch: ${url}`);
};

describe('woodpecker repo id lookup', () => {
  test('repo id lookup is cached', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipelines = await fixture<unknown[]>('pipelines.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = client(fetch);
    await wp.listRuns(REF);
    await wp.listRuns(REF);
    const lookups = calls.filter((c) => c.url.includes('/repos/lookup/'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.url).toBe('https://ci.codeberg.org/api/repos/lookup/alicia/pixelflare');
    expect(calls[1]!.url.startsWith('https://ci.codeberg.org/api/repos/42/pipelines')).toBeTrue();
  });

  test('listRuns maps pipelines', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipelines = await fixture<Record<string, unknown>[]>('pipelines.json');
    const { fetch } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = client(fetch);
    const runs = await wp.listRuns(REF);
    expect(runs).toHaveLength(3);
    const latest: Run = runs[0]!;
    expect(latest).toEqual({
      id: '128',
      provider: 'woodpecker',
      repo: 'woodpecker:ci.codeberg.org/alicia/pixelflare',
      number: 128,
      workflow: 'Pipelines',
      workflowId: 'pipelines',
      branch: 'main',
      sha: 'abc123def4567890',
      title: 'pixelflare: sharpen the flare pass',
      event: 'push',
      attempt: 1,
      status: 'completed',
      conclusion: 'success',
      createdAt: 1788999300000,
      startedAt: 1788999360000,
      finishedAt: 1788999600000,
      actor: 'alicia',
      url: 'https://ci.codeberg.org/repos/42/pipeline/128',
      commitUrl: 'https://codeberg.org/alicia/pixelflare/commit/abc123def4567890',
    });
    const blocked = runs[2]!
    expect(blocked.status).toBe('waiting');
    expect(blocked.conclusion).toBeNull();
    expect(blocked.startedAt).toBeNull();
    expect(blocked.finishedAt).toBeNull();
  });

  test('a declined pipeline is over, not waiting', () => {
    const run = mapWoodpeckerRun({ number: 130, status: 'declined' }, 'https://ci.codeberg.org', REF, '42');
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('cancelled');
  });

  test('listRuns passes filters through', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipelines = await fixture<unknown[]>('pipelines.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = client(fetch);
    await wp.listRuns(REF, { branch: 'main', event: 'push', status: 'failed', perPage: 20, page: 2 });
    expect(calls[1]!.url).toBe(
      'https://ci.codeberg.org/api/repos/42/pipelines?branch=main&event=push&status=failure&perPage=20&page=2',
    );
  });

  test('listWorkflowRuns guesses total from the page size', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipelines = await fixture<Record<string, unknown>[]>('pipelines.json');
    const { fetch } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = client(fetch);
    const full = await wp.listWorkflowRuns(REF, 'pipelines', { perPage: 3, page: 1 });
    expect(full.runs).toHaveLength(3);
    expect(full.total).toBe(4);
    const short = await wp.listWorkflowRuns(REF, 'pipelines', { perPage: 50, page: 1 });
    expect(short.total).toBe(3);
  });
});

describe('woodpecker jobs and logs', () => {
  test('listJobs flattens steps', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipeline = await fixture<Record<string, unknown>>('pipeline.json');
    const { fetch } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines/128': () => respond(pipeline),
      }),
    );
    const wp = client(fetch);
    const jobs = await wp.listJobs(REF, '128');
    expect(jobs.map((job) => job.id)).toEqual(['128-901', '128-903']);
    expect(jobs.map((job) => job.name)).toEqual(['compile', 'unit']);
    expect(jobs[1]!.conclusion).toBe('failure');
    expect(jobs.every((job) => job.steps.length === 0)).toBeTrue();
    expect(JSON.stringify(jobs)).not.toContain('clone');
    expect(JSON.stringify(jobs)).not.toContain('redis');
  });

  test('getJobLog decodes entries and drops metadata', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const log = await fixture<unknown[]>('log.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/logs/': () => respond(log),
      }),
    );
    const wp = client(fetch);
    const window = await wp.getJobLog(REF, '128-903', { full: true });
    expect(calls[1]!.url).toBe('https://ci.codeberg.org/api/repos/42/logs/128/903');
    expect(window.text).toBe('hello\ngrüße\n1');
    expect(window.truncated).toBeFalse();
  });

  test('getJobLog tails on a line boundary', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const log = await fixture<unknown[]>('log.json');
    const { fetch } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/logs/': () => respond(log),
      }),
    );
    const wp = client(fetch);
    const window = await wp.getJobLog(REF, '128-903', { tailBytes: 6 });
    expect(window.text).toBe('1');
    expect(window.truncated).toBeTrue();
  });

  test('a malformed job id is a miss, not a request', async () => {
    const { fetch, calls } = fakeFetch(() => respond({}, 200));
    const wp = client(fetch);
    await expect(wp.getJobLog(REF, '903')).rejects.toMatchObject({ kind: 'not-found' });
    expect(calls).toHaveLength(0);
  });
});

describe('woodpecker transport', () => {
  test('origin option overrides the https default', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const pipelines = await fixture<unknown[]>('pipelines.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = createWoodpeckerClient({ fetch, token: 't', host: 'ci.lan:8000', origin: 'http://ci.lan:8000', now: () => NOW });
    await wp.listRuns({ provider: 'woodpecker', host: 'ci.lan:8000', path: 'alicia/pixelflare' });
    expect(calls[0]!.url.startsWith('http://ci.lan:8000/api/')).toBeTrue();
  });

  test.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [500, 'server'],
  ])('status %i maps to kind %s', async (status, kind) => {
    const { fetch } = fakeFetch(route({ '/repos/lookup/': () => respond({ message: 'nope' }, status) }));
    const wp = client(fetch);
    await expect(wp.defaultBranch(REF)).rejects.toMatchObject({ kind });
  });

  test('sends the bearer token', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const { fetch, calls } = fakeFetch(route({ '/repos/lookup/': () => respond(repo) }));
    const wp = client(fetch);
    await wp.defaultBranch(REF);
    expect(authOf(calls[0])).toBe('Bearer t');
  });
});

describe('woodpecker server surface', () => {
  test('listServerRepos maps the user list and seeds the id cache', async () => {
    const repos = await fixture<Record<string, unknown>[]>('user-repos.json');
    const pipelines = await fixture<unknown[]>('pipelines.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/user/repos': () => respond(repos),
        '/pipelines': () => respond(pipelines),
      }),
    );
    const wp = client(fetch);
    const list = await wp.listServerRepos!();
    expect(list).toEqual([
      {
        path: 'alicia/pixelflare',
        id: '42',
        cloneUrls: ['https://codeberg.org/alicia/pixelflare.git', 'git@codeberg.org:alicia/pixelflare.git'],
        forgeUrl: 'https://codeberg.org/alicia/pixelflare',
      },
      {
        path: 'alicia/notes',
        id: '43',
        cloneUrls: ['https://codeberg.org/alicia/notes.git', 'git@codeberg.org:alicia/notes.git'],
        forgeUrl: 'https://codeberg.org/alicia/notes',
      },
    ]);
    expect(calls[0]!.url).toBe('https://ci.codeberg.org/api/user/repos');
    expect(calls[0]!.url).not.toContain('all=');
    await wp.listRuns(REF);
    expect(calls.some((c) => c.url.includes('/repos/lookup/'))).toBeFalse();
  });

  test('listWorkflows is the synthetic group, without a request', async () => {
    const { fetch, calls } = fakeFetch(() => respond({}));
    const wp = client(fetch);
    await expect(wp.listWorkflows(REF)).resolves.toEqual([
      { id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' },
    ]);
    expect(calls).toHaveLength(0);
  });
});

describe('woodpecker errors', () => {
  test('ProviderError carries kind and status', () => {
    const error = new ProviderError('gone', { kind: 'not-found', status: 404 });
    expect(error.kind).toBe('not-found');
    expect(error.status).toBe(404);
  });
});

describe('woodpecker actions', () => {
  const withPipeline = async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    return fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/pipelines': () => respond({}),
      }),
    );
  };

  test('rerunAll restarts the pipeline', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await wp.rerunAll(REF, '128');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(calls[1]!.url).toBe('https://ci.codeberg.org/api/repos/42/pipelines/128');
  });

  test('cancel stops the pipeline', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await wp.cancel(REF, '128');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(calls[1]!.url).toBe('https://ci.codeberg.org/api/repos/42/pipelines/128/cancel');
  });

  test('approve and decline reach the pipeline endpoints', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await wp.approve!(REF, '128');
    expect(calls[1]!.init?.method).toBe('POST');
    expect(calls[1]!.url).toBe('https://ci.codeberg.org/api/repos/42/pipelines/128/approve');
    await wp.decline!(REF, '128');
    expect(calls[2]!.init?.method).toBe('POST');
    expect(calls[2]!.url).toBe('https://ci.codeberg.org/api/repos/42/pipelines/128/decline');
  });

  test('rerunFailed is unsupported without a request', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await expect(wp.rerunFailed(REF, '128')).rejects.toMatchObject({ kind: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  test('dispatch starts a manual pipeline on the branch', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await wp.dispatch(REF, 'pipelines', 'dev', {});
    expect(calls[1]!.init?.method).toBe('POST');
    expect(calls[1]!.url).toBe('https://ci.codeberg.org/api/repos/42/pipelines');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ branch: 'dev', variables: {} });
  });

  test('dispatch inputs offer a workflow choice when several pipelines exist', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const workflows = await fixture<unknown[]>('workflows.json');
    const { fetch, calls } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/workflows': () => respond(workflows),
      }),
    );
    const wp = client(fetch);
    const inputs = await wp.getDispatchInputs(REF, { id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }, 'main');
    expect(inputs.dispatchable).toBe(true);
    expect(inputs.inputs[0]).toMatchObject({ name: 'workflow', type: 'choice', options: ['build', 'deploy'], required: false });
    expect(inputs.inputs[1]).toMatchObject({ name: 'variables', type: 'variables', required: false });
    expect(calls.some((c) => c.url.endsWith('/api/repos/42/workflows'))).toBe(true);
  });

  test('a single pipeline offers only variables', async () => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const { fetch } = fakeFetch(
      route({
        '/repos/lookup/': () => respond(repo),
        '/workflows': () => respond([{ name: 'build', depends_on: [] }]),
      }),
    );
    const wp = client(fetch);
    const inputs = await wp.getDispatchInputs(REF, { id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }, 'main');
    expect(inputs.inputs.map((input) => input.name)).toEqual(['variables']);
  });

  test('dispatch sends the picked workflow and parsed variables', async () => {
    const { fetch, calls } = await withPipeline();
    const wp = client(fetch);
    await wp.dispatch(REF, 'pipelines', 'main', { workflow: 'build', variables: '{"x":"1","empty":""}' });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ branch: 'main', variables: { x: '1', empty: '' }, workflow: 'build' });
    await wp.dispatch(REF, 'pipelines', 'main', { variables: '{"x"' });
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({ branch: 'main', variables: {} });
  });

  test.each([
    ['https://ci.codeberg.org/repos/42/pipeline/128', '/api/repos/42'],
    ['https://ci.codeberg.org/repos/42/pipeline/127', '/api/repos/42'],
    ['https://ci.codeberg.org/#/repos/42/pipeline/128', '/api/repos/42'],
  ])('resolveRunUrl parses %s', async (url, path) => {
    const repo = await fixture<Record<string, unknown>>('repo.json');
    const { fetch, calls } = fakeFetch(route({ '/repos/42': () => respond(repo) }));
    const wp = client(fetch);
    await expect(wp.resolveRunUrl!(url)).resolves.toEqual({ path: 'alicia/pixelflare', runId: url.endsWith('127') ? '127' : '128' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.endsWith(path)).toBeTrue();
  });

  test('a repo page is not a run url', async () => {
    const { fetch, calls } = fakeFetch(() => respond({}));
    const wp = client(fetch);
    await expect(wp.resolveRunUrl!('https://ci.codeberg.org/repos/42')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('woodpecker json guard', () => {
  test('a non-JSON body is an unknown provider error, not a crash', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const caught: unknown = await client(fetch).defaultBranch(REF).catch((err: unknown) => err);
    expect((caught as { kind?: string }).kind).toBe('unknown');
    expect((caught as Error).message).toContain('not JSON');
  });
});
