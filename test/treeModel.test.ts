import { describe, expect, test } from 'bun:test';
import type { Run } from '../src/domain/types.ts';
import type { OverviewRepo } from '../src/service/engine.ts';
import {
  buildRows,
  counts,
  offsets,
  projectFor,
  projectKey,
  ROW_HEIGHT,
  SCOPE_ALL,
  SCOPE_MINE,
  windowFor,
  workflowKey,
  type BuildInput,
  type HistoryState,
  type ProjectRow,
  type TreeRow,
} from '../src/ui/treeModel.ts';

const keyOf = (name: string) => `github:github.com/${name}`;

let nextId = 1;
const run = (over: Partial<Run> = {}): Run => ({
  id: String(nextId++),
  provider: 'github',
  repo: keyOf('acme/app'),
  number: nextId,
  workflow: 'CI',
  workflowId: '10',
  branch: 'main',
  sha: 'abc',
  title: 'commit',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'success',
  createdAt: 1000 + nextId,
  startedAt: 1000,
  finishedAt: 2000,
  actor: 'ann',
  url: 'https://github.com/acme/app/actions/runs/1',
  commitUrl: null,
  ...over,
});

const repo = (fullName: string, runs: Run[], over: Partial<OverviewRepo> = {}): OverviewRepo => ({
  key: keyOf(fullName),
  provider: 'github',
  name: fullName,
  webUrl: `https://github.com/${fullName}`,
  ciUrl: `https://github.com/${fullName}/actions`,
  project: { id: fullName, name: fullName.split('/')[1]!, directory: `/p/${fullName}` },
  defaultBranch: 'main',
  currentBranch: null,
  polledAt: 1,
  error: null,
  runs,
  ...over,
});

const input = (repos: OverviewRepo[], over: Partial<BuildInput> = {}): BuildInput => ({
  repos,
  current: null,
  filter: 'all',
  scope: SCOPE_MINE,
  actor: '',
  query: '',
  expanded: new Set(repos.map((r) => projectKey(r.key))),
  toggled: new Set(),
  history: new Map(),
  paging: () => true,
  label: () => 'GitHub',
  ...over,
});

const kinds = (rows: TreeRow[]) => rows.map((row) => row.kind);

describe('tree model', () => {
  test('a workflow takes the colour of its newest run in scope', () => {
    const old = run({ conclusion: 'success', createdAt: 100 });
    const broke = run({ conclusion: 'failure', createdAt: 200 });
    const elsewhere = run({ conclusion: 'success', createdAt: 300, branch: 'feature' });
    // A second workflow keeps the workflow level in the tree.
    const other = run({ workflowId: '99', workflow: 'Other', createdAt: 50 });
    const rows = buildRows(input([repo('acme/app', [old, broke, elsewhere, other])]));
    const workflow = rows.find((row) => row.kind === 'workflow');
    expect(workflow?.kind === 'workflow' && workflow.latest.id).toBe(broke.id);
    const all = buildRows(input([repo('acme/app', [old, broke, elsewhere, other])], { scope: SCOPE_ALL }));
    const any = all.find((row) => row.kind === 'workflow');
    expect(any?.kind === 'workflow' && any.latest.id).toBe(elsewhere.id);
  });

  test('the failed filter hides green workflows and leaves a line on the project', () => {
    const green = repo('acme/app', [run({ workflowId: '1', workflow: 'Lint' })]);
    const red = repo('acme/lib', [
      run({ repo: keyOf('acme/lib'), workflowId: '2', workflow: 'Test', conclusion: 'failure' }),
      run({ repo: keyOf('acme/lib'), workflowId: '3', workflow: 'Nightly', createdAt: 50 }),
    ]);
    const rows = buildRows(input([green, red], { filter: 'failed' }));
    expect(rows.filter((row) => row.kind === 'workflow').map((row) => (row as { name: string }).name)).toEqual(['Test']);
    const note = rows.find((row) => row.kind === 'note');
    expect(note?.kind === 'note' && note.text).toBe('Nothing needs attention here.');
    // Broken projects come first.
    expect(rows[0]?.kind === 'project' && rows[0].repo).toBe(keyOf('acme/lib'));
  });

  test('a failed run carries its successful same-commit twin', () => {
    const broke = run({ conclusion: 'failure', sha: 'deadbeef', workflowId: '10' });
    const passed = run({ conclusion: 'success', sha: 'deadbeef', workflowId: '10' });
    const rows = buildRows(input([repo('acme/app', [broke, passed])]));
    const row = rows.find((candidate) => candidate.kind === 'run' && candidate.run.id === broke.id);
    expect(row?.kind === 'run' && row.twin?.id).toBe(passed.id);
    const greenRow = rows.find((candidate) => candidate.kind === 'run' && candidate.run.id === passed.id);
    expect(greenRow?.kind === 'run' && greenRow.twin).toBeNull();
  });

  test('a merge request pipeline stays in scope:mine without a branch of its own', () => {
    const mr = run({
      branch: 'refs/merge-requests/30879/head',
      event: 'merge_request_event',
      conclusion: 'failure',
      createdAt: 400,
    });
    const elsewhere = run({ conclusion: 'success', createdAt: 300, branch: 'feature' });
    const rows = buildRows(input([repo('acme/app', [mr, elsewhere])]));
    const runs = rows.filter((row) => row.kind === 'run');
    expect(runs.map((row) => row.kind === 'run' && row.run.id)).toEqual([mr.id]);
  });

  test('a collapsed project has no children', () => {
    const rows = buildRows(input([repo('acme/app', [run()])], { expanded: new Set() }));
    expect(kinds(rows)).toEqual(['project']);
  });

  test('an expanded workflow lists its runs, then older pages, then a load-more row', () => {
    const recent = run({ createdAt: 500 });
    const history: HistoryState = { runs: [recent, run({ createdAt: 50 })], page: 1, hasMore: true, loading: false, error: null };
    const other = run({ workflowId: '20', workflow: 'Nightly', createdAt: 40 });
    const key = workflowKey(keyOf('acme/app'), '10');
    const rows = buildRows(
      input([repo('acme/app', [recent, other])], {
        expanded: new Set([projectKey(keyOf('acme/app')), key]),
        history: new Map([[key, history]]),
      }),
    );
    expect(kinds(rows)).toEqual(['project', 'workflow', 'run', 'run', 'more', 'workflow']);
    const done = buildRows(
      input([repo('acme/app', [recent, other])], {
        expanded: new Set([projectKey(keyOf('acme/app')), key]),
        history: new Map([[key, { ...history, hasMore: false }]]),
      }),
    );
    expect(kinds(done)).toEqual(['project', 'workflow', 'run', 'run', 'workflow']);
  });

  test('the search finds projects and workflows by name', () => {
    const app = repo('acme/app', [run({ workflow: 'Deploy', workflowId: '1' })]);
    const lib = repo('acme/lib', [run({ repo: keyOf('acme/lib'), workflow: 'Lint', workflowId: '2' })]);
    const byProject = buildRows(input([app, lib], { query: 'lib', expanded: new Set() }));
    expect(byProject.map((row) => row.kind === 'project' && row.repo)).toEqual([keyOf('acme/lib')]);
    // The single matching workflow's runs show directly under the project.
    const byWorkflow = buildRows(input([app, lib], { query: 'deploy', expanded: new Set() }));
    expect(kinds(byWorkflow)).toEqual(['project', 'run', 'more']);
  });

  test('counts follow broken workflows', () => {
    const repos = [
      repo('acme/app', [run({ conclusion: 'failure' }), run({ status: 'in_progress', conclusion: null, workflowId: '2' })]),
      repo('acme/lib', [run({ repo: 'acme/lib' })]),
    ];
    expect(counts(repos, SCOPE_MINE)).toEqual({ failed: 1, running: 1 });
    // Projects stay collapsed until the reader opens them — even broken ones.
    const rows = buildRows(input(repos, { expanded: new Set() }));
    expect(kinds(rows)).toEqual(['project', 'project']);
  });

  test('the window finds the visible slice of a long list', () => {
    const rows: TreeRow[] = Array.from({ length: 10_000 }, (_, i) => ({ kind: 'run', key: String(i), run: run(), twin: null }));
    const tops = offsets(rows);
    expect(tops[10_000]).toBe(10_000 * ROW_HEIGHT.run);
    const at = 5000 * ROW_HEIGHT.run + 10;
    expect(windowFor(tops, at, 440, 5)).toEqual({ start: 4995, end: 5016 });
    expect(windowFor(tops, 0, 440, 5)).toEqual({ start: 0, end: 16 });
    expect(windowFor(offsets([]), 0, 440, 5)).toEqual({ start: 0, end: 0 });
  });

  test('history paging follows the data, not the id shape', () => {
    // A single workflow shows its runs directly under the project.
    const unnamed = repo('acme/app', [run({ workflowId: '', workflow: 'CI' })]);
    const rows = buildRows(input([unnamed], { paging: () => true }));
    expect(kinds(rows)).toEqual(['project', 'run']);
    const flat = repo('acme/app', [run({ workflowId: '123' })]);
    const rows2 = buildRows(input([flat], { paging: () => false }));
    expect(kinds(rows2)).toEqual(['project', 'run']);
    const named = repo('acme/app', [run({ workflowId: 'build.yml' })]);
    const rows3 = buildRows(input([named]));
    expect(kinds(rows3)).toEqual(['project', 'run', 'more']);
  });

  test('a single-workflow repository shows its runs directly', () => {
    const first = run({ createdAt: 300 });
    const second = run({ createdAt: 200 });
    const rows = buildRows(input([repo('acme/app', [first, second])]));
    expect(kinds(rows)).toEqual(['project', 'run', 'run', 'more']);
    expect(rows[1]?.kind === 'run' && rows[1].run.id).toBe(first.id);
    const noPaging = buildRows(input([repo('acme/app', [first, second])], { paging: () => false }));
    expect(kinds(noPaging)).toEqual(['project', 'run', 'run']);
    // A second workflow brings the level back.
    const two = buildRows(
      input([repo('acme/app', [first, second, run({ workflowId: '20', workflow: 'Deploy', createdAt: 100 })])]),
    );
    expect(kinds(two)).toEqual(['project', 'workflow', 'workflow']);
  });

  test('one visible workflow among several opens on its own', () => {
    const broke = run({ workflowId: '10', conclusion: 'failure', createdAt: 200 });
    const green = run({ workflowId: '20', createdAt: 100 });
    const rows = buildRows(input([repo('acme/app', [broke, green])], { filter: 'failed' }));
    expect(kinds(rows)).toEqual(['project', 'workflow', 'run', 'more']);
    // A workflow the reader has toggled keeps their choice.
    const wKey = workflowKey(keyOf('acme/app'), '10');
    const chosen = buildRows(
      input([repo('acme/app', [broke, green])], { filter: 'failed', toggled: new Set([wKey]) }),
    );
    const closed = chosen.find((row) => row.kind === 'workflow');
    expect(closed?.kind === 'workflow' && closed.expanded).toBe(false);
    expect(kinds(chosen)).toEqual(['project', 'workflow']);
  });

  test('keys with nested paths and ports group by repository', () => {
    expect(projectKey('github:ghe.acme.io:8443/acme/app')).toBe(projectKey('github:GHE.acme.io:8443/acme/app'));
    expect(projectKey('github:ghe.acme.io:8443/Acme/App')).toBe(projectKey('github:ghe.acme.io:8443/acme/app'));
  });

  test('a repository not read yet names its provider', () => {
    const fresh = repo('acme/app', [], { polledAt: null });
    const rows = buildRows(input([fresh], { label: () => 'Forge' }));
    const note = rows.find((row) => row.kind === 'note');
    expect(note?.kind === 'note' && note.text).toBe('Checking Forge…');
  });

  test('the sticky header is the nearest project above', () => {
    const rows = buildRows(input([repo('acme/app', [run(), run({ workflowId: '2' })])]));
    expect(projectFor(rows, rows.length - 1)).toBe(0);
  });

  test('a service filter cuts the projects by provider', () => {
    const gh = repo('acme/app', [run({ conclusion: 'failure' }), run({ status: 'in_progress', conclusion: null, workflowId: '2' })]);
    const gl = repo('guru/e8', [run({ repo: 'gitlab:gitlab.gurunetwork.ai/guru/e8', provider: 'gitlab', url: 'https://gitlab.gurunetwork.ai/guru/e8/-/pipelines/1' })], {
      key: 'gitlab:gitlab.gurunetwork.ai/guru/e8',
      provider: 'gitlab',
      webUrl: 'https://gitlab.gurunetwork.ai/guru/e8',
      ciUrl: 'https://gitlab.gurunetwork.ai/guru/e8/-/pipelines',
      project: { id: 'e8', name: 'e8', directory: '/p/e8' },
    });
    const repos = [gh, gl];
    const projects = (rows: TreeRow[]) => rows.filter((row): row is ProjectRow => row.kind === 'project').map((row) => row.key);
    expect(projects(buildRows(input(repos, { service: 'gitlab' })))).toEqual([projectKey(gl.key)]);
    expect(projects(buildRows(input(repos, { service: 'github' })))).toEqual([projectKey(gh.key)]);
    expect(projects(buildRows(input(repos)))).toEqual([projectKey(gh.key), projectKey(gl.key)]);
    // A stale service id (its repo is gone) empties the tree without throwing.
    expect(buildRows(input(repos, { service: 'github:gitlab.com' }))).toEqual([]);
    expect(counts(repos, SCOPE_MINE, '', 'gitlab')).toEqual({ failed: 0, running: 0 });
    expect(counts(repos, SCOPE_MINE, '', 'github')).toEqual({ failed: 1, running: 1 });
  });
});

test('a workflow row carries the trend of its finished runs', () => {
  const base = repo('acme/app', [
    run({ id: 'r2', number: 2, createdAt: 2_100_000, startedAt: 2_000_000, finishedAt: 2_000_000 + 180_000 }),
    run({ id: 'r1', number: 1, createdAt: 1_100_000, startedAt: 1_000_000, finishedAt: 1_000_000 + 60_000 }),
    run({ id: 'r3', number: 3, status: 'in_progress' as const, conclusion: null, finishedAt: null, startedAt: 3_000_000 }),
    run({ id: 'r4', number: 4, workflow: 'Lint', workflowId: '20' }),
  ]);
  const rows = buildRows(input([base]));
  const wf = rows.find((row) => row.kind === 'workflow' && row.workflowId === '10') as Extract<TreeRow, { kind: 'workflow' }>;
  expect(wf.trend).toEqual([60_000, 180_000]);
});
