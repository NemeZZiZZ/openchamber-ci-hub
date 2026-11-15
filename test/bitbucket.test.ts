// Bitbucket Cloud Pipelines: pipelines, steps and logs on bitbucket.org.
import { describe, expect, test } from 'bun:test';
import { createBitbucketClient, mapBitbucketJobs, mapBitbucketRun } from '../src/providers/bitbucket.ts';
import type { RepoRef } from '../src/domain/repoKey.ts';

const NOW = 1_789_000_000_000;
const REF = { provider: 'bitbucket', host: 'bitbucket.org', path: 'acme/web' } as RepoRef;
const WEB = 'https://bitbucket.org/acme/web';

const fixture = async <T,>(name: string): Promise<T> =>
  JSON.parse(await Bun.file(`test/fixtures/bitbucket/${name}`).text()) as T;

/** A fetch stub that routes by substring and records every call. */
const fakeFetch = (routes: Array<[string, (url: URL) => Response | Promise<Response>]>) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), init });
    for (const [part, respond] of routes) {
      if (url.pathname.includes(part) || url.search.includes(part)) return await respond(url);
    }
    return new Response('no route', { status: 404 });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
};

const respond = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const client = (fetch: typeof globalThis.fetch, user = 'me@example.com') =>
  createBitbucketClient({ fetch, user, token: 't', host: 'bitbucket.org', now: () => NOW });

describe('bitbucket provider', () => {
  test('authenticates with Basic credentials built from user and token', async () => {
    const { fetch, calls } = fakeFetch([
      ['/repositories/acme/web', () => respond({ main_branch: 'main' })],
    ]);
    await client(fetch).defaultBranch(REF);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Basic ${btoa('me@example.com:t')}` });
  });

  test('listRuns maps pipelines, dropping the uuid braces', async () => {
    const { fetch, calls } = fakeFetch([
      ['/pipelines', async () => respond(await fixture('pipelines.json'))],
    ]);
    const runs = await client(fetch).listRuns(REF);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      id: 'a1b2c3d4-1111-2222-3333-444455556666',
      provider: 'bitbucket',
      repo: 'bitbucket:bitbucket.org/acme/web',
      number: 42,
      workflow: 'Pipelines',
      workflowId: 'pipelines',
      branch: 'main',
      sha: 'a1b2c3d4e5f6',
      title: '#42 main',
      event: 'push',
      attempt: 1,
      status: 'completed',
      conclusion: 'success',
      createdAt: Date.parse('2026-11-15T10:00:00+00:00'),
      finishedAt: Date.parse('2026-11-15T10:05:00+00:00'),
      url: `${WEB}/pipelines/a1b2c3d4-1111-2222-3333-444455556666`,
      commitUrl: 'https://bitbucket.org/acme/web/commits/a1b2c3d4e5f6',
    });
    // A running pipeline has no completed_on and no result yet.
    expect(runs[1]).toMatchObject({ status: 'in_progress', conclusion: null, finishedAt: null });
    expect(calls[0]!.url).toContain('/2.0/repositories/acme/web/pipelines');
  });

  test('a failed run maps to failure; expired build minutes too', () => {
    const failed = mapBitbucketRun(
      {
        uuid: '{x1}',
        build_number: 7,
        created_on: '2026-11-15T10:00:00+00:00',
        completed_on: '2026-11-15T10:01:00+00:00',
        target: { ref_type: 'branch', ref_name: 'fix', commit: { hash: 'abc123' } },
        state: { name: 'COMPLETED', result: { name: 'EXPIRED' } },
      },
      REF,
      WEB,
    );
    expect(failed).toMatchObject({ status: 'completed', conclusion: 'failure' });
    const stopped = mapBitbucketRun(
      {
        uuid: '{x2}',
        build_number: 8,
        created_on: '2026-11-15T10:00:00+00:00',
        target: { ref_type: 'branch', ref_name: 'fix', commit: { hash: 'abc124' } },
        state: { name: 'COMPLETED', result: { name: 'STOPPED' } },
      },
      REF,
      WEB,
    );
    expect(stopped).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
  });

  test('the status filter reaches the API in its own words', async () => {
    const { fetch, calls } = fakeFetch([
      ['/pipelines', async () => respond(await fixture('pipelines.json'))],
    ]);
    await client(fetch).listRuns(REF, { status: 'failed' });
    expect(calls[0]!.url).toContain('status=FAILED');
  });

  test('the branch filter reaches the API as target.ref_name', async () => {
    const { fetch, calls } = fakeFetch([
      ['/pipelines', async () => respond(await fixture('pipelines.json'))],
    ]);
    await client(fetch).listRuns(REF, { branch: 'release/1.0' });
    expect(calls[0]!.url).toContain(`target.ref_name=${encodeURIComponent('release/1.0')}`);
  });

  test('listWorkflowRuns reports a total: full page with next hints more', async () => {
    const page = await fixture<Record<string, unknown>>('pipelines.json');
    page['values'] = Array.from({ length: 50 }, (_, i) => ({ ...(page['values'] as unknown[])[i % 2]!, build_number: i }));
    const { fetch } = fakeFetch([['/pipelines', async () => respond(page)]]);
    const { runs, total } = await client(fetch).listWorkflowRuns(REF, 'pipelines');
    expect(runs).toHaveLength(50);
    expect(total).toBe(51);
  });

  test('listWorkflowRuns reports a short page exactly', async () => {
    const { fetch } = fakeFetch([['/pipelines', async () => respond(await fixture('pipelines.json'))]]);
    const { total } = await client(fetch).listWorkflowRuns(REF, 'pipelines');
    expect(total).toBe(2);
  });

  test('getRun maps the detail payload', async () => {
    const { fetch } = fakeFetch([['/pipelines/a1b2c3d4', async () => respond(await fixture('pipeline.json'))]]);
    const run = await client(fetch).getRun(REF, 'a1b2c3d4-1111-2222-3333-444455556666');
    expect(run).toMatchObject({ id: 'a1b2c3d4-1111-2222-3333-444455556666', number: 42, status: 'completed', conclusion: 'success' });
    expect(run.startedAt).toBeNull();
  });

  test('listJobs maps steps to jobs, naming them by image or position', async () => {
    const { fetch } = fakeFetch([['/steps', async () => respond(await fixture('steps.json'))]]);
    const jobs = await client(fetch).listJobs(REF, 'a1b2c3d4-1111-2222-3333-444455556666');
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      id: 'a1b2c3d4-1111-2222-3333-444455556666:c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff',
      runId: 'a1b2c3d4-1111-2222-3333-444455556666',
      name: 'node:20',
      status: 'completed',
      conclusion: 'success',
      startedAt: Date.parse('2026-11-15T10:00:10+00:00'),
      finishedAt: Date.parse('2026-11-15T10:04:00+00:00'),
      steps: [],
    });
    expect(jobs[1]).toMatchObject({ name: 'step 2', conclusion: 'failure' });
    // A step that never ran is skipped, not failed.
    expect(jobs[2]).toMatchObject({ name: 'step 3', status: 'completed', conclusion: 'skipped', startedAt: null, finishedAt: null });
  });

  test('the job id braces are stripped for the engine gate', () => {
    const jobs = mapBitbucketJobs(
      { values: [{ uuid: '{s9}', image: 'alpine', state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } } }] },
      'run-1',
    );
    expect(jobs[0]!.id).toBe('run-1:s9');
  });

  test('getJobLog tails through a Range window and flags the cut', async () => {
    const log = await Bun.file('test/fixtures/bitbucket/log.txt').text();
    const total = new TextEncoder().encode(log).length;
    const { fetch, calls } = fakeFetch([
      ['/log', (url) => {
        const range = (calls.at(-1)?.init.headers as Record<string, string> | undefined)?.Range ?? '';
        if (range === 'bytes=0-0') return respond('', 206, { 'Content-Range': `bytes 0-0/${total}` });
        return respond(log.slice(-6), 206, { 'Content-Range': `bytes ${total - 6}-${total - 1}/${total}` });
      }],
    ]);
    const window = await client(fetch).getJobLog(REF, 'a1b2c3d4-1111-2222-3333-444455556666:c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff', { tailBytes: 6 });
    expect(window).toEqual({ text: 'third\n', truncated: true });
    const rangeCall = calls.find((call) => (call.init.headers as Record<string, string>)?.['Range'] === `bytes=${total - 6}-`);
    expect(rangeCall).toBeDefined();
  });

  test('getJobLog returns the whole log when it fits the budget', async () => {
    const log = await Bun.file('test/fixtures/bitbucket/log.txt').text();
    const total = new TextEncoder().encode(log).length;
    const { fetch, calls } = fakeFetch([
      ['/log', () => {
        const range = (calls.at(-1)?.init.headers as Record<string, string> | undefined)?.Range ?? '';
        if (range === 'bytes=0-0') return respond('', 206, { 'Content-Range': `bytes 0-0/${total}` });
        return respond(log);
      }],
    ]);
    const window = await client(fetch).getJobLog(REF, 'a1b2c3d4-1111-2222-3333-444455556666:c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff', { tailBytes: 64 });
    expect(window).toEqual({ text: log, truncated: false });
  });

  test('error kinds map: 401 auth, 403 forbidden, 404 not-found, 429 rate-limit, 500 server', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [429, 'rate-limit'],
      [500, 'server'],
    ];
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch([['/repositories/acme/web', () => respond({ error: { message: 'nope' } }, status)]]);
      const caught: unknown = await client(fetch).defaultBranch(REF).catch((err: unknown) => err);
      expect((caught as { kind?: string }).kind, `${status} maps to ${kind}`).toBe(kind);
    }
  });

  test('non-latin credentials fail with a card hint', async () => {
    const { fetch } = fakeFetch([['/repositories/acme/web', () => respond({ main_branch: 'main' })]]);
    const latin = createBitbucketClient({ fetch, user: 'a@b.co', token: 'пароль', host: 'bitbucket.org', now: () => NOW });
    const caught: unknown = await latin.defaultBranch(REF).catch((err: unknown) => err);
    const error = caught as { kind?: string; message?: string };
    expect(error.kind).toBe('unknown');
    expect(error.message).toContain('bitbucket-token');
  });

  test('an unsatisfiable range reads as an empty log', async () => {
    const { fetch } = fakeFetch([['/log', () => respond('', 416, { 'Content-Range': 'bytes */19' })]]);
    const window = await client(fetch).getJobLog(REF, 'a1b2c3d4-1111-2222-3333-444455556666:c3d4e5f6-aaaa-bbbb-cccc-ddddeeeeffff');
    expect(window).toEqual({ text: '', truncated: false });
  });

  test('workflows list one synthetic Pipelines group without a request', async () => {
    const { fetch, calls } = fakeFetch([]);
    const workflows = await client(fetch).listWorkflows(REF);
    expect(workflows).toEqual([{ id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }]);
    expect(calls).toHaveLength(0);
  });

  test('dispatch inputs carry the variables field', async () => {
    const { fetch, calls } = fakeFetch([]);
    const inputs = await client(fetch).getDispatchInputs(REF, { id: 'pipelines', name: 'Pipelines', path: 'pipelines', file: 'pipelines' }, 'main');
    expect(inputs.dispatchable).toBe(true);
    expect(inputs.refusal).toBeNull();
    expect(inputs.inputs).toEqual([
      { name: 'variables', type: 'variables', description: 'Pipeline variables, as key/value pairs.', required: false, default: '', options: [] },
    ]);
    expect(calls).toHaveLength(0);
  });

  test('cancel reaches stopPipeline', async () => {
    const { fetch, calls } = fakeFetch([
      ['/stopPipeline', () => respond({})],
    ]);
    await client(fetch).cancel(REF, 'a1b2c3d4-1111-2222-3333-444455556666');
    const call = calls[0]!;
    expect(call.init.method).toBe('POST');
    expect(call.url).toContain('/pipelines/a1b2c3d4-1111-2222-3333-444455556666/stopPipeline');
  });

  test('rerunAll re-posts the run own target', async () => {
    const detail = await fixture<Record<string, unknown>>('pipeline.json');
    const { fetch, calls } = fakeFetch([
      ['/pipelines/a1b2c3d4', () => respond(detail)],
      ['/web/pipelines', () => respond({ uuid: '{new}' })],
    ]);
    await client(fetch).rerunAll(REF, 'a1b2c3d4-1111-2222-3333-444455556666');
    const post = calls.at(-1)!;
    expect(post.init.method).toBe('POST');
    const body = JSON.parse(String(post.init.body));
    expect(body.target).toMatchObject({ type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 'main' });
  });

  test('rerunFailed throws unsupported without a request', async () => {
    const { fetch, calls } = fakeFetch([]);
    const caught: unknown = await client(fetch).rerunFailed(REF, 'x').catch((err: unknown) => err);
    expect((caught as { kind?: string }).kind).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  test('dispatch sends the branch and the variables array', async () => {
    const { fetch, calls } = fakeFetch([
      ['/web/pipelines', () => respond({ uuid: '{new}' })],
    ]);
    await client(fetch).dispatch(REF, 'pipelines', 'main', { variables: '{"a":"1","flag":""}' });
    const post = calls[0]!;
    expect(post.init.method).toBe('POST');
    expect(post.url).toContain('/2.0/repositories/acme/web/pipelines');
    const body = JSON.parse(String(post.init.body));
    expect(body).toEqual({
      target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 'main' },
      variables: [
        { key: 'a', value: '1' },
        { key: 'flag', value: '' },
      ],
    });
  });
});
