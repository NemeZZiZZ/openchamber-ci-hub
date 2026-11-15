// The job log card: focus / full modes, search with hits, collapsible groups.

import { mountSearchField, mountSpinner, mountTabs } from '@openchamber/sdk/ui';
import { byteLength, formatBytes, type LogLine } from '../../domain/log.ts';
import { clear, h, slot } from '../dom.ts';
import { viewFor } from './providers.ts';
import { button, debounce, FOCUS_AFTER, FOCUS_BEFORE, RENDER_CAP, type App, type Detail } from './state.ts';

const firstError = (lines: LogLine[]): number => {
  const index = lines.findIndex((line) => line.tone === 'error');
  return index;
};

/** Line indices to draw, in order, for the current mode, query and open groups. */
const visibleLines = (current: Detail, lines: LogLine[]): { indices: number[]; hidden: number } => {
  const query = current.query.trim().toLowerCase();
  if (query) {
    const indices: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i]!.text.toLowerCase().includes(query)) indices.push(i);
    return { indices, hidden: lines.length - indices.length };
  }
  if (current.mode === 'focus') {
    const at = firstError(lines);
    const start = at === -1 ? Math.max(0, lines.length - FOCUS_AFTER) : Math.max(0, at - FOCUS_BEFORE);
    const end = at === -1 ? lines.length : Math.min(lines.length, at + FOCUS_AFTER);
    const indices: number[] = [];
    for (let i = start; i < end; i++) indices.push(i);
    return { indices, hidden: lines.length - indices.length };
  }
  // Full log: groups start closed unless they hold an error; the user can flip each.
  const errorGroups = new Set<number>();
  let header = -1;
  lines.forEach((line, i) => {
    if (line.tone === 'group') header = i;
    else if (line.depth === 0) header = -1;
    else if (line.tone === 'error' && header >= 0) errorGroups.add(header);
  });
  const indices: number[] = [];
  let open = true;
  for (let i = 0; i < lines.length && indices.length < RENDER_CAP; i++) {
    const line = lines[i]!;
    if (line.tone === 'group') {
      open = errorGroups.has(i) !== current.toggled.has(i);
      indices.push(i);
      continue;
    }
    if (line.depth > 0 && !open) continue;
    indices.push(i);
  }
  return { indices, hidden: 0 };
};

const highlight = (text: string, query: string): (Node | string)[] => {
  if (!query) return [text];
  const out: (Node | string)[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(query, from);
    if (at === -1) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(h('mark', null, text.slice(at, at + query.length)));
    from = at + query.length;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
};

const searchLater = debounce(150, (draw: () => void) => draw());

export const renderLog = (app: App) => {
  const host = app.host;
  const s = app.s;
  const current = s.detail;
  const region = s.logRegion;
  if (!current || !region) return;
  region.reset();
  s.logBody = null;
  const job = current.jobs.find((entry) => entry.id === current.jobId) ?? null;
  if (!job) return;
  const site = viewFor(app, current.repo).label;
  const log = current.log && current.log.jobId === job.id ? current.log : null;

  const bar = h(
    'div',
    { class: 'cih-card-head' },
    h('span', { class: 'cih-card-title', text: 'Log' }),
    h('span', { class: 'cih-card-sub cih-bar-grow', title: job.name, text: job.name }),
  );
  if (log?.text !== null && log?.text !== undefined) {
    bar.append(h('span', { class: 'cih-card-sub', text: `${log.truncated ? 'last ' : ''}${formatBytes(byteLength(log.text))}` }));
  }
  region.el.append(bar);

  if (!log || log.loading) {
    const at = slot();
    region.keep(mountSpinner(at, { size: 'sm', label: 'Loading log…' }));
    region.el.append(h('div', { class: 'cih-pad' }, at));
    return;
  }
  if (log.error || log.text === null) {
    const box = h('div', { class: 'cih-pad cih-muted', text: log.error ?? 'No log.' });
    region.el.append(box);
    const row = h('div', { class: 'cih-pad cih-actions' });
    if (job.status === 'completed') row.append(button(region, { label: 'Try again', size: 'xs', variant: 'outline', onClick: () => void app.loadLog(job, log.full) }));
    row.append(button(region, { label: `Open job on ${site}`, size: 'xs', variant: 'ghost', onClick: () => void host.openUrl(job.url) }));
    region.el.append(row);
    return;
  }

  const tools = h('div', { class: 'cih-log-bar' });
  const searchAt = slot('cih-bar-grow');
  region.keep(
    mountSearchField(searchAt, {
      value: current.query,
      placeholder: 'Search the log',
      label: 'Search the log',
      onChange: (value) => {
        current.query = value;
        current.hit = 0;
        searchLater(() => drawLines(true));
      },
    }),
  );
  tools.append(searchAt);
  const counter = h('span', { class: 'cih-small cih-muted' });
  const prev = button(region, { label: '↑', size: 'xs', variant: 'ghost', onClick: () => step(-1) });
  const next = button(region, { label: '↓', size: 'xs', variant: 'ghost', onClick: () => step(1) });
  tools.append(counter, prev, next);

  const modes = h('div', { class: 'cih-log-bar cih-log-modes' });
  const tabsAt = slot();
  region.keep(
    mountTabs(tabsAt, {
      items: [
        { id: 'focus', label: firstError(log.lines) === -1 ? 'Last lines' : 'Around the failure' },
        { id: 'all', label: 'Full log' },
      ],
      activeId: current.mode,
      onChange: (id) => {
        current.mode = id === 'all' ? 'all' : 'focus';
        app.renderLog();
        if (current.mode === 'focus') app.scrollToFailure();
      },
    }),
  );
  modes.append(tabsAt);
  if (log.truncated) {
    modes.append(
      button(region, {
        label: log.full ? 'Showing up to 4 MB' : 'Load the whole log',
        size: 'xs',
        variant: 'ghost',
        disabled: log.full,
        onClick: () => {
          current.mode = 'all';
          void app.loadLog(job, true);
        },
      }),
    );
  }
  modes.append(h('button', { class: 'cih-link cih-small', type: 'button', onclick: () => void host.openUrl(job.url) }, `Job on ${site} ↗`));
  region.el.append(modes, tools);

  const body = h('div', { class: 'cih-log-body', role: 'log', 'aria-label': `Log of ${job.name}` });
  region.el.append(body);
  s.logBody = body;

  let hits: HTMLElement[] = [];

  const step = (delta: number) => {
    if (hits.length === 0) return;
    current.hit = (current.hit + delta + hits.length) % hits.length;
    paintHit();
  };

  const paintHit = () => {
    hits.forEach((node, i) => (node.dataset.hit = i === current.hit ? 'current' : ''));
    hits[current.hit]?.scrollIntoView({ block: 'center' });
    counter.textContent = hits.length ? `${current.hit + 1} of ${hits.length}` : current.query.trim() ? 'no matches' : '';
  };

  const drawLines = (fromSearch: boolean) => {
    clear(body);
    const query = current.query.trim().toLowerCase();
    const { indices, hidden } = visibleLines(current, log.lines);
    if (current.mode === 'focus' && !query && indices.length > 0 && indices[0]! > 0) {
      body.append(
        h('div', { class: 'cih-ln cih-muted' }, h('span', { class: 'cih-ln-no' }, ''), h('button', { class: 'cih-link cih-small', type: 'button', onclick: () => { current.mode = 'all'; app.renderLog(); } }, `${indices[0]} earlier lines — show the full log`)),
      );
    }
    hits = [];
    const fragment = document.createDocumentFragment();
    for (const i of indices) {
      const line = log.lines[i]!;
      const isGroup = line.tone === 'group';
      const node = h(
        'div',
        {
          class: 'cih-ln',
          'data-tone': line.tone === 'normal' ? null : line.tone,
          'data-depth': String(line.depth),
          onclick: isGroup && current.mode === 'all' && !query
            ? () => {
                if (current.toggled.has(i)) current.toggled.delete(i);
                else current.toggled.add(i);
                drawLines(false);
              }
            : null,
        },
        h('span', { class: 'cih-ln-no', text: String(i + 1) }),
        h('span', { class: 'cih-ln-text' }, isGroup ? `▸ ${line.text}` : '', ...(isGroup ? [] : highlight(line.text, query))),
      );
      if (query) hits.push(node);
      fragment.append(node);
    }
    body.append(fragment);
    if (current.mode === 'focus' && !query && hidden > 0 && indices.length > 0 && indices[indices.length - 1]! < log.lines.length - 1) {
      body.append(h('div', { class: 'cih-ln cih-muted' }, h('span', { class: 'cih-ln-no' }, ''), h('span', { text: `${log.lines.length - 1 - indices[indices.length - 1]!} more lines in the full log` })));
    }
    if (indices.length >= RENDER_CAP) {
      body.append(h('div', { class: 'cih-ln cih-muted' }, h('span', { class: 'cih-ln-no' }, ''), h('span', { text: `The rest is cut here; search narrows it down, or open the job on ${site}.` })));
    }
    if (query) {
      if (current.hit >= hits.length) current.hit = 0;
      paintHit();
    } else {
      counter.textContent = '';
    }
    if (!fromSearch && !query) return;
  };

  drawLines(false);
};

export const scrollToFailure = (app: App) => {
  const body = app.s.logBody;
  if (!body) return;
  const target = body.querySelector<HTMLElement>('.cih-ln[data-tone="error"]');
  if (!target) {
    body.scrollTop = body.scrollHeight;
    return;
  }
  requestAnimationFrame(() => {
    body.scrollTop = Math.max(0, target.offsetTop - body.clientHeight / 3);
    if (!app.s.wide) target.scrollIntoView({ block: 'nearest' });
  });
};
