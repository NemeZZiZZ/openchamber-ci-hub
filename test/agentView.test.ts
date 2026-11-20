import { describe, expect, test } from 'bun:test';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';
import { createEngine } from '../src/service/engine.ts';
import { handleRequest } from '../src/service/routes.ts';
import { agentJobsView, agentRunsView, AGENT_LOG_MAX, AGENT_RUNS_MAX } from '../src/service/agentView.ts';
import type { Job, Run } from '../src/domain/types.ts';

const KEY = 'github:github.com/acme/app';

const run = (over: Partial<Run> = {}): Run => ({
  id: '100',
  provider: 'github',
  repo: KEY,
  number: 7,
  workflow: 'CI',
  workflowId: '3',
  branch: 'main',
  sha: 'abc',
  title: 'Commit',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  createdAt: 1,
  startedAt: 1000,
  finishedAt: 61_000,
  actor: 'octo',
  url: 'https://example.invalid/run/100',
  commitUrl: null,
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: '55',
  runId: '100',
  name: 'test',
  status: 'completed',
  conclusion: 'failure',
  startedAt: 1000,
  finishedAt: 2000,
  steps: [
    { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', startedAt: null, finishedAt: null },
    { number: 2, name: 'Run tests', status: 'completed', conclusion: 'failure', startedAt: null, finishedAt: null },
  ],
  url: 'https://example.invalid/job/55',
  ...over,
});

describe('agentRunsView', () => {
  const runs = Array.from({ length: 30 }, (_, i) => run({ id: String(i), number: i, createdAt: i }));

  test('defaults to ten and never exceeds the cap', () => {
    expect(agentRunsView(runs).items).toHaveLength(10);
    expect(agentRunsView(runs, 100).items).toHaveLength(AGENT_RUNS_MAX);
    expect(AGENT_RUNS_MAX).toBe(20);
    expect(agentRunsView(runs, 3).items).toHaveLength(3);
  });

  test('answers the newest runs first with compact fields', () => {
    const view = agentRunsView(runs, 1).items[0]!;
    expect(view.id).toBe('29');
    expect(view).toEqual({
      repo: KEY,
      id: '29',
      number: 29,
      workflow: 'CI',
      branch: 'main',
      sha: 'abc',
      status: 'completed',
      conclusion: 'failure',
      attempt: 1,
      url: 'https://example.invalid/run/100',
      durationMs: 60_000,
      finishedAt: 61_000,
    });
  });
});

describe('agentJobsView', () => {
  test('keeps only the failing step name', () => {
    const view = agentJobsView([job()]);
    expect(view).toEqual([{ id: '55', name: 'test', status: 'completed', conclusion: 'failure', failingStep: 'Run tests' }]);
    expect(agentJobsView([job({ conclusion: 'success', steps: [] })])[0]!.failingStep).toBeNull();
  });
});

describe('agent routes', () => {
  const engineWith = (logText: string) =>
    createEngine({
      config: createMemoryConfigStore({ version: 2, repos: [{ key: KEY, enabled: true, addedAt: 0 }], directoryMap: {} }),
      prefs: createMemoryPrefsStore(),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/actions/jobs/55/logs')) return new Response(logText);
        if (/\/actions\/runs\/\d+\/jobs$/.test(path))
          return Response.json({
            jobs: [
              {
                id: 55,
                name: 'test',
                status: 'completed',
                conclusion: 'failure',
                started_at: '2026-11-14T10:00:00Z',
                completed_at: '2026-11-14T10:01:00Z',
                html_url: 'https://example.invalid/job/55',
                steps: [{ number: 2, name: 'Run tests', status: 'completed', conclusion: 'failure' }],
              },
            ],
          });
        if (/\/actions\/runs\/\d+$/.test(path))
          return Response.json({
            id: 100,
            run_number: 7,
            name: 'CI',
            workflow_id: 3,
            head_branch: 'main',
            head_sha: 'abc',
            display_title: 'Commit',
            event: 'push',
            run_attempt: 1,
            status: 'completed',
            conclusion: 'failure',
            created_at: '2026-11-14T10:00:00Z',
            updated_at: '2026-11-14T10:01:00Z',
            actor: { login: 'octo' },
            html_url: 'https://example.invalid/run/100',
          });
        if (path.endsWith('/actions/runs'))
          return Response.json({
            workflow_runs: [
              {
                id: 100,
                run_number: 7,
                name: 'CI',
                workflow_id: 3,
                head_branch: 'main',
                head_sha: 'abc',
                display_title: 'Commit',
                event: 'push',
                run_attempt: 1,
                status: 'completed',
                conclusion: 'failure',
                created_at: '2026-11-14T10:00:00Z',
                updated_at: '2026-11-14T10:01:00Z',
                actor: { login: 'octo' },
                html_url: 'https://example.invalid/run/100',
              },
            ],
          });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      timers: { set: () => 0, clear: () => undefined },
    });

  const get = (url: string, log = 'x') => handleRequest({ method: 'GET', url, body: '' }, engineWith(log));

  test('/agent/runs without a resolvable repo is a readable 400', async () => {
    const res = await get('/agent/runs?directory=%2Fnope');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: expect.stringContaining('repository') });
    const bare = await get('/agent/runs');
    expect(bare.status).toBe(400);
  });

  test('/agent/runs answers compact items', async () => {
    const res = await get(`/agent/runs?repo=${encodeURIComponent(KEY)}`);
    expect(res.status).toBe(200);
    const body = res.body as { items: { id: string; repo: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: '100', repo: KEY, number: 7 });
  });

  test('/agent/run adds the jobs view', async () => {
    const res = await get(`/agent/run?repo=${encodeURIComponent(KEY)}&id=100`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: '100', jobs: [{ id: '55', failingStep: 'Run tests' }] });
  });

  test('/agent/log caps a huge log and picks the failed job', async () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `2026-11-14T10:00:00Z line ${i} ${'x'.repeat(40)}`).join('\n');
    const res = await get(`/agent/log?repo=${encodeURIComponent(KEY)}&id=100`, huge);
    expect(res.status).toBe(200);
    const body = res.body as { job: { id: string; name: string }; excerpt: string; truncated: boolean };
    expect(body.job).toMatchObject({ id: '55', name: 'test' });
    expect(body.excerpt.length).toBeLessThanOrEqual(AGENT_LOG_MAX);
    expect(AGENT_LOG_MAX).toBe(12_000);
  });

  test('/agent/log for a run with no jobs is a 404', async () => {
    const res = await handleRequest(
      { method: 'GET', url: `/agent/log?repo=${encodeURIComponent(KEY)}&id=100`, body: '' },
      createEngine({
        config: createMemoryConfigStore({ version: 2, repos: [{ key: KEY, enabled: true, addedAt: 0 }], directoryMap: {} }),
        prefs: createMemoryPrefsStore(),
        audit: async () => undefined,
        auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
        fetch: async (url) => {
          const path = new URL(url).pathname;
          if (/\/actions\/runs\/\d+\/jobs$/.test(path)) return Response.json({ jobs: [] });
          return Response.json({ id: 100 });
        },
        git: async () => ({ code: 1, stdout: '', stderr: '' }),
        emit: () => undefined,
        needsConfiguration: () => undefined,
        timers: { set: () => 0, clear: () => undefined },
      }),
    );
    expect(res.status).toBe(404);
  });
});
