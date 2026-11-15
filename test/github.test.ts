import { describe, expect, test } from 'bun:test';
import type { RepoRef } from '../src/domain/repoKey.ts';
import { ProviderError } from '../src/providers/errors.ts';
import { createGitHubClient, hasDispatchTrigger, mapRun, parseDispatchInputs } from '../src/providers/github.ts';

const REF: RepoRef = { provider: 'github', host: 'github.com', path: 'acme/app' };

type Call = { url: string; init: RequestInit | undefined };

const fakeFetch = (responder: (url: string, init?: RequestInit) => Response) => {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
};

const header = (call: Call | undefined, name: string) => (call?.init?.headers as Record<string, string> | undefined)?.[name];

const rawRun = {
  id: 100,
  run_number: 7,
  name: 'CI',
  workflow_id: 3,
  head_branch: 'main',
  head_sha: 'abc',
  display_title: 'Commit',
  event: 'push',
  run_attempt: 1,
  status: 'in_progress',
  conclusion: null,
  created_at: '2026-11-14T10:00:00Z',
  run_started_at: '2026-11-14T10:00:05Z',
  updated_at: '2026-11-14T10:01:00Z',
  actor: { login: 'octo' },
  html_url: 'https://github.com/acme/app/actions/runs/100',
};

describe('mapRun', () => {
  test('a running run has no finish time', () => {
    const run = mapRun(REF, rawRun);
    expect(run).toMatchObject({ id: '100', number: 7, status: 'in_progress', finishedAt: null, actor: 'octo' });
    expect(run?.repo).toBe('github:github.com/acme/app');
    expect(run?.commitUrl).toBe('https://github.com/acme/app/commit/abc');
  });
  test('a completed run finishes at updated_at', () => {
    const run = mapRun(REF, { ...rawRun, status: 'completed', conclusion: 'failure' });
    expect(run?.finishedAt).toBe(Date.parse('2026-11-14T10:01:00Z'));
  });
});

describe('client', () => {
  test('lists runs with the API version header and query', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ workflow_runs: [rawRun] }));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    const runs = await client.listRuns(REF, { branch: 'main', status: 'failure' });
    expect(runs).toHaveLength(1);
    expect(calls[0]!.url).toContain('/repos/acme/app/actions/runs?');
    expect(calls[0]!.url).toContain('branch=main');
    expect(header(calls[0], 'X-GitHub-Api-Version')).toBe('2022-11-28');
    expect(header(calls[0], 'Authorization')).toBe('Bearer t');
  });

  test('a 304 reuses the cached body', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() =>
      n++ === 0
        ? Response.json({ workflow_runs: [rawRun] }, { headers: { etag: 'W/"1"' } })
        : new Response(null, { status: 304 }),
    );
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    await client.listRuns(REF);
    const again = await client.listRuns(REF);
    expect(again).toHaveLength(1);
    expect(header(calls[1], 'If-None-Match')).toBe('W/"1"');
  });

  test('rate limit carries the reset time', async () => {
    const { fetch } = fakeFetch(
      () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' } }),
    );
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    const err = await client.listRuns(REF).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('rate-limit');
    expect(err.rateLimitReset).toBe(2_000_000_000_000);
  });

  test('Retry-After wins over the reset header', async () => {
    const { fetch } = fakeFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com', now: () => 1000 });
    const err = await client.listRuns(REF).catch((e) => e);
    expect(err.rateLimitReset).toBe(31_000);
  });

  test('401 is an auth error', async () => {
    const { fetch } = fakeFetch(() => new Response('{}', { status: 401 }));
    const err = await createGitHubClient({ fetch, token: 't', host: 'github.com' }).listRuns(REF).catch((e) => e);
    expect(err.kind).toBe('auth');
  });

  test('log is fetched as a tail window', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('partial first\nline 2\nline 3\n', { status: 206 }));
    const log = await createGitHubClient({ fetch, token: 't', host: 'github.com' }).getJobLog(REF, '9');
    expect(header(calls[0], 'Range')).toMatch(/^bytes=-\d+$/);
    expect(log.truncated).toBe(true);
    expect(log.text.startsWith('partial first')).toBe(false);
  });

  test('an empty answer is not a parse error', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    expect(await client.listRuns(REF)).toEqual([]);
    const notModified = fakeFetch(() => new Response(null, { status: 304 }));
    expect(await createGitHubClient({ fetch: notModified.fetch, token: 't', host: 'github.com' }).listJobs(REF, '1')).toEqual([]);
  });

  test('a body that is not JSON becomes a provider error, not a crash', async () => {
    const { fetch } = fakeFetch(() => new Response('<!doctype html><title>Gateway</title>', { status: 200 }));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    await expect(client.listRuns(REF)).rejects.toThrow(/not JSON/i);
  });

  test('an enterprise host is asked at its own API origin', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ workflow_runs: [] }));
    await createGitHubClient({ fetch, token: 't', host: 'ghe.acme.io' }).listRuns({ ...REF, host: 'ghe.acme.io' });
    expect(calls[0]!.url.startsWith('https://ghe.acme.io/api/v3/repos/acme/app/actions/runs?')).toBe(true);
  });

  test('workflows carry the file name without the folder', async () => {
    const { fetch } = fakeFetch(() => Response.json({ workflows: [{ id: 3, name: 'CI', path: '.github/workflows/ci.yml' }] }));
    const [workflow] = await createGitHubClient({ fetch, token: 't', host: 'github.com' }).listWorkflows(REF);
    expect(workflow).toEqual({ id: '3', name: 'CI', path: '.github/workflows/ci.yml', file: 'ci.yml' });
  });

  test('a workflow without the trigger says why', async () => {
    const { fetch } = fakeFetch(() => new Response('on: push\n'));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    const result = await client.getDispatchInputs(REF, { id: '3', name: 'CI', path: '.github/workflows/ci.yml', file: 'ci.yml' }, 'main');
    expect(result).toEqual({
      dispatchable: false,
      inputs: [],
      refusal: 'This workflow has no workflow_dispatch trigger on main, so GitHub will refuse to start it.',
    });
  });

  test('writes go to the documented endpoints', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    const client = createGitHubClient({ fetch, token: 't', host: 'github.com' });
    await client.rerunAll(REF, '100');
    await client.rerunFailed(REF, '100');
    await client.cancel(REF, '100');
    await client.dispatch(REF, '3', 'main', { target: 'staging' });
    expect(calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /repos/acme/app/actions/runs/100/rerun',
      'POST /repos/acme/app/actions/runs/100/rerun-failed-jobs',
      'POST /repos/acme/app/actions/runs/100/cancel',
      'POST /repos/acme/app/actions/workflows/3/dispatches',
    ]);
    expect(JSON.parse(String(calls[3]!.init?.body))).toEqual({ ref: 'main', inputs: { target: 'staging' } });
  });
});

describe('workflow_dispatch inputs', () => {
  const yaml = `
name: Deploy
on:
  push:
  workflow_dispatch:
    inputs:
      target:
        description: "Where to deploy"
        required: true
        default: staging
        type: choice
        options:
          - staging
          - production
      dry-run:
        type: boolean
        default: false
jobs:
  deploy:
    runs-on: ubuntu-latest
`;
  test('reads names, types and options', () => {
    expect(hasDispatchTrigger(yaml)).toBe(true);
    const inputs = parseDispatchInputs(yaml);
    expect(inputs.map((i) => i.name)).toEqual(['target', 'dry-run']);
    expect(inputs[0]).toMatchObject({ required: true, default: 'staging', type: 'choice', options: ['staging', 'production'] });
    expect(inputs[1]).toMatchObject({ type: 'boolean', default: 'false' });
  });
  test('inline trigger list counts, no inputs', () => {
    expect(hasDispatchTrigger('on: [push, workflow_dispatch]\n')).toBe(true);
    expect(parseDispatchInputs('on: [push, workflow_dispatch]\n')).toEqual([]);
    expect(hasDispatchTrigger('on: push\n# workflow_dispatch\n')).toBe(false);
  });
});
