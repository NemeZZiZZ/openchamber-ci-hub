import { describe, expect, test } from 'bun:test';
import type { RepoRef } from '../src/domain/repoKey.ts';
import type { Conclusion, RunStatus } from '../src/domain/types.ts';
import { ProviderError, type FetchLike, type ProviderErrorKind } from '../src/providers/errors.ts';
import { GitLabApi, createGitLabClient, mapJob, mapRun } from '../src/providers/gitlab.ts';

const NOW = 1_789_000_000_000;
const REF: RepoRef = { provider: 'gitlab', host: 'gitlab.gurunetwork.ai', path: 'DEXGURU/e8-markets' };

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Bun.file(`test/fixtures/gitlab/${name}`).text()) as T;

const fakeFetch = (responder: (url: string, init?: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
};

const api = (fetch: FetchLike) =>
  new GitLabApi({ fetch, token: 't', host: 'gitlab.gurunetwork.ai', now: () => NOW });

const auth = (call: { init?: RequestInit | undefined } | undefined) =>
  (call?.init?.headers as Record<string, string> | undefined)?.['Authorization'];

describe('GitLabApi', () => {
  test('errors map to provider kinds', async () => {
    const cases: [number, ProviderErrorKind][] = [
      [401, 'auth'],
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'server'],
    ];
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch(() => new Response('{}', { status }));
      const err = await api(fetch).request('GET', '/projects').catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
    }
  });

  test('a 429 with Retry-After carries the reset', async () => {
    const seconds = fakeFetch(() => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }));
    const err = await api(seconds.fetch).request('GET', '/x').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('rate-limit');
    expect(err.rateLimitReset).toBe(NOW + 30_000);

    const date = new Date(NOW + 45_000).toUTCString();
    const httpDate = fakeFetch(() => new Response('{}', { status: 429, headers: { 'Retry-After': date } }));
    const dated = await api(httpDate.fetch).request('GET', '/x').catch((e) => e);
    expect(dated.rateLimitReset).toBe(NOW + 45_000);

    const none = fakeFetch(() => new Response('{}', { status: 429 }));
    const guessed = await api(none.fetch).request('GET', '/x').catch((e) => e);
    expect(guessed.rateLimitReset).toBe(NOW + 60_000);
  });

  test('list totals come from X-Total', async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json([{ id: 1 }], { headers: { 'x-total': '57' } }),
    );
    const out = await api(fetch).request<unknown[]>('GET', '/projects/a%2Fb/pipelines', {
      per_page: 20,
      ref: 'main',
      sha: undefined,
    });
    expect(out.data).toHaveLength(1);
    expect(out.total).toBe(57);
    expect(calls[0]!.url).toBe('https://gitlab.gurunetwork.ai/api/v4/projects/a%2Fb/pipelines?per_page=20&ref=main');
    expect(auth(calls[0])).toBe('Bearer t');

    const bare = fakeFetch(() => Response.json([]));
    expect((await api(bare.fetch).request<unknown[]>('GET', '/x')).total).toBeNull();
  });

  test('requestRaw passes headers through and exposes the answer', async () => {
    const { fetch, calls } = fakeFetch(() =>
      new Response('trace', { status: 206, headers: { 'Content-Range': 'bytes 0-5/10' } }),
    );
    const out = await api(fetch).requestRaw('GET', '/projects/x/jobs/1/trace', { Range: 'bytes=0-0' });
    expect(out.status).toBe(206);
    expect(out.bodyText).toBe('trace');
    expect(out.header('Content-Range')).toBe('bytes 0-5/10');
    expect(out.header('X-Nothing')).toBeNull();
    expect((calls[0]!.init?.headers as Record<string, string>)['Range']).toBe('bytes=0-0');
  });

  test('a fetch failure is a network error', async () => {
    const { fetch } = fakeFetch(() => {
      throw new Error('boom');
    });
    const err = await api(fetch).request('GET', '/x').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('network');
  });

  test('an empty body is not a parse error', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 201 }));
    const out = await api(fetch).request<unknown>('POST', '/x');
    expect(out.data).toBeUndefined();
  });
});

describe('gitlab mapping', () => {
  test('pipeline statuses map to run states', async () => {
    const old = await fixture<Record<string, unknown>[]>('pipelines-old.json');
    const raw = old[0]!;
    const cases: [string, RunStatus, Conclusion][] = [
      ['created', 'queued', null],
      ['preparing', 'queued', null],
      ['waiting_for_resource', 'queued', null],
      ['pending', 'queued', null],
      ['scheduled', 'queued', null],
      ['running', 'in_progress', null],
      ['manual', 'waiting', null],
      ['success', 'completed', 'success'],
      ['failed', 'completed', 'failure'],
      ['canceled', 'completed', 'cancelled'],
      ['skipped', 'completed', 'skipped'],
    ];
    for (const [gitlab, status, conclusion] of cases) {
      const run = mapRun(REF, { ...raw, status: gitlab });
      expect(run?.status).toBe(status);
      expect(run?.conclusion).toBe(conclusion);
    }
    expect(mapRun(REF, { ...raw, status: 'waiting_for_callback' })?.status).toBe('unknown');
  });

  test('a named pipeline carries its run fields', async () => {
    const [raw] = await fixture<Record<string, unknown>[]>('pipelines.json');
    const run = mapRun(REF, raw);
    expect(run).toMatchObject({
      id: '911',
      number: 42,
      provider: 'gitlab',
      repo: 'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets',
      workflow: 'Nightly build',
      workflowId: 'Nightly build',
      branch: 'main',
      event: 'push',
      actor: '',
      attempt: 1,
      status: 'in_progress',
      title: '',
      url: 'https://gitlab.gurunetwork.ai/DEXGURU/e8-markets/-/pipelines/911',
    });
    expect(run?.commitUrl).toBe('https://gitlab.gurunetwork.ai/DEXGURU/e8-markets/-/commit/abc123');
    expect(run?.startedAt).toBe(Date.parse('2026-11-14T10:00:05Z'));
    expect(run?.finishedAt).toBeNull();
  });

  test('a pre-19.4 list payload maps with blanks', async () => {
    const old = await fixture<Record<string, unknown>[]>('pipelines-old.json');
    for (const raw of old) {
      const run = mapRun(REF, raw);
      expect(run).not.toBeNull();
      expect(run!.workflow).toBe(run!.event);
      expect(run!.title).toBe('');
      expect(run!.startedAt).toBeNull();
    }
    const finished = mapRun(REF, old[2]!)!;
    expect(finished.conclusion).toBe('success');
    // No finished_at in a pre-19.4 list: no end time is fabricated from updated_at.
    expect(finished.finishedAt).toBeNull();
  });

  test('MR refs stay verbatim', async () => {
    const old = await fixture<Record<string, unknown>[]>('pipelines-old.json');
    const run = mapRun(REF, old[1]!)!;
    expect(run.branch).toBe('refs/merge-requests/7/head');
  });

  test('a job carries its stage as its single step', async () => {
    const jobs = await fixture<Record<string, unknown>[]>('jobs.json');
    const build = mapJob('911', jobs[0]!)!;
    expect(build).toMatchObject({
      id: '501',
      runId: '911',
      name: 'compile',
      status: 'completed',
      conclusion: 'success',
      steps: [
        {
          number: 1,
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          startedAt: Date.parse('2026-11-14T10:00:06Z'),
          finishedAt: Date.parse('2026-11-14T10:01:07Z'),
        },
      ],
      url: 'https://gitlab.gurunetwork.ai/DEXGURU/e8-markets/-/jobs/501',
    });
    expect(mapJob('911', jobs[2]!)?.status).toBe('waiting');
    expect(mapJob('911', jobs[2]!)?.steps[0]).toMatchObject({ name: 'deploy', startedAt: null, finishedAt: null });
  });
});

describe('gitlab client', () => {
  const client = (fetch: FetchLike) => createGitLabClient({ fetch, token: 't', host: REF.host, now: () => NOW });

  test('listRuns sends ref, username and a mapped status', async () => {
    const pipelines = await fixture<unknown[]>('pipelines.json');
    const { fetch, calls } = fakeFetch(() => Response.json(pipelines));
    const runs = await client(fetch).listRuns(REF, { branch: 'main', actor: 'octo', status: 'in_progress', perPage: 40, page: 2 });
    expect(runs).toHaveLength(3);
    expect(calls[0]!.url).toBe(
      'https://gitlab.gurunetwork.ai/api/v4/projects/DEXGURU%2Fe8-markets/pipelines?ref=main&username=octo&status=running&per_page=40&page=2',
    );
    const odd = fakeFetch(() => Response.json(pipelines));
    await client(odd.fetch).listRuns(REF, { status: 'attention' });
    expect(odd.calls[0]!.url).not.toContain('status=');
  });

  test('getRun fills the commit title', async () => {
    const pipelines = await fixture<Record<string, unknown>[]>('pipelines.json');
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('/repository/commits/')
        ? Response.json({ title: 'Fix the thing' })
        : Response.json(pipelines[0]),
    );
    const run = await client(fetch).getRun(REF, '911');
    expect(run.title).toBe('Fix the thing');
    expect(calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/911',
      'GET /api/v4/projects/DEXGURU%2Fe8-markets/repository/commits/abc123',
    ]);

    const missing = fakeFetch((url) =>
      url.includes('/repository/commits/') ? new Response('{}', { status: 404 }) : Response.json(pipelines[0]),
    );
    const bare = await client(missing.fetch).getRun(REF, '911');
    expect(bare.title).toBe('');
  });

  test('listJobs keeps API order and marks allowed failures', async () => {
    const jobs = await fixture<unknown[]>('jobs.json');
    const { fetch, calls } = fakeFetch(() => Response.json(jobs));
    const out = await client(fetch).listJobs(REF, '911');
    expect(calls[0]!.url).toContain('/pipelines/911/jobs?per_page=100&include_retried=false');
    expect(out.map((job) => job.name)).toEqual(['compile', 'lint (allowed to fail)', 'deploy']);
    expect(out[1]).toMatchObject({ conclusion: 'failure', status: 'completed' });
  });

  test('listWorkflowRuns filters groups and pages across windows', async () => {
    const pipelines = await fixture<Record<string, unknown>[]>('pipelines.json');
    const mixed = [
      ...pipelines,
      { ...pipelines[0]!, id: 908, name: 'push', source: 'push' },
      { ...pipelines[0]!, id: 907, name: 'push', source: 'push' },
    ];
    const { fetch, calls } = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return Response.json(page === 1 ? mixed : [{ ...pipelines[0]!, id: 906 }]);
    });
    const first = await client(fetch).listWorkflowRuns(REF, 'Nightly build', { page: 1, perPage: 2 });
    expect(first.runs.map((run) => run.id)).toEqual(['911', '909']);
    expect(first.total).toBe(2);

    await client(fetch).listWorkflowRuns(REF, 'Nightly build', { page: 6, perPage: 20 });
    await client(fetch).listWorkflowRuns(REF, 'Nightly build', { page: 30, perPage: 20 });
    const pages = calls.map((c) => new URL(c.url).searchParams.get('page'));
    expect(pages).toEqual(['1', '1', '2', '1', '2', '3', '4', '5']);
    expect(calls.every((c) => new URL(c.url).searchParams.get('per_page') === '100')).toBe(true);
  });

  test('a body that is not JSON becomes a provider error, not a crash', async () => {
    // A proxy or a captive portal can answer 200 with HTML; JSON.parse would
    // otherwise throw a SyntaxError the service reports as a bare failure.
    const html = fakeFetch(() => new Response('<!doctype html><title>Gateway</title>', { status: 200 }));
    await expect(api(html.fetch).request('GET', '/projects/x')).rejects.toThrow(/not JSON/i);
  });

  test('a full last window probes the next page instead of ending history early', async () => {
    // 250 pipelines of one workflow: the fifth 20-run page walks exactly one
    // underlying page of 100. Reporting total = 100 there would tell the panel
    // there is nothing more, so the tail of the history would never load.
    const base = (await fixture<Record<string, unknown>[]>('pipelines.json'))[0]!;
    const all = Array.from({ length: 250 }, (_, i) => ({ ...base, id: 1_000 + i, name: 'Deploy' }));
    const { fetch } = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return Response.json(all.slice((page - 1) * 100, page * 100));
    });
    const fifth = await client(fetch).listWorkflowRuns(REF, 'Deploy', { page: 5, perPage: 20 });
    expect(fifth.runs).toHaveLength(20);
    expect(fifth.total).toBeGreaterThan(100);

    const last = await client(fetch).listWorkflowRuns(REF, 'Deploy', { page: 13, perPage: 20 });
    expect(last.runs).toHaveLength(10);
    expect(last.total).toBe(250);
  });

  test('rerunAll starts a new pipeline on the ref', async () => {
    const pipelines = await fixture<Record<string, unknown>[]>('pipelines.json');
    const seq: { method: string; path: string; body?: string }[] = [];
    const recording: FetchLike = async (url, init) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      seq.push({ method, path, body: typeof init?.body === 'string' ? init.body : undefined });
      return path.endsWith('/pipelines/911') ? Response.json(pipelines[0]) : new Response(null, { status: 201 });
    };
    await client(recording).rerunAll(REF, '911');
    expect(seq.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/911',
      'POST /api/v4/projects/DEXGURU%2Fe8-markets/pipeline',
    ]);
    expect(JSON.parse(seq[1]!.body!)).toEqual({ ref: 'main' });
  });

  test('rerunAll refuses a pipeline without a ref instead of posting an empty one', async () => {
    // A merge-request or detached pipeline has no ref; GitLab would answer 400
    // with nothing a person could act on, so the client says why itself.
    const seq: { method: string; path: string }[] = [];
    const recording: FetchLike = async (url, init) => {
      seq.push({ method: init?.method ?? 'GET', path: new URL(url).pathname });
      return Response.json({ id: 911, status: 'failed', ref: null, sha: 'abc' });
    };
    await expect(client(recording).rerunAll(REF, '911')).rejects.toThrow(/merge request|ref/i);
    expect(seq.map((c) => c.method)).toEqual(['GET']);
  });

  test('the trace tail reads two ranges', async () => {
    const trace = await Bun.file('test/fixtures/gitlab/trace.txt').text();
    const total = Buffer.byteLength(trace);
    const { fetch, calls } = fakeFetch((url, init) => {
      const range = (init?.headers as Record<string, string>)['Range'] ?? '';
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), total - 1);
        return new Response(trace.slice(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
        });
      }
      return new Response(trace, { status: 200 });
    });
    const log = await client(fetch).getJobLog(REF, '502', { tailBytes: 8 });
    expect(log.text).toBe(trace.slice(-8));
    expect(log.truncated).toBe(true);
    expect((calls[0]!.init?.headers as Record<string, string>)['Range']).toBe('bytes=0-0');
    expect((calls[1]!.init?.headers as Record<string, string>)['Range']).toBe(`bytes=${total - 8}-${total - 1}`);

    const whole = await client(fetch).getJobLog(REF, '502', { tailBytes: 10_000 });
    expect(whole.text).toBe(trace);
    expect(whole.truncated).toBe(false);
  });

  test('a tail window drops its partial first line', async () => {
    const trace = 'first line\nsecond line\nthird line';
    const total = Buffer.byteLength(trace);
    const { fetch } = fakeFetch((url, init) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec((init?.headers as Record<string, string>)['Range'] ?? '');
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), total - 1);
        return new Response(trace.slice(start, end + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
        });
      }
      return new Response('0', { status: 200, headers: { 'Content-Range': `bytes 0-0/${total}` } });
    });
    const log = await client(fetch).getJobLog(REF, '502', { tailBytes: 20 });
    expect(log.text).toBe('third line');
    expect(log.truncated).toBe(true);
  });

  test('a range-less tail also drops its partial first line', async () => {
    const body = `header ${'x'.repeat(200)}\nlast line`;
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
    const log = await client(fetch).getJobLog(REF, '502', { tailBytes: 20 });
    expect(log.text).toBe('last line');
    expect(log.truncated).toBe(true);
  });

  test('a range-less trace still loads, capped and flagged', async () => {
    const body = 'x'.repeat(150_000);
    const { fetch, calls } = fakeFetch(() => new Response(body, { status: 200 }));
    const log = await client(fetch).getJobLog(REF, '502');
    expect(log.truncated).toBe(true);
    expect(log.text).toBe(body.slice(-131_072));
    expect(calls[0]!.url).toContain('/jobs/502/trace');

    const small = fakeFetch(() => new Response('tiny', { status: 200 }));
    const short = await client(small.fetch).getJobLog(REF, '502');
    expect(short.text).toBe('tiny');
    expect(short.truncated).toBe(false);
  });

  test('a range-less full trace stops at the cap too', async () => {
    const body = 'z'.repeat(2_000_000);
    const { fetch, calls } = fakeFetch(() => new Response(body, { status: 200 }));
    const log = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(log.text).toBe(body.slice(0, 1_048_576));
    expect(log.truncated).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('the full trace stops at the cap with truncated set', async () => {
    const big = 'y'.repeat(2_000_000);
    const { fetch, calls } = fakeFetch((_url, init) => {
      const range = (init?.headers as Record<string, string>)['Range'] ?? '';
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) return new Response(big, { status: 200 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), big.length - 1);
      if (start > end) return new Response(null, { status: 416 });
      return new Response(big.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${big.length}` },
      });
    });
    const log = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(log.text.length).toBe(1_048_576);
    expect(log.truncated).toBe(true);
    expect(calls).toHaveLength(16);
  });

  test('a range past the end ends the walk', async () => {
    const { fetch, calls } = fakeFetch((_url, init) => {
      const range = (init?.headers as Record<string, string>)['Range'] ?? '';
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) return new Response('tiny', { status: 200 });
      const start = Number(match[1]);
      if (start >= 10) return new Response(null, { status: 416 });
      return new Response('0123456789'.slice(start), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-9/10` },
      });
    });
    const log = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(log.text).toBe('0123456789');
    expect(log.truncated).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test('a missing trace is a not-found error', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 404 }));
    const err = await client(fetch).getJobLog(REF, '502').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('not-found');
  });

  test('workflows, dispatch and the default branch', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith('/projects/DEXGURU%2Fe8-markets') ? Response.json({ default_branch: 'master' }) : new Response(null, { status: 201 }),
    );
    const it = client(fetch);
    expect(await it.listWorkflows(REF)).toEqual([
      { id: 'pipelines', name: 'Pipelines', path: '.gitlab-ci.yml', file: '.gitlab-ci.yml' },
    ]);
    expect(await it.getDispatchInputs(REF, { id: 'pipelines', name: 'Pipelines', path: '.gitlab-ci.yml', file: '.gitlab-ci.yml' }, 'main')).toEqual({
      dispatchable: true,
      inputs: [],
      refusal: null,
    });
    await it.dispatch(REF, 'pipelines', 'main', {});
    await it.rerunFailed(REF, '911');
    await it.cancel(REF, '911');
    expect(await it.defaultBranch(REF)).toBe('master');
    expect(calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`).slice(-4)).toEqual([
      'POST /api/v4/projects/DEXGURU%2Fe8-markets/pipeline',
      'POST /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/911/retry',
      'POST /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/911/cancel',
      'GET /api/v4/projects/DEXGURU%2Fe8-markets',
    ]);
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/pipeline'))!.init?.body))).toEqual({ ref: 'main' });
  });
});


describe('gitlab trace with multibyte text', () => {
  const client = (fetch: FetchLike) => createGitLabClient({ fetch, token: 't', host: REF.host, now: () => NOW });
  // A byte-range fake: it serves exactly the bytes asked for, like the API.
  const rangeFetch = (text: string) => {
    const bytes = Buffer.from(text, 'utf8');
    return fakeFetch((_url, init) => {
      const range = (init?.headers as Record<string, string>)['Range'] ?? '';
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) return new Response(text, { status: 200 });
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      if (start > end) return new Response('', { status: 416 });
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      });
    });
  };

  test('the full walk advances by bytes, so nothing repeats', async () => {
    const line = 'строка лога с кириллицей и ✅ эмодзи 2026\n';
    const trace = line.repeat(3_000); // ~150 KB of UTF-8 across several windows
    const { fetch, calls } = rangeFetch(trace);
    const log = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(log.text).toBe(trace);
    expect(log.truncated).toBe(false);
    // Chars are half the bytes here; a char-counting walk would re-read slices.
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(Buffer.byteLength(trace) / 65_536) + 1);
  });

  test('a range-less tail caps by bytes, not chars', async () => {
    const body = 'ж'.repeat(150_000); // 300 KB of UTF-8
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
    const log = await client(fetch).getJobLog(REF, '502');
    expect(log.truncated).toBe(true);
    expect(Buffer.byteLength(log.text)).toBe(131_072);
    expect(log.text).toBe(body.slice(-65_536));
  });

  test('a range-less full trace caps by bytes too', async () => {
    const body = 'ж'.repeat(600_000); // 1.2 MB of UTF-8
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
    const log = await client(fetch).getJobLog(REF, '501', { full: true });
    expect(log.truncated).toBe(true);
    expect(Buffer.byteLength(log.text)).toBe(1_048_576);
    expect(log.text).toBe(body.slice(0, 524_288));
  });
});
