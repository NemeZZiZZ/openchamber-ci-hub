import { describe, expect, test } from 'bun:test';
import type { RepoRef } from '../src/domain/repoKey.ts';
import { ProviderError, type FetchLike, type ProviderErrorKind } from '../src/providers/errors.ts';
import { createForgejoClient, forgejo, mapForgejoJob, mapForgejoRun } from '../src/providers/forgejo.ts';

const NOW = 1_789_000_000_000;
const REF: RepoRef = { provider: 'forgejo', host: 'codeberg.org', path: 'g/p' };

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Bun.file(`test/fixtures/forgejo/${name}`).text()) as T;

const fakeFetch = (responder: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
};

const client = (fetch: FetchLike) =>
  createForgejoClient({ fetch, token: 't', host: 'codeberg.org', now: () => NOW });

const authOf = (call: { init?: RequestInit | undefined } | undefined) =>
  (call?.init?.headers as Record<string, string> | undefined)?.['Authorization'];

const recorded = async () => {
  const runs = await fixture<{ workflow_runs: unknown[] }>('runs.json');
  const jobs = await fixture<unknown[]>('jobs.json');
  const job = await fixture<{ steps: unknown[] }>('job.json');
  return { runs, jobs, job };
};

describe('Forgejo transport', () => {
  test('errors map to provider kinds', async () => {
    const cases: [number, ProviderErrorKind][] = [
      [401, 'auth'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'server'],
    ];
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch(() => new Response('{}', { status }));
      const err = await client(fetch).defaultBranch(REF).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
    }
  });

  test('the token goes out as a Forgejo token header', async () => {
    const { runs } = await recorded();
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('/actions/runs?') ? Response.json(runs) : Response.json({}),
    );
    await client(fetch).listRuns(REF);
    expect(authOf(calls[0])).toBe('token t');
  });
});

describe('Forgejo mapping', () => {
  test('runs map the forgejo shape to Run', async () => {
    const runs = (await recorded()).runs.workflow_runs;
    const done = mapForgejoRun(REF, runs[0]);
    expect(done!.id).toBe('71');
    expect(done!.provider).toBe('forgejo');
    expect(done!.workflowId).toBe('build.yml');
    expect(done!.workflow).toBe('Fix the widget');
    expect(done!.number).toBe(12);
    expect(done!.branch).toBe('main');
    expect(done!.status).toBe('completed');
    expect(done!.conclusion).toBe('failure');
    expect(done!.createdAt).toBe(Date.parse('2026-11-15T08:58:00Z'));
    expect(done!.startedAt).toBe(Date.parse('2026-11-15T09:00:00Z'));
    expect(done!.finishedAt).toBe(Date.parse('2026-11-15T09:04:30Z'));
    expect(done!.actor).toBe('ada');
    expect(done!.attempt).toBe(1);

    const running = mapForgejoRun(REF, runs[1]);
    expect(running!.status).toBe('in_progress');
    expect(running!.conclusion).toBeNull();
    expect(running!.branch).toBe('!42');
    expect(running!.workflow).toBe('build.yml'); // falls back to the workflow file
    expect(running!.workflowId).toBe('.gitea/workflows/build.yml');

    const blocked = mapForgejoRun(REF, runs[2]);
    expect(blocked!.status).toBe('queued');
    expect(blocked!.conclusion).toBeNull();
    expect(blocked!.startedAt).toBeNull();
  });

  test('listRuns maps filters to native params and filters the actor client-side', async () => {
    const { runs } = await recorded();
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('/actions/runs?') ? Response.json(runs) : Response.json({}),
    );
    const out = await client(fetch).listRuns(REF, { branch: 'main', actor: 'ada', status: 'in_progress' });
    expect(calls[0]!.url).toBe(
      'https://codeberg.org/api/v1/repos/g/p/actions/runs?page=1&limit=50&ref=refs%2Fheads%2Fmain&status=running',
    );
    expect(out.map((run) => run.actor).every((name) => name === 'ada')).toBe(true);
    expect(out).toHaveLength(2);
  });

  test('listWorkflowRuns matches the workflow file across id spellings', async () => {
    const { runs } = await recorded();
    const { fetch } = fakeFetch((url) =>
      url.includes('/actions/runs?') ? Response.json(runs) : Response.json({}),
    );
    const out = await client(fetch).listWorkflowRuns(REF, 'build.yml', { perPage: 20 });
    expect(out.total).toBe(2); // the bare and the .gitea/workflows/-prefixed spellings both match
    expect(out.runs.map((run) => run.id)).toEqual(['71', '70']);
  });

  test('jobs are a bare array and gain steps from single-job GETs', async () => {
    const { jobs, job } = await recorded();
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/actions/jobs/601')) return Response.json(job);
      if (url.includes('/actions/runs/71/jobs')) return Response.json(jobs);
      return Response.json({});
    });
    const list = await client(fetch).listJobs(REF, '71');
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('build');
    expect(list[0]!.status).toBe('completed');
    expect(list[0]!.conclusion).toBe('failure');
    expect(list[0]!.steps).toHaveLength(2);
    expect(list[0]!.startedAt).toBe(Date.parse('2026-11-15T09:00:05Z'));
    expect(list[0]!.finishedAt).toBe(Date.parse('2026-11-15T09:04:00Z'));
    // The skipped job has no single-job answer; it keeps no steps and no times.
    expect(list[1]!.steps).toHaveLength(0);
    expect(list[1]!.startedAt).toBeNull();
    expect(calls.filter((call) => call.url.includes('/actions/jobs/60'))).toHaveLength(2);
  });

  test('mapForgejoJob derives nothing when steps are missing', () => {
    const jobs = [
      { id: 1, name: 'bare', status: 'running' },
      null,
      'junk',
    ];
    const mapped = jobs.map((raw) => mapForgejoJob('71', raw, []));
    expect(mapped[0]).not.toBeNull();
    expect(mapped[0]!.status).toBe('in_progress');
    expect(mapped[0]!.steps).toHaveLength(0);
    expect(mapped[0]!.startedAt).toBeNull();
    expect(mapped[1]).toBeNull();
    expect(mapped[2]).toBeNull();
  });

  test('the log reads a suffix range', async () => {
    const trace = await Bun.file('test/fixtures/forgejo/trace.txt').text();
    const { fetch } = fakeFetch((url) => {
      if (url.includes('/actions/jobs/601/logs')) {
        return new Response(trace.slice(-120), {
          status: 206,
          headers: { 'content-range': `bytes ${trace.length - 120}-${trace.length - 1}/${trace.length}` },
        });
      }
      return Response.json({});
    });
    const tail = await client(fetch).getJobLog(REF, '601', { tailBytes: 120 });
    expect(tail.truncated).toBe(true);
    expect(tail.text.endsWith('##[error]Process completed with exit code 1.\n')).toBe(true);

    const whole = fakeFetch((url) => {
      if (url.includes('/actions/jobs/601/logs')) return new Response(trace);
      return Response.json({});
    });
    const full = await client(whole.fetch).getJobLog(REF, '601', { full: true });
    expect(full.truncated).toBe(false);
    expect(full.text).toBe(trace);

    const umlauts = 'ü'.repeat(10); // 10 chars on the wire as 20 UTF-8 bytes
    const bytes = fakeFetch((url) => {
      if (url.includes('/actions/jobs/601/logs')) return new Response(umlauts);
      return Response.json({});
    });
    const bytesTail = await client(bytes.fetch).getJobLog(REF, '601', { tailBytes: 12 });
    expect(bytesTail.truncated).toBe(true);
    expect(bytesTail.text).toBe('ü'.repeat(6));
    const range = (whole.calls[0]!.init?.headers as Record<string, string>).Range;
    expect(range).toBeUndefined(); // full reads send no Range
  });

  test('rerun and cancel reach their endpoints', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('', { status: 204 }));
    await client(fetch).rerunAll(REF, '71');
    await client(fetch).cancel(REF, '71');
    const posts = calls.filter((call) => call.init?.method === 'POST');
    expect(posts.map((call) => call.url)).toEqual([
      'https://codeberg.org/api/v1/repos/g/p/actions/runs/71/rerun',
      'https://codeberg.org/api/v1/repos/g/p/actions/runs/71/cancel',
    ]);
  });

  test('re-run failed is refused without a request', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const err = await client(fetch).rerunFailed(REF, '71').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  test('a server without runs endpoints refuses clearly', async () => {
    const { fetch } = fakeFetch(() => new Response('{}', { status: 404 }));
    const err = await client(fetch).listRuns(REF).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('unsupported');
    expect(err.message).toContain('runs API');
  });

  test('workflows come from both contents directories', async () => {
    const { fetch } = fakeFetch((url) => {
      if (url.includes('/contents/.gitea/workflows')) {
        return Response.json([
          { name: 'build.yml', path: '.gitea/workflows/build.yml', type: 'file' },
          { name: 'README.md', path: '.gitea/workflows/README.md', type: 'file' },
        ]);
      }
      if (url.includes('/contents/.github/workflows')) {
        return Response.json([{ name: 'nightly.yml', path: '.github/workflows/nightly.yml', type: 'file' }]);
      }
      return new Response('{}', { status: 404 });
    });
    const workflows = await client(fetch).listWorkflows(REF);
    expect(workflows).toEqual([
      { id: 'build.yml', name: 'build', path: '.gitea/workflows/build.yml', file: 'build.yml' },
      { id: 'nightly.yml', name: 'nightly', path: '.github/workflows/nightly.yml', file: 'nightly.yml' },
    ]);
  });

  test('dispatch posts to the file-name endpoint', async () => {
    const yaml = await Bun.file('test/fixtures/forgejo/workflow.yml').text();
    const encoded = btoa(yaml);
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/contents/')) return Response.json({ content: encoded, encoding: 'base64' });
      return new Response('', { status: 204 });
    });
    const one = client(fetch);
    const inputs = await one.getDispatchInputs(REF, { id: 'build.yml', name: 'build', path: '.gitea/workflows/build.yml', file: 'build.yml' }, 'main');
    expect(inputs.dispatchable).toBe(true);
    expect(inputs.inputs[0]!.name).toBe('verbose');

    await one.dispatch(REF, '.gitea/workflows/build.yml', 'main', { verbose: 'true' });
    const post = calls.find((call) => call.url.includes('/dispatches'));
    expect(post?.url).toBe('https://codeberg.org/api/v1/repos/g/p/actions/workflows/build.yml/dispatches');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ ref: 'main', inputs: { verbose: 'true' } });
  });

  test('getRun falls back to the run index the web URLs carry', async () => {
    const { runs } = await recorded();
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/actions/runs/12')) return new Response('{}', { status: 404 });
      if (url.includes('/actions/runs?')) return Response.json(runs);
      return Response.json({});
    });
    const run = await client(fetch).getRun(REF, '12'); // index_in_repo of run 71
    expect(run.id).toBe('71');
    expect(calls.some((call) => call.url.includes('/actions/runs/12'))).toBe(true); // the direct attempt
    expect(calls.some((call) => call.url.includes('/actions/runs?'))).toBe(true); // the index lookup
  });

  test('a run url parses into a repo key and id', () => {
    expect(forgejo.parseRunUrl('https://codeberg.org/g/p/actions/runs/71')).toEqual({
      repo: 'forgejo:codeberg.org/g/p',
      runId: '71',
    });
    expect(forgejo.parseRunUrl('https://codeberg.org/g/p/actions/runs/71/jobs/0')).toBeNull();
  });
});
