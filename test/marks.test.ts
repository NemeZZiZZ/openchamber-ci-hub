import { describe, expect, test } from 'bun:test';
import type { ServiceMark, ServiceMarkTarget } from '@openchamber/sdk';
import { createMemoryConfigStore } from '../src/service/configStore.ts';
import { createEngine } from '../src/service/engine.ts';
import { createMarkSync, latestOnBranch, markFor } from '../src/service/marks.ts';
import { createMemoryPrefsStore } from '../src/service/prefs.ts';
import type { Run } from '../src/domain/types.ts';

const run = (over: Partial<Run> = {}): Run => ({
  id: '1',
  provider: 'github',
  repo: 'github:github.com/acme/app',
  number: 7,
  workflow: 'CI',
  workflowId: '3',
  branch: 'main',
  sha: 'abc',
  title: 'Commit',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'success',
  createdAt: 1_000,
  startedAt: null,
  finishedAt: null,
  actor: 'octo',
  url: 'https://github.com/acme/app/actions/runs/1',
  commitUrl: null,
  ...over,
});

const failedRun = run({ conclusion: 'failure' });
const runningRun = run({ status: 'in_progress', conclusion: null });

describe('latestOnBranch', () => {
  test('picks the newest run on the branch, null for another branch', () => {
    const runs = [
      run({ id: 'old', createdAt: 1_000 }),
      run({ id: 'new', createdAt: 2_000 }),
      run({ id: 'dev', branch: 'dev', createdAt: 3_000 }),
    ];
    expect(latestOnBranch(runs, 'main')?.id).toBe('new');
    expect(latestOnBranch(runs, 'nope')).toBeNull();
    expect(latestOnBranch(runs, null)?.id).toBe('dev');
    expect(latestOnBranch([], 'main')).toBeNull();
  });
});

describe('markFor', () => {
  test('failure → error tone, running → info, success → null', () => {
    expect(markFor(failedRun)).toEqual({
      icon: 'error-warning-line',
      tone: 'error',
      text: `CI failed · ${failedRun.workflow} #${failedRun.number}`,
    });
    expect(markFor(runningRun)?.tone).toBe('info');
    expect(markFor(run())).toBeNull();
    expect(markFor(null)).toBeNull();
  });
});

describe('createMarkSync', () => {
  const syncWith = (maxPerMinute?: number) => {
    const calls: { target: ServiceMarkTarget; mark: ServiceMark | null }[] = [];
    const sync = createMarkSync({
      setMark: async (target, mark) => {
        calls.push({ target, mark });
      },
      ...(maxPerMinute !== undefined ? { maxPerMinute } : {}),
    });
    return { calls, sync };
  };

  test('sync sets only changed targets and clears removed ones', async () => {
    const { calls, sync } = syncWith();
    const rows = [{ directory: '/a', branch: 'main', runs: [failedRun] }];
    await sync.sync(rows);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.mark?.tone).toBe('error');
    await sync.sync(rows);
    expect(calls).toHaveLength(1); // unchanged, no writes
    await sync.sync([{ directory: '/a', branch: 'main', runs: [run()] }]);
    expect(calls).toHaveLength(2); // green now: the mark is cleared
    expect(calls[1]!.mark).toBeNull();
    await sync.sync([]);
    expect(calls).toHaveLength(2); // already clear, nothing to do
  });

  test('sync never exceeds 60 setMark calls per minute', async () => {
    const { calls, sync } = syncWith();
    const rows = Array.from({ length: 70 }, (_, i) => ({
      directory: `/p/${i}`,
      branch: 'main',
      runs: [failedRun],
    }));
    await sync.sync(rows);
    expect(calls).toHaveLength(60);
  });
});

describe('engine marks', () => {
  const rawRun = (conclusion: string | null) => ({
    id: 100,
    run_number: 7,
    name: 'CI',
    workflow_id: 3,
    head_branch: 'main',
    head_sha: 'abc',
    display_title: 'Commit',
    event: 'push',
    run_attempt: 1,
    status: conclusion ? 'completed' : 'in_progress',
    conclusion,
    created_at: '2026-11-14T10:00:00Z',
    updated_at: '2026-11-14T10:01:00Z',
    actor: { login: 'octo' },
    html_url: 'https://github.com/acme/app/actions/runs/100',
  });

  const setup = (conclusion: string | null = 'failure') => {
    const calls: { target: ServiceMarkTarget; mark: ServiceMark | null }[] = [];
    const engine = createEngine({
      config: createMemoryConfigStore(),
      prefs: createMemoryPrefsStore(),
      audit: async () => undefined,
      auth: { readStore: async () => undefined, readSettings: async () => ({}), cliToken: async () => 't' },
      fetch: async (url) =>
        url.includes('/actions/runs')
          ? Response.json({ workflow_runs: [rawRun(conclusion)] })
          : Response.json({ default_branch: 'main' }),
      git: async (args) => {
        if (args[0] === 'remote') return { code: 0, stdout: 'git@github.com:acme/app.git\n', stderr: '' };
        if (args[0] === 'rev-parse') return { code: 0, stdout: 'main\n', stderr: '' };
        return { code: 1, stdout: '', stderr: '' };
      },
      emit: () => undefined,
      needsConfiguration: () => undefined,
      setMark: async (target, mark) => {
        calls.push({ target, mark });
      },
      timers: { set: () => 0, clear: () => undefined },
    });
    return { engine, calls };
  };

  test('pollAll marks the project directory when its branch fails', async () => {
    const { engine, calls } = setup();
    await engine.state('/p/app');
    await engine.pollAll();
    expect(calls).toEqual([
      {
        target: { directory: '/p/app', branch: 'main' },
        mark: { icon: 'error-warning-line', tone: 'error', text: 'CI failed · CI #7' },
      },
    ]);
  });

  test('marks off clears every mark we set and sets nothing new', async () => {
    const { engine, calls } = setup();
    await engine.state('/p/app');
    await engine.pollAll();
    expect(calls).toHaveLength(1);
    await engine.setPrefs({ marks: false });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.mark).toBeNull();
    await engine.pollAll();
    expect(calls).toHaveLength(2);
  });
});
