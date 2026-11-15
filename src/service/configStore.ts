// Config and the action log live in the service data folder OpenChamber gives
// the extension (outside the package: a write inside it would reload us).

import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { legacyRepoKey, parseRepoKey, repoKeyId } from '../domain/repoKey.ts';
import { EMPTY_CONFIG, type Config, type RepoConfig } from '../domain/types.ts';

export interface ConfigStore {
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

export interface AuditEntry {
  at: number;
  action: string;
  repo: string;
  target: string;
  ok: boolean;
  message?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Version 1 named repositories `owner/name` on GitHub; version 2 by repo key. */
const keyOf = (version: 1 | 2, value: unknown, apiOrigin?: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (version === 2) return parseRepoKey(value) ? value : null;
  return legacyRepoKey(value, typeof apiOrigin === 'string' ? apiOrigin : undefined);
};

export const parseConfig = (raw: string | undefined): Config => {
  if (!raw) return structuredClone(EMPTY_CONFIG);
  try {
    const value = asRecord(JSON.parse(raw));
    if (!value) return structuredClone(EMPTY_CONFIG);
    // A config from before versions existed is version 1.
    const version = value.version === undefined ? 1 : value.version;
    if (version !== 1 && version !== 2) return structuredClone(EMPTY_CONFIG);
    const repos: RepoConfig[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(value.repos) ? value.repos : []) {
      const repo = asRecord(item);
      if (!repo) continue;
      const key = version === 1 ? keyOf(1, repo.fullName, repo.apiOrigin) : keyOf(2, repo.key);
      if (!key || seen.has(repoKeyId(key))) continue;
      seen.add(repoKeyId(key));
      repos.push({
        key,
        ...(typeof repo.directory === 'string' ? { directory: repo.directory } : {}),
        enabled: repo.enabled !== false,
        addedAt: typeof repo.addedAt === 'number' ? repo.addedAt : 0,
      });
    }
    const directoryMap: Record<string, string> = {};
    for (const [dir, name] of Object.entries(asRecord(value.directoryMap) ?? {})) {
      // v1 map entries were on the host of the matching repo, if it had one.
      const origin =
        version === 1 && typeof name === 'string'
          ? (Array.isArray(value.repos) ? value.repos : [])
              .map(asRecord)
              .find((repo) => repo && typeof repo.fullName === 'string' && repo.fullName.toLowerCase() === name.toLowerCase())?.apiOrigin
          : undefined;
      const key = keyOf(version, name, origin);
      if (key) directoryMap[dir] = key;
    }
    return { version: 2, repos, directoryMap };
  } catch {
    return structuredClone(EMPTY_CONFIG);
  }
};

export const createFileConfigStore = (dir: string): ConfigStore => {
  const path = join(dir, 'config.json');
  let cached: Config | null = null;
  return {
    async load() {
      if (cached) return structuredClone(cached);
      const raw = await readFile(path, 'utf8').catch(() => undefined);
      cached = parseConfig(raw);
      return structuredClone(cached);
    },
    async save(config) {
      await mkdir(dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, path);
      cached = structuredClone(config);
    },
  };
};

export const createMemoryConfigStore = (initial: Config = EMPTY_CONFIG): ConfigStore => {
  let value = structuredClone(initial);
  return {
    async load() {
      return structuredClone(value);
    },
    async save(config) {
      value = structuredClone(config);
    },
  };
};

const AUDIT_MAX_BYTES = 512 * 1024;

/** One JSON line per write we made on GitHub; rotated when it grows. */
export const createFileAudit = (dir: string) => async (entry: AuditEntry): Promise<void> => {
  const path = join(dir, 'actions.log');
  try {
    await mkdir(dir, { recursive: true });
    const size = await stat(path).then((info) => info.size, () => 0);
    if (size > AUDIT_MAX_BYTES) await rename(path, `${path}.1`).catch(() => undefined);
    await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // The log is a record, not a gate: a full disk must not block a re-run.
  }
};
