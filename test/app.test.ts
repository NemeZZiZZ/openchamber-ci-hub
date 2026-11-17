import { describe, expect, test } from 'bun:test';
import type { Run } from '../src/domain/types.ts';
import type { OverviewRepo, OverviewView } from '../src/service/engine.ts';
import { loadMore, loadOverview } from '../src/ui/app/data.ts';
import { serviceOptions, tabChange } from '../src/ui/app/bar.ts';
import { runMenuItems, onRunMenu } from '../src/ui/app/runMenu.ts';
import { providerFor, providerView } from '../src/providers/index.ts';
import type { App, AppState } from '../src/ui/app/state.ts';
import { SCOPE_MINE } from '../src/ui/treeModel.ts';
import { parseVariablesField, serializeVariablesField } from '../src/ui/app/dispatch.ts';
import { boardProviders, boardRows, filterBoardRows } from '../src/ui/app/board.ts';

const run = (over: Partial<Run> = {}): Run => ({
  id: '1',
  provider: 'github',
  repo: 'github:github.com/acme/app',
  number: 1,
  workflow: 'CI',
  workflowId: '10',
  branch: 'main',
  sha: 'abc',
  title: 'commit',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  createdAt: 100,
  startedAt: 100,
  finishedAt: 200,
  actor: 'ann',
  url: 'https://github.com/acme/app/actions/runs/1',
  commitUrl: null,
  ...over,
});

const repo = (key: string, runs: Run[]): OverviewRepo => ({
  key,
  provider: 'github',
  name: key.split('/').slice(1).join('/'),
  webUrl: `https://github.com/${key.split('/').slice(1).join('/')}`,
  ciUrl: 'https://github.com/x/actions',
  project: { id: 'p', name: 'App', directory: '/p/app' },
  defaultBranch: 'main',
  currentBranch: null,
  polledAt: 1,
  error: null,
  runs,
});

const makeApp = (view: OverviewView): { app: App; s: AppState } => {
  const s = {
    overview: null,
    overviewError: null,
    overviewLoading: false,
    directory: '/p/app',
    projects: [],
    projectsSig: '',
    expanded: new Set<string>(),
    toggled: new Set<string>(),
    scope: SCOPE_MINE,
    actor: '',
    history: new Map(),
    historyGen: 0,
    detail: null,
    filter: 'attention',
    view: { kind: 'list' },
  } as unknown as AppState;
  const app = {
    s,
    host: { setBadge: async () => undefined },
    svc: async () => view,
    renderNotes: () => undefined,
    syncBar: () => undefined,
    renderTree: () => undefined,
    updateBadge: () => undefined,
    renderSide: () => undefined,
  } as unknown as App;
  return { app, s };
};

describe('loadOverview', () => {
  test('projects no longer open on their own', async () => {
    const failing = repo('github:github.com/acme/app', [run()]);
    const folder = repo('github:github.com/acme/lib', [run({ repo: 'github:github.com/acme/lib', conclusion: 'success' })]);
    const { app, s } = makeApp({ providers: [], repos: [failing, folder], current: folder.key, accounts: [] });
    await loadOverview(app);
    // Not the folder's own project, not a broken one: expansion is the reader's click.
    expect(s.expanded.size).toBe(0);
    expect(s.overview).toBeInstanceOf(Object);
  });
});

describe('serviceOptions', () => {
  const view = (id: string, label: string) => ({ id, label }) as OverviewView['providers'][number];
  const gitlabRepo = () => ({ ...repo('gitlab:gitlab.gurunetwork.ai/guru/e8', []), provider: 'gitlab' });

  test('lists the services that have projects, in registry order, after All services', () => {
    const overview = { providers: [view('github', 'GitHub'), view('gitlab', 'GitLab')], repos: [repo('github:github.com/acme/app', []), gitlabRepo()], current: null, accounts: [] } as OverviewView;
    const { app, s } = makeApp(overview);
    s.overview = overview;
    expect(serviceOptions(app)).toEqual([
      { id: '', label: 'All services' },
      { id: 'github', label: 'GitHub' },
      { id: 'gitlab', label: 'GitLab' },
    ]);
  });

  test('a connected service without projects gets no option', () => {
    const overview = { providers: [view('github', 'GitHub'), view('gitlab', 'GitLab')], repos: [gitlabRepo()], current: null, accounts: [] } as OverviewView;
    const { app, s } = makeApp(overview);
    s.overview = overview;
    expect(serviceOptions(app)).toEqual([
      { id: '', label: 'All services' },
      { id: 'gitlab', label: 'GitLab' },
    ]);
  });

  test('a project whose provider view is missing stays under All services', () => {
    const overview = { providers: [view('github', 'GitHub')], repos: [gitlabRepo()], current: null, accounts: [] } as OverviewView;
    const { app, s } = makeApp(overview);
    s.overview = overview;
    // No mislabeled fallback option: the repo simply has no service to filter by.
    expect(serviceOptions(app)).toEqual([{ id: '', label: 'All services' }]);
  });

  test('a chosen service whose projects are gone stays visible, like branch and actor', () => {
    const overview = { providers: [view('github', 'GitHub'), view('gitlab', 'GitLab')], repos: [repo('github:github.com/acme/app', [])], current: null, accounts: [] } as OverviewView;
    const { app, s } = makeApp(overview);
    s.overview = overview;
    s.service = 'gitlab';
    // The pill must not fall back to a dimmed "Select" while the filter empties the tree.
    expect(serviceOptions(app)).toEqual([
      { id: '', label: 'All services' },
      { id: 'github', label: 'GitHub' },
      { id: 'gitlab', label: 'GitLab' },
    ]);
    // Even the provider view is gone: the id itself carries the label.
    const gone = { providers: [], repos: [], current: null, accounts: [] } as unknown as OverviewView;
    s.overview = gone;
    expect(serviceOptions(app)).toEqual([
      { id: '', label: 'All services' },
      { id: 'gitlab', label: 'gitlab' },
    ]);
  });
});

describe('runMenuItems', () => {
  const app = {
    s: { overview: { providers: [providerView(providerFor('woodpecker')), providerView(providerFor('github'))] } },
  } as unknown as App;
  const wpRun = (over: Partial<Run> = {}): Run =>
    run({ provider: 'woodpecker', repo: 'woodpecker:ci.codeberg.org/alicia/pixelflare', status: 'waiting', conclusion: null, ...over });

  test('a waiting run on an approving provider offers approve and decline', () => {
    const items = runMenuItems(app, wpRun());
    const ids = items.map((item) => ('id' in item ? item.id : null));
    expect(ids).toContain('approve');
    const decline = items.find((item) => 'id' in item && item.id === 'decline');
    expect(decline && 'destructive' in decline && decline.destructive).toBe(true);
    const approve = items.find((item) => 'id' in item && item.id === 'approve');
    expect(approve && 'destructive' in approve && approve.destructive).toBeFalsy();
  });

  test('a run that is not waiting gets no approve items', () => {
    const items = runMenuItems(app, wpRun({ status: 'completed', conclusion: 'success' }));
    expect(items.some((item) => 'id' in item && item.id === 'approve')).toBe(false);
  });

  test('a provider without approvals never offers them', () => {
    const items = runMenuItems(app, run({ status: 'waiting', conclusion: null }));
    expect(items.some((item) => 'id' in item && item.id === 'approve')).toBe(false);
  });
});

describe('variables field', () => {
  test('parses a JSON object string into rows, keeping empty values', () => {
    expect(parseVariablesField('{"x":"1","empty":""}')).toEqual([
      { key: 'x', value: '1' },
      { key: 'empty', value: '' },
    ]);
  });

  test('anything that is not an object parses to no rows', () => {
    expect(parseVariablesField('')).toEqual([]);
    expect(parseVariablesField('{"x"')).toEqual([]);
    expect(parseVariablesField('[1]')).toEqual([]);
    expect(parseVariablesField('null')).toEqual([]);
  });

  test('serializes rows back, keeping a draft row with an empty key', () => {
    // An empty-key row is the freshly added "+ Variable" draft: dropping it
    // on serialize made the row vanish on the next render.
    expect(serializeVariablesField([{ key: '', value: 'v' }, { key: 'a', value: 'b' }, { key: 'b', value: '' }])).toBe(
      '{"":"v","a":"b","b":""}',
    );
    expect(serializeVariablesField([])).toBe('');
    expect(parseVariablesField('{"":"v","a":"b"}')).toEqual([
      { key: '', value: 'v' },
      { key: 'a', value: 'b' },
    ]);
  });
});

describe('onRunMenu approve and decline', () => {
  test('the menu items reach askAction instead of a silent no-op', async () => {
    const asked: Array<[unknown, string]> = [];
    const app = { askAction: (run: unknown, kind: string) => void asked.push([run, kind]) } as unknown as Parameters<typeof onRunMenu>[0];
    const run = { id: '1', status: 'waiting' } as unknown as Parameters<typeof onRunMenu>[1];
    onRunMenu(app, run, 'approve');
    onRunMenu(app, run, 'decline');
    expect(asked).toEqual([[run, 'approve'], [run, 'decline']]);
  });
});

describe('loadMore', () => {
  test('a failed page retries on the next explicit load', async () => {
    const row = {
      kind: 'more',
      key: 'w:github:github.com/acme/app:10',
      repo: 'github:github.com/acme/app',
      workflowId: '10',
      loading: false,
      error: 'boom',
    } as const;
    const { app, s } = makeApp({ providers: [], repos: [], current: null, accounts: [] });
    let calls = 0;
    (app as { svc: unknown }).svc = async () => {
      calls++;
      return { runs: [], hasMore: false };
    };
    s.history.set(row.key, { runs: [], page: 1, hasMore: true, loading: false, error: 'boom' });
    await loadMore(app, row);
    expect(calls).toBe(1);
    expect(s.history.get(row.key)?.error).toBeNull();
  });
});

describe('boardRows', () => {
  const repo = (name: string, runs: Run[], error: string | null = null): OverviewRepo =>
    ({
      key: `github:github.com/acme/${name}`,
      provider: 'github',
      name: `acme/${name}`,
      webUrl: 'https://github.com/acme/app',
      ciUrl: 'https://github.com/acme/app',
      project: null,
      defaultBranch: 'main',
      currentBranch: null,
      polledAt: null,
      error,
      runs,
    }) as unknown as OverviewRepo;

  test('failures come first, then running, then by recency, repos without runs last', () => {
    const failedOld = repo('old', [run({ id: '5', number: 5, createdAt: 100, finishedAt: 100 })]);
    const idleRecent = repo('recent', [run({ id: '6', number: 6, conclusion: 'success', createdAt: 600, finishedAt: 600 })]);
    const active = repo('active', [run({ id: '7', number: 7, status: 'in_progress', conclusion: null, createdAt: 300, finishedAt: null })]);
    const failedNew = repo('new', [run({ id: '8', number: 8, createdAt: 400, finishedAt: 400 })]);
    const none = repo('none', []);
    const rows = boardRows([idleRecent, none, failedOld, active, failedNew]);
    expect(rows.map((row) => row.repo.name)).toEqual(['acme/new', 'acme/old', 'acme/active', 'acme/recent', 'acme/none']);
    expect(rows[0]?.state).toBe('failed');
    expect(rows[2]?.state).toBe('active');
    expect(rows[3]?.state).toBe('idle');
  });

  test('a repo with an error and no runs sits last as none', () => {
    const errored = repo('broken', [], 'no token');
    const fine = repo('fine', [run({ id: '1', conclusion: 'success', createdAt: 10, finishedAt: 10 })]);
    const rows = boardRows([errored, fine]);
    expect(rows.map((row) => row.repo.name)).toEqual(['acme/fine', 'acme/broken']);
    expect(rows.at(-1)?.state).toBe('none');
  });
});

describe('filterBoardRows', () => {
  test('filters by provider and status, empty when nothing matches', () => {
    const failed = repo('github:github.com/acme/app', [run({ id: '1', createdAt: 100, finishedAt: 100 })]);
    const active = repo('github:github.com/acme/lib', [run({ id: '2', status: 'in_progress', conclusion: null, createdAt: 200 })]);
    const idle = repo('github:github.com/acme/web', [run({ id: '3', conclusion: 'success', createdAt: 300, finishedAt: 300 })]);
    const rows = boardRows([failed, active, idle]);
    expect(filterBoardRows(rows, '', 'all').length).toBe(3);
    expect(filterBoardRows(rows, '', 'failed').map((row) => row.repo.name)).toEqual(['acme/app']);
    expect(filterBoardRows(rows, '', 'running').map((row) => row.repo.name)).toEqual(['acme/lib']);
    expect(filterBoardRows(rows, 'gitlab', 'all')).toEqual([]);
  });
});

describe('boardProviders', () => {
  test('present providers in order, the selected one kept even when gone', () => {
    const repos = [repo('github:github.com/acme/app', []), repo('github:github.com/acme/lib', [])];
    const labels = [
      { id: 'github', label: 'GitHub' },
      { id: 'gitlab', label: 'GitLab' },
    ];
    expect(boardProviders(repos, '', labels)).toEqual([{ id: 'github', label: 'GitHub' }]);
    expect(boardProviders(repos, 'gitlab', labels)).toEqual([
      { id: 'github', label: 'GitHub' },
      { id: 'gitlab', label: 'GitLab' },
    ]);
    expect(boardProviders(repos, 'gitea', [])).toEqual([
      { id: 'github', label: 'github' },
      { id: 'gitea', label: 'gitea' },
    ]);
  });
});

describe('loadOverview board repaint', () => {
  test('a loaded overview repaints an open board', async () => {
    const failing = repo('github:github.com/acme/app', [run()]);
    const { app, s } = makeApp({ providers: [], repos: [failing], current: null, accounts: [] });
    s.view = { kind: 'board' } as AppState['view'];
    const painted: string[] = [];
    (app as unknown as { renderSide: () => void }).renderSide = () => painted.push('side');
    await loadOverview(app);
    expect(s.overview).toBeInstanceOf(Object);
    expect(painted).toEqual(['side']);
  });
});

describe('tabChange', () => {
  const makeTabApp = (viewKind: 'list' | 'board') => {
    const shown: unknown[] = [];
    const painted: string[] = [];
    const app = {
      s: {
        view: { kind: viewKind },
        filter: 'attention',
        expanded: new Set<string>(),
        overview: null,
        scope: SCOPE_MINE,
        actor: '',
        service: '',
      },
      show: (next: unknown) => shown.push(next),
      renderNotes: () => painted.push('notes'),
      renderTree: () => painted.push('tree'),
    } as unknown as App;
    return { app, shown, painted };
  };

  test('the board tab opens the board and repaints the strip', () => {
    const { app, shown } = makeTabApp('list');
    const updated: string[] = [];
    tabChange(app, (id) => updated.push(id), 'board');
    expect(shown).toEqual([{ kind: 'board' }]);
    expect(updated).toEqual(['board']);
    expect(app.s.filter).toBe('attention');
  });

  test('a filter tab leaves an open board for the list', () => {
    const { app, shown } = makeTabApp('board');
    const updated: string[] = [];
    tabChange(app, (id) => updated.push(id), 'failed');
    expect(app.s.filter).toBe('failed');
    expect(shown).toEqual([{ kind: 'list' }]);
    expect(updated).toEqual(['failed']);
  });

  test('a filter tab keeps the list view', () => {
    const { app, shown, painted } = makeTabApp('list');
    const updated: string[] = [];
    tabChange(app, (id) => updated.push(id), 'failed');
    expect(shown).toEqual([]);
    expect(updated).toEqual(['failed']);
    expect(painted).toContain('tree');
  });
});
