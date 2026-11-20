import { describe, expect, test } from 'bun:test';
import type { GuestSessionEventRequest, ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createEngine } from '../src/service/engine.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';
import { handleRequest } from '../src/service/routes.ts';

const KEY = 'github:github.com/acme/app';

const rawRun = (conclusion: string | null, attempt = 1) => ({
  id: 100,
  run_number: 7,
  name: 'CI',
  workflow_id: 3,
  head_branch: 'main',
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
  const engine = createEngine({
    config: createMemoryConfigStore(),
    prefs: createMemoryPrefsStore(),
    audit: async () => undefined,
    auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
    fetch: async (url) => {
      requests.push(new URL(url).pathname);
      return url.includes('/actions/runs')
        ? Response.json({ workflow_runs: [rawRun(conclusion)] })
        : Response.json({ default_branch: 'main' });
    },
    git: async (args) => {
      if (!withRemote) return { code: 1, stdout: '', stderr: '' };
      if (args[0] === 'remote') return { code: 0, stdout: 'git@github.com:acme/app.git\n', stderr: '' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'main\n', stderr: '' };
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
  return { engine, events, marks, requests, turnCi };
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
