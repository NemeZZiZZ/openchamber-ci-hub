import { describe, expect, test } from 'bun:test';
import type { GuestSessionEventRequest, ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createEngine } from '../src/service/engine.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';
import { handleRequest } from '../src/service/routes.ts';

const KEY = 'github:github.com/acme/app';

const rawRun = (conclusion: string | null, attempt = 1, branch = 'main', id = 100) => ({
  id,
  run_number: 7,
  name: 'CI',
  workflow_id: 3,
  head_branch: branch,
  head_sha: 'abc',
  display_title: 'Commit',
  event: 'push',
  run_attempt: attempt,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:01:00Z',
  actor: { login: 'octo' },
  html_url: 'https://github.com/acme/app/actions/runs/100',
});

const turnFinished = (directory: string | null): GuestSessionEventRequest => ({
  v: 1,
  requestId: 'r1',
  event: {
    id: 'e1',
    type: 'turn-finished',
    at: 1_700_000_000_000,
    session: { id: 's1', parentId: null },
    project: { directory },
    linked: [],
  },
});

const setup = (conclusion: string | null = 'failure', withRemote = true) => {
  const events: { topic: string; data?: unknown }[] = [];
  const marks: { target: ServiceMarkTarget; mark: ServiceMark | null }[] = [];
  const requests: string[] = [];
  const control = { failRuns: false, attempt: 1, branch: 'main', extra: [] as ReturnType<typeof rawRun>[] };
  const engine = createEngine({
    config: createMemoryConfigStore(),
    prefs: createMemoryPrefsStore(),
    audit: async () => undefined,
    auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
    fetch: async (url) => {
      requests.push(new URL(url).pathname);
      if (url.includes('/actions/runs')) {
        if (control.failRuns) return new Response('{}', { status: 500 });
        return Response.json({ workflow_runs: [rawRun(conclusion, control.attempt), ...control.extra] });
      }
      return Response.json({ default_branch: 'main' });
    },
    git: async (args) => {
      if (!withRemote) return { code: 1, stdout: '', stderr: '' };
      if (args[0] === 'remote') return { code: 0, stdout: 'git@github.com:acme/app.git\n', stderr: '' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: `${control.branch}\n`, stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    },
    emit: (topic, data) => {
      events.push({ topic, data });
    },
    needsConfiguration: () => undefined,
    setMark: async (target, mark) => {
      marks.push({ target, mark });
    },
    timers: { set: () => 0, clear: () => undefined },
  });
  const turnCi = () => events.filter((event) => event.topic === 'turn-ci');
  return { engine, events, marks, requests, turnCi, control };
};

describe('session events', () => {
  test('turn-finished with a failing run emits turn-ci once per run attempt', async () => {
    const { engine, turnCi } = setup();
    expect(await engine.sessionEvent(turnFinished('/p/app'))).toEqual({ ok: true });
    expect(turnCi()).toHaveLength(1);
    expect(turnCi()[0]!.data).toMatchObject({
      directory: '/p/app',
      repo: KEY,
      branch: 'main',
      runId: '100',
      number: 7,
      workflow: 'CI',
      conclusion: 'failure',
      attempt: 1,
    });
  });

  test('a second event for the same run attempt does not emit again', async () => {
    const { engine, turnCi } = setup();
    await engine.sessionEvent(turnFinished('/p/app'));
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(turnCi()).toHaveLength(1);
  });

  test('turn-failed is handled like turn-finished', async () => {
    const { engine, turnCi } = setup();
    const request = turnFinished('/p/app');
    const failed = {
      ...request,
      event: { ...request.event, type: 'turn-failed' as const },
    };
    expect(await engine.sessionEvent(failed)).toEqual({ ok: true });
    expect(turnCi()).toHaveLength(1);
  });

  test('an unwatched directory answers ok without polling or emitting', async () => {
    const { engine, requests, turnCi } = setup('failure', false);
    expect(await engine.sessionEvent(turnFinished('/elsewhere'))).toEqual({ ok: true });
    expect(await engine.sessionEvent(turnFinished(null))).toEqual({ ok: true });
    expect(requests).toHaveLength(0);
    expect(turnCi()).toHaveLength(0);
  });

  test('a green run emits nothing', async () => {
    const { engine, turnCi } = setup('success');
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(turnCi()).toHaveLength(0);
  });

  test('a failed refresh never toasts a stale failure', async () => {
    const { engine, turnCi, control } = setup();
    await engine.agentRuns({ repo: KEY }); // seed the cache without a turn event
    control.failRuns = true;
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(turnCi()).toHaveLength(0);
  });

  test('agentRuns surfaces a provider error instead of a stale or empty list', async () => {
    const { engine, control } = setup();
    control.failRuns = true;
    await expect(engine.agentRuns({ repo: KEY })).rejects.toThrow();
  });

  test('toastOnTurnFailure:false emits nothing but still refreshes marks', async () => {
    const { engine, turnCi, marks } = setup();
    await engine.setPrefs({ toastOnTurnFailure: false });
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(turnCi()).toHaveLength(0);
    expect(marks.some((entry) => entry.mark?.tone === 'error')).toBe(true);
  });

  test('other event types are ignored', async () => {
    const { engine, requests, turnCi } = setup();
    const request = turnFinished('/p/app');
    const other = {
      ...request,
      event: { ...request.event, type: 'session-created' },
    } as GuestSessionEventRequest;
    expect(await engine.sessionEvent(other)).toEqual({ ok: true });
    expect(requests).toHaveLength(0);
    expect(turnCi()).toHaveLength(0);
  });

  test('a branch switched during the turn is seen by the next event', async () => {
    const { engine, marks, control } = setup();
    control.extra = [rawRun('success', 1, 'feature', 200)];
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(marks.at(-1)!.mark?.tone).toBe('error');
    control.branch = 'feature';
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(marks.at(-1)).toMatchObject({ target: { directory: '/p/app', branch: 'main' }, mark: null });
  });

  test('the directories and turns it remembers are bounded', async () => {
    const { engine, turnCi, control } = setup();
    for (let i = 0; i < 300; i++) await engine.sessionEvent(turnFinished(`/p/app${i}`));
    expect(engine.extraDirs.size).toBeLessThanOrEqual(256);
    for (let attempt = 1; attempt <= 300; attempt++) {
      control.attempt = attempt;
      await engine.sessionEvent(turnFinished('/p/app'));
    }
    const before = turnCi().length;
    control.attempt = 1; // forgotten by now, so it is announced again
    await engine.sessionEvent(turnFinished('/p/app'));
    expect(turnCi().length).toBe(before + 1);
  });

  test('POST /session-events with junk answers 400', async () => {
    const { engine } = setup();
    const bad = await handleRequest({ method: 'POST', url: '/session-events', body: '{"v":1}' }, engine);
    expect(bad.status).toBe(400);
    const good = await handleRequest(
      { method: 'POST', url: '/session-events', body: JSON.stringify(turnFinished(null)) },
      engine,
    );
    expect(good.status).toBe(200);
  });
});
