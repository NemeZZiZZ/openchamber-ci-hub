// The Work Status section: counts, what is still broken (up to three runs per
// repository), and what is building.
// Pure: the service hands it a snapshot and serves the result as-is.

import type { GuestStatusRow, GuestStatusView } from '@openchamber/sdk';
import { conclusionLabel, formatAgo, formatDuration, isActive, isFailed, runDuration } from './format.ts';
import { legacyRepoKey, parseRepoKey, repoLabel, type RepoKey } from './repoKey.ts';
import type { Run } from './types.ts';

export interface RepoSnapshot {
  key: RepoKey;
  runs: Run[];
  polledAt: number | null;
  error: string | null;
}

export interface StatusInput {
  /** Null when a token was found; otherwise the line telling the user how to connect. */
  authProblem: string | null;
  repos: RepoSnapshot[];
  /** Set while a provider is making us wait: its label and when it lets us go. */
  blocked: { label: string; until: number } | null;
  /** What to say when the project has no repository; the engine names the providers. */
  noRepoText: string;
  now: number;
}

/** FNV-1a as base36: a short, stable, host-charset-safe stand-in for a repo key or run id. */
const slug = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/** Run ids are digits in practice; anything else goes through the slug. */
const runPart = (runId: string): string => (/^[a-z0-9-]{1,16}$/.test(runId) ? runId : slug(runId));

/**
 * Ids a status button posts back. The host only accepts
 * `/^[a-z][a-z0-9-]{0,39}$/`, so the repo key travels as a slug and the
 * engine decodes the id through the map the served view carried out.
 */
export const statusActionId = (kind: 'rerun-failed' | 'refresh', repo: RepoKey = '', runId = ''): string =>
  kind === 'refresh' ? 'refresh' : `${kind}-${slug(repo)}-${runPart(runId)}`;

/** Buttons drawn before the provider registry carried repo keys; they still work. */
export const readStatusActionId = (
  id: string,
  resolveRepo: (input: string) => RepoKey | null = (input) => (parseRepoKey(input) ? input : legacyRepoKey(input)),
): { kind: 'refresh' } | { kind: 'rerun-failed'; repo: RepoKey; runId: string } | null => {
  if (id === 'refresh') return { kind: 'refresh' };
  const match = /^rerun-failed:(.+):(\d+)$/.exec(id);
  if (!match) return null;
  const repo = resolveRepo(match[1]!);
  return repo ? { kind: 'rerun-failed', repo, runId: match[2]! } : null;
};

/** What a served status view's button ids decode back to. */
export type StatusActions = Map<string, { repo: RepoKey; runId: string }>;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One run per workflow and branch: the newest says whether it is still broken. */
export const latestPerWorkflow = (runs: Run[]): Run[] => {
  const seen = new Set<string>();
  const out: Run[] = [];
  for (const run of [...runs].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = `${run.workflowId || run.workflow}\u0000${run.branch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
  }
  return out;
};

export const buildStatusView = (input: StatusInput): { view: GuestStatusView; actions: StatusActions } => {
  const rows: GuestStatusRow[] = [];
  const actions: StatusActions = new Map();
  if (input.authProblem) {
    rows.push({ kind: 'note', id: 'auth', text: clip(input.authProblem, 300), tone: 'warning' });
    return { view: { rows }, actions };
  }
  if (input.repos.length === 0) {
    rows.push({
      kind: 'note',
      id: 'empty',
      text: input.noRepoText,
      tone: 'muted',
    });
    return { view: { rows }, actions };
  }

  const multi = input.repos.length > 1;
  for (const repo of input.repos.slice(0, 4)) {
    const active = repo.runs.filter(isActive);
    const latest = latestPerWorkflow(repo.runs.filter((run) => !isActive(run)));
    const broken = latest.filter(isFailed);
    const prefix = multi ? `${repoLabel(repo.key)}: ` : '';

    if (repo.error && repo.runs.length === 0) {
      rows.push({ kind: 'note', id: `error-${slug(repo.key)}`, text: clip(`${prefix}${repo.error}`, 300), tone: 'error' });
      continue;
    }

    const chips = [
      ...(active.length > 0 ? [{ id: 'building', label: `${active.length} building`, tone: 'info' as const }] : []),
      ...(broken.length > 0 ? [{ id: 'failed', label: `${broken.length} failed`, tone: 'error' as const }] : []),
    ];
    rows.push({
      kind: 'line',
      id: multi ? `summary-${slug(repo.key)}` : 'summary',
      label: clip(repoLabel(repo.key), 40),
      icon: 'git-branch-line',
      dot: broken.length > 0 ? 'error' : active.length > 0 ? 'info' : 'success',
      // The rail's rows are one line tall: only the counts that exist are drawn,
      // so the chips never wrap and collide with the rows below.
      content: chips.length > 0 ? { kind: 'chips', chips } : undefined,
      value: repo.polledAt ? formatAgo(repo.polledAt, input.now) : '…',
      valueTone: 'muted',
      tooltip: repo.error ? clip(repo.error, 200) : `Checked ${formatAgo(repo.polledAt, input.now)}`,
    });

    // Rows are not clickable as a whole and an extension cannot open its own
    // page, so each failure carries a chip that opens the run at its provider.
    // The branch and the age live in the tooltip: a second chip and a value
    // would push the re-run button off the rail's one-line row.
    const failing = broken.slice(0, 3);
    for (const run of failing) {
      rows.push({
        kind: 'line',
        id: `failed-${slug(run.repo)}-${runPart(run.id)}`,
        label: clip(`${prefix}${run.workflow} #${run.number}`, 60),
        dot: 'error',
        content: {
          kind: 'chips',
          chips: [{ id: 'open', label: 'Open run', tone: 'error', url: run.url }],
        },
        tooltip: clip(
          `${run.workflow} ${conclusionLabel(run.conclusion, run.status)} on ${run.branch}, ${formatAgo(run.finishedAt ?? run.createdAt, input.now)}: ${run.title}`,
          200,
        ),
        actions: [
          {
            kind: 'button',
            id: statusActionId('rerun-failed', run.repo, run.id),
            label: 'Re-run failed',
            variant: 'outline',
            confirm: 'Re-run the failed jobs?',
          },
        ],
      });
      actions.set(statusActionId('rerun-failed', run.repo, run.id), { repo: run.repo, runId: run.id });
    }

    for (const run of active.slice(0, Math.max(1, 3 - failing.length))) {
      const elapsed = runDuration(run, input.now);
      rows.push({
        kind: 'line',
        id: `active-${slug(run.repo)}-${runPart(run.id)}`,
        label: clip(`${prefix}${run.workflow} #${run.number}`, 60),
        dot: 'info',
        content: { kind: 'text', text: clip(`${run.branch || '—'} · ${conclusionLabel(run.conclusion, run.status)}`, 200), tone: 'muted' },
        // The host refuses an empty value; a run without a start has none yet.
        ...(elapsed !== null ? { value: formatDuration(elapsed), valueTone: 'muted' as const } : {}),
      });
    }
  }

  if (input.blocked && input.blocked.until > input.now) {
    rows.push({
      kind: 'note',
      id: 'rate-limit',
      text: `${input.blocked.label} rate limit reached; checking again in ${formatDuration(input.blocked.until - input.now)}.`,
      tone: 'info',
    });
  }

  return { view: { rows: rows.slice(0, 16) }, actions };
};
