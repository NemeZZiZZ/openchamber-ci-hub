// The last overview, kept in host storage so a panel reload shows the known
// projects immediately instead of flashing "Looking for …". The live fetch
// always follows and replaces whatever the cache gave, so stale entries only
// ever shrink the empty-load window — they never stick.

import type { JsonValue } from '@openchamber/sdk';
import type { OverviewView } from '../../service/engine.ts';
import type { App } from './state.ts';

const KEY = 'ci-hub:last-overview';

export interface CachedOverview {
  directory: string | null;
  view: OverviewView;
}

/** True when the note above the tree should say the load is still going. */
export const showsLoadingPlaceholder = (s: { overview: OverviewView | null; overviewLoading: boolean }): boolean =>
  (s.overview === null || s.overview.repos.length === 0) && s.overviewLoading;

const isCachedOverview = (value: unknown): value is CachedOverview => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { directory?: unknown; view?: unknown };
  const view = entry.view as { repos?: unknown } | undefined;
  return (
    (entry.directory === null || typeof entry.directory === 'string') &&
    typeof view === 'object' &&
    view !== null &&
    Array.isArray(view.repos)
  );
};

export const saveCachedOverview = (app: App): void => {
  const view = app.s.overview;
  if (!view) return;
  try {
    const value: CachedOverview = { directory: app.s.directory, view };
    void app.host.storage?.set(KEY, value as unknown as JsonValue)?.catch(() => undefined);
  } catch {
    // A missing or broken storage must never break the panel.
  }
};

/**
 * Applies the stored overview (if it is for this directory) and returns true.
 * Never throws; a rejection means "start from the empty state".
 */
export const restoreCachedOverview = async (app: App): Promise<boolean> => {
  try {
    const stored = await app.host.storage?.get(KEY);
    if (!isCachedOverview(stored)) return false;
    if (typeof stored.directory === 'string' && stored.directory !== app.s.directory) return false;
    if (app.s.overview !== null) return false;
    app.s.overview = stored.view;
    return true;
  } catch {
    return false;
  }
};
