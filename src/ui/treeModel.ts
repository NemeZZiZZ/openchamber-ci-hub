/**
 * The run tree as flat rows: project → workflow → runs. A repository whose
 * scope leaves a single workflow shows that workflow's runs directly, and a
 * lone visible workflow opens on its own. Pure, so the virtual list only has
 * to place fixed-height rows and the rules about what shows can be tested
 * without a DOM.
 */
import { flakyTwin, isActive, isFailed, runDuration } from '../domain/format.ts';
import { repoKeyId, repoLabel, repoOwner, type RepoKey } from '../domain/repoKey.ts';
import type { Run } from '../domain/types.ts';
import type { OverviewRepo } from '../service/engine.ts';

export type TreeFilter = 'attention' | 'failed' | 'in_progress' | 'all';

/** `scope:mine` = default branch + the folder's branch, `scope:all`, or `branch:<name>`. */
export type Scope = string;
export const SCOPE_MINE = 'scope:mine';
export const SCOPE_ALL = 'scope:all';
export const BRANCH_PREFIX = 'branch:';
export const scopeBranch = (scope: Scope): string | null =>
  scope.startsWith(BRANCH_PREFIX) ? scope.slice(BRANCH_PREFIX.length) : null;

export interface HistoryState {
  runs: Run[];
  /** The last page fetched; 0 before the first. */
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

export interface ProjectRow {
  kind: 'project';
  key: string;
  repo: string;
  name: string;
  owner: string;
  folder: string | null;
  expanded: boolean;
  failed: number;
  running: number;
  total: number;
  error: string | null;
}

export interface WorkflowRow {
  kind: 'workflow';
  key: string;
  repo: string;
  workflowId: string;
  name: string;
  latest: Run;
  expanded: boolean;
  /** Durations of the last finished runs, oldest first — the sparkline data. */
  trend: number[];
}

export interface RunRow {
  kind: 'run';
  key: string;
  run: Run;
  /** The same-commit sibling run that passed, when this one flaked. */
  twin: Run | null;
}

export interface MoreRow {
  kind: 'more';
  key: string;
  repo: string;
  workflowId: string;
  loading: boolean;
  error: string | null;
}

export interface NoteRow {
  kind: 'note';
  key: string;
  text: string;
}

export type TreeRow = ProjectRow | WorkflowRow | RunRow | MoreRow | NoteRow;

export const ROW_HEIGHT: Record<TreeRow['kind'], number> = {
  project: 36,
  workflow: 34,
  run: 44,
  more: 32,
  note: 32,
};

export const projectKey = (repo: RepoKey): string => `p:${repoKeyId(repo)}`;
export const workflowKey = (repo: RepoKey, workflowId: string): string => `w:${repoKeyId(repo)}:${workflowId}`;

const workflowIdOf = (run: Run): string => run.workflowId || run.workflow;

/** The branches a repository's runs are kept to, or null for every branch. */
export const scopeBranches = (repo: OverviewRepo, scope: Scope): string[] | null => {
  if (scope === SCOPE_ALL) return null;
  const one = scopeBranch(scope);
  if (one !== null) return [one];
  const mine = [repo.defaultBranch, repo.currentBranch].filter((b): b is string => !!b);
  return mine.length ? [...new Set(mine)] : null;
};

export const inScope = (run: Run, branches: string[] | null, actor: string): boolean =>
  // A merge request pipeline runs on a pseudo-ref like
  // `refs/merge-requests/7/head`, never on a branch, so no branch filter can
  // catch it: it stays visible wherever branches are narrowed.
  (!branches || branches.includes(run.branch) || run.event === 'merge_request_event') &&
  (!actor || run.actor === actor);

interface WorkflowGroup {
  id: string;
  name: string;
  runs: Run[];
}

const byNewest = (a: Run, b: Run) => b.createdAt - a.createdAt;

const groupWorkflows = (runs: Run[]): WorkflowGroup[] => {
  const groups = new Map<string, WorkflowGroup>();
  for (const run of [...runs].sort(byNewest)) {
    const id = workflowIdOf(run);
    const group = groups.get(id) ?? { id, name: run.workflow, runs: [] };
    group.runs.push(run);
    groups.set(id, group);
  }
  return [...groups.values()];
};

/** A workflow is still broken when its newest run failed. */
const workflowFailed = (group: WorkflowGroup) => !!group.runs[0] && isFailed(group.runs[0]);
const workflowRunning = (group: WorkflowGroup) => group.runs.some(isActive);

const workflowMatches = (group: WorkflowGroup, filter: TreeFilter): boolean => {
  switch (filter) {
    case 'all':
      return group.runs.length > 0;
    case 'failed':
      return workflowFailed(group);
    case 'in_progress':
      return workflowRunning(group);
    case 'attention':
      return workflowFailed(group) || workflowRunning(group);
  }
};

const scopedGroups = (repo: OverviewRepo, scope: Scope, actor: string): WorkflowGroup[] => {
  const branches = scopeBranches(repo, scope);
  return groupWorkflows(repo.runs.filter((run) => inScope(run, branches, actor)));
};

const repoCounts = (groups: WorkflowGroup[]) => ({
  failed: groups.filter(workflowFailed).length,
  running: groups.reduce((sum, group) => sum + group.runs.filter(isActive).length, 0),
});

/** Broken workflows and active runs across every repository, in scope. */
export const counts = (repos: OverviewRepo[], scope: Scope, actor = '', service = ''): { failed: number; running: number } => {
  let failed = 0;
  let running = 0;
  const inService = service ? repos.filter((repo) => repo.provider === service) : repos;
  for (const repo of inService) {
    const c = repoCounts(scopedGroups(repo, scope, actor));
    failed += c.failed;
    running += c.running;
  }
  return { failed, running };
};

const projectName = (repo: OverviewRepo) => repo.project?.name || repoLabel(repo.key);

/** The folder's repository first, then broken ones, then running ones, then by latest activity. */
const orderRepos = (repos: OverviewRepo[], scope: Scope, actor: string, current: string | null) => {
  const rank = (repo: OverviewRepo) => {
    const c = repoCounts(scopedGroups(repo, scope, actor));
    if (current && repoKeyId(repo.key) === repoKeyId(current)) return 0;
    if (c.failed) return 1;
    if (c.running) return 2;
    return 3;
  };
  const newest = (repo: OverviewRepo) => repo.runs.reduce((max, run) => Math.max(max, run.createdAt), 0);
  return [...repos].sort(
    (a, b) => rank(a) - rank(b) || newest(b) - newest(a) || projectName(a).localeCompare(projectName(b)),
  );
};

export interface BuildInput {
  repos: OverviewRepo[];
  current: string | null;
  filter: TreeFilter;
  scope: Scope;
  actor: string;
  /** `''` or omitted keeps every provider; a `ProviderId` keeps only its repositories. */
  service?: string;
  query: string;
  expanded: Set<string>;
  /** Workflow rows the reader has opened or closed themselves; their choice beats the lone-workflow default. */
  toggled: Set<string>;
  history: Map<string, HistoryState>;
  /** Whether the repository's provider pages a workflow's older runs. */
  paging: (repo: RepoKey) => boolean;
  /** The provider's name, for the line shown before the first read. */
  label: (repo: RepoKey) => string;
}

const mergeRuns = (first: Run[], more: Run[]): Run[] => {
  const seen = new Set(first.map((run) => run.id));
  const merged = [...first];
  for (const run of more) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    merged.push(run);
  }
  return merged.sort(byNewest);
};

export const buildRows = (input: BuildInput): TreeRow[] => {
  const query = input.query.trim().toLowerCase();
  const rows: TreeRow[] = [];
  const service = input.service ?? '';
  const repos = service ? input.repos.filter((repo) => repo.provider === service) : input.repos;
  for (const repo of orderRepos(repos, input.scope, input.actor, input.current)) {
    const name = projectName(repo);
    const repoHit = !query || name.toLowerCase().includes(query) || repo.name.toLowerCase().includes(query);
    const groups = scopedGroups(repo, input.scope, input.actor);
    const named = repoHit ? groups : groups.filter((group) => group.name.toLowerCase().includes(query));
    if (!repoHit && !named.length) continue;

    const key = projectKey(repo.key);
    const expanded = input.expanded.has(key) || (!!query && !repoHit);
    const c = repoCounts(groups);
    rows.push({
      kind: 'project',
      key,
      repo: repo.key,
      name,
      owner: repoOwner(repo.key),
      folder: repo.project?.directory ?? null,
      expanded,
      failed: c.failed,
      running: c.running,
      total: groups.length,
      error: repo.error,
    });
    if (!expanded) continue;

    const visible = named.filter((group) => workflowMatches(group, input.filter));
    if (!visible.length) {
      const text = repo.error
        ? repo.error
        : repo.polledAt === null
          ? `Checking ${input.label(repo.key)}…`
          : !repo.runs.length
            ? 'No runs yet.'
            : !groups.length
              ? 'No runs on these branches.'
              : input.filter === 'all'
                ? 'Nothing matches.'
                : 'Nothing needs attention here.';
      rows.push({ kind: 'note', key: `${key}:note`, text });
      continue;
    }

    const branches = scopeBranches(repo, input.scope);
    const runsFor = (group: WorkflowGroup) => {
      const history = input.history.get(workflowKey(repo.key, group.id));
      const older = (history?.runs ?? []).filter((run) => inScope(run, branches, input.actor));
      return mergeRuns(group.runs, older);
    };
    const runsOf = (group: WorkflowGroup) => {
      const wKey = workflowKey(repo.key, group.id);
      const history = input.history.get(wKey);
      const list = runsFor(group);
      for (const run of list) rows.push({ kind: 'run', key: `r:${run.repo}:${run.id}`, run, twin: flakyTwin(run, list) });
      // Only a real workflow id pages; a run without one is all we know.
      const pages = !!group.runs[0]?.workflowId && input.paging(repo.key);
      if (pages && (!history || history.hasMore)) {
        rows.push({
          kind: 'more',
          key: `${wKey}:more`,
          repo: repo.key,
          workflowId: group.id,
          loading: history?.loading ?? false,
          error: history?.error ?? null,
        });
      }
    };

    // One workflow in scope: its row would only repeat the project's, so its
    // runs (and its "more") hang directly under the project.
    if (groups.length === 1 && visible.length === 1) {
      runsOf(visible[0]!);
      continue;
    }

    for (const group of visible) {
      const wKey = workflowKey(repo.key, group.id);
      // A lone visible workflow opens on its own — unless the reader toggled it.
      const open = input.expanded.has(wKey) || (visible.length === 1 && !input.toggled.has(wKey));
      const trend = runsFor(group)
        .filter((run) => run.finishedAt !== null)
        .slice(0, 20)
        .map((run) => runDuration(run))
        .filter((value): value is number => value !== null)
        .reverse();
      rows.push({
        kind: 'workflow',
        key: wKey,
        repo: repo.key,
        workflowId: group.id,
        name: group.name,
        latest: group.runs[0]!,
        expanded: open,
        trend,
      });
      if (!open) continue;
      runsOf(group);
    }
  }
  return rows;
};

/** offsets[i] is the top of row i; offsets[rows.length] is the total height. */
export const offsets = (rows: TreeRow[]): number[] => {
  const out = new Array<number>(rows.length + 1);
  out[0] = 0;
  for (let i = 0; i < rows.length; i++) out[i + 1] = out[i]! + ROW_HEIGHT[rows[i]!.kind];
  return out;
};

/** The row under a vertical position. */
export const rowAt = (tops: number[], y: number): number => {
  const count = tops.length - 1;
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Rows to put in the DOM for a viewport, `buffer` rows either side. `end` is exclusive. */
export const windowFor = (tops: number[], scrollTop: number, height: number, buffer: number) => {
  const count = tops.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const first = rowAt(tops, Math.max(0, scrollTop));
  const last = rowAt(tops, Math.max(0, scrollTop + height));
  return { start: Math.max(0, first - buffer), end: Math.min(count, last + 1 + buffer) };
};

/** The project row that owns row `index`, for the sticky header. */
export const projectFor = (rows: TreeRow[], index: number): number => {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i--) if (rows[i]!.kind === 'project') return i;
  return -1;
};
