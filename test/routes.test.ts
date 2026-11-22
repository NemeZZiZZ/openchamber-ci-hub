import { describe, expect, test } from 'bun:test';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createEngine } from '../src/service/engine.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';
import { handleRequest } from '../src/service/routes.ts';
import { blockRunQuery, readBlockArgs } from '../src/ui/blockModel.ts';

const engineWith = (status: number) =>
  createEngine({
    config: createMemoryConfigStore(),
    prefs: createMemoryPrefsStore(),
    audit: async () => undefined,
    auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
    fetch: async () => (status === 200 ? Response.json({ workflow_runs: [] }) : new Response('{}', { status })),
    git: async () => ({ code: 1, stdout: '', stderr: '' }),
    emit: () => undefined,
    needsConfiguration: () => undefined,
    timers: { set: () => 0, clear: () => undefined },
  });

const get = (url: string, status = 200) => handleRequest({ method: 'GET', url, body: '' }, engineWith(status));

describe('routes', () => {
  test('health answers', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('a malformed wait is a 400', async () => {
    const res = await handleRequest({ method: 'POST', url: '/waits/start', body: '{"v":1}' }, engineWith(200));
    expect(res.status).toBe(400);
  });

  test('a missing parameter is a 400 with a message', async () => {
    const res = await get('/run?repo=github:github.com/acme/app');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: expect.stringContaining('id') });
  });

  test('the CiRun block query satisfies the /run route', async () => {
    const target = readBlockArgs({ repo: 'github:github.com/acme/app', runId: '1' });
    const params = new URLSearchParams(blockRunQuery(target)).toString();
    const res = await get(`/run?${params}`);
    // A missing run is fine; a 400 here means the block and the route
    // disagree about the parameter names again.
    expect(res.status).not.toBe(400);
  });

  test('provider errors keep their meaning', async () => {
    expect((await get('/run?repo=github:github.com/acme/app&id=1', 404)).status).toBe(404);
    expect((await get('/run?repo=github:github.com/acme/app&id=1', 401)).body).toMatchObject({ kind: 'auth' });
    expect((await get('/run?repo=github:github.com/acme/app&id=1', 500)).status).toBe(502);
  });

  test('an overview without a project list is a 400', async () => {
    const res = await handleRequest({ method: 'POST', url: '/overview', body: '{"directory":null}' }, engineWith(200));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: expect.stringContaining('projects') });
  });

  test('an overview with no projects is empty, not an error', async () => {
    const res = await handleRequest({ method: 'POST', url: '/overview', body: '{"directory":null,"projects":[]}' }, engineWith(200));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repos: [], current: null });
  });

  test('an unknown path is a 404', async () => {
    expect((await get('/nope')).status).toBe(404);
  });

  test('the old rerun kind still reaches the run', async () => {
    const res = await handleRequest(
      { method: 'POST', url: '/action', body: JSON.stringify({ kind: 'rerun', repo: 'github:github.com/acme/app', runId: '1' }) },
      engineWith(200),
    );
    expect(res.status).toBe(200);
  });
});

describe('mentions routes', () => {
  const post = (url: string, body: string, status = 200) => handleRequest({ method: 'POST', url, body }, engineWith(status));

  test('search answers items, an empty query answers empty', async () => {
    const res = await post('/mentions/search', '{"query":"100"}');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [] }); // no repos watched in this engine
    const empty = await post('/mentions/search', '{"query":""}');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ items: [] });
  });

  test('resolve answers text or keeps the provider meaning', async () => {
    const res = await post('/mentions/resolve', '{"id":"github:github.com/acme/app|999"}', 404);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  test('resolve without an id is a 400', async () => {
    const res = await post('/mentions/resolve', '{}');
    expect(res.status).toBe(400);
  });

  test('a junk body is a 400, not a 500', async () => {
    expect((await post('/mentions/search', 'nope')).status).toBe(400);
  });
});
