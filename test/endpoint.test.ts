import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endpointPath, removeEndpoint, writeEndpoint, type EndpointInfo } from '../src/service/endpoint.ts';

const info: EndpointInfo = { port: 1234, token: 'secret-token', pid: 4242, startedAt: 1, version: '0.3.0' };

describe('endpoint file', () => {
  test('writes 0600 JSON at the fixed path under the home directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ci-hub-endpoint-'));
    try {
      expect(endpointPath(home)).toBe(join(home, '.openchamber-ci-hub', 'endpoint.json'));
      await writeEndpoint(home, info);
      const path = endpointPath(home);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(info);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('a second write replaces the first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ci-hub-endpoint-'));
    try {
      await writeEndpoint(home, info);
      await writeEndpoint(home, { ...info, port: 9999 });
      expect(JSON.parse(await readFile(endpointPath(home), 'utf8')).port).toBe(9999);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('removeEndpoint removes only its own pid and tolerates a missing file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ci-hub-endpoint-'));
    try {
      await removeEndpoint(home, 1); // nothing written yet
      await writeEndpoint(home, info);
      await removeEndpoint(home, 999); // another instance owns the file now
      expect(JSON.parse(await readFile(endpointPath(home), 'utf8'))).toEqual(info);
      await removeEndpoint(home, info.pid);
      await expect(stat(endpointPath(home))).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
