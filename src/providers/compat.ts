// Mapping helpers shared by the GitHub-shaped adapters (github, gitea and any
// fork that copies its run JSON). Forgejo maps its own, different shape on top
// of the same primitives.

import type { Conclusion, RunStatus } from '../domain/types.ts';

export const RUN_STATUS: Record<string, RunStatus> = {
  queued: 'queued',
  requested: 'requested',
  waiting: 'waiting',
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
};

export const CONCLUSIONS = new Set<string>([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
]);

export const time = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  // Gitea answers Go's zero time (0001-01-01) for a clock that has not started.
  if (!Number.isFinite(parsed) || parsed < -2_208_988_800_000) return null;
  return parsed;
};

/**
 * Parses the panel's variables field: a JSON object string mapping key to
 * value. Anything else — a non-string, empty, invalid JSON, not an object —
 * is no variables at all. Non-string values are dropped; empty values stay.
 */
export const parseVariablesObject = (raw: unknown): Record<string, string> => {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    // An empty key is the panel's unsaved draft row, never a variable.
    if (key !== '' && typeof value === 'string') out[key] = value;
  }
  return out;
};

export const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const statusOf = (value: unknown): RunStatus => RUN_STATUS[asString(value)] ?? 'unknown';

export const conclusionOf = (value: unknown): Conclusion => {
  const text = asString(value);
  return text !== '' && CONCLUSIONS.has(text) ? (text as Conclusion) : null;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The file-name part of `path/to/workflow.yml@refs/heads/main`, or the value itself. */
export const workflowFileOf = (value: string): string => {
  const path = value.split('@')[0] ?? '';
  return path.split('/').pop() ?? path;
};
