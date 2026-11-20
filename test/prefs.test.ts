import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createEngine } from '../src/service/engine.ts';
import {
  createFilePrefsStore,
  createMemoryPrefsStore,
  DEFAULT_PREFS,
  parsePrefs,
} from '../src/service/prefs.ts';
import { handleRequest } from '../src/service/routes.ts';

describe('parsePrefs', () => {
  test('defaults and rejects junk', () => {
    expect(parsePrefs(undefined)).toEqual({ marks: true, toastOnTurnFailure: true });
    expect(parsePrefs('{"marks":false}')).toEqual({ marks: false, toastOnTurnFailure: true });
    expect(parsePrefs('{"toastOnTurnFailure":false}')).toEqual({ marks: true, toastOnTurnFailure: false });
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"marks":"yes"}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[]')).toEqual(DEFAULT_PREFS);
  });
});

describe('prefs stores', () => {
  test('file store round-trips and survives a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ci-hub-prefs-'));
    try {
      const store = createFilePrefsStore(dir);
      expect(await store.load()).toEqual(DEFAULT_PREFS);
      await store.save({ marks: false, toastOnTurnFailure: true });
      expect((await stat(join(dir, 'prefs.json'))).mode & 0o777).toBe(0o600);
      // A second store over the same directory sees the saved values.
      expect(await createFilePrefsStore(dir).load()).toEqual({ marks: false, toastOnTurnFailure: true });
      expect(JSON.parse(await readFile(join(dir, 'prefs.json'), 'utf8'))).toEqual({
        marks: false,
        toastOnTurnFailure: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('memory store returns copies', async () => {
    const store = createMemoryPrefsStore();
    const loaded = await store.load();
    loaded.marks = false;
    expect((await store.load()).marks).toBe(true);
  });
});

describe('/prefs routes', () => {
  const engine = () =>
    createEngine({
      config: createMemoryConfigStore(),
      prefs: createMemoryPrefsStore(),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async () => Response.json({ workflow_runs: [] }),
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      timers: { set: () => 0, clear: () => undefined },
    });

  test('PUT then GET returns the saved preferences', async () => {
    const e = engine();
    const put = await handleRequest({ method: 'PUT', url: '/prefs', body: '{"marks":false}' }, e);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ marks: false, toastOnTurnFailure: true });
    const get = await handleRequest({ method: 'GET', url: '/prefs', body: '' }, e);
    expect(get.body).toEqual({ marks: false, toastOnTurnFailure: true });
  });

  test('a non-boolean field is ignored', async () => {
    const e = engine();
    const res = await handleRequest(
      { method: 'PUT', url: '/prefs', body: '{"marks":"no","toastOnTurnFailure":false}' },
      e,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marks: true, toastOnTurnFailure: false });
  });
});
