// CI Hub service: the only place a CI token lives. OpenChamber starts it
// on the first request and stops it after ten quiet minutes; everything it
// needs to survive that lives in the data folder or in OpenChamber's wait state.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServiceHost } from '@openchamber/sdk';
import { createFileAudit, createFileConfigStore } from '../src/service/configStore.ts';
import { createFilePrefsStore } from '../src/service/prefs.ts';
import { createEngine, type ExecResult } from '../src/service/engine.ts';
import { handleRequest } from '../src/service/routes.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!Number.isInteger(port) || port <= 0 || !token) {
  console.error('[ci-hub] OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}

const home = homedir();
const dataDir = process.env.OPENCHAMBER_SERVICE_DATA_DIR || join(home, '.openchamber-ci-hub');
const storePath = join(home, '.config', 'openchamber', 'source-control-auth.json');
const MAX_BODY_BYTES = 256 * 1024;

const host = process.env.OPENCHAMBER_HOST_CALLBACK_URL ? createServiceHost({ env: process.env }) : null;

const run = (program: string, args: string[], cwd?: string): Promise<ExecResult> =>
  new Promise((resolve) => {
    execFile(program, args, { cwd, timeout: 10_000, maxBuffer: 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as { code: number }).code) : -1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

// Provider CLIs the service may ask for a token. Keep in step with the
// manifest's `exec` permission, which the host enforces anyway.
const CLI_PROGRAMS = new Set(['gh', 'glab']);

// A token command costs a process; a minute of caching is plenty, and a
// logout is picked up on the next minute.
const cliCache = new Map<string, { value: string | null; at: number }>();
const cliToken = async (program: string, args: string[]): Promise<string | null> => {
  if (!CLI_PROGRAMS.has(program)) return null;
  const key = [program, ...args].join('\0');
  const hit = cliCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const result = await run(program, args);
  const value = result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  cliCache.set(key, { value, at: Date.now() });
  return value;
};

let warnedStore = false;
const readStore = async (): Promise<string | undefined> => {
  try {
    return await readFile(storePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !warnedStore) {
      warnedStore = true;
      console.warn('[ci-hub] could not read the OpenChamber credential store:', (err as Error).message);
    }
    return undefined;
  }
};

const engine = createEngine({
  config: createFileConfigStore(dataDir),
  prefs: createFilePrefsStore(dataDir),
  audit: createFileAudit(dataDir),
  auth: {
    readStore,
    readSettings: async () => (host ? host.readSettings() : {}),
    cliToken,
  },
  fetch: (input, init) => fetch(input, init),
  git: (args, cwd) => run('git', args, cwd),
  emit: (topic, data) => {
    host?.emit(topic, data).catch(() => undefined);
  },
  needsConfiguration: (message) => {
    host?.needsConfiguration(message).catch(() => undefined);
  },
});

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const server = createServer(async (req, res) => {
  const reply = (status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'unauthorized' });
  try {
    const body = await readBody(req);
    const result = await handleRequest({ method: req.method ?? 'GET', url: req.url ?? '/', body }, engine);
    reply(result.status, result.body);
  } catch (err) {
    console.error('[ci-hub] request failed', err);
    reply(500, { error: 'internal' });
  }
});

server.on('error', (err) => {
  console.error('[ci-hub] server error', err);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[ci-hub] listening on 127.0.0.1:${port}`);
});

const shutdown = () => {
  engine.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
