// The endpoint file is how the OpenCode plugin finds this service without a
// port scan: the host picks the port and the token, the plugin reads them
// here. One OpenChamber instance per machine, so the last writer wins; a
// stale file is detected by its pid and by /health.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface EndpointInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: number;
  version: string;
}

export const endpointPath = (home: string): string => join(home, '.openchamber-ci-hub', 'endpoint.json');

export const writeEndpoint = async (home: string, info: EndpointInfo): Promise<void> => {
  const path = endpointPath(home);
  await mkdir(join(home, '.openchamber-ci-hub'), { recursive: true });
  const tmp = `${path}.${info.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
};

export const removeEndpoint = async (home: string, pid: number): Promise<void> => {
  const path = endpointPath(home);
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return;
  try {
    const current = JSON.parse(raw) as { pid?: unknown };
    if (current.pid !== pid) return; // a newer instance owns the file
  } catch {
    // A corrupt file is safe to remove only if it is ours; leave it otherwise.
    return;
  }
  await rm(path, { force: true });
};
