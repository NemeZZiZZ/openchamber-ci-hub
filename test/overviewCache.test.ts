import { describe, expect, test } from 'bun:test';
import type { OverviewView } from '../src/service/engine.ts';
import type { App } from '../src/ui/app/state.ts';
import { restoreCachedOverview, saveCachedOverview, showsLoadingPlaceholder } from '../src/ui/app/overviewCache.ts';

const view = (repos: unknown[] = []): OverviewView =>
  ({ providers: [], repos, current: null, accounts: [] }) as unknown as OverviewView;

const storageOf = (initial: Record<string, unknown> = {}, failing = false) => {
  const store = { ...initial };
  return {
    get: async (key: string) => store[key] as never,
    set: async (key: string, value: unknown) => {
      if (failing) throw new Error('storage is down');
      store[key] = value;
    },
  };
};

const appWith = (store: ReturnType<typeof storageOf> | undefined, overview: OverviewView | null = null, directory: string | null = '/p/app') => {
  const s = { overview, overviewLoading: false, directory };
  const app = { s, host: store === undefined ? {} : { storage: store } } as unknown as App;
  return { app, s };
};

describe('saveCachedOverview', () => {
  test('stores the overview with its directory', async () => {
    const store = storageOf();
    const seen: Array<[string, unknown]> = [];
    const spying = { ...store, set: async (k: string, v: unknown) => void seen.push([k, v]) };
    const { app } = appWith(spying, view([{ key: 'a' }]));
    saveCachedOverview(app);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([['ci-hub:last-overview', { directory: '/p/app', view: view([{ key: 'a' }]) }]]);
  });

  test('saves nothing when there is no overview yet', () => {
    const seen: unknown[] = [];
    const store = { get: async () => undefined, set: async (_k: string, v: unknown) => void seen.push(v) };
    const { app } = appWith(store as never, null);
    saveCachedOverview(app);
    expect(seen).toHaveLength(0);
  });

  test('a failing storage never breaks the panel', () => {
    const { app } = appWith(storageOf({}, true), view());
    expect(() => saveCachedOverview(app)).not.toThrow();
  });
});

describe('restoreCachedOverview', () => {
  test('applies a stored overview for this directory', async () => {
    const stored = { directory: '/p/app', view: view([{ key: 'a' }]) };
    const { app, s } = appWith(storageOf({ 'ci-hub:last-overview': stored }));
    expect(await restoreCachedOverview(app)).toBe(true);
    expect(s.overview).toBe(stored.view);
  });

  test('rejects a cache from another directory', async () => {
    const stored = { directory: '/p/other', view: view([{ key: 'a' }]) };
    const { app, s } = appWith(storageOf({ 'ci-hub:last-overview': stored }));
    expect(await restoreCachedOverview(app)).toBe(false);
    expect(s.overview).toBeNull();
  });

  test('rejects garbage instead of painting it', async () => {
    const { app, s } = appWith(storageOf({ 'ci-hub:last-overview': { view: { repos: 'nope' } } }));
    expect(await restoreCachedOverview(app)).toBe(false);
    expect(s.overview).toBeNull();
  });

  test('never overwrites a live overview that won the race', async () => {
    const live = view([{ key: 'live' }]);
    const stored = { directory: '/p/app', view: view([{ key: 'stale' }]) };
    const { app, s } = appWith(storageOf({ 'ci-hub:last-overview': stored }), live);
    expect(await restoreCachedOverview(app)).toBe(false);
    expect(s.overview).toBe(live);
  });

  test('no storage means no cache', async () => {
    const { app } = appWith(undefined);
    expect(await restoreCachedOverview(app)).toBe(false);
  });
});

describe('showsLoadingPlaceholder', () => {
  test('a boot with no data yet says it is looking', () => {
    expect(showsLoadingPlaceholder({ overview: null, overviewLoading: true })).toBe(true);
  });

  test('an empty list stays on the placeholder while the load runs', () => {
    expect(showsLoadingPlaceholder({ overview: view(), overviewLoading: true })).toBe(true);
  });

  test('a list that already has projects never shows it mid-load', () => {
    expect(showsLoadingPlaceholder({ overview: view([{ key: 'a' }]), overviewLoading: true })).toBe(false);
  });

  test('idle never shows it', () => {
    expect(showsLoadingPlaceholder({ overview: null, overviewLoading: false })).toBe(false);
    expect(showsLoadingPlaceholder({ overview: view(), overviewLoading: false })).toBe(false);
  });
});
