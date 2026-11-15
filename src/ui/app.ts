// The CI Hub panel: every OpenChamber project with a CI remote as a tree
// (project → workflow → runs), and a run detail with jobs, steps, the failing
// log, actions and the hand-off to an agent. The same module draws the
// full-screen page; a wide frame shows tree and detail side by side, a narrow
// one drills down.
//
// The page never polls. The service polls the CI hosts and emits `runs` after each
// poll; the panel refetches on that event, which also tells the service the
// panel is still open.
//
// This file holds the skeleton, the tree, navigation and wiring; each other
// surface lives in `./app/` and reaches the rest through the `App`.

import type { HostClient, HostReadyContext } from '@openchamber/sdk';
import { isActive } from '../domain/format.ts';
import type { Run } from '../domain/types.ts';
import { mountBar } from './app/bar.ts';
import { renderBoard } from './app/board.ts';
import { ask, askAction, sendToAgent } from './app/confirm.ts';
import {
  applyProjects,
  contextRepo,
  loadMore,
  loadOverview,
  loadState,
  refreshAll,
  repoView,
  resetHistory,
  updateBadge,
} from './app/data.ts';
import { loadDetail, loadLog, renderSide } from './app/detail.ts';
import { openDispatch, renderDispatch } from './app/dispatch.ts';
import { renderLog, scrollToFailure } from './app/log.ts';
import { renderNotes } from './app/notes.ts';
import { restoreCachedOverview } from './app/overviewCache.ts';
import { renderRepos } from './app/repos.ts';
import { viewFor } from './app/providers.ts';
import { onRunMenu, runMenuItems } from './app/runMenu.ts';
import { debounce, Region, SMALL_PX, WIDE_PX, type App, type AppState, type View } from './app/state.ts';
import { clear, h } from './dom.ts';
import { createSvc } from './port.ts';
import { CSS } from './styles.ts';
import { mountTree } from './tree.ts';
import { buildRows, SCOPE_MINE } from './treeModel.ts';

export const startApp = (host: HostClient, root: HTMLElement, ctx: HostReadyContext): void => {
  const svc = createSvc(host);
  const style = h('style', null, CSS);
  document.head.append(style);

  const s: AppState = {
    directory: ctx.directory,
    overview: null,
    overviewError: null,
    overviewLoading: false,
    projects: [],
    projectsSig: '',
    state: null,
    filter: 'attention',
    scope: SCOPE_MINE,
    actor: '',
    service: '',
    boardProvider: '',
    boardFilter: 'all',
    query: '',
    expanded: new Set(),
    toggled: new Set(),
    history: new Map(),
    idlePages: new Map(),
    historyGen: 0,
    view: { kind: 'list' },
    detail: null,
    confirm: null,
    dispatch: null,
    dispatchRepo: null,
    wide: false,
    size: 'm',
    busy: new Set(),
    addRepoValue: '',
    addRepoForFolder: true,
    addRepoError: null,
    addingRepo: false,
    treeRowCount: 0,
    logRegion: null,
    logBody: null,
  };
  // The dedicated page entry lands on the board; the panel keeps the run tree.
  if (ctx.surface === 'page') s.view = { kind: 'board' };

  // ---- skeleton ---------------------------------------------------------------
  const shell = h('div', { class: 'cih', 'data-wide': 'false', 'data-size': 'm' });
  const confirmRegion = new Region(h('div'));
  const listCol = h('div', { class: 'cih-col cih-col-list' });
  const sideCol = h('div', { class: 'cih-col cih-col-side' });
  const barEl = h('div', { class: 'cih-fbar' });
  const listNotes = new Region(h('div', { class: 'cih-notes' }));
  const side = new Region(h('div', { class: 'cih-scroll cih-detail' }));
  sideCol.append(side.el);
  shell.append(confirmRegion.el, h('div', { class: 'cih-split' }, listCol, sideCol));
  clear(root);
  root.append(shell);

  const sizeOf = (width: number): 's' | 'm' | 'l' => (width < SMALL_PX ? 's' : width < WIDE_PX ? 'm' : 'l');

  const layout = () => {
    shell.dataset.wide = s.wide ? 'true' : 'false';
    shell.dataset.size = s.size;
    const secondary = s.view.kind !== 'list';
    listCol.hidden = !s.wide && secondary;
    sideCol.hidden = !s.wide && !secondary;
  };

  const toast = (kind: 'info' | 'success' | 'error', message: string) => {
    void host.toast({ kind, message: message.slice(0, 500) }).catch(() => undefined);
  };

  // ---- navigation -------------------------------------------------------------
  const show = (next: View) => {
    s.view = next;
    if (next.kind !== 'run') s.detail = null;
    layout();
    renderTree();
    app.renderSide();
  };

  const openRun = (run: Run) => {
    s.detail = {
      repo: run.repo,
      runId: run.id,
      loading: true,
      error: null,
      run,
      jobs: [],
      jobId: null,
      log: null,
      mode: 'focus',
      query: '',
      hit: 0,
      toggled: new Set(),
    };
    s.view = { kind: 'run', repo: run.repo, runId: run.id };
    layout();
    renderTree();
    app.renderSide();
    void app.loadDetail(false);
  };

  const openRepos = () => {
    show({ kind: 'repos' });
    void app.loadState().then(() => {
      if (s.view.kind === 'repos') app.renderSide();
    });
  };

  // ---- tree -------------------------------------------------------------------
  const tree = mountTree({
    onToggle: (key) => {
      const opening = !s.expanded.has(key);
      if (opening) s.expanded.add(key);
      else s.expanded.delete(key);
      // The reader has decided this workflow row; their choice beats the auto-open.
      if (key.startsWith('w:')) s.toggled.add(key);
      renderTree();
      // The service polls open projects more often; tell it which ones are open.
      if (opening && key.startsWith('p:')) void app.loadOverview(true);
    },
    onOpenRun: (run) => openRun(run),
    runMenuItems: (run) => app.runMenuItems(run),
    onRunMenu: (run, id) => app.onRunMenu(run, id),
    onMore: (row, clicked) => void app.loadMore(row, clicked),
  });

  function renderTree() {
    const rows = buildRows({
      repos: s.overview?.repos ?? [],
      current: s.overview?.current ?? null,
      filter: s.filter,
      scope: s.scope,
      actor: s.actor,
      service: s.service,
      query: s.query.trim(),
      expanded: s.expanded,
      toggled: s.toggled,
      history: s.history,
      paging: (key) => viewFor(app, key).capabilities.groupHistory,
      label: (key) => viewFor(app, key).label,
    });
    const hadRows = s.treeRowCount;
    s.treeRowCount = rows.length;
    tree.setRows(rows, s.detail ? `r:${s.detail.repo}:${s.detail.runId}` : null);
    if ((hadRows === 0) !== (rows.length === 0)) app.renderNotes();
  }

  const app: App = {
    host,
    svc,
    s,
    side,
    listNotes,
    confirmRegion,
    toast,
    layout,
    show,
    openRun,
    openRepos,
    openDispatch: (target) => openDispatch(app, target),
    repoView: (name) => repoView(app, name),
    contextRepo: () => contextRepo(app),
    loadOverview: (quiet) => loadOverview(app, quiet),
    loadState: () => loadState(app),
    refreshAll: () => refreshAll(app),
    updateBadge: () => updateBadge(app),
    resetHistory: () => resetHistory(app),
    loadMore: (row, clicked) => loadMore(app, row, clicked),
    syncBar: () => bar.sync(),
    renderNotes: () => renderNotes(app),
    renderTree,
    renderSide: () => renderSide(app),
    renderDispatch: () => renderDispatch(app),
    renderRepos: () => renderRepos(app),
    renderBoard: () => renderBoard(app),
    renderLog: () => renderLog(app),
    scrollToFailure: () => scrollToFailure(app),
    loadDetail: (quiet) => loadDetail(app, quiet),
    loadLog: (job, full) => loadLog(app, job, full),
    ask: (next) => ask(app, next),
    askAction: (run, kind) => askAction(app, run, kind),
    sendToAgent: (run, jobId, worktree) => sendToAgent(app, run, jobId, worktree),
    runMenuItems: (run) => runMenuItems(app, run),
    onRunMenu: (run, id, jobId) => onRunMenu(app, run, id, jobId),
  };

  const bar = mountBar(app, barEl);
  listCol.append(barEl, listNotes.el, tree.el);

  new ResizeObserver(() => {
    const next = sizeOf(root.clientWidth);
    if (next === s.size) return;
    s.size = next;
    s.wide = s.size === 'l';
    layout();
    app.renderSide();
    app.syncBar();
  }).observe(root);
  s.size = sizeOf(root.clientWidth);
  s.wide = s.size === 'l';

  // ---- wiring -----------------------------------------------------------------
  host.onDirectory((next) => {
    if (next === s.directory) return;
    s.directory = next;
    s.detail = null;
    s.view = { kind: 'list' };
    layout();
    app.renderSide();
    void app.loadOverview(true);
  });

  const refetchAfterPoll = debounce(300, () => {
    void app.loadOverview(true);
    const detail = s.detail;
    if (detail && (!detail.run || isActive(detail.run) || detail.jobs.some((job) => job.status !== 'completed'))) {
      void app.loadDetail(true);
    }
  });

  host.onServiceEvent(({ topic, data }) => {
    if (topic !== 'runs') return;
    const forRepo = data && typeof data === 'object' && 'repo' in data ? (data as { repo?: unknown }).repo : null;
    if (typeof forRepo === 'string' && s.overview && !app.repoView(forRepo)) return;
    if (document.visibilityState === 'hidden') return;
    refetchAfterPoll();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void app.loadOverview(true);
  });

  layout();
  app.syncBar();
  app.renderNotes();
  renderTree();
  app.renderSide();
  // A stored overview paints the known projects immediately; the live fetch
  // below replaces it, quietly when the cache hit.
  void restoreCachedOverview(app).then((restored) => {
    if (!restored) return;
    app.syncBar();
    app.renderNotes();
    renderTree();
    app.updateBadge();
  });
  void host.listProjects().then((snapshot) => applyProjects(app, snapshot)).catch(() => void app.loadOverview());
  void host.onProjects((snapshot) => applyProjects(app, snapshot)).catch(() => undefined);
};
