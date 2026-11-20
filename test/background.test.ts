import { describe, expect, test } from 'bun:test';
import type { HostClient, HostReadyContext } from '@openchamber/sdk';
import { CHIP_TEXT_MAX, fixChip, pickFixRun, startBackground, statusChip, type AgentRun } from '../src/ui/background.ts';

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  repo: 'github:host/acme/app',
  id: '100',
  number: 7,
  workflow: 'CI',
  branch: 'main',
  sha: 'abc1234',
  status: 'completed',
  conclusion: 'failure',
  attempt: 1,
  url: 'https://host/acme/app/actions/runs/100',
  ...over,
});

describe('command chips', () => {
  test('status chip names the run and carries the context as text', () => {
    const chip = statusChip(run({ conclusion: 'success' }));
    expect(chip.providerId).toBe('ci-hub');
    expect(chip.id).toBe('100');
    expect(chip.title).toContain('CI #7');
    expect(chip.title).toContain('success');
    expect(chip.url).toBe(run().url);
    expect(chip.text).toContain('github:host/acme/app');
    expect(chip.text).toContain('main');
    expect(chip.text!.length).toBeLessThanOrEqual(CHIP_TEXT_MAX);
  });

  test('fix chip points the agent at the CI tools, not at guesses', () => {
    const chip = fixChip(run());
    expect(chip.text).toContain('ci_run_detail');
    expect(chip.text).toContain('ci_failing_log');
    expect(chip.text).toContain('ci_rerun');
    expect(chip.text).toContain('100');
    expect(chip.text!.length).toBeLessThanOrEqual(CHIP_TEXT_MAX);
  });

  test('fix picks the latest failed run, status the latest run', () => {
    const runs = [run({ id: '3', conclusion: 'success' }), run({ id: '2', conclusion: 'failure' }), run({ id: '1' })];
    expect(pickFixRun(runs)?.id).toBe('2');
    expect(pickFixRun([run({ conclusion: 'success' })])).toBeNull();
    expect(pickFixRun([])).toBeNull();
  });
});

describe('background frame against the real route envelope', () => {
  const frame = (response: unknown) => {
    const toasts: { kind: string; message: string }[] = [];
    const queries: Record<string, string | undefined>[] = [];
    let resolve: ((request: { command: string }) => Promise<unknown>) | null = null;
    let action: ((item: { action: string; directory: string | null }) => Promise<void>) | null = null;
    const host = {
      serviceRequest: async (call: { path: string; query?: Record<string, string | undefined> }) => {
        if (call.path !== '/agent/runs') throw new Error(`unexpected ${call.path}`);
        queries.push(call.query ?? {});
        return { status: 200, body: JSON.stringify(response) };
      },
      onResolve: (fn: never) => {
        resolve = fn;
      },
      onAction: (fn: never) => {
        action = fn;
      },
      toast: async (t: { kind: string; message: string }) => {
        toasts.push(t);
      },
    } as unknown as HostClient;
    startBackground(host, { directory: '/work/app' } as HostReadyContext);
    return {
      toasts,
      queries,
      resolve: (command: string) => resolve!({ command }),
      act: (name: string) => action!({ action: name, directory: '/work/app' }),
    };
  };

  test('/ci-status attaches a chip from { items }', async () => {
    const f = frame({ items: [run({ conclusion: 'success' })] });
    const chip = (await f.resolve('ci-status')) as { id: string; title: string };
    expect(chip.id).toBe('100');
    expect(chip.title).toContain('CI #7');
    expect(f.queries[0]).toMatchObject({ directory: '/work/app' });
  });

  test('/ci-fix picks the failed run from { items }', async () => {
    const f = frame({ items: [run({ conclusion: 'success' }), run({ id: '2', conclusion: 'failure' })] });
    const chip = (await f.resolve('ci-fix')) as { id: string };
    expect(chip.id).toBe('2');
  });

  test('/ci-status with no runs is a readable error', async () => {
    const f = frame({ items: [] });
    await expect(f.resolve('ci-status')).rejects.toThrow('No CI runs');
  });

  test('Check CI toasts from { items }', async () => {
    const f = frame({ items: [run()] });
    await f.act('ci-check');
    expect(f.toasts).toEqual([{ kind: 'error', message: 'The latest CI run failed. Fix it.' }]);
    const empty = frame({ items: [] });
    await empty.act('ci-check');
    expect(empty.toasts[0]).toMatchObject({ kind: 'info', message: 'No CI runs for this folder yet.' });
  });
});
