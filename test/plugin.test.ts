import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../plugin/index.js';

const realFetch = globalThis.fetch;
let dir: string;
let endpointFile: string;
let requests: { method: string; url: string; body: unknown; auth: string | null }[];
let answer: (url: string) => { status: number; body: unknown };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ci-hub-plugin-'));
  endpointFile = join(dir, 'endpoint.json');
  await writeFile(endpointFile, JSON.stringify({ port: 4321, token: 'tok', pid: 1, startedAt: 1, version: '0.3.0' }));
  process.env.CI_HUB_ENDPOINT = endpointFile;
  requests = [];
  answer = () => ({ status: 200, body: { ok: true } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
    });
    const res = answer(url);
    return new Response(JSON.stringify(res.body), { status: res.status });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.CI_HUB_ENDPOINT;
  await rm(dir, { recursive: true, force: true });
});

const tools = async () => {
  const setup = await plugin.setup({});
  return setup.tool;
};

const text = (result: { content: { type: string; text: string }[] }) => result.content[0]!.text;

describe('OpenCode plugin', () => {
  test('exposes the four tools with JSON Schema inputs', async () => {
    const tool = await tools();
    expect(Object.keys(tool).sort()).toEqual(['ci_failing_log', 'ci_list_runs', 'ci_rerun', 'ci_run_detail']);
    for (const name of Object.keys(tool) as (keyof typeof tool)[]) {
      expect(tool[name].description).toContain('CI');
      expect(tool[name].input.type).toBe('object');
    }
  });

  test('ci_list_runs returns JSON text with items from /agent/runs', async () => {
    answer = (url) =>
      url.endsWith('/health') ? { status: 200, body: { ok: true } } : { status: 200, body: { items: [{ id: '100', number: 7 }] } };
    const tool = await tools();
    const result = await tool.ci_list_runs.execute({ repo: 'github:github.com/acme/app', limit: 5 });
    expect(JSON.parse(text(result))).toEqual({ items: [{ id: '100', number: 7 }] });
    // The first call checks /health, then asks for the runs.
    expect(requests[0]!.url).toBe('http://127.0.0.1:4321/health');
    const list = requests.find((r) => r.url.includes('/agent/runs'))!;
    expect(list.url).toContain('repo=github%3Agithub.com%2Facme%2Fapp');
    expect(list.url).toContain('limit=5');
    expect(list.auth).toBe('Bearer tok');
  });

  test('a missing endpoint file returns a readable message, not a throw', async () => {
    await rm(endpointFile);
    const tool = await tools();
    const result = await tool.ci_list_runs.execute({});
    expect(text(result)).toContain('CI Hub');
    expect(text(result)).toContain('panel');
  });

  test('a non-200 service answer returns the service message text', async () => {
    answer = (url) => (url.endsWith('/health') ? { status: 200, body: { ok: true } } : { status: 400, body: { message: 'Unknown repository.' } });
    const tool = await tools();
    const result = await tool.ci_run_detail.execute({ repo: 'x', runId: '1' });
    expect(text(result)).toContain('Unknown repository.');
  });

  test('ci_rerun posts to /action with rerun-failed', async () => {
    const tool = await tools();
    const result = await tool.ci_rerun.execute({ repo: 'github:github.com/acme/app', runId: '100' });
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.url).toContain('/action');
    expect(post.body).toEqual({ kind: 'rerun-failed', repo: 'github:github.com/acme/app', runId: '100' });
    expect(JSON.parse(text(result))).toMatchObject({ ok: true, repo: 'github:github.com/acme/app', runId: '100' });
  });

  test('ci_failing_log passes the job and reports the cap in its description', async () => {
    answer = (url) =>
      url.endsWith('/health')
        ? { status: 200, body: { ok: true } }
        : { status: 200, body: { job: { id: '55' }, excerpt: 'boom', truncated: true } };
    const tool = await tools();
    const result = await tool.ci_failing_log.execute({ repo: 'r', runId: '100', jobId: '55' });
    expect(JSON.parse(text(result))).toMatchObject({ excerpt: 'boom' });
    expect(requests.some((r) => r.url.includes('/agent/log') && r.url.includes('job=55'))).toBe(true);
    expect(tool.ci_failing_log.description).toContain('12');
  });

  test('ci_list_runs without arguments resolves the execution context directory', async () => {
    answer = (url) => (url.endsWith('/health') ? { status: 200, body: { ok: true } } : { status: 200, body: { items: [] } });
    const tool = await tools();
    await tool.ci_list_runs.execute({}, { directory: '/work/app' });
    const list = requests.find((r) => r.url.includes('/agent/runs'))!;
    expect(list.url).toContain('directory=%2Fwork%2Fapp');
  });

  test('an explicit directory wins over the execution context', async () => {
    answer = (url) => (url.endsWith('/health') ? { status: 200, body: { ok: true } } : { status: 200, body: { items: [] } });
    const tool = await tools();
    await tool.ci_list_runs.execute({ directory: '/elsewhere' }, { directory: '/work/app' });
    const list = requests.find((r) => r.url.includes('/agent/runs'))!;
    expect(list.url).toContain('directory=%2Felsewhere');
  });

  test('a foreign service on the port never counts as healthy', async () => {
    answer = (url) => (url.endsWith('/health') ? { status: 200, body: 'pong' } : { status: 200, body: { items: [] } });
    const tool = await tools();
    const result = await tool.ci_list_runs.execute({ repo: 'x' });
    expect(text(result)).toContain('CI Hub');
    expect(requests.some((r) => r.url.includes('/agent/runs'))).toBe(false);
  });

  test('a health answer of {ok:false} never counts as healthy', async () => {
    answer = (url) => (url.endsWith('/health') ? { status: 200, body: { ok: false } } : { status: 200, body: { items: [] } });
    const tool = await tools();
    const result = await tool.ci_list_runs.execute({ repo: 'x' });
    expect(text(result)).toContain('CI Hub');
    expect(requests.some((r) => r.url.includes('/agent/runs'))).toBe(false);
  });

  test('a changed endpoint file re-validates health before the next call', async () => {
    answer = () => ({ status: 200, body: { ok: true, items: [] } });
    const tool = await tools();
    await tool.ci_list_runs.execute({ repo: 'x' });
    expect(requests.filter((r) => r.url.endsWith('/health'))).toHaveLength(1);
    // The service restarted: same port, new process. Health now fails.
    await writeFile(endpointFile, JSON.stringify({ port: 4321, token: 'tok', pid: 2, startedAt: 2, version: '0.3.0' }));
    answer = (url) => (url.endsWith('/health') ? { status: 500, body: { message: 'down' } } : { status: 200, body: { items: [] } });
    const result = await tool.ci_list_runs.execute({ repo: 'x' });
    expect(text(result)).toContain('CI Hub');
    expect(requests.filter((r) => r.url.endsWith('/health'))).toHaveLength(2);
    expect(requests.filter((r) => r.url.includes('/agent/runs'))).toHaveLength(1);
  });
});
