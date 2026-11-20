// Preferences for behavior the service itself owns (sidebar marks, the
// post-turn toast). They live in the data folder, not in a frame's storage:
// every frame and the service read the same values.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Prefs {
  marks: boolean;
  toastOnTurnFailure: boolean;
}

export const DEFAULT_PREFS: Prefs = { marks: true, toastOnTurnFailure: true };

export interface PrefsStore {
  load(): Promise<Prefs>;
  save(prefs: Prefs): Promise<void>;
}

export const parsePrefs = (raw: string | undefined): Prefs => {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFS };
    const record = value as Record<string, unknown>;
    return {
      marks: typeof record.marks === 'boolean' ? record.marks : DEFAULT_PREFS.marks,
      toastOnTurnFailure:
        typeof record.toastOnTurnFailure === 'boolean' ? record.toastOnTurnFailure : DEFAULT_PREFS.toastOnTurnFailure,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const createFilePrefsStore = (dir: string): PrefsStore => {
  const path = join(dir, 'prefs.json');
  let cached: Prefs | null = null;
  return {
    async load() {
      if (cached) return { ...cached };
      const raw = await readFile(path, 'utf8').catch(() => undefined);
      cached = parsePrefs(raw);
      return { ...cached };
    },
    async save(prefs) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
      cached = { ...prefs };
    },
  };
};

export const createMemoryPrefsStore = (initial: Prefs = DEFAULT_PREFS): PrefsStore => {
  let value = { ...initial };
  return {
    async load() {
      return { ...value };
    },
    async save(prefs) {
      value = { ...prefs };
    },
  };
};
