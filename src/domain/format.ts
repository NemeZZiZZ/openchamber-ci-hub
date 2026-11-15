import type { Conclusion, Run, RunFilter, RunStatus } from './types.ts';

export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
};

export const formatAgo = (at: number | null, now: number = Date.now()): string => {
  if (at === null) return '—';
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const runDuration = (run: Run, now: number = Date.now()): number | null => {
  const start = run.startedAt ?? run.createdAt;
  const end = run.finishedAt ?? (run.status === 'completed' ? null : now);
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
};

/** Queue time: how long the run waited before a runner picked it up. */
export const queueTime = (run: Run): number | null => {
  if (run.startedAt === null) return null;
  return Math.max(0, run.startedAt - run.createdAt);
};

/** The tree's one-line duration: the queue wait is composed in when it mattered. */
export const runDurationLabel = (run: Run, now: number = Date.now()): string | null => {
  const took = runDuration(run, now);
  if (took === null) return null;
  const queued = queueTime(run);
  return queued !== null && queued >= 5_000 ? `${formatDuration(queued)} + ${formatDuration(took)}` : formatDuration(took);
};

/** Classic flake: the same workflow, branch and commit failed here but succeeded
 * in a sibling run — return that twin so the row can say the pipeline passed too. */
export const flakyTwin = (run: Run, runs: readonly Run[]): Run | null => {
  if (run.conclusion !== 'failure') return null;
  return (
    runs.find(
      (other) =>
        other !== run &&
        other.workflowId === run.workflowId &&
        other.branch === run.branch &&
        other.sha === run.sha &&
        other.conclusion === 'success' &&
        // A twin from yesterday is a different codebase: only a same-day
        // retry counts as flaky.
        Math.abs(other.createdAt - run.createdAt) <= 86_400_000,
    ) ?? null
  );
};

/** SVG polyline points for a duration sparkline: oldest left, fast runs high. */
export const trendPoints = (durations: readonly number[], width: number, height: number): string => {
  if (durations.length < 2) return '';
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const span = max - min;
  const step = width / (durations.length - 1);
  return durations
    .map((value, index) => {
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
      return `${Math.round(index * step)},${Math.round(y)}`;
    })
    .join(' ');
};

/** `fastest – slowest` for a trend tooltip; empty until there are two runs. */
export const trendSpan = (durations: readonly number[]): string => {
  if (durations.length < 2) return '';
  return `${formatDuration(Math.min(...durations))} – ${formatDuration(Math.max(...durations))}`;
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'muted';

export const conclusionLabel = (conclusion: Conclusion, status?: RunStatus): string => {
  if (status === 'in_progress') return 'in progress';
  if (status === 'queued' || status === 'waiting' || status === 'pending') return 'queued';
  switch (conclusion) {
    case null:
      return status === 'completed' ? 'completed' : 'unknown';
    case 'success':
      return 'succeeded';
    case 'failure':
      return 'failed';
    case 'timed_out':
      return 'timed out';
    case 'action_required':
      return 'needs action';
    case 'startup_failure':
      return 'startup failed';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    default:
      return conclusion.replace(/_/g, ' ');
  }
};

export const conclusionTone = (conclusion: Conclusion, status?: RunStatus): Tone => {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting' || status === 'pending') {
    return 'info';
  }
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'error';
    case 'action_required':
      return 'warning';
    case 'cancelled':
    case 'skipped':
    case 'stale':
      return 'muted';
    default:
      return 'neutral';
  }
};

export const isFailedConclusion = (conclusion: Conclusion): boolean =>
  conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure';

export const isFailed = (run: Run): boolean => isFailedConclusion(run.conclusion);

export const isActive = (run: Run): boolean => run.status !== 'completed';
/** The filter the panel opens with: what is building, and what broke. */
export const matchesFilter = (run: Run, filter: RunFilter | undefined): boolean => {
  switch (filter ?? 'attention') {
    case 'all':
      return true;
    case 'attention':
      return isActive(run) || isFailed(run);
    case 'in_progress':
      return isActive(run);
    case 'failed':
      return isFailed(run);
    case 'succeeded':
      return run.conclusion === 'success';
    case 'cancelled':
      return run.conclusion === 'cancelled';
  }
};

export const formatEvent = (event: string): string => event.replace(/_/g, ' ');

export interface RemoteParts {
  /** Lower-cased; an http(s) port stays, an ssh port is dropped. */
  host: string;
  segments: string[];
  ssh: boolean;
}

/**
 * `git@host:group/app.git`, `ssh://git@host:2222/group/app.git`,
 * `git://host/group/app`, `https://user@host:8443/group/app/` → host and path
 * segments. Which provider and which segments name the repository is the
 * registry's call (`detectRemote`).
 */
export const parseRemote = (remote: string): RemoteParts | null => {
  const value = remote.trim();
  if (value === '') return null;

  let host = '';
  let path = '';
  let ssh = true;

  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(value);
  if (scp && !value.includes('://')) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      ssh = false;
      host = url.host;
    } else if (url.protocol === 'ssh:' || url.protocol === 'git:' || url.protocol === 'git+ssh:') {
      host = url.hostname;
    } else {
      return null;
    }
    path = url.pathname;
  }

  host = host.toLowerCase();
  if (host === '') return null;
  const segments = path
    .replace(/\.git\/*$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return null;
  return { host, segments, ssh };
};

/** Case-folded `host/path` of a git remote with any port dropped — the
 * identity a server-backed provider matches its clone URLs against. Null
 * when `parseRemote` cannot read the URL. */
export const remoteIdentity = (remote: string): string | null => {
  const parts = parseRemote(remote);
  if (!parts) return null;
  const host = parts.host.split(':')[0] ?? parts.host;
  return `${host}/${parts.segments.map((segment) => segment.toLowerCase()).join('/')}`;
};
