// The filter bar above the tree: tabs, branch scope, actor, search and the ⋯ menu.

import { mountMenu, mountSearchField, mountSelect, mountTabs } from '@openchamber/sdk/ui';
import { formatAgo } from '../../domain/format.ts';
import { h } from '../dom.ts';
import { BRANCH_PREFIX, counts, projectKey, SCOPE_ALL, SCOPE_MINE, scopeBranch, type TreeFilter } from '../treeModel.ts';
import { known, labels, viewFor } from './providers.ts';
import { mountPrefs } from './prefs.ts';
import { debounce, type App } from './state.ts';

const branchNames = (app: App): string[] => {
  const names = new Set<string>();
  for (const entry of app.s.overview?.repos ?? []) for (const run of entry.runs) if (run.branch) names.add(run.branch);
  const picked = scopeBranch(app.s.scope);
  if (picked) names.add(picked);
  return [...names].sort((a, b) => a.localeCompare(b)).slice(0, 60);
};

const actorNames = (app: App): string[] => {
  const names = new Set<string>();
  for (const entry of app.s.overview?.repos ?? []) for (const run of entry.runs) if (run.actor) names.add(run.actor);
  if (app.s.actor) names.add(app.s.actor);
  return [...names].sort((a, b) => a.localeCompare(b)).slice(0, 60);
};

const tabItems = (app: App) => {
  const s = app.s;
  const c = s.overview ? counts(s.overview.repos, s.scope, s.actor, s.service) : { failed: 0, running: 0 };
  return [
    { id: 'attention', label: s.size === 'm' ? 'Needs attention' : 'Attention' },
    { id: 'failed', label: 'Failed', count: c.failed },
    { id: 'in_progress', label: 'Running', count: c.running },
    { id: 'all', label: 'All' },
    { id: 'board', label: 'Board' },
  ];
};

const scopeOptions = (app: App) => [
  { id: SCOPE_MINE, label: 'Default + current', hint: 'each project’s default branch and the branch checked out in its folder' },
  { id: SCOPE_ALL, label: 'All branches' },
  ...branchNames(app).map((name) => ({ id: `${BRANCH_PREFIX}${name}`, label: name })),
];

const actorOptions = (app: App): { id: string; label: string }[] => [{ id: '', label: 'Anyone' }, ...actorNames(app).map((name) => ({ id: name, label: name }))];

/** «All services» plus the providers that actually have projects, in registry order. */
export const serviceOptions = (app: App): { id: string; label: string }[] => {
  const present = new Set((app.s.overview?.repos ?? []).map((repo) => repo.provider));
  const options = [
    { id: '', label: 'All services' },
    ...known(app)
      .filter((provider) => present.has(provider.id))
      .map((provider) => ({ id: provider.id, label: provider.label })),
  ];
  // A chosen service stays visible even when its projects are gone, like branch and actor do:
  // a pill fallen back to "Select" hides the very filter that emptied the tree.
  if (app.s.service && !options.some((option) => option.id === app.s.service)) {
    options.push({ id: app.s.service, label: known(app).find((provider) => provider.id === app.s.service)?.label ?? app.s.service });
  }
  return options;
};

const menuItems = (app: App) => {
  const target = app.contextRepo();
  const provider = viewFor(app, target);
  return [
    { id: 'refresh', label: 'Refresh' },
    { id: 'collapse', label: 'Collapse all' },
    { separator: true as const },
    { id: 'dispatch', label: `Run a ${provider.words.workflow}…`, disabled: !target || !provider.capabilities.dispatch },
    { id: 'repos', label: 'Repositories and account…' },
    { id: 'ci', label: target ? `Open ${app.repoView(target)?.name ?? target} on ${provider.label}` : `Open on ${labels(app)}`, disabled: !target },
  ];
};

// A narrower filter should show its matches, not collapsed projects: open
// every project that has something under it. Opening only adds; what the
// user closed by hand stays closed until the filter changes again.
/**
 * One tab click: the board tab swaps the view, a filter tab narrows the tree —
 * and when the board is open, returns to it. The strip repaint is the caller's
 * `updateTabs`, so the highlight follows even though mountTabs never
 * self-selects.
 */
export const tabChange = (app: App, updateTabs: (activeId: string) => void, id: string): void => {
  const s = app.s;
  if (id === 'board') {
    app.show({ kind: 'board' });
    updateTabs('board');
    return;
  }
  s.filter = id as TreeFilter;
  if (s.view.kind === 'board') app.show({ kind: 'list' });
  updateTabs(s.filter);
  expandMatches(app);
  app.renderNotes();
  app.renderTree();
};

const expandMatches = (app: App) => {
  const s = app.s;
  if (!s.overview || s.filter === 'all') return;
  for (const entry of s.overview.repos) {
    const c = counts([entry], s.scope, s.actor, s.service);
    const hit = s.filter === 'in_progress' ? c.running > 0 : s.filter === 'failed' ? c.failed > 0 : c.failed + c.running > 0;
    if (hit) s.expanded.add(projectKey(entry.key));
  }
};

/** Mounts the bar into `barEl`; the returned `sync` updates the controls in place, so an open dropdown or typed text survives a refetch. */
export const mountBar = (app: App, barEl: HTMLElement): { sync(): void } => {
  const s = app.s;
  const tabsAt = h('div', { class: 'cih-fbar-tabs' });
  const pills = h('div', { class: 'cih-fbar-pills' });
  const scopeAt = h('div', { class: 'cih-pill' });
  const serviceAt = h('div', { class: 'cih-pill' });
  const actorAt = h('div', { class: 'cih-pill' });
  const searchAt = h('div', { class: 'cih-pill cih-pill-grow' });
  const menuAt = h('div', { class: 'cih-pill cih-pill-menu' });
  const prefsAt = h('div', { class: 'cih-pill cih-pill-prefs' });
  const metaEl = h('div', { class: 'cih-fbar-meta' });
  pills.append(scopeAt, serviceAt, actorAt, searchAt, menuAt, prefsAt);
  barEl.append(tabsAt, pills, metaEl);

  const tabs = mountTabs(tabsAt, {
    items: tabItems(app),
    activeId: s.filter,
    onChange: (id) => {
      tabChange(app, (activeId) => tabs.update({ activeId }), id);
    },
  });
  const scopeSelect = mountSelect(scopeAt, {
    value: s.scope,
    options: scopeOptions(app),
    searchable: true,
    searchPlaceholder: 'Branch',
    onChange: (id) => {
      s.scope = id;
      app.resetHistory();
      expandMatches(app);
      app.syncBar();
      app.renderTree();
      app.updateBadge();
    },
  });
  const serviceSelect = mountSelect(serviceAt, {
    value: s.service,
    options: serviceOptions(app),
    onChange: (id) => {
      s.service = id;
      serviceSelect.update({ value: s.service, options: serviceOptions(app) });
      expandMatches(app);
      app.syncBar();
      app.renderTree();
      app.updateBadge();
    },
  });
  const actorSelect = mountSelect(actorAt, {
    value: s.actor,
    options: actorOptions(app),
    searchable: true,
    searchPlaceholder: 'Who started it',
    onChange: (id) => {
      s.actor = id;
      app.resetHistory();
      expandMatches(app);
      app.syncBar();
      app.renderTree();
      app.updateBadge();
    },
  });
  const treeSearch = mountSearchField(searchAt, {
    value: s.query,
    placeholder: 'Filter projects',
    label: 'Filter projects and workflows',
    onChange: (value) => {
      s.query = value;
      treeSearch.update({ value });
      filterLater();
    },
  });
  const filterLater = debounce(120, () => app.renderTree());
  const prefs = mountPrefs(app, prefsAt);
  const barMenu = mountMenu(menuAt, {
    label: '⋯',
    variant: 'ghost',
    size: 'sm',
    items: menuItems(app),
    onSelect: (id) => {
      const target = app.contextRepo();
      if (id === 'refresh') void app.refreshAll();
      if (id === 'collapse') {
        s.expanded.clear();
        app.renderTree();
      }
      if (id === 'dispatch' && target) app.openDispatch(target);
      if (id === 'repos') app.openRepos();
      if (id === 'ci' && target) {
        const ciUrl = app.repoView(target)?.ciUrl;
        if (ciUrl) void app.host.openUrl(ciUrl);
      }
    },
  });

  const sync = () => {
    prefs.sync();
    tabs.update({ items: tabItems(app), activeId: s.view.kind === 'board' ? 'board' : s.filter });
    scopeSelect.update({ value: s.scope, options: scopeOptions(app) });
    actorSelect.update({ value: s.actor, options: actorOptions(app) });
    serviceSelect.update({ value: s.service, options: serviceOptions(app) });
    barMenu.update({ items: menuItems(app) });
    const repos = s.overview?.repos ?? [];
    const polled = repos.map((entry) => entry.polledAt ?? 0).filter(Boolean);
    const newest = polled.length ? Math.max(...polled) : null;
    metaEl.textContent = s.overview
      ? `${repos.length} ${repos.length === 1 ? 'project' : 'projects'}${newest ? ` · checked ${formatAgo(newest)}` : ''}`
      : '';
  };
  return { sync };
};
