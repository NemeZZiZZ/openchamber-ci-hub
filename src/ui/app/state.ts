// Shared state, types and small helpers for the panel's surface modules. Each
// surface takes the `App` first; surfaces never import each other, they call
// through the `App`.

import type { GuestProject, HostClient } from '@openchamber/sdk';
import { mountButton, type ButtonProps, type MenuItem } from '@openchamber/sdk/ui';
import type { Tone } from '../../domain/format.ts';
import type { LogLine } from '../../domain/log.ts';
import type { DispatchInput, Job, Run, WorkflowRef } from '../../domain/types.ts';
import type { OverviewRepo, OverviewView, StateView } from '../../service/engine.ts';
import { clear, h, slot } from '../dom.ts';
import type { ServiceError, Svc } from '../port.ts';
import type { HistoryState, MoreRow, Scope, TreeFilter } from '../treeModel.ts';

type Handle = { dispose(): void };

/** A part of the screen that is redrawn as a whole, with the kit controls it mounted. */
export class Region {
  readonly el: HTMLElement;
  private handles: Handle[] = [];
  constructor(el: HTMLElement) {
    this.el = el;
  }
  keep<H extends Handle>(handle: H): H {
    this.handles.push(handle);
    return handle;
  }
  reset(): void {
    for (const handle of this.handles) handle.dispose();
    this.handles = [];
    clear(this.el);
  }
}

export const button = (region: Region, props: ButtonProps): HTMLElement => {
  const at = slot();
  region.keep(mountButton(at, props));
  return at;
};

export const dot = (tone: Tone, label: string) => h('span', { class: 'cih-dot', 'data-tone': tone, title: label, 'aria-label': label });

export const shortSha = (sha: string) => sha.slice(0, 7);

/** Runs `fn` once calls stop for `ms`; a new call restarts the wait. */
export const debounce = <A extends unknown[]>(ms: number, fn: (...args: A) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

export const note = (region: Region, tone: 'error' | 'warning' | 'info', text: string, actions: ButtonProps[] = []) => {
  const box = h('div', { class: 'cih-note', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' }, h('div', { text }));
  if (actions.length > 0) {
    const row = h('div', { class: 'cih-note-actions' });
    for (const props of actions) row.append(button(region, { size: 'xs', variant: 'outline', ...props }));
    box.append(row);
  }
  region.el.append(box);
};

/** Lines shown around the first error before "Full log". */
export const FOCUS_BEFORE = 40;
export const FOCUS_AFTER = 160;
/** More lines than this in one frame makes typing in the search box sluggish. */
export const RENDER_CAP = 20_000;
export const SMALL_PX = 380;
export const WIDE_PX = 640;

export type View =
  | { kind: 'list' }
  | { kind: 'run'; repo: string; runId: string }
  | { kind: 'dispatch' }
  | { kind: 'repos' }
  | { kind: 'board' };

export interface LogState {
  jobId: string;
  loading: boolean;
  text: string | null;
  truncated: boolean;
  full: boolean;
  error: string | null;
  lines: LogLine[];
}

export interface Detail {
  repo: string;
  runId: string;
  loading: boolean;
  error: string | null;
  run: Run | null;
  jobs: Job[];
  jobId: string | null;
  log: LogState | null;
  mode: 'focus' | 'all';
  query: string;
  hit: number;
  /** Group header line indices the user opened or closed, against the default. */
  toggled: Set<number>;
}

export interface Confirm {
  message: string;
  label: string;
  destructive: boolean;
  work: () => Promise<void>;
}

export interface Dispatch {
  loading: boolean;
  error: string | null;
  workflows: WorkflowRef[];
  workflowId: string | null;
  ref: string;
  inputsLoading: boolean;
  dispatchable: boolean | null;
  /** Why the provider would refuse to start the chosen workflow, when it would. */
  refusal: string | null;
  inputs: DispatchInput[];
  values: Record<string, string>;
  submitting: boolean;
}

export interface HandoffResponse {
  title: string;
  text: string;
  url: string;
  id: string;
  branch: string;
  sha: string;
  directory: string | null;
}

export type RunActionKind = 'rerun-all' | 'rerun-failed' | 'cancel' | 'approve' | 'decline';

export interface AppState {
  directory: string | null;
  /** Every project with a CI remote, with its cached runs. */
  overview: OverviewView | null;
  overviewError: ServiceError | Error | null;
  overviewLoading: boolean;
  projects: GuestProject[];
  projectsSig: string;
  /** Watched repositories and the account, for the settings view only. */
  state: StateView | null;
  filter: TreeFilter;
  scope: Scope;
  actor: string;
  /** `''` shows every provider; a `ProviderId` keeps only its projects. */
  service: string;
  /** Board page: `''` shows every provider, else a `ProviderId`. */
  boardProvider: string;
  /** Board page: `all` keeps everything, `failed`/`running` filter by row state. */
  boardFilter: 'all' | 'failed' | 'running';
  query: string;
  expanded: Set<string>;
  /** Workflow rows the reader has toggled; their choice outranks the lone-workflow auto-open. */
  toggled: Set<string>;
  history: Map<string, HistoryState>;
  historyGen: number;
  view: View;
  detail: Detail | null;
  confirm: Confirm | null;
  dispatch: Dispatch | null;
  dispatchRepo: string | null;
  wide: boolean;
  size: 's' | 'm' | 'l';
  busy: Set<string>;
  addRepoValue: string;
  addRepoForFolder: boolean;
  addRepoError: string | null;
  addingRepo: boolean;
  treeRowCount: number;
  logRegion: Region | null;
  logBody: HTMLElement | null;
}

/** The panel as the surfaces see it: shared state, the regions they draw into, and each other's entry points. */
export interface App {
  host: HostClient;
  svc: Svc;
  s: AppState;
  side: Region;
  listNotes: Region;
  confirmRegion: Region;
  toast(kind: 'info' | 'success' | 'error', message: string): void;
  layout(): void;
  show(next: View): void;
  openRun(run: Run): void;
  openRepos(): void;
  openDispatch(target: string): void;
  repoView(name: string | null): OverviewRepo | null;
  contextRepo(): string | null;
  loadOverview(quiet?: boolean): Promise<void>;
  loadState(): Promise<void>;
  refreshAll(): Promise<void>;
  updateBadge(): void;
  resetHistory(): void;
  loadMore(row: MoreRow): Promise<void>;
  syncBar(): void;
  renderNotes(): void;
  renderTree(): void;
  renderSide(): void;
  renderDispatch(): void;
  renderRepos(): void;
  renderBoard(): void;
  renderLog(): void;
  scrollToFailure(): void;
  loadDetail(quiet: boolean): Promise<void>;
  loadLog(job: Job, full: boolean): Promise<void>;
  ask(next: Confirm): void;
  askAction(run: Run, kind: RunActionKind): void;
  sendToAgent(run: Run, jobId: string | null, worktree: boolean, mode?: 'read' | 'fix'): Promise<void>;
  runMenuItems(run: Run): MenuItem[];
  onRunMenu(run: Run, id: string, jobId?: string | null): void;
}

/** The "← Runs" bar on narrow screens, where the side column replaces the list. */
export const backBar = (app: App, title: string) => {
  if (app.s.wide && app.s.view.kind === 'run') return null;
  return h(
    'div',
    { class: 'cih-bar' },
    button(app.side, { label: '← Runs', variant: 'ghost', size: 'sm', onClick: () => app.show({ kind: 'list' }) }),
    h('span', { class: 'cih-title cih-bar-grow', text: title }),
  );
};
