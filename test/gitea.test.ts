import { describe, expect, test } from 'bun:test';
import type { RepoRef } from '../src/domain/repoKey.ts';
import { ProviderError, type FetchLike, type ProviderErrorKind } from '../src/providers/errors.ts';
import { createGiteaClient, gitea, mapGiteaRun } from '../src/providers/gitea.ts';

const NOW = 1_789_000_000_000;
const REF: RepoRef = { provider: 'gitea', host: 'gitea.acme.io', path: 'g/p' };

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Bun.file(`test/fixtures/gitea/${name}`).text()) as T;

const fakeFetch = (responder: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
};

const client = (fetch: FetchLike) =>
  createGiteaClient({ fetch, token: 't', host: 'gitea.acme.io', now: () => NOW });

const authOf = (call: { init?: RequestInit | undefined } | undefined) =>
  (call?.init?.headers as Record<string, string> | undefined)?.['Authorization'];

/** A fetch that answers the version probe and replays the recorded payloads. */
const recorded = async (extra?: (url: string) => Response | undefined) => {
  const runs = await fixture<{ workflow_runs: unknown[] }>('runs.json');
  const jobs = await fixture<unknown>('jobs.json');
  const workflows = await fixture<unknown>('workflows.json');
  return fakeFetch((url) => {
    const answer = extra?.(url);
    if (answer) return answer;
    if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
    if (url.includes('/actions/runs/91/jobs')) return Response.json(jobs);
    if (url.endsWith('/actions/runs/91')) return Response.json(runs.workflow_runs[0]);
    if (url.includes('/actions/runs?')) return Response.json(runs);
    if (url.includes('/actions/workflows?')) return Response.json(workflows);
    if (url.includes('/contents/')) {
      return Response.json({ content: 'x', encoding: 'base64' });
    }
    return Response.json({});
  });
};

describe('Gitea transport', () => {
  test('errors map to provider kinds', async () => {
    const cases: [number, ProviderErrorKind][] = [
      [401, 'auth'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'server'],
    ];
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch(() => new Response('{}', { status }));
      const err = await client(fetch).listRuns(REF).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
    }
  });

  test('getRun surfaces a server error instead of pretending the run is gone', async () => {
    const { fetch } = await recorded((url) =>
      url.endsWith('/actions/runs/91') ? new Response('{}', { status: 500 }) : undefined,
    );
    const err = await client(fetch).getRun(REF, '91').catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('server');
  });

  test('the token goes out as a Gitea token header', async () => {
    const { fetch, calls } = await recorded();
    await client(fetch).listRuns(REF);
    expect(authOf(calls[0])).toBe('token t');
    expect(calls.some((call) => call.url.endsWith('/version'))).toBe(true);
  });

  test('the version probe is read once per client', async () => {
    const { fetch, calls } = await recorded();
    const one = client(fetch);
    await one.listRuns(REF);
    await one.getRun(REF, '91');
    await one.listJobs(REF, '91');
    expect(calls.filter((call) => call.url.endsWith('/version'))).toHaveLength(1);
  });
});

describe('Gitea mapping', () => {
  test('runs map the gitea shape to Run', async () => {
    const runs = await fixture<{ workflow_runs: unknown[] }>('runs.json').then((body) => body.workflow_runs);
    const done = mapGiteaRun(REF, runs[0]);
    expect(done).not.toBeNull();
    expect(done!.id).toBe('91');
    expect(done!.provider).toBe('gitea');
    expect(done!.workflowId).toBe('build.yml');
    expect(done!.workflow).toBe('Fix the widget');
    expect(done!.number).toBe(12);
    expect(done!.branch).toBe('main');
    expect(done!.status).toBe('completed');
    expect(done!.conclusion).toBe('failure');
    expect(done!.startedAt).toBe(Date.parse('2026-11-15T09:00:00Z'));
    expect(done!.finishedAt).toBe(Date.parse('2026-11-15T09:04:30Z'));
    expect(done!.actor).toBe('ada');
    expect(done!.url).toBe('https://gitea.acme.io/g/p/actions/runs/91');
    expect(done!.commitUrl).toBe('https://gitea.acme.io/g/p/commit/abc1234');

    const running = mapGiteaRun(REF, runs[1]);
    expect(running!.workflowId).toBe('build.yml'); // a .github/workflows/ prefix is stripped
    expect(running!.status).toBe('in_progress');
    expect(running!.finishedAt).toBeNull();
    expect(running!.attempt).toBe(2);
  });

  test('listRuns sends page, limit and mapped filters', async () => {
    const { fetch, calls } = await recorded();
    await client(fetch).listRuns(REF, { branch: 'main', actor: 'ada', status: 'failed' });
    const runCall = calls.find((call) => call.url.includes('/actions/runs?'));
    expect(runCall?.url).toBe(
      'https://gitea.acme.io/api/v1/repos/g/p/actions/runs?page=1&limit=50&branch=main&actor=ada&status=failure',
    );
  });

  test('listWorkflowRuns filters by workflow file across windows and peeks for an honest total', async () => {
    const matching = (id: number) => ({
      id,
      display_title: 'Build',
      path: 'build.yml@refs/heads/main',
      head_branch: 'main',
      head_sha: 'sha' + id,
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-11-15T09:00:00Z',
      completed_at: '2026-11-15T09:01:00Z',
    });
    const other = { id: 999, path: 'other.yml@refs/heads/main', status: 'completed', conclusion: 'success' };
    const pageOf = (url: string): string | null => new URL(url).searchParams.get('page');
    let window1Seen = false;
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      const page = pageOf(url);
      if (page === '1') {
        window1Seen = true;
        return Response.json({ total_count: 50, workflow_runs: Array.from({ length: 50 }, (_, i) => matching(i + 1)) });
      }
      if (page === '2') return Response.json({ total_count: 3, workflow_runs: [matching(51), other, matching(52)] });
      return Response.json({ total_count: 0, workflow_runs: [] });
    });
    const out = await client(fetch).listWorkflowRuns(REF, 'build.yml', { page: 2, perPage: 20 });
    // page 2 needs windows 1..ceil(40/50)=1; window 1 is full, so one peek follows.
    expect(window1Seen).toBe(true);
    expect(calls.filter((call) => pageOf(call.url) === '2')).toHaveLength(1);
    expect(out.total).toBe(51); // 50 matches + the peek's one more
    expect(out.runs).toHaveLength(20);
    expect(out.runs[0]!.id).toBe('21');
  });

  test('listJobs reuses the github job shape', async () => {
    const { fetch } = await recorded();
    const jobs = await client(fetch).listJobs(REF, '91');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.id).toBe('501');
    expect(jobs[0]!.name).toBe('build');
    expect(jobs[0]!.conclusion).toBe('failure');
    expect(jobs[0]!.steps).toHaveLength(2);
    expect(jobs[0]!.steps[1]!.name).toBe('Run tests');
    expect(jobs[0]!.steps[1]!.conclusion).toBe('failure');
    // The skipped job's zero timestamps (0001-01-01) collapse to null.
    expect(jobs[1]!.conclusion).toBe('skipped');
    expect(jobs[1]!.startedAt).toBeNull();
  });

  test('the log reads the whole body, capped and flagged', async () => {
    const trace = await Bun.file('test/fixtures/gitea/trace.txt').text();
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      if (url.includes('/actions/jobs/501/logs')) return new Response(trace);
      return Response.json({});
    });
    const tail = await client(fetch).getJobLog(REF, '501', { tailBytes: 120 });
    const lastLine = trace.split('\n').filter((line) => line !== '').at(-1)!;
    expect(tail.truncated).toBe(true);
    expect(tail.text).toBe(lastLine + '\n'); // the partial line 4 was dropped, line 5 kept whole

    const tiny = await client(fetch).getJobLog(REF, '501', { tailBytes: 8 });
    expect(tiny.truncated).toBe(true);
    expect(tiny.text).not.toBe(''); // a window inside the last line stays visible

    const full = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(full.truncated).toBe(false);
    expect(full.text).toBe(trace);
  });

  test('a multibyte tail is capped by bytes, not characters', async () => {
    const umlauts = 'ü'.repeat(10); // 10 chars on the wire as 20 UTF-8 bytes
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      if (url.includes('/actions/jobs/501/logs')) return new Response(umlauts);
      return Response.json({});
    });
    const tail = await client(fetch).getJobLog(REF, '501', { tailBytes: 12 });
    expect(tail.truncated).toBe(true);
    expect(tail.text).toBe('ü'.repeat(6));
  });

  test('a 1.24 server refuses reads before any API call', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.24.3' });
      return Response.json({});
    });
    const err = await client(fetch).listRuns(REF).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('unsupported');
    expect(err.message).toContain('1.24.3');
    expect(calls.some((call) => call.url.includes('/actions/runs'))).toBe(false);
  });

  test('re-run refuses on 1.25 and reaches the endpoint on 1.26', async () => {
    const old = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      return Response.json({});
    });
    const refused = await client(old.fetch).rerunAll(REF, '91').catch((e) => e);
    expect(refused).toBeInstanceOf(ProviderError);
    expect(refused.kind).toBe('unsupported');
    expect(refused.message).toContain('1.26');
    expect(old.calls.some((call) => call.url.includes('/rerun'))).toBe(false);

    const neu = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.26.0' });
      return Response.json({});
    });
    await client(neu.fetch).rerunAll(REF, '91');
    const post = neu.calls.find((call) => call.init?.method === 'POST');
    expect(post?.url).toBe('https://gitea.acme.io/api/v1/repos/g/p/actions/runs/91/rerun');
  });

  test('cancel is refused without a request', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const err = await client(fetch).cancel(REF, '91').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  test('workflows list maps file-name ids', async () => {
    const { fetch } = await recorded();
    const workflows = await client(fetch).listWorkflows(REF);
    expect(workflows).toHaveLength(2);
    expect(workflows[0]).toEqual({
      id: 'build.yml',
      name: 'Build',
      path: '.github/workflows/build.yml',
      file: 'build.yml',
    });
    expect(workflows[1]!.name).toBe('.github/workflows/nightly.yml'); // falls back to the path
  });

  test('dispatch reads the workflow file and posts ref plus inputs', async () => {
    const yaml = await Bun.file('test/fixtures/gitea/workflow.yml').text();
    const encoded = btoa(yaml);
    const { fetch, calls } = fakeFetch((url) => {
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      if (url.includes('/contents/')) return Response.json({ content: encoded, encoding: 'base64' });
      return Response.json({});
    });
    const one = client(fetch);
    const workflow = { id: 'build.yml', name: 'Build', path: '.github/workflows/build.yml', file: 'build.yml' };
    const inputs = await one.getDispatchInputs(REF, workflow, 'main');
    expect(inputs.dispatchable).toBe(true);
    expect(inputs.inputs[0]!.name).toBe('verbose');
    expect(inputs.refusal).toBeNull();

    await one.dispatch(REF, workflow.id, 'main', { verbose: 'true' });
    const post = calls.find((call) => call.url.includes('/dispatches'));
    expect(post?.url).toBe('https://gitea.acme.io/api/v1/repos/g/p/actions/workflows/build.yml/dispatches');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ ref: 'main', inputs: { verbose: 'true' } });
  });

  test('a run url parses into a repo key and id', () => {
    const parsed = gitea.parseRunUrl('https://gitea.acme.io/g/p/actions/runs/91');
    expect(parsed).toEqual({ repo: 'gitea:gitea.acme.io/g/p', runId: '91' });
    expect(gitea.parseRunUrl('https://gitea.acme.io/g/p/actions/runs/91/jobs/0')).toBeNull();
  });
});
