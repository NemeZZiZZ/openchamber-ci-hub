// The Board: every watched repository's latest run at a glance, fresh
// failures first. Read-only; clicking a row opens the run detail.

import { mountSelect } from '@openchamber/sdk/ui';
import { conclusionLabel, conclusionTone, formatAgo, isActive, runDurationLabel } from '../../domain/format.ts';
import type { Run } from '../../domain/types.ts';
import type { OverviewRepo } from '../../service/engine.ts';
import { h } from '../dom.ts';
import { button, type App } from './state.ts';

export interface BoardRow {
  repo: OverviewRepo;
  run: Run | null;
  state: 'failed' | 'active' | 'idle' | 'none';
}

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'startup_failure']);
const STATE_RANK = { failed: 0, active: 1, idle: 2, none: 3 } as const;

/** Latest run per repo, ordered fresh failures → running → recency → no runs. */
export const boardRows = (repos: OverviewRepo[]): BoardRow[] => {
  const rows = repos.map((repo): BoardRow => {
    const run = repo.runs[0] ?? null;
    const state = !run
      ? 'none'
      : run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)
        ? 'failed'
        : isActive(run)
          ? 'active'
          : 'idle';
    return { repo, run, state };
  });
  const recency = (row: BoardRow): number => row.run?.finishedAt ?? row.run?.createdAt ?? 0;
  return rows.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || recency(b) - recency(a));
};

/** The rows a provider and a status filter leave visible. */
export const filterBoardRows = (rows: BoardRow[], provider: string, filter: 'all' | 'failed' | 'running'): BoardRow[] =>
  rows.filter((row) => {
    if (provider && row.repo.provider !== provider) return false;
    if (filter === 'failed') return row.state === 'failed';
    if (filter === 'running') return row.state === 'active';
    return true;
  });

/** Providers present on the board, with a vanished selection kept visible so the pill never goes blank. */
export const boardProviders = (
  repos: OverviewRepo[],
  selected: string,
  providers: readonly { id: string; label: string }[],
): { id: string; label: string }[] => {
  const label = (id: string): string => providers.find((provider) => provider.id === id)?.label ?? id;
  const present: string[] = [...new Set(repos.map((repo) => repo.provider))];
  const ids = present.includes(selected) || !selected ? present : [...present, selected];
  return ids.map((id) => ({ id, label: label(id) }));
};

export const renderBoard = (app: App) => {
  const { side, s } = app;
  side.reset();
  side.el.append(
    h(
      'div',
      { class: 'cih-bar' },
      button(side, { label: s.wide ? 'Close' : '← Runs', variant: 'ghost', size: 'sm', onClick: () => app.show({ kind: 'list' }) }),
      h('span', { class: 'cih-title cih-bar-grow', text: 'Board' }),
    ),
  );

  const repos = s.overview?.repos ?? [];
  const providers = s.overview?.providers ?? [];
  const providerLabel = (id: string): string => providers.find((provider) => provider.id === id)?.label ?? id;

  const pills = h('div', { class: 'cih-fbar-pills', style: 'margin:8px 0;padding:0 10px' });
  const providerAt = h('div', { class: 'cih-pill' });
  const statusAt = h('div', { class: 'cih-pill' });
  pills.append(providerAt, statusAt);
  side.el.append(pills);
  const providerSelect = mountSelect(providerAt, {
    value: s.boardProvider,
    options: [{ id: '', label: 'All providers' }, ...boardProviders(repos, s.boardProvider, providers)],
    onChange: (id) => {
      s.boardProvider = id;
      providerSelect.update({ value: id });
      app.renderSide();
    },
  });
  side.keep(providerSelect);
  const statusSelect = mountSelect(statusAt, {
    value: s.boardFilter,
    options: [
      { id: 'all', label: 'All statuses' },
      { id: 'failed', label: 'Failed' },
      { id: 'running', label: 'Running' },
    ],
    onChange: (id) => {
      s.boardFilter = id === 'failed' || id === 'running' ? id : 'all';
      statusSelect.update({ value: s.boardFilter });
      app.renderSide();
    },
  });
  side.keep(statusSelect);

  const rows = filterBoardRows(boardRows(repos), s.boardProvider, s.boardFilter);

  const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px;padding:0 10px 12px' });
  if (repos.length === 0) {
    list.append(h('div', { class: 'cih-muted', text: s.overviewLoading ? 'Loading…' : 'Watch repositories to see them here.' }));
  } else if (rows.length === 0) {
    list.append(h('div', { class: 'cih-muted', text: 'No repositories match these filters.' }));
  }
  for (const row of rows) {
    const { repo, run } = row;
    if (!run) {
      list.append(
        h(
          'div',
          { class: 'cih-card' },
          h('div', { class: 'cih-card-head' }, h('span', { class: 'cih-card-title', text: repo.name })),
          h('div', { class: 'cih-card-sub', ...(repo.error ? { 'data-tone': 'error' } : {}) }, h('span', { class: 'cih-muted', text: repo.error ?? 'No runs yet' })),
        ),
      );
      continue;
    }
    const tone = conclusionTone(run.conclusion, run.status);
    const duration = runDurationLabel(run, Date.now());
    const card = h(
      'div',
      { class: 'cih-card', style: 'cursor:pointer', role: 'button', tabindex: '0' },
      h(
        'div',
        { class: 'cih-card-head' },
        h('span', { class: 'cih-card-title', text: repo.name }),
        h('span', { class: 'cih-card-sub cih-small', text: providerLabel(repo.provider) }),
        h('span', { class: 'cih-small', style: 'margin-left:auto;white-space:nowrap', 'data-tone': tone, text: `${conclusionLabel(run.conclusion, run.status)}${duration ? ` · ${duration}` : ''}` }),
      ),
      h(
        'div',
        { class: 'cih-card-sub', style: 'padding:4px 10px 8px' },
        h('span', { class: 'cih-muted', text: `${run.workflow} #${run.number} · ${run.branch || run.sha.slice(0, 7)} · ${formatAgo(run.finishedAt ?? run.createdAt)}` }),
      ),
    );
    const open = () => app.openRun(run);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    list.append(card);
  }
  side.el.append(list);
};
