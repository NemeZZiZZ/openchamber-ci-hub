// What the panel knows: the overview of every project, the settings view's
// state, and older runs of a workflow paged in on demand.

import type { GuestProjectsSnapshot } from '@openchamber/sdk';
import type { OverviewRepo, OverviewView, StateView, WorkflowRunsView } from '../../service/engine.ts';
import { errorText } from '../port.ts';
import { counts, inScope, projectKey, scopeBranch, scopeBranches, workflowKey, type MoreRow } from '../treeModel.ts';
import type { App } from './state.ts';
import { restoreCachedOverview, saveCachedOverview } from './overviewCache.ts';

export const repoView = (app: App, name: string | null): OverviewRepo | null =>
  (name && app.s.overview?.repos.find((entry) => entry.key.toLowerCase() === name.toLowerCase())) || null;

/** The repository the ⋯ menu acts on: the open run's, else the folder's, else the first one. */
export const contextRepo = (app: App): string | null =>
  app.s.detail?.repo ?? app.s.overview?.current ?? app.s.overview?.repos[0]?.key ?? null;

const expandedRepos = (app: App): string[] =>
  (app.s.overview?.repos ?? []).filter((entry) => app.s.expanded.has(projectKey(entry.key))).map((entry) => entry.key);

let overviewSeq = 0;
export const loadOverview = async (app: App, quiet = false) => {
  const s = app.s;
  const seq = ++overviewSeq;
  if (!quiet) {
    s.overviewLoading = true;
    app.renderNotes();
  }
  try {
    const next = await app.svc<OverviewView>({
      method: 'POST',
      path: '/overview',
      body: {
        directory: s.directory,
        projects: s.projects.map((project) => ({ id: project.id, name: project.name, directory: project.directory })),
        expanded: expandedRepos(app),
      },
    });
    if (seq !== overviewSeq) return;
    s.overview = next;
    s.overviewError = null;
    void saveCachedOverview(app);
  } catch (err) {
    if (seq !== overviewSeq) return;
    s.overviewError = err instanceof Error ? err : new Error(errorText(err));
  }
  s.overviewLoading = false;
  app.syncBar();
  app.renderNotes();
  app.renderTree();
  app.updateBadge();
  // The board is the one side view fed by the overview itself; it has no own
  // loader that would repaint it, so a fresh overview must.
  if (s.view.kind === 'board') app.renderSide();
};

export const loadState = async (app: App) => {
  try {
    app.s.state = await app.svc<StateView>({ path: '/state', query: { directory: app.s.directory } });
  } catch (err) {
    app.toast('error', errorText(err));
  }
};

export const updateBadge = (app: App) => {
  const s = app.s;
  const n = s.overview ? counts(s.overview.repos, s.scope, s.actor, s.service).failed : 0;
  void app.host.setBadge(n > 0 ? n : null).catch(() => undefined);
};

export const refreshAll = async (app: App) => {
  await app.loadOverview();
  if (app.s.view.kind === 'repos') await app.loadState();
  if (app.s.detail) await app.loadDetail(true);
};

export const applyProjects = (app: App, snapshot: GuestProjectsSnapshot) => {
  const s = app.s;
  const next = snapshot.state === 'ready' ? snapshot.projects : s.projects;
  const sig = JSON.stringify(next.map((project) => [project.id, project.name, project.directory]));
  if (snapshot.state === 'ready' && sig === s.projectsSig && s.overview) return;
  s.projectsSig = sig;
  s.projects = next;
  if (snapshot.state === 'loading' && s.overview) return;
  void app.loadOverview(s.overview !== null);
};

/** Older runs of one workflow, a page at a time, when its "more" row comes into view. */
export const loadMore = async (app: App, row: MoreRow, clicked: boolean) => {
  const s = app.s;
  const key = workflowKey(row.repo, row.workflowId);
  const prev = s.history.get(key) ?? { runs: [], page: 0, hasMore: true, loading: false, error: null };
  if (prev.loading || !prev.hasMore) return;
  if (!clicked && (prev.error || (s.idlePages.get(key) ?? 0) >= 2)) return;
  const gen = s.historyGen;
  s.history.set(key, { ...prev, loading: true, error: null });
  app.renderTree();
  try {
    const page = prev.page + 1;
    const data = await app.svc<WorkflowRunsView>({
      path: '/workflow-runs',
      query: { repo: row.repo, workflow: row.workflowId, branch: scopeBranch(s.scope), actor: s.actor || null, page: String(page) },
    });
    if (gen !== s.historyGen) return;
    const owner = repoView(app, row.repo);
    const branches = owner ? scopeBranches(owner, s.scope) : null;
    const added = data.runs.filter((run) => inScope(run, branches, s.actor)).length;
    s.idlePages.set(key, added > 0 ? 0 : (s.idlePages.get(key) ?? 0) + 1);
    s.history.set(key, { runs: [...prev.runs, ...data.runs], page, hasMore: data.hasMore, loading: false, error: null });
  } catch (err) {
    if (gen !== s.historyGen) return;
    s.history.set(key, { ...prev, loading: false, error: errorText(err) });
  }
  app.renderTree();
};

/** Scope or actor changed: pages fetched for the old ones no longer apply. */
export const resetHistory = (app: App) => {
  app.s.historyGen++;
  app.s.history.clear();
  app.s.idlePages.clear();
};
