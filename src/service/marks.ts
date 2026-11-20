// Sidebar marks: one sign per project row — the latest run on its branch.
// Failure and in-progress only; a green branch gets no noise. The host caps
// changes at 60 a minute, and marks die with this process, so every write
// goes through the diff and budget below.

import type { ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';
import { isActive, isFailed } from '../domain/format.ts';
import type { Run } from '../domain/types.ts';

export interface MarkRow {
  directory: string;
  branch: string | null;
  runs: Run[];
}

export const latestOnBranch = (runs: Run[], branch: string | null): Run | null => {
  const candidates = branch === null ? runs : runs.filter((run) => run.branch === branch);
  let latest: Run | null = null;
  for (const run of candidates) if (!latest || run.createdAt > latest.createdAt) latest = run;
  return latest;
};

export const markFor = (run: Run | null): ServiceMark | null => {
  if (!run) return null;
  if (isFailed(run)) {
    return { icon: 'error-warning-line', tone: 'error', text: `CI failed · ${run.workflow} #${run.number}` };
  }
  if (isActive(run)) {
    return { icon: 'loader-4-line', tone: 'info', text: `CI running · ${run.workflow} #${run.number}` };
  }
  return null;
};

const targetOf = (row: MarkRow): ServiceMarkTarget =>
  row.branch ? { directory: row.directory, branch: row.branch } : { directory: row.directory };

export const createMarkSync = (deps: {
  setMark: (target: ServiceMarkTarget, mark: ServiceMark | null) => Promise<unknown>;
  maxPerMinute?: number;
}): { sync(rows: MarkRow[]): Promise<void>; clear(): Promise<void> } => {
  const max = deps.maxPerMinute ?? 60;
  const current = new Map<string, { target: ServiceMarkTarget; mark: ServiceMark }>();
  let windowStart = 0;
  let used = 0;

  const write = async (target: ServiceMarkTarget, mark: ServiceMark | null): Promise<boolean> => {
    const t = Date.now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      used = 0;
    }
    if (used >= max) return false;
    used += 1;
    await deps.setMark(target, mark).catch(() => undefined);
    return true;
  };

  const clear = async () => {
    for (const [key, entry] of current) {
      if (!(await write(entry.target, null))) break;
      current.delete(key);
    }
  };

  return {
    clear,
    async sync(rows) {
      const desired = new Map<string, { target: ServiceMarkTarget; mark: ServiceMark }>();
      for (const row of rows) {
        const mark = markFor(latestOnBranch(row.runs, row.branch));
        if (!mark) continue;
        desired.set(`${row.directory}\0${row.branch ?? ''}`, { target: targetOf(row), mark });
      }
      // Rows that went green or disappeared lose their mark.
      for (const [key, entry] of current) {
        if (desired.has(key)) continue;
        if (!(await write(entry.target, null))) return;
        current.delete(key);
      }
      for (const [key, entry] of desired) {
        const prev = current.get(key);
        if (prev && JSON.stringify(prev.mark) === JSON.stringify(entry.mark)) continue;
        if (!(await write(entry.target, entry.mark))) return;
        current.set(key, entry);
      }
    },
  };
};
