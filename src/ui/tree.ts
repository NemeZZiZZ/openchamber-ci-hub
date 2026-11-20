// The run tree: projects → workflows → runs, drawn as a virtual list. Rows
// have fixed heights (ROW_HEIGHT), so only the rows in view plus a buffer are
// in the DOM; the project a reader has scrolled into stays pinned on top.

import { mountMenu, type MenuItem } from '@openchamber/sdk/ui';
import { conclusionTone, formatEvent, runDurationLabel, trendPoints, trendSpan, type Tone } from '../domain/format.ts';
import type { Conclusion, Run, RunStatus } from '../domain/types.ts';
import { h } from './dom.ts';
import { agoText, conLabel, t, tPlural } from './i18n.ts';
import { offsets, projectFor, rowAt, ROW_HEIGHT, windowFor, type MoreRow, type ProjectRow, type TreeRow } from './treeModel.ts';

export interface TreeCallbacks {
  onToggle(key: string): void;
  onOpenRun(run: Run): void;
  runMenuItems(run: Run): MenuItem[];
  onRunMenu(run: Run, id: string): void;
  /** A "more" row was clicked — older runs load only on an explicit click. */
  onMore(row: MoreRow): void;
}

export interface Tree {
  readonly el: HTMLElement;
  setRows(rows: TreeRow[], selectedKey: string | null): void;
  dispose(): void;
}

const BUFFER = 8;

interface Drawn {
  el: HTMLElement;
  sig: string;
  dispose?: () => void;
}

const dot = (tone: Tone, label: string) => h('span', { class: 'cih-dot', 'data-tone': tone, title: label, 'aria-label': label });

const chevron = (open: boolean) => h('span', { class: 'cih-chev', 'data-open': open ? 'true' : 'false', 'aria-hidden': 'true' });

/**
 * The domain conclusionLabel's status-wins resolution as a single conLabel
 * input: an active status names itself, otherwise the conclusion does.
 * Exact in english for every (conclusion, status) pair the domain handles.
 */
const labelOf = (conclusion: Conclusion, status: RunStatus): string =>
  conLabel(
    status === 'in_progress'
      ? status
      : status === 'queued' || status === 'waiting' || status === 'pending'
        ? 'queued'
        : conclusion === 'success'
          ? 'succeeded'
          : conclusion === 'failure'
            ? 'failed'
            : (conclusion ?? (status === 'completed' ? 'completed' : 'unknown')),
  );

/** A duration sparkline for the workflow row; invisible until two runs loaded. */
const sparkline = (trend: readonly number[]): SVGElement | null => {
  const points = trendPoints(trend, 64, 18);
  if (!points) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cih-trend');
  svg.setAttribute('viewBox', '0 0 64 18');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = `Durations ${trendSpan(trend)}`;
  svg.append(title);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  svg.append(line);
  return svg;
};

const summary = (row: ProjectRow): { text: string; tone: string } => {
  if (row.error) return { text: t('tree.projectError', { name: row.name, message: row.error }), tone: 'error' };
  if (row.failed) return { text: tPlural('tree.failedCount', row.failed), tone: 'error' };
  if (row.running) return { text: tPlural('tree.runningCount', row.running), tone: 'info' };
  if (row.total) return { text: t('tree.allGreen'), tone: 'success' };
  return { text: t('tree.noRuns'), tone: 'muted' };
};

export const mountTree = (callbacks: TreeCallbacks): Tree => {
  const scroller = h('div', { class: 'cih-tree', role: 'tree', 'aria-label': t('tree.projectsRuns') });
  const sticky = h('div', { class: 'cih-tree-sticky' });
  const canvas = h('div', { class: 'cih-tree-canvas' });
  scroller.append(sticky, canvas);

  let rows: TreeRow[] = [];
  let tops: number[] = [0];
  let selected: string | null = null;
  const drawn = new Map<string, Drawn>();
  let stickyKey = '';
  let stickyDispose: (() => void) | undefined;

  const signature = (row: TreeRow): string => {
    const now = Date.now();
    switch (row.kind) {
      case 'project':
        return `${row.expanded}|${row.failed}|${row.running}|${row.total}|${row.error}|${row.name}`;
      case 'workflow':
        return `${row.expanded}|${row.name}|${row.latest.id}|${row.latest.status}|${row.latest.conclusion}|${agoText(row.latest.createdAt, now)}|${row.trend.length}`;
      case 'run': {
        const run = row.run;
        return `${row.key === selected}|${run.status}|${run.conclusion}|${run.attempt}|${agoText(run.createdAt, now)}|${runDurationLabel(run, now) ?? ''}|${row.twin?.id ?? ''}`;
      }
      case 'more':
        return `${row.loading}|${row.error}`;
      case 'note':
        return row.text;
    }
  };

  const projectEl = (row: ProjectRow, pinned: boolean): HTMLElement => {
    const s = summary(row);
    return h(
      'button',
      {
        class: 'cih-tr cih-tr-project',
        type: 'button',
        role: 'treeitem',
        'aria-expanded': row.expanded ? 'true' : 'false',
        'data-pinned': pinned ? 'true' : null,
        title: row.folder ? `${row.repo} · ${row.folder}` : row.repo,
        onclick: () => callbacks.onToggle(row.key),
      },
      chevron(row.expanded),
      h('span', { class: 'cih-tr-name', text: row.name }),
      h('span', { class: 'cih-tr-owner', text: row.owner }),
      h('span', { class: 'cih-tr-sum', 'data-tone': s.tone, text: s.text }),
    );
  };

  const build = (row: TreeRow): Drawn => {
    const sig = signature(row);
    switch (row.kind) {
      case 'project':
        return { el: projectEl(row, false), sig };
      case 'workflow': {
        const latest = row.latest;
        const label = labelOf(latest.conclusion, latest.status);
        return {
          sig,
          el: h(
            'button',
            {
              class: 'cih-tr cih-tr-workflow',
              type: 'button',
              role: 'treeitem',
              'aria-expanded': row.expanded ? 'true' : 'false',
              onclick: () => callbacks.onToggle(row.key),
            },
            chevron(row.expanded),
            dot(conclusionTone(latest.conclusion, latest.status), t('tree.latestRun', { title: label })),
            h('span', { class: 'cih-tr-name', text: row.name }),
            h('span', { class: 'cih-tr-meta', text: `#${latest.number} · ${agoText(latest.createdAt)}` }),
            sparkline(row.trend),
          ),
        };
      }
      case 'run': {
        const run = row.run;
        const now = Date.now();
        const label = labelOf(run.conclusion, run.status);
        const sub = [run.branch, formatEvent(run.event), runDurationLabel(run, now) ?? ''].filter(Boolean);
        if (run.attempt > 1) sub.push(t('tree.attempt', { n: run.attempt }));
        if (row.twin) sub.push(t('tree.flakyTwin', { title: row.twin.title || row.twin.workflow }));
        const menuAt = h('span', { class: 'cih-tr-menu', onclick: (event: Event) => event.stopPropagation() });
        const menu = mountMenu(menuAt, {
          label: '⋯',
          variant: 'ghost',
          size: 'xs',
          items: callbacks.runMenuItems(run),
          onSelect: (id) => callbacks.onRunMenu(run, id),
        });
        const el = h(
          'div',
          {
            class: 'cih-tr cih-tr-run',
            role: 'treeitem',
            tabindex: '0',
            'aria-current': row.key === selected ? 'true' : 'false',
            'aria-label': `${t('tree.runLabel', { workflow: run.workflow, number: run.number })} ${label}: ${run.title}`,
            onclick: () => callbacks.onOpenRun(run),
            onkeydown: (event: KeyboardEvent) => {
              if (event.target !== el) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                callbacks.onOpenRun(run);
              }
            },
          },
          dot(conclusionTone(run.conclusion, run.status), label),
          h(
            'span',
            { class: 'cih-tr-body' },
            h('span', { class: 'cih-tr-title' }, h('span', { class: 'cih-tr-num', text: `#${run.number}` }), ' ', run.title || run.workflow),
            h('span', { class: 'cih-tr-sub', text: sub.join(' · ') }),
          ),
          h('span', { class: 'cih-tr-meta', text: agoText(run.createdAt, now) }),
          menuAt,
        );
        return { el, sig, dispose: () => menu.dispose() };
      }
      case 'more': {
        const text = row.loading ? t('tree.loadingOlder') : row.error ? t('tree.loadError', { message: row.error }) : t('tree.loadOlder');
        return {
          sig,
          el: h('button', {
            class: 'cih-tr cih-tr-more',
            type: 'button',
            'data-loading': row.loading ? 'true' : null,
            'data-tone': row.error ? 'error' : null,
            disabled: row.loading,
            text,
            onclick: () => callbacks.onMore(row),
          }),
        };
      }
      case 'note':
        return { sig, el: h('div', { class: 'cih-tr cih-tr-note', text: row.text }) };
    }
  };

  const drawSticky = () => {
    const top = scroller.scrollTop;
    const index = projectFor(rows, rowAt(tops, top));
    const row = index >= 0 ? rows[index] : undefined;
    // Pinned only once its own row has scrolled under the top edge.
    if (!row || row.kind !== 'project' || tops[index]! >= top) {
      if (stickyKey) {
        sticky.replaceChildren();
        stickyKey = '';
      }
      sticky.hidden = true;
      return;
    }
    const key = `${row.key}|${signature(row)}`;
    sticky.hidden = false;
    if (key === stickyKey) return;
    stickyDispose?.();
    stickyKey = key;
    sticky.replaceChildren(projectEl(row, true));
  };

  const draw = () => {
    const { start, end } = windowFor(tops, scroller.scrollTop, scroller.clientHeight || 600, BUFFER);
    const keep = new Set<string>();
    for (let i = start; i < end; i++) {
      const row = rows[i]!;
      keep.add(row.key);
      const sig = signature(row);
      let item = drawn.get(row.key);
      if (item && item.sig !== sig) {
        item.dispose?.();
        item.el.remove();
        item = undefined;
      }
      if (!item) {
        item = build(row);
        drawn.set(row.key, item);
        canvas.append(item.el);
      }
      // `top`, not `transform`: a transform makes the row the containing block
      // for the row menu's position:fixed popup and a stacking context, so the
      // menu lands shifted inside the row and paints under the rows below.
      item.el.style.top = `${tops[i]}px`;
      item.el.style.height = `${ROW_HEIGHT[row.kind]}px`;
    }
    for (const [key, item] of drawn) {
      if (keep.has(key)) continue;
      item.dispose?.();
      item.el.remove();
      drawn.delete(key);
    }
    drawSticky();
  };

  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const resize = new ResizeObserver(() => draw());
  resize.observe(scroller);

  return {
    el: scroller,
    setRows(next, selectedKey) {
      rows = next;
      selected = selectedKey;
      tops = offsets(rows);
      canvas.style.height = `${tops[rows.length]}px`;
      draw();
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      for (const item of drawn.values()) item.dispose?.();
      drawn.clear();
      stickyDispose?.();
    },
  };
};
