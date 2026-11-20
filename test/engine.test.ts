import { describe, expect, test } from 'bun:test';
import { createEngine, EngineError, POLL_IDLE_MS, type AccountView, type EngineDeps } from '../src/service/engine.ts';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';

const KEY = 'github:github.com/acme/app';
const LIB = 'github:github.com/acme/lib';
const GHE = 'github:ghe.acme.io/acme/app';
const account = (view: { accounts: AccountView[] }, host: string) => view.accounts.find((a) => a.host === host);

const rawRun = (over: Record<string, unknown> = {}) => ({
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
  updated_at: '2026-11-14T10:01:00Z',
  actor: { login: 'octo' },
  html_url: 'https://github.com/acme/app/actions/runs/100',
  ...over,
});

const setup = (
  options: {
    token?: string | undefined;
    status?: () => number;
    run?: () => Record<string, unknown>;
    remote?: string;
    remotes?: Record<string, string>;
    settings?: Record<string, string>;
    store?: string;
    wpRepos?: () => Response | Promise<Response>;
  } = {},
) => {
  const timers: { fn: () => void; ms: number }[] = [];
  const requests: string[] = [];
  const urls: string[] = [];
  const hosts: string[] = [];
  const auths: string[] = [];
  const gitCalls: string[] = [];
  const audit: unknown[] = [];
  const configNotes: (string | null)[] = [];
  let now = Date.parse('2026-11-14T12:00:00Z');
  const deps: EngineDeps = {
    config: createMemoryConfigStore(),
    prefs: createMemoryPrefsStore(),
    now: () => now,
    audit: async (entry) => void audit.push(entry),
    auth: {
      readStore: async () => options.store,
      readSettings: async () => options.settings ?? {},
      cliToken: async () => ('token' in options ? (options.token ?? null) : 'gh-token'),
    },
    fetch: async (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      urls.push(url);
      hosts.push(new URL(url).host);
      auths.push((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '');
      const status = options.status?.() ?? 200;
      if (status !== 200) return new Response('{}', { status });
      if (url.includes('/jobs')) return Response.json({ jobs: [] });
      if (url.includes('/actions/workflows/')) {
        return Response.json({ total_count: 45, workflow_runs: [rawRun({ id: 200 })] });
      }
      if (url.includes('/actions/runs/')) return Response.json(options.run?.() ?? rawRun());
      if (url.includes('/actions/runs')) return Response.json({ workflow_runs: [options.run?.() ?? rawRun()] });
      if (url.includes('/user/repos')) return options.wpRepos ? options.wpRepos() : Response.json([]);
      if (url.includes('api.bitbucket.org')) return Response.json({ main_branch: 'main' });
      if (url.endsWith('/version')) return Response.json({ version: '1.25.5' });
      if (/\/pipelines\/\d+$/.test(new URL(url).pathname)) {
        return Response.json({
          number: 128,
          status: 'success',
          event: 'push',
          branch: 'main',
          commit: 'abc123',
          title: 'm',
          message: 'm',
          sender: 'alicia',
          created: 1788999300,
          started: 1788999360,
          finished: 1788999600,
          forge_url: 'https://codeberg.org/alicia/pixelflare/commit/abc123',
        });
      }
      if (/\/repos\/\d+$/.test(new URL(url).pathname)) {
        return Response.json({ id: 42, full_name: 'alicia/pixelflare', default_branch: 'main' });
      }
      if (url.includes('/repos/lookup/')) {
        return Response.json(
          url.includes('alicia/pixelflare')
            ? { default_branch: 'main', id: 42, full_name: 'alicia/pixelflare' }
            : { default_branch: 'main', id: 7, full_name: 'acme/app' },
        );
      }
      return Response.json({ default_branch: 'main' });
    },
    git: async (args, cwd) => {
      if (args.includes('get-url')) gitCalls.push(cwd ?? '');
      const remote = options.remotes ? options.remotes[cwd] : options.remote;
      if (!remote) return { code: 1, stdout: '', stderr: 'not a repo' };
      if (args.includes('get-url')) return { code: 0, stdout: `${remote}\n`, stderr: '' };
      return { code: 0, stdout: 'main\n', stderr: '' };
    },
    emit: () => undefined,
    needsConfiguration: (message) => void configNotes.push(message),
    timers: {
      set: (fn, ms) => {
        const t = { fn, ms };
        timers.push(t);
        return t;
      },
      clear: (handle) => {
        const i = timers.indexOf(handle as never);
        if (i >= 0) timers.splice(i, 1);
      },
    },
  };
  return { engine: createEngine(deps), timers, requests, urls, auths, gitCalls, hosts, audit, configNotes, advance: (ms: number) => { now += ms; } };
};

describe('engine', () => {
  test('nothing polls until a surface asks when marks are off', async () => {
    const { engine, timers, requests } = setup();
    await engine.setPrefs({ marks: false });
    expect(engine.debug().interval).toBeNull();
    expect(timers).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  test('idle: polls every POLL_IDLE_MS when marks are on and nothing is open', () => {
    const { engine } = setup();
    expect(engine.debug().interval).toBe(POLL_IDLE_MS);
  });

  test('idle: panel open still wins over idle', async () => {
    const { engine } = setup();
    await engine.state(null);
    expect(engine.debug().interval).toBe(20_000);
  });

  test('start kicks the idle loop without any surface', async () => {
    const { engine, timers } = setup();
    engine.start();
    // reschedule() runs in pollAll's finally, after several awaited steps.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(POLL_IDLE_MS);
  });

  test('wait starts, keeps waiting while running, fires once completed', async () => {
    let status = 'in_progress';
    const { engine } = setup({ run: () => rawRun({ status, conclusion: status === 'completed' ? 'success' : null }) });
    const start = await engine.waitStart({ repo: 'acme/app', runId: '100' });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.label).toBe('CI #7 on acme/app');
    const pending = await engine.waitCheck([{ id: 'w1', state: start.state }]);
    expect(pending).toEqual([{ id: 'w1', fired: false }]);
    status = 'completed';
    const done = await engine.waitCheck([{ id: 'w1', state: start.state }]);
    expect(done[0]).toMatchObject({ id: 'w1', fired: true });
    expect((done[0] as { summary: string }).summary).toContain('success');
  });

  test('bad wait args are refused, not thrown', async () => {
    const { engine } = setup();
    expect(await engine.waitStart({ repo: 'nope', runId: 'x' })).toMatchObject({ ok: false });
  });

  test('a network failure keeps the wait alive', async () => {
    let fail = false;
    const { engine } = setup({ status: () => (fail ? 503 : 200) });
    const start = await engine.waitStart({ repo: 'acme/app', runId: '100' });
    if (!start.ok) throw new Error('start failed');
    fail = true;
    expect(await engine.waitCheck([{ id: 'w', state: start.state }])).toEqual([{ id: 'w', fired: false }]);
  });

  test('no token: state says how to connect and the card is told', async () => {
    const { engine, configNotes } = setup({ token: undefined });
    const state = await engine.state(null);
    expect(account(state, 'github.com')).toMatchObject({ provider: 'github', ok: false });
    expect(account(state, 'github.com')!.message).toContain('gh auth login');
    expect(state.providers.map((p) => p.id)).toEqual(['github', 'gitlab', 'gitea', 'forgejo', 'woodpecker', 'bitbucket']);
    expect(configNotes.some((note) => note?.includes('GitHub'))).toBe(true);
    expect(configNotes.some((note) => note?.includes('GitLab'))).toBe(true);
  });

  test('a revoked token shows a reconnect line', async () => {
    const { engine } = setup({ status: () => 401 });
    await engine.runDetail(KEY, '100').catch(() => undefined);
    const state = await engine.state(null);
    expect(account(state, 'github.com')!.ok).toBe(false);
    expect(account(state, 'github.com')!.message).toMatch(/Reconnect/);
  });

  test("a wait without repo uses the session folder's remote", async () => {
    const { engine } = setup({ remote: 'git@github.com:acme/app.git' });
    expect(await engine.waitStart({ runId: '100' }, '/work/app')).toMatchObject({ ok: true, label: 'CI #7 on acme/app' });
    const bare = setup();
    expect(await bare.engine.waitStart({ runId: '100' }, '/tmp')).toMatchObject({ ok: false });
  });

  test('a quiet repo is not polled on every fast tick', async () => {
    const quiet = () => rawRun({ status: 'completed', conclusion: 'success', updated_at: '2026-01-01T00:00:00Z' });
    let now = Date.parse('2026-11-14T12:00:00Z');
    const runsRequests = () => requests.filter((r) => r.endsWith('/actions/runs')).length;
    const timers: { fn: () => void; ms: number }[] = [];
    const requests: string[] = [];
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({
        version: 2,
        repos: [
          { key: KEY, enabled: true, addedAt: 0 },
          { key: LIB, enabled: true, addedAt: 0 },
        ],
        directoryMap: {},
      }),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        requests.push(new URL(url).pathname);
        if (url.includes('/actions/runs')) return Response.json({ workflow_runs: [quiet()] });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      now: () => now,
      timers: {
        set: (fn, ms) => {
          const t = { fn, ms };
          timers.push(t);
          return t;
        },
        clear: (handle) => {
          const i = timers.indexOf(handle as never);
          if (i >= 0) timers.splice(i, 1);
        },
      },
    });
    await engine.state(null);
    await engine.overview({ directory: null, projects: [], expanded: [KEY] });
    await engine.pollAll();
    const first = runsRequests();
    now += 25_000;
    await engine.state(null);
    await engine.pollAll();
    // acme/app is the panel's repo and stays hot; acme/lib was polled and is quiet.
    expect(runsRequests() - first).toBe(1);
  });

  test('actions are audited', async () => {
    const { engine, audit, requests } = setup();
    await engine.runAction('cancel', KEY, '100');
    expect(requests).toContain('POST /repos/acme/app/actions/runs/100/cancel');
    expect(audit[0]).toMatchObject({ action: 'cancel', repo: KEY, target: '100', ok: true });
  });

  test('adding and removing a repository is audited like a write', async () => {
    const { engine, audit } = setup();
    await engine.addRepo('acme/app', '/p/app');
    expect(audit[0]).toMatchObject({ action: 'add-repo', repo: KEY, ok: true });
    await engine.removeRepo(KEY);
    expect(audit[1]).toMatchObject({ action: 'remove-repo', repo: KEY, ok: true });
  });

  test('overview lists every project with a CI remote, once per repository', async () => {
    const { engine } = setup({
      remotes: {
        '/p/app': 'git@github.com:acme/app.git',
        '/p/app-copy': 'https://github.com/acme/app',
        '/p/lib': 'https://github.com/acme/lib.git',
        '/p/gitlab': 'git@gitlab.com:acme/other.git',
      },
    });
    const view = await engine.overview({
      directory: '/p/lib',
      projects: [
        { id: 'a', name: 'App', directory: '/p/app' },
        { id: 'b', name: 'App copy', directory: '/p/app-copy' },
        { id: 'c', name: 'Lib', directory: '/p/lib' },
        { id: 'd', name: 'Other', directory: '/p/gitlab' },
        { id: 'e', name: 'Notes', directory: '/p/notes' },
      ],
      expanded: [],
    });
    expect(view.repos.map((repo) => repo.key)).toEqual([KEY, LIB, 'gitlab:gitlab.com/acme/other']);
    expect(view.repos[0]).toMatchObject({ provider: 'github', name: 'acme/app', webUrl: 'https://github.com/acme/app', ciUrl: 'https://github.com/acme/app/actions' });
    expect(view.repos[0]!.project?.name).toBe('App');
    expect(view.repos[0]!.runs).toHaveLength(1);
    expect(view.repos[0]!.defaultBranch).toBe('main');
    expect(view.current).toBe(LIB);
    expect(account(view, 'github.com')!.ok).toBe(true);
    expect(view.providers[0]!.label).toBe('GitHub');
  });

  test('a removed project repository stays hidden', async () => {
    const { engine } = setup({ remotes: { '/p/app': 'git@github.com:acme/app.git' } });
    const input = { directory: null, projects: [{ id: 'a', name: 'App', directory: '/p/app' }], expanded: [] };
    expect((await engine.overview(input)).repos).toHaveLength(1);
    await engine.removeRepo(KEY);
    expect((await engine.overview(input)).repos).toHaveLength(0);
    await engine.addRepo('acme/app', null);
    expect((await engine.overview(input)).repos).toHaveLength(1);
  });

  test('workflow history pages say whether there is more', async () => {
    const { engine, requests } = setup();
    const first = await engine.workflowRuns({ repo: KEY, workflowId: '3', page: 2 });
    expect(first.hasMore).toBe(true);
    expect(first.runs[0]!.id).toBe('200');
    expect(requests).toContain('GET /repos/acme/app/actions/workflows/3/runs');
    const last = await engine.workflowRuns({ repo: KEY, workflowId: '3', page: 3 });
    expect(last.hasMore).toBe(false);
    // The same page within the cache window does not ask GitHub again.
    const before = requests.length;
    await engine.workflowRuns({ repo: KEY, workflowId: '3', page: 3 });
    expect(requests.length).toBe(before);
    await expect(engine.workflowRuns({ repo: KEY, workflowId: '', page: 1 })).rejects.toThrow('Unknown workflow');
  });

  test('expanded repositories stay hot while the panel is open', async () => {
    const { engine, requests } = setup({ remotes: { '/p/app': 'git@github.com:acme/app.git', '/p/lib': 'git@github.com:acme/lib.git' } });
    const projects = [
      { id: 'a', name: 'App', directory: '/p/app' },
      { id: 'b', name: 'Lib', directory: '/p/lib' },
    ];
    await engine.overview({ directory: null, projects, expanded: [LIB] });
    const polls = (name: string) => requests.filter((r) => r === `GET /repos/${name}/actions/runs`).length;
    const before = { app: polls('acme/app'), lib: polls('acme/lib') };
    await engine.pollAll();
    expect(polls('acme/lib') - before.lib).toBe(1);
  });

  test('a rate limit on one host does not stop another', async () => {
    let now = Date.parse('2026-11-14T12:00:00Z');
    const polled: string[] = [];
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({
        version: 2,
        repos: [
          { key: KEY, enabled: true, addedAt: 0 },
          { key: GHE, enabled: true, addedAt: 0 },
        ],
        directoryMap: {},
      }),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        const { host, pathname } = new URL(url);
        if (pathname.endsWith('/actions/runs')) polled.push(host);
        if (host === 'ghe.acme.io') {
          return new Response('{}', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(now / 1000) + 3600) },
          });
        }
        if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: [rawRun()] });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      now: () => now,
      timers: { set: () => 0, clear: () => undefined },
    });
    await engine.state(null);
    await engine.pollAll();
    const count = (host: string) => polled.filter((h) => h === host).length;
    const before = { pub: count('api.github.com'), ghe: count('ghe.acme.io') };
    expect(before.pub).toBe(1);
    expect(before.ghe).toBe(1);
    now += 25_000;
    await engine.state(null);
    await engine.pollAll();
    expect(count('api.github.com') - before.pub).toBe(1);
    expect(count('ghe.acme.io')).toBe(before.ghe);
    const view = await engine.overview({ directory: null, projects: [], expanded: [] });
    expect(account(view, 'ghe.acme.io')!.rateLimit?.blockedUntil).toBeGreaterThan(now);
    expect(account(view, 'github.com')!.rateLimit).toBeNull();
  });

  test('idle: a rate-limit-blocked account is still skipped', async () => {
    let now = Date.parse('2026-11-14T12:00:00Z');
    const polled: string[] = [];
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({
        version: 2,
        repos: [
          { key: KEY, enabled: true, addedAt: 0 },
          { key: GHE, enabled: true, addedAt: 0 },
        ],
        directoryMap: {},
      }),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        const { host, pathname } = new URL(url);
        if (pathname.endsWith('/actions/runs')) polled.push(host);
        if (host === 'ghe.acme.io') {
          return new Response('{}', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(now / 1000) + 3600) },
          });
        }
        if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: [rawRun()] });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      now: () => now,
      timers: { set: () => 0, clear: () => undefined },
    });
    // No state() or status(): only the idle cadence drives these polls.
    expect(engine.debug().interval).toBe(POLL_IDLE_MS);
    await engine.pollAll();
    const count = (host: string) => polled.filter((h) => h === host).length;
    expect(count('api.github.com')).toBe(1);
    expect(count('ghe.acme.io')).toBe(1);
    now += POLL_IDLE_MS + 1_000;
    await engine.pollAll();
    expect(count('api.github.com')).toBe(2);
    expect(count('ghe.acme.io')).toBe(1);
  });

  test('a wait started before the upgrade resumes', async () => {
    const { engine } = setup({ run: () => rawRun({ status: 'completed', conclusion: 'success' }) });
    const state = { repo: 'acme/app', runId: '100', conclusion: null, attempt: 1, number: 7, workflow: 'CI' };
    const [outcome] = await engine.waitCheck([{ id: 'old', state }]);
    expect(outcome).toMatchObject({ id: 'old', fired: true });
  });

  test('addRepo takes a url and dedupes against the detected remote', async () => {
    const { engine } = setup({ remote: 'git@github.com:acme/app.git' });
    await engine.state('/p/app');
    await engine.addRepo('https://github.com/ACME/app');
    expect((await engine.state('/p/app')).repos).toHaveLength(1);
    await expect(engine.addRepo('not a repo')).rejects.toThrow('Enter the repository as owner/name');
  });

  const enterpriseOnly = () => {
    const hosts: string[] = [];
    const requests: string[] = [];
    const configNotes: (string | null)[] = [];
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({ version: 2, repos: [{ key: GHE, enabled: true, addedAt: 0 }], directoryMap: {} }),
      audit: async () => undefined,
      auth: {
        readStore: async () => undefined,
        readSettings: async () => ({}),
        cliToken: async (_program, args) => (args.includes('ghe.acme.io') ? 'ghe-token' : null),
      },
      fetch: async (url, init) => {
        const { host, pathname } = new URL(url);
        hosts.push(host);
        requests.push(`${init?.method ?? 'GET'} ${host}${pathname}`);
        if (pathname.includes('/jobs')) return Response.json({ jobs: [] });
        if (pathname.includes('/actions/runs/')) return Response.json(rawRun({ status: 'completed', conclusion: 'failure' }));
        if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: [rawRun()] });
        if (init?.method === 'POST') return new Response(null, { status: 201 });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: (message) => void configNotes.push(message),
      timers: { set: () => 0, clear: () => undefined },
    });
    return { engine, hosts, requests, configNotes };
  };

  test('an old owner/name finds its enterprise repository', async () => {
    const { engine, hosts, requests } = enterpriseOnly();
    const state = { repo: 'acme/app', runId: '100', conclusion: null, attempt: 1, number: 7, workflow: 'CI' };
    const [outcome] = await engine.waitCheck([{ id: 'old', state }]);
    expect(outcome).toMatchObject({ id: 'old', fired: true });
    await engine.statusAction('rerun-failed:acme/app:100');
    expect(requests).toContain('POST ghe.acme.io/api/v3/repos/acme/app/actions/runs/100/rerun-failed-jobs');
    expect(hosts).not.toContain('api.github.com');
    expect(await engine.removeRepo('acme/app')).toHaveLength(0);
  });

  test('an enterprise-only setup does not ask for a github.com account', async () => {
    const { engine, configNotes } = enterpriseOnly();
    const state = await engine.state(null);
    expect(state.accounts.map((a) => a.host)).toEqual(['ghe.acme.io']);
    const view = await engine.overview({ directory: null, projects: [], expanded: [] });
    expect(view.accounts.map((a) => a.host)).toEqual(['ghe.acme.io']);
    expect(configNotes.filter((note) => note !== null)).toEqual([]);
  });

  test('unknown hosts are not watched', async () => {
    const { engine, hosts } = setup({ remotes: { '/p/x': 'https://code.acme.io/acme/app' } });
    const view = await engine.overview({ directory: '/p/x', projects: [{ id: 'x', name: 'X', directory: '/p/x' }], expanded: [] });
    expect(view.repos).toHaveLength(0);
    expect(view.current).toBeNull();
    expect(hosts).not.toContain('code.acme.io');
  });
});

describe('engine with gitlab', () => {
  const GLKEY = 'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets';
  const WEB = 'https://gitlab.gurunetwork.ai/DEXGURU/e8-markets';
  const rawPipeline = (over: Record<string, unknown> = {}) => ({
    id: 123,
    iid: 9,
    project_id: 77,
    ref: 'main',
    sha: 'abc',
    status: 'running',
    source: 'push',
    name: 'Nightly',
    created_at: '2026-11-14T10:00:00Z',
    updated_at: '2026-11-14T10:01:00Z',
    web_url: `${WEB}/-/pipelines/123`,
    ...over,
  });
  const rawJob = { id: 55, name: 'build', stage: 'build', status: 'running', web_url: `${WEB}/-/jobs/55` };

  const gl = (configRepos: { key: string; enabled: boolean; addedAt: number }[] = [{ key: GLKEY, enabled: true, addedAt: 0 }]) => {
    const calls: { method: string; path: string; body: string; auth: string }[] = [];
    const store = JSON.stringify({
      providers: {
        gitlab: {
          instances: {
            'https://gitlab.gurunetwork.ai': {
              credentials: [{ credentialId: 'a', token: 'store-token', status: 'valid' }],
            },
          },
        },
      },
    });
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({ version: 2, repos: configRepos, directoryMap: {} }),
      audit: async () => undefined,
      auth: { readStore: async () => store, readSettings: async () => ({}), cliToken: async () => 'gh-token' },
      fetch: async (url, init) => {
        const { pathname } = new URL(url);
        calls.push({
          method: init?.method ?? 'GET',
          path: pathname,
          body: String(init?.body ?? ''),
          auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '',
        });
        if (/\/pipelines\/\d+\/(retry|cancel)$/.test(pathname)) return new Response(null, { status: 201 });
        if (pathname.endsWith('/pipeline')) return new Response(null, { status: 201 });
        if (/\/pipelines\/\d+\/jobs$/.test(pathname)) return Response.json([rawJob]);
        if (/\/pipelines\/\d+$/.test(pathname)) return Response.json(rawPipeline());
        if (pathname.endsWith('/pipelines')) return Response.json([rawPipeline()]);
        if (pathname.includes('/repository/commits/')) return Response.json({ title: 'Commit title' });
        if (url.includes('/actions/runs')) return Response.json({ workflow_runs: [rawRun()] });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
    });
    return { engine, calls };
  };

  test('a gitlab repo polls pipelines with the store token', async () => {
    const { engine, calls } = gl();
    const overview = await engine.overview({ directory: null, projects: [], expanded: [GLKEY] });
    const repo = overview.repos.find((entry) => entry.key === GLKEY)!;
    expect(repo.runs.map((run) => run.id)).toEqual(['123']);
    expect(repo.runs[0]).toMatchObject({ provider: 'gitlab', number: 9, branch: 'main', workflow: 'Nightly' });
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/api/v4/projects/DEXGURU%2Fe8-markets/pipelines', auth: 'Bearer store-token' }),
    );
    expect(repo).toMatchObject({
      provider: 'gitlab',
      webUrl: WEB,
      ciUrl: `${WEB}/-/pipelines`,
    });
    expect(overview.providers.map((p) => p.id)).toEqual(['github', 'gitlab', 'gitea', 'forgejo', 'woodpecker', 'bitbucket']);
  });

  test('run actions reach the pipeline endpoints', async () => {
    const { engine, calls } = gl();
    await engine.runAction('rerun-failed', GLKEY, '123');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/123/retry');
    await engine.runAction('cancel', GLKEY, '123');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/123/cancel');
    // A write schedules follow-up polls; keep only the write itself.
    calls.length = 0;
    await engine.runAction('rerun-all', GLKEY, '123');
    const actions = calls.filter(
      (c) => !c.path.endsWith('/pipelines') && !c.path.endsWith('%2Fe8-markets'),
    );
    expect(actions.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v4/projects/DEXGURU%2Fe8-markets/pipelines/123',
      'POST /api/v4/projects/DEXGURU%2Fe8-markets/pipeline',
    ]);
    expect(JSON.parse(actions[1]!.body)).toEqual({ ref: 'main' });
  });

  test('a pipeline url waits', async () => {
    const { engine } = gl();
    const start = await engine.waitStart({ runId: `${WEB}/-/pipelines/123` });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.label).toBe('Nightly #9 on DEXGURU/e8-markets');
  });

  test('dispatch starts a pipeline on a ref', async () => {
    const { engine, calls } = gl();
    await engine.dispatch(GLKEY, 'pipelines', 'main', {});
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('POST /api/v4/projects/DEXGURU%2Fe8-markets/pipeline');
    expect(JSON.parse(calls.find((c) => c.path.endsWith('/pipeline'))!.body)).toEqual({ ref: 'main' });
  });

  test('accounts list the gitlab host alongside github', async () => {
    const { engine } = gl([
      { key: GLKEY, enabled: true, addedAt: 0 },
      { key: KEY, enabled: true, addedAt: 1 },
    ]);
    const state = await engine.state(null);
    expect(account(state, 'gitlab.gurunetwork.ai')).toMatchObject({ provider: 'gitlab', ok: true, source: 'openchamber' });
    expect(account(state, 'github.com')).toMatchObject({ provider: 'github', ok: true });
    const overview = await engine.overview({ directory: null, projects: [], expanded: [] });
    expect(account(overview, 'gitlab.gurunetwork.ai')!.ok).toBe(true);
  });
});

describe('engine with gitea and forgejo', () => {
  const GTKEY = 'gitea:gitea.acme.io/g/p';
  const FJKEY = 'forgejo:codeberg.org/g/p';
  const rawGiteaRun = (over: Record<string, unknown> = {}) => ({
    id: 101,
    run_number: 8,
    display_title: 'Commit',
    path: 'build.yml@refs/heads/main',
    event: 'push',
    run_attempt: 1,
    head_branch: 'main',
    head_sha: 'abc',
    status: 'in_progress',
    started_at: '2026-11-14T10:00:00Z',
    completed_at: '0001-01-01T00:00:00Z',
    actor: { login: 'ada' },
    html_url: 'https://gitea.acme.io/g/p/actions/runs/101',
    ...over,
  });
  const rawForgejoRun = (over: Record<string, unknown> = {}) => ({
    id: 71,
    title: 'Commit',
    workflow_id: 'build.yml',
    index_in_repo: 12,
    trigger_user: { login: 'ada' },
    prettyref: 'main',
    commit_sha: 'abc',
    event: 'push',
    status: 'running',
    started: '2026-11-14T10:00:00Z',
    html_url: 'https://codeberg.org/g/p/actions/runs/71',
    ...over,
  });

  const four = (options: { version?: string } = {}) => {
    const calls: { method: string; path: string; body: string; auth: string }[] = [];
    const store = JSON.stringify({
      providers: {
        gitea: {
          instances: {
            'https://gitea.acme.io': { credentials: [{ credentialId: 'a', token: 'gt-token', status: 'valid' }] },
          },
        },
        forgejo: {
          instances: {
            'https://codeberg.org': { credentials: [{ credentialId: 'b', token: 'fj-token', status: 'valid' }] },
          },
        },
      },
    });
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({
        version: 2,
        repos: [
          { key: GTKEY, enabled: true, addedAt: 0 },
          { key: FJKEY, enabled: true, addedAt: 0 },
        ],
        directoryMap: {},
      }),
      audit: async () => undefined,
      auth: { readStore: async () => store, readSettings: async () => ({}), cliToken: async () => null },
      fetch: async (url, init) => {
        const u = new URL(url);
        const { pathname } = u;
        calls.push({
          method: init?.method ?? 'GET',
          path: pathname,
          body: String(init?.body ?? ''),
          auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '',
        });
        if (u.host === 'gitea.acme.io') {
          if (pathname === '/api/v1/version') return Response.json({ version: options.version ?? '1.26.0' });
          if (pathname.endsWith('/actions/runs/101')) return Response.json(rawGiteaRun());
          if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: [rawGiteaRun()] });
          if (pathname.includes('/dispatches')) return new Response(null, { status: 201 });
          if (pathname.endsWith('/actions/workflows')) {
            return Response.json({
              workflows: [{ id: 'build.yml', name: 'Build', path: '.github/workflows/build.yml' }],
            });
          }
          if (pathname.includes('/contents/')) {
            return Response.json({ content: btoa('name: Build\non:\n  workflow_dispatch:\n'), encoding: 'base64' });
          }
          return Response.json({ default_branch: 'main' });
        }
        if (pathname.endsWith('/actions/runs/71/cancel')) return new Response(null, { status: 201 });
        if (pathname.endsWith('/actions/runs/12') || pathname.endsWith('/actions/runs/71')) {
          return Response.json(rawForgejoRun());
        }
        if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: [rawForgejoRun()] });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
    });
    return { engine, calls };
  };

  test('a gitea repo polls runs with the store token', async () => {
    const { engine, calls } = four();
    const overview = await engine.overview({ directory: null, projects: [], expanded: [GTKEY] });
    const repo = overview.repos.find((entry) => entry.key === GTKEY)!;
    expect(repo.runs.map((run) => run.id)).toEqual(['101']);
    expect(repo.runs[0]).toMatchObject({ provider: 'gitea', number: 8, branch: 'main', workflowId: 'build.yml' });
    expect(repo.ciUrl).toBe('https://gitea.acme.io/g/p/actions');
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/repos/g/p/actions/runs',
        auth: 'token gt-token',
      }),
    );
    expect(calls.some((call) => call.path === '/api/v1/version')).toBe(true);
  });

  test('a forgejo repo polls runs with the store token', async () => {
    const { engine, calls } = four();
    const overview = await engine.overview({ directory: null, projects: [], expanded: [FJKEY] });
    const repo = overview.repos.find((entry) => entry.key === FJKEY)!;
    expect(repo.runs.map((run) => run.id)).toEqual(['71']);
    expect(repo.runs[0]).toMatchObject({ provider: 'forgejo', number: 12, branch: 'main' });
    expect(repo.ciUrl).toBe('https://codeberg.org/g/p/actions');
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/repos/g/p/actions/runs',
        auth: 'token fj-token',
      }),
    );
  });

  test('gitea writes follow the version gate', async () => {
    const { engine, calls } = four();
    await engine.runAction('rerun-failed', GTKEY, '101');
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/repos/g/p/actions/runs/101/rerun-failed-jobs',
        auth: 'token gt-token',
      }),
    );
    await expect(engine.runAction('cancel', GTKEY, '101')).rejects.toThrow('Gitea cannot cancel runs.');

    const old = four({ version: '1.25.5' });
    await expect(old.engine.runAction('rerun-failed', GTKEY, '101')).rejects.toThrow('1.26');
    expect(old.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  test('forgejo writes cancel and refuse rerun-failed', async () => {
    const { engine, calls } = four();
    await engine.runAction('cancel', FJKEY, '71');
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/repos/g/p/actions/runs/71/cancel',
        auth: 'token fj-token',
      }),
    );
    await expect(engine.runAction('rerun-failed', FJKEY, '71')).rejects.toThrow('Forgejo cannot rerun-failed runs.');
  });

  test('run urls wait on both providers', async () => {
    const { engine } = four();
    const giteaWait = await engine.waitStart({ runId: 'https://gitea.acme.io/g/p/actions/runs/101' });
    expect(giteaWait.ok).toBe(true);
    if (giteaWait.ok) expect(giteaWait.state).toMatchObject({ repo: GTKEY, runId: '101', number: 8 });

    const forgejoWait = await engine.waitStart({ runId: 'https://codeberg.org/g/p/actions/runs/12' });
    expect(forgejoWait.ok).toBe(true);
    if (forgejoWait.ok) expect(forgejoWait.state).toMatchObject({ repo: FJKEY, runId: '71', number: 12 });
  });

  test('dispatch reads workflows and posts to the gitea dispatches endpoint', async () => {
    const { engine, calls } = four();
    const inputs = await engine.dispatchInputs(GTKEY, 'build.yml', 'main');
    expect(inputs.dispatchable).toBe(true);
    await engine.dispatch(GTKEY, 'build.yml', 'main', { verbose: '1' });
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/repos/g/p/actions/workflows/build.yml/dispatches',
        body: JSON.stringify({ ref: 'main', inputs: { verbose: '1' } }),
      }),
    );
  });

  test('state lists all four providers and both new hosts', async () => {
    const { engine } = four();
    const state = await engine.state(null);
    expect(state.providers.map((p) => p.id)).toEqual(['github', 'gitlab', 'gitea', 'forgejo', 'woodpecker', 'bitbucket']);
    expect(state.accounts.find((a) => a.host === 'gitea.acme.io')).toMatchObject({ provider: 'gitea', ok: true });
    expect(state.accounts.find((a) => a.host === 'codeberg.org')).toMatchObject({ provider: 'forgejo', ok: true });
  });
});

describe('engine status buttons', () => {
  test('the served view decodes back through the engine', async () => {
    const failing = rawRun({ status: 'completed', conclusion: 'failure' });
    const { engine, requests } = setup({ run: () => failing, remote: 'git@github.com:acme/app.git' });
    const view = (await engine.status('/p/app')) as { rows: { kind: string; actions?: { id: string }[] }[] };
    const button = view.rows.flatMap((row) => row.actions ?? []).find((action) => action.id.startsWith('rerun-failed-'));
    expect(button).toBeDefined();
    await engine.statusAction(button!.id);
    expect(requests).toContain('POST /repos/acme/app/actions/runs/100/rerun-failed-jobs');
    // A button drawn before the upgrade still resolves its owner/name.
    await engine.statusAction('rerun-failed:acme/app:100');
    expect(requests.filter((r) => r.endsWith('/rerun-failed-jobs'))).toHaveLength(2);
  });
});

describe('engine with a woodpecker server', () => {
  test('the configured server is an account row even with no repos', async () => {
    const { engine } = setup({ settings: { 'woodpecker-server': 'ci.codeberg.org', 'woodpecker-token': 'wp' } });
    const state = await engine.state(null);
    expect(state.accounts.find((a) => a.host === 'ci.codeberg.org')).toMatchObject({ provider: 'woodpecker', ok: true });
  });

  test('a server without a token asks to be configured', async () => {
    const { engine, configNotes } = setup({ settings: { 'woodpecker-server': 'ci.codeberg.org' } });
    await engine.state(null);
    expect(configNotes.some((note) => note !== null && /woodpecker/i.test(note))).toBe(true);
    const note = configNotes.find((n) => n !== null && /woodpecker/i.test(n))!;
    expect(note).toContain('woodpecker-server');
    expect(note).toContain('woodpecker-token');
    expect(note).not.toContain('OpenChamber');
  });

  test('the client honors the pasted scheme', async () => {
    const { engine, urls } = setup({ settings: { 'woodpecker-server': 'http://ci.lan:8000', 'woodpecker-token': 'wp' } });
    await engine.addRepo('woodpecker:ci.lan:8000/acme/app');
    expect(urls[0]!.startsWith('http://ci.lan:8000/api/repos/lookup/acme/app')).toBe(true);
  });

  test('approve and decline reach the pipeline endpoints', async () => {
    const { engine, urls, audit } = setup({ settings: { 'woodpecker-server': 'ci.codeberg.org', 'woodpecker-token': 'wp' } });
    await engine.addRepo('woodpecker:ci.codeberg.org/alicia/pixelflare');
    urls.length = 0;
    await engine.runAction('approve', 'woodpecker:ci.codeberg.org/alicia/pixelflare', '128');
    expect(urls).toContain('https://ci.codeberg.org/api/repos/42/pipelines/128/approve');
    await engine.runAction('decline', 'woodpecker:ci.codeberg.org/alicia/pixelflare', '128');
    expect(urls.some((u) => u.endsWith('/pipelines/128/decline'))).toBe(true);
    expect(audit.at(-1)).toMatchObject({ action: 'decline', ok: true });
  });

  test('a provider without approvals refuses the action', async () => {
    const { engine } = setup();
    await expect(engine.runAction('approve', KEY, '100')).rejects.toThrow('GitHub cannot approve runs.');
  });
});

describe('engine discovery with a woodpecker server', () => {
  const wpSettings = { 'woodpecker-server': 'ci.codeberg.org', 'woodpecker-token': 'wp' };
  const WOODPECKER_REPOS = async () => Bun.file('test/fixtures/woodpecker/user-repos.json').json();
  const overviewOf = async (engine: ReturnType<typeof createEngine>, directory: string) =>
    engine.overview({ directory, projects: [], expanded: [] });

  test('woodpecker claims a codeberg directory', async () => {
    const { engine } = setup({
      settings: wpSettings,
      remotes: { '/w': 'git@codeberg.org:alicia/pixelflare.git' },
      wpRepos: async () => Response.json(await WOODPECKER_REPOS()),
    });
    const view = await overviewOf(engine, '/w');
    expect(view.repos.map((repo) => repo.key)).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
  });

  test('repos not on the server keep host detection', async () => {
    const { engine } = setup({
      settings: wpSettings,
      remotes: { '/o': 'https://codeberg.org/alicia/other' },
      wpRepos: async () => Response.json(await WOODPECKER_REPOS()),
    });
    const view = await overviewOf(engine, '/o');
    expect(view.repos.map((repo) => repo.key)).toContain('forgejo:codeberg.org/alicia/other');
  });

  test('an unavailable list does not fall through and registers later', async () => {
    let up = false;
    const { engine, advance } = setup({
      settings: wpSettings,
      remotes: { '/w': 'git@codeberg.org:alicia/pixelflare.git' },
       wpRepos: async () => (up ? Response.json(await WOODPECKER_REPOS()) : new Response('nope', { status: 500 })),
    });
    expect((await overviewOf(engine, '/w')).repos.map((repo) => repo.key)).not.toContain('forgejo:codeberg.org/alicia/pixelflare');
    up = true;
    advance(16_000);
    const view = await overviewOf(engine, '/w');
    expect(view.repos.map((repo) => repo.key)).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
  });

  test('the last good list survives a failed refresh', async () => {
    let up = true;
    const { engine, advance } = setup({
      settings: wpSettings,
      remotes: { '/w': 'git@codeberg.org:alicia/pixelflare.git' },
       wpRepos: async () => (up ? Response.json(await WOODPECKER_REPOS()) : new Response('nope', { status: 500 })),
    });
    expect((await overviewOf(engine, '/w')).repos.map((repo) => repo.key)).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
    up = false;
    advance(16_000);
    expect((await overviewOf(engine, '/w')).repos.map((repo) => repo.key)).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
  });

  test('typed input resolves woodpecker-first, explicitly overridable', async () => {
    const { engine } = setup({ settings: wpSettings, wpRepos: async () => Response.json(await WOODPECKER_REPOS()), });
    const keysAfter = async (input: string) => (await engine.addRepo(input)).map((repo) => repo.key);
    expect(await keysAfter('alicia/pixelflare')).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
    expect(await keysAfter('acme/app')).toContain('github:github.com/acme/app');
    expect(await keysAfter('github:github.com/alicia/pixelflare')).toContain('github:github.com/alicia/pixelflare');
    expect(await keysAfter('https://codeberg.org/alicia/pixelflare')).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
    expect(await keysAfter('ci.codeberg.org/alicia/pixelflare')).toContain('woodpecker:ci.codeberg.org/alicia/pixelflare');
  });

  test('a run url on the server host starts a wait', async () => {
    const { engine } = setup({ settings: wpSettings, wpRepos: async () => Response.json(await WOODPECKER_REPOS()), });
    const result = await engine.waitStart({ runId: 'https://ci.codeberg.org/repos/42/pipeline/128' }, null);
    expect(result.ok).toBe(true);
    const state = result.ok ? (result.state as Record<string, unknown>) : {};
    expect(state.repo).toBe('woodpecker:ci.codeberg.org/alicia/pixelflare');
    expect(state.number).toBe(128);
  });

  test('the repo view links to the forge page the list reported', async () => {
    const { engine } = setup({
      settings: wpSettings,
      remotes: { '/w': 'git@codeberg.org:alicia/pixelflare.git' },
      wpRepos: async () => Response.json(await WOODPECKER_REPOS()),
    });
    const view = await overviewOf(engine, '/w');
    expect(view.repos.find((repo) => repo.key.startsWith('woodpecker'))?.webUrl).toBe('https://codeberg.org/alicia/pixelflare');
  });
});

describe('engine review-minor fixes', () => {
  const wpSettings = () => ({ 'woodpecker-server': 'http://localhost:8000', 'woodpecker-token': 't' });

  test('a pasted run url resolves through the server client', async () => {
    const { engine } = setup({ settings: wpSettings() });
    const views = await engine.addRepo('http://localhost:8000/repos/42/pipeline/128');
    expect(views.map((v) => v.key)).toContain('woodpecker:localhost:8000/alicia/pixelflare');
  });

  test('a failing server list backs off within the ttl', async () => {
    const { engine, urls } = setup({
      settings: wpSettings(),
      wpRepos: async () => new Response('nope', { status: 500 }),
    });
    await engine.addRepo('alicia/pixelflare');
    await engine.addRepo('alicia/pixelflare');
    expect(urls.filter((u) => u.includes('/user/repos')).length).toBe(1);
  });

  test('a scheme flip on the same host gets a fresh client', async () => {
    const settings = wpSettings();
    const { engine, urls } = setup({ settings });
    await engine.addRepo('woodpecker:localhost:8000/alicia/pixelflare');
    settings['woodpecker-server'] = 'https://localhost:8000';
    await engine.addRepo('woodpecker:localhost:8000/alicia/notes');
    expect(urls.some((u) => u.startsWith('http://localhost:8000/api/'))).toBeTrue();
    expect(urls.some((u) => u.startsWith('https://localhost:8000/api/'))).toBeTrue();
  });
});

describe('engine with a bitbucket token', () => {
  test('clientFor passes the email as the Basic user', async () => {
    const { engine, urls, auths } = setup({
      settings: { 'bitbucket-email': 'me@example.com', 'bitbucket-token': 'bb' },
    });
    await engine.addRepo('bitbucket:bitbucket.org/acme/app');
    expect(urls[0]).toContain('https://api.bitbucket.org/2.0/repositories/acme/app');
    expect(auths[0]).toBe(`Basic ${btoa('me@example.com:bb')}`);
  });
});

describe('run url claiming priority', () => {
  test('a connected instance beats a provider name pattern', async () => {
    const store = JSON.stringify({
      providers: { gitea: { instances: { 'https://github.example.com': { credentials: [{ token: 'g' }] } } } },
    });
    const { engine, urls } = setup({ store });
    const started = await engine.waitStart({ runId: 'https://github.example.com/acme/app/actions/runs/5' });
    expect(started.ok).toBe(true);
    // The Gitea instance answers on its own host (/api/v1); github's host
    // pattern must not steal the URL (its client would say /api/v3).
    expect(urls.some((u) => u.includes('github.example.com/api/v1/repos/acme/app/actions/runs/5'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/v3/'))).toBe(false);
  });
});

describe('engine cache bounds', () => {
  test('the oldest detected directory falls out of the cache past the cap', async () => {
    const projects = Array.from({ length: 257 }, (_, i) => ({ id: `p${i}`, name: `App ${i}`, directory: `/p/dir${i}` }));
    const remotes: Record<string, string> = {};
    for (const [i, project] of projects.entries()) remotes[project.directory] = `git@github.com:acme/app${i}.git`;
    const { engine, gitCalls } = setup({ remotes });
    await engine.overview({ directory: null, projects, expanded: [] });
    const first = gitCalls.filter((call) => call === '/p/dir0').length;
    await engine.overview({ directory: null, projects, expanded: [] });
    const second = gitCalls.filter((call) => call === '/p/dir0').length;
    // The 257th detection evicts the oldest entry, so dir0 is detected again.
    expect(second).toBe(first + 1);
  });
});

describe('mentions', () => {
  const OVERVIEW = { directory: null, projects: [], expanded: [] };
  const failingRun = () => rawRun({ status: 'completed', conclusion: 'failure' });
  const greenRun = () => rawRun({ id: 99, run_number: 6, display_title: 'Green', status: 'completed', conclusion: 'success', updated_at: '2026-11-14T09:00:00Z' });
  type GhState = { runs: Record<string, unknown>[]; jobs: { id: number; name: string; status: string; conclusion: string | null }[]; log: string };
  const mentionsEngine = (state: GhState) =>
    createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({ version: 2, repos: [{ key: KEY, enabled: true, addedAt: 0 }], directoryMap: {} }),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/actions/jobs/55/logs')) return new Response(state.log, { headers: { 'content-type': 'text/plain' } });
        if (/\/actions\/runs\/\d+\/jobs$/.test(pathname))
          return Response.json({
            jobs: state.jobs.map((job) => ({
              id: job.id,
              name: job.name,
              status: job.status,
              conclusion: job.conclusion,
              started_at: '2026-11-14T10:00:00Z',
              completed_at: '2026-11-14T10:01:00Z',
              html_url: 'https://github.com/acme/app/actions/runs/100/job/55',
            })),
          });
        if (/\/actions\/runs\/999$/.test(pathname)) return new Response('{}', { status: 404 });
        if (/\/actions\/runs\/\d+$/.test(pathname)) return Response.json(state.runs[0]);
        if (pathname.endsWith('/actions/runs')) return Response.json({ workflow_runs: state.runs });
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      timers: { set: () => 0, clear: () => undefined },
    });

  test('search matches number, branch and repo, newest first', async () => {
    const engine = mentionsEngine({ runs: [rawRun(), greenRun()], jobs: [], log: '' });
    await engine.overview(OVERVIEW);
    const byBranch = await engine.mentionsSearch('main');
    expect(byBranch.map((item) => item.id)).toEqual(['github:github.com/acme/app|100', 'github:github.com/acme/app|99']);
    expect(byBranch[0]).toMatchObject({
      title: 'Commit · #7',
      subtitle: 'acme/app · CI · main',
      url: 'https://github.com/acme/app/actions/runs/100',
    });
    expect((await engine.mentionsSearch('7')).map((item) => item.id)).toEqual(['github:github.com/acme/app|100']);
    expect(await engine.mentionsSearch('zzz-no-match')).toEqual([]);
  });

  test('search without any watched repo returns empty, not an error', async () => {
    const { engine } = setup();
    expect(await engine.mentionsSearch('anything')).toEqual([]);
  });

  test('resolve returns a summary with the failing job log tail', async () => {
    const engine = mentionsEngine({ runs: [failingRun()], jobs: [{ id: 55, name: 'build', status: 'completed', conclusion: 'failure' }], log: 'boom line\nsecond line' });
    await engine.overview(OVERVIEW);
    const text = await engine.mentionsResolve('github:github.com/acme/app|100');
    expect(text).toContain('acme/app');
    expect(text).toContain('#7');
    expect(text).toContain('failure');
    expect(text).toContain('build');
    expect(text).toContain('boom line');
    expect(text).toContain('https://github.com/acme/app/actions/runs/100');
    expect(text.length).toBeLessThanOrEqual(16_000);
  });

  test('resolve of a run with no failing or running job says so', async () => {
    const engine = mentionsEngine({ runs: [rawRun()], jobs: [], log: '' });
    await engine.overview(OVERVIEW);
    const text = await engine.mentionsResolve('github:github.com/acme/app|100');
    expect(text).toContain('No failing or running job.');
    expect(text).toContain('https://github.com/acme/app/actions/runs/100');
  });

  test('resolve of an unknown run is a 404 EngineError', async () => {
    const engine = mentionsEngine({ runs: [rawRun()], jobs: [], log: '' });
    await engine.overview(OVERVIEW);
    const err = await engine.mentionsResolve('github:github.com/acme/app|999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).status).toBe(404);
  });

  test('resolve of an unknown repo is a 404, not a 400', async () => {
    const engine = mentionsEngine({ runs: [rawRun()], jobs: [], log: '' });
    await engine.overview(OVERVIEW);
    const err = await engine.mentionsResolve('nope|x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).status).toBe(404);
  });

  test('resolve of an all-green run reports no failing job', async () => {
    const engine = mentionsEngine({
      runs: [rawRun({ status: 'completed', conclusion: 'success' })],
      jobs: [{ id: 55, name: 'build', status: 'completed', conclusion: 'success' }],
      log: 'all fine',
    });
    await engine.overview(OVERVIEW);
    const text = await engine.mentionsResolve('github:github.com/acme/app|100');
    expect(text).toContain('No failing or running job.');
    expect(text).not.toContain('all fine');
  });

  test('search cannot be starved by one repo filling the cap with older runs', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      rawRun({ id: index + 1, run_number: index + 1, head_branch: 'main', created_at: `2026-11-01T00:${String(index).padStart(2, '0')}:00Z` }),
    );
    const newest = rawRun({ id: 50, run_number: 50, head_branch: 'main', created_at: '2026-11-14T11:00:00Z' });
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore({
        version: 2,
        repos: [
          { key: KEY, enabled: true, addedAt: 0 },
          { key: 'github:github.com/acme/lib', enabled: true, addedAt: 0 },
        ],
        directoryMap: {},
      }),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/actions/runs')) {
          if (pathname.includes('/repos/acme/lib/')) return Response.json({ workflow_runs: [newest] });
          return Response.json({ workflow_runs: many });
        }
        return Response.json({ default_branch: 'main' });
      },
      git: async () => ({ code: 1, stdout: '', stderr: '' }),
      emit: () => undefined,
      needsConfiguration: () => undefined,
      timers: { set: () => 0, clear: () => undefined },
    });
    await engine.overview(OVERVIEW);
    const hits = await engine.mentionsSearch('main');
    expect(hits.length).toBe(20);
    expect(hits[0]?.id).toBe('github:github.com/acme/lib|50');
  });

  test('search never touches the network', async () => {
    const { engine, urls } = setup({
      settings: { repos: 'alicia/pixelflare', 'woodpecker-server': 'ci.codeberg.org', 'woodpecker-token': 'wp' },
      wpRepos: () => Response.json([]),
    });
    await engine.mentionsSearch('main');
    expect(urls.some((url) => url.includes('/user/repos'))).toBe(false);
  });
});

describe('server discovery under a rate limit', () => {
  test('a 429 from the server blocks further discovery fetches while it lasts', async () => {
    let now = Date.parse('2026-11-14T12:00:00Z');
    let serverCalls = 0;
    const engine = createEngine({
      prefs: createMemoryPrefsStore(),
      config: createMemoryConfigStore(),
      audit: async () => undefined,
      auth: {
        readStore: async () => undefined,
        readSettings: async () => ({ 'woodpecker-server': 'ci.acme.io', 'woodpecker-token': 'wp' }),
        cliToken: async () => null,
      },
      fetch: async (url) => {
        if (new URL(url).host === 'ci.acme.io') {
          serverCalls++;
          return new Response('{}', { status: 429 });
        }
        return Response.json({ default_branch: 'main' });
      },
      git: async (args) =>
        args[0] === 'remote'
          ? { code: 0, stdout: 'git@github.com:acme/app.git\n', stderr: '' }
          : { code: 0, stdout: 'main\n', stderr: '' },
      emit: () => undefined,
      needsConfiguration: () => undefined,
      now: () => now,
      timers: { set: () => 0, clear: () => undefined },
    });
    await engine.state('/p/app');
    expect(serverCalls).toBe(1);
    // Past the 15 s discovery cache, still inside the 60 s rate-limit block;
    // another directory defeats the per-directory detection cache.
    now += 20_000;
    await engine.state('/p/other');
    expect(serverCalls).toBe(1);
  });
});
