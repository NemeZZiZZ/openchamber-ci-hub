import { describe, expect, test } from 'bun:test';
import { flakyTwin, matchesFilter, conclusionTone, formatDuration, runDurationLabel, trendPoints, trendSpan } from '../src/domain/format.ts';
import { buildHandoff, focusJob, handoffTitle } from '../src/domain/handoff.ts';
import { judgeWait, readWaitArgs, readWaitState, waitSummary } from '../src/domain/waits.ts';
import { providerFor } from '../src/providers/index.ts';
import { buildStatusView, readStatusActionId, statusActionId } from '../src/domain/statusView.ts';
import { byteLength, sliceByBytes } from '../src/domain/log.ts';
import { GUEST_STATUS_CONTROL_ID } from '@openchamber/sdk';
import { guestStatusViewSchema } from '@openchamber/sdk/schemas';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileAudit, parseConfig } from '../src/service/configStore.ts';
import type { Job, Run } from '../src/domain/types.ts';

const run = (over: Partial<Run> = {}): Run => ({
  id: '100',
  provider: 'github',
  repo: 'github:github.com/acme/app',
  number: 1284,
  workflow: 'CI',
  workflowId: '7',
  branch: 'main',
  sha: 'abcdef1234567',
  title: 'Fix the parser',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  createdAt: 1_000_000,
  startedAt: 1_005_000,
  finishedAt: 1_065_000,
  actor: 'octo',
  url: 'https://github.com/acme/app/actions/runs/100',
  commitUrl: null,
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: '9',
  runId: '100',
  name: 'build-and-test',
  status: 'completed',
  conclusion: 'failure',
  startedAt: 1_005_000,
  finishedAt: 1_065_000,
  url: 'https://github.com/acme/app/actions/runs/100/job/9',
  steps: [
    { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success', startedAt: null, finishedAt: null },
    { number: 2, name: 'Test', status: 'completed', conclusion: 'failure', startedAt: null, finishedAt: null },
  ],
  ...over,
});

describe('filters and formatting', () => {
  test('attention keeps failures and active runs', () => {
    expect(matchesFilter(run(), 'attention')).toBe(true);
    expect(matchesFilter(run({ status: 'in_progress', conclusion: null }), 'attention')).toBe(true);
    expect(matchesFilter(run({ conclusion: 'success' }), 'attention')).toBe(false);
  });
  test('a duration label composes queue time and run time', () => {
    type LabelRun = Parameters<typeof runDurationLabel>[0];
    const base = { provider: 'github', status: 'completed' };
    // 12s in queue, then 3m on the runner.
    expect(runDurationLabel({ ...base, createdAt: 1_000, startedAt: 13_000, finishedAt: 193_000 } as LabelRun, 1_000_000)).toBe('12s + 3m 00s');
    // A short queue does not clutter the cell.
    expect(runDurationLabel({ ...base, createdAt: 1_000, startedAt: 3_000, finishedAt: 183_000 } as LabelRun, 1_000_000)).toBe('3m 00s');
    // Never started: the clock runs from creation, no queue part.
    expect(runDurationLabel({ ...base, status: 'in_progress', createdAt: 1_000, startedAt: null, finishedAt: null } as LabelRun, 61_000)).toBe('1m 00s');
    expect(runDurationLabel({ ...base, createdAt: 1_000, startedAt: null, finishedAt: 181_000 } as LabelRun, 1_000_000)).toBe('3m 00s');
  });

  test('tones and durations', () => {
    expect(conclusionTone('failure', 'completed')).toBe('error');
    expect(conclusionTone(null, 'in_progress')).toBe('info');
    expect(formatDuration(65_000)).toBe('1m 05s');
  });
});

describe('handoff', () => {
  test('title and text carry the facts and an excerpt', () => {
    const jobs = [job({ id: '8', name: 'lint', conclusion: 'success', steps: [] }), job()];
    expect(focusJob(jobs)?.name).toBe('build-and-test');
    expect(handoffTitle(run(), jobs[1]!)).toBe('#1284 build-and-test failed');
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: 'FAIL src/parser.test.ts\n', logTruncated: false });
    expect(handoff.text).toContain('acme/app');
    expect(handoff.text).toContain(run().url);
    expect(handoff.text).toContain('Test');
    expect(handoff.text).toContain('FAIL src/parser.test.ts');
    expect(handoff.text.length).toBeLessThanOrEqual(16000);
  });

  test('handoff names the host', () => {
    const jobs = [job()];
    const input = { run: run(), jobs, job: jobs[0]!, log: null, logTruncated: false };
    expect(buildHandoff(input).text).toContain('Repository: github.com/acme/app');
  });

  test('fix mode appends the fix instruction', () => {
    const jobs = [job({ id: '8', name: 'lint', conclusion: 'success', steps: [] }), job()];
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: 'FAIL src/parser.test.ts\n', logTruncated: false, mode: 'fix' });
    expect(handoff.text).toContain('current branch');
    expect(handoff.text).toContain('Do not push.');
  });

  test('fix mode without a readable log still instructs', () => {
    const jobs = [job({ id: '8', name: 'lint', conclusion: 'success', steps: [] }), job()];
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: null, logTruncated: false, mode: 'fix' });
    expect(handoff.text).toContain('could not be read');
    expect(handoff.text).toContain('Do not push.');
  });

  test('read mode text is unchanged', () => {
    const jobs = [job({ id: '8', name: 'lint', conclusion: 'success', steps: [] }), job()];
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: 'FAIL src/parser.test.ts\n', logTruncated: false });
    expect(handoff.text).not.toContain('Do not push.');
  });
});

describe('waits', () => {
  test('wait args take a key, owner/name or a run url', async () => {
    const parse = providerFor('github').parseRunUrl;
    expect((await readWaitArgs({ repo: 'acme/app', runId: '42' }, parse)).repo).toBe('github:github.com/acme/app');
    expect(await readWaitArgs({ repo: 'github:ghe.acme.io/acme/app', runId: '#42' }, parse)).toEqual({ repo: 'github:ghe.acme.io/acme/app', runId: '42', conclusion: null });
    expect(await readWaitArgs({ runId: 'https://github.com/acme/app/actions/runs/42' }, parse)).toMatchObject({ repo: 'github:github.com/acme/app', runId: '42' });
    expect((await readWaitArgs({ runId: '42' }, parse)).repo).toBeNull();
    await expect(readWaitArgs({ runId: 'x' }, parse)).rejects.toThrow('runId must be a run id or a run URL.');
    await expect(readWaitArgs({ repo: 'acme', runId: '42' }, parse)).rejects.toThrow('repo must be owner/name, a repository URL or a CI Hub repo key.');
  });

  test('old waits and old status buttons still work', () => {
    expect(readWaitState({ repo: 'acme/app', runId: '42', conclusion: 'success', attempt: 1, number: 7, workflow: 'CI' })?.repo).toBe('github:github.com/acme/app');
    expect(readWaitState({ repo: '../etc', runId: '42' })).toBeNull();
    expect(readStatusActionId('rerun-failed:acme/app:42')).toEqual({ kind: 'rerun-failed', repo: 'github:github.com/acme/app', runId: '42' });
    // New ids carry a slug, not the key: the engine decodes them through the served view's map.
    const id = statusActionId('rerun-failed', 'github:ghe.acme.io:8443/acme/app', '42');
    expect(id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    expect(readStatusActionId(id)).toBeNull();
    expect(readStatusActionId('rerun-failed:nonsense:42')).toBeNull();
  });

  test('fires on completion, or early on a failed job', () => {
    const state = { repo: 'github:github.com/acme/app', runId: '100', conclusion: 'failure', attempt: 1, number: 1284, workflow: 'CI' };
    expect(judgeWait(state, run({ status: 'in_progress', conclusion: null }), [job({ status: 'in_progress', conclusion: null })])).toEqual({ fired: false });
    expect(judgeWait(state, run({ status: 'in_progress', conclusion: null }), [job()])).toEqual({ fired: true, early: true });
    expect(judgeWait({ ...state, conclusion: null }, run(), null)).toEqual({ fired: true, early: false });
  });

  test('summary is a report under 2000 chars without angle brackets', () => {
    const summary = waitSummary(run(), [job()], false, ['<div> broke', 'x'.repeat(5000)]);
    expect(summary.length).toBeLessThanOrEqual(2000);
    expect(summary).not.toMatch(/[<>]/);
    expect(summary).toContain('build-and-test (step "Test")');
  });
});

describe('status view', () => {
  test('auth problem is a single warning note', () => {
    const built = buildStatusView({ authProblem: 'Connect GitHub', repos: [], blocked: null, noRepoText: 'No GitHub repository for this project.', now: 0 });
    expect(built.view.rows).toEqual([{ kind: 'note', id: 'auth', text: 'Connect GitHub', tone: 'warning' }]);
    expect(built.actions.size).toBe(0);
  });

  test('empty state says what to do next', () => {
    const built = buildStatusView({ authProblem: null, repos: [], blocked: null, noRepoText: 'No GitHub repository for this project.', now: 0 });
    expect(built.view.rows[0]).toMatchObject({ kind: 'note', text: 'No GitHub repository for this project.' });
  });

  test('newest failure gets a re-run button', () => {
    const built = buildStatusView({
      authProblem: null,
      repos: [{ key: 'github:github.com/acme/app', runs: [run(), run({ id: '99', status: 'in_progress', conclusion: null, workflowId: '8' })], polledAt: 0, error: null }],
      blocked: null,
      noRepoText: '',
      now: 2_000_000,
    });
    expect(built.view.rows.length).toBeLessThanOrEqual(16);
    const ids = JSON.stringify(built.view.rows);
    expect(ids).toContain(statusActionId('rerun-failed', 'github:github.com/acme/app', '100'));
    expect(ids).toContain('"label":"app"');
  });

  test('up to three failing runs, each with a chip that opens it', () => {
    const failures = ['1', '2', '3', '4'].map((n) => run({ id: n, workflowId: n, createdAt: Number(n), url: `https://github.com/acme/app/actions/runs/${n}` }));
    const built = buildStatusView({
      authProblem: null,
      repos: [{ key: 'github:github.com/acme/app', runs: failures, polledAt: 0, error: null }],
      blocked: null,
      noRepoText: '',
      now: 2_000_000,
    });
    const text = JSON.stringify(built.view.rows);
    expect(text).toContain('actions/runs/4');
    expect(text).toContain('actions/runs/2');
    expect(text).not.toContain('actions/runs/1"');
    expect(text.match(/"Open run"/g)).toHaveLength(3);
  });

  test('a rate limit names the provider that set it', () => {
    const built = buildStatusView({
      authProblem: null,
      repos: [{ key: 'github:github.com/acme/app', runs: [], polledAt: 0, error: null }],
      blocked: { label: 'GitHub', until: 2_060_000 },
      noRepoText: '',
      now: 2_000_000,
    });
    expect(JSON.stringify(built.view.rows)).toContain('GitHub rate limit reached; checking again in 1m 00s.');
  });

  test('the status view passes the host schema', () => {
    const now = 2_000_000;
    const built = buildStatusView({
      authProblem: null,
      repos: [
        {
          key: 'github:github.com/acme/app',
          runs: [
            run(),
            run({ id: '98', status: 'queued', conclusion: null, startedAt: null, workflowId: '9' }),
            run({ id: '97', status: 'in_progress', conclusion: null, startedAt: null, workflowId: '8' }),
          ],
          polledAt: now,
          error: null,
        },
        { key: 'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets', runs: [run({ id: '300', repo: 'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets', provider: 'gitlab' })], polledAt: null, error: 'GitLab answered 404.' },
      ],
      blocked: { label: 'GitHub', until: now + 60_000 },
      noRepoText: '',
      now,
    });
    const parsed = guestStatusViewSchema.safeParse(built.view);
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    expect(parsed.success).toBe(true);
    // Button ids fit the control charset and map back to their run.
    for (const id of built.actions.keys()) expect(GUEST_STATUS_CONTROL_ID.test(id)).toBe(true);
    expect(built.actions.get(statusActionId('rerun-failed', 'github:github.com/acme/app', '100'))).toEqual({
      repo: 'github:github.com/acme/app',
      runId: '100',
    });
    // A row must never wrap on the rail: the failing line carries one chip and
    // no value, the summary counts only what is non-zero.
    const failed = built.view.rows.find((row) => row.kind === 'line' && row.id.startsWith('failed-'));
    if (failed?.kind !== 'line') throw new Error('no failed row');
    expect(failed.content?.kind === 'chips' && failed.content.chips.map((chip) => chip.label)).toEqual(['Open run']);
    expect(failed.value).toBeUndefined();
    const summary = built.view.rows.find((row) => row.kind === 'line' && row.id.startsWith('summary'));
    if (summary?.kind !== 'line' || summary.content?.kind !== 'chips') throw new Error('no summary chips');
    expect(summary.content.chips.map((chip) => chip.label)).toEqual(['2 building', '1 failed']);
    // An active run without a duration carries no empty value.
    for (const row of built.view.rows) {
      if (row.kind === 'line' && row.value !== undefined) expect(row.value.length).toBeGreaterThan(0);
    }
  });

  test('a green summary carries no chips at all', () => {
    const built = buildStatusView({
      authProblem: null,
      repos: [{ key: 'github:github.com/acme/app', runs: [run({ conclusion: 'success' })], polledAt: 2_000_000, error: null }],
      blocked: null,
      noRepoText: '',
      now: 2_000_000,
    });
    const summary = built.view.rows[0]!;
    if (summary.kind !== 'line') throw new Error('not a line');
    expect(summary.content).toBeUndefined();
    expect(summary.value).toBe('just now');
    expect(guestStatusViewSchema.safeParse(built.view).success).toBe(true);
  });
});

describe('config', () => {
  test('parseConfig keeps valid repos and drops junk', () => {
    const config = parseConfig(
      JSON.stringify({ repos: [{ fullName: 'acme/app', enabled: false }, { fullName: '../etc' }, 7], directoryMap: { '/w': 'acme/app', '/x': 3 } }),
    );
    expect(config.repos.map((repo) => [repo.key, repo.enabled])).toEqual([['github:github.com/acme/app', false]]);
    expect(config.directoryMap).toEqual({ '/w': 'github:github.com/acme/app' });
    expect(parseConfig('not json').repos).toEqual([]);
  });

  test('the audit log rotates when it grows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ci-hub-audit-'));
    try {
      await writeFile(join(dir, 'actions.log'), 'x'.repeat(600 * 1024));
      await createFileAudit(dir)({ at: 1, action: 'cancel', repo: 'acme/app', target: '1', ok: true });
      expect((await stat(join(dir, 'actions.log.1'))).size).toBe(600 * 1024);
      expect(await readFile(join(dir, 'actions.log'), 'utf8')).toContain('"cancel"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('byte helpers', () => {
  test('byteLength counts UTF-8 bytes, not chars', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('ж')).toBe(2);
    expect(byteLength('✅')).toBe(3);
  });

  test('sliceByBytes never splits a code point', () => {
    expect(sliceByBytes('aж✅b', 0, 4)).toBe('aж');
    expect(sliceByBytes('aж✅b', 0, 2)).toBe('a'); // 2 would cut ж in half: falls back to a whole ж? no — start<stop so 'a'
    expect(sliceByBytes('жжж', 2, 4)).toBe('ж');
    expect(sliceByBytes('✅✅', 0, 3)).toBe('✅');
    expect(sliceByBytes('abc', 5, 9)).toBe('');
  });
});

describe('flakyTwin', () => {
  const base = {
    provider: 'github', repo: 'github:github.com/acme/app', workflow: 'CI', workflowId: 'ci.yml',
    branch: 'main', sha: 'abc123', event: 'push', attempt: 1, status: 'completed' as const,
    createdAt: 1_000, startedAt: 1_000, finishedAt: 2_000, actor: 'a', url: '', commitUrl: null,
  };
  const run = (over: Record<string, unknown>) => ({ ...base, ...over }) as Parameters<typeof flakyTwin>[0];
  const failed = run({ number: 42, id: '42', conclusion: 'failure' as const });

  test('a failed run with a successful twin on the same commit is flaky', () => {
    const passed = run({ number: 41, id: '41', conclusion: 'success' as const });
    expect(flakyTwin(failed, [passed, run({ number: 40, id: '40', conclusion: 'success' as const, sha: 'other' })])).toBe(passed);
  });

  test('no twin, another commit, another branch, another workflow: null', () => {
    expect(flakyTwin(failed, [])).toBeNull();
    expect(flakyTwin(failed, [run({ number: 41, id: '41', conclusion: 'failure' as const })])).toBeNull();
    expect(flakyTwin(failed, [run({ number: 41, id: '41', conclusion: 'success' as const, sha: 'other' })])).toBeNull();
    expect(flakyTwin(failed, [run({ number: 41, id: '41', conclusion: 'success' as const, branch: 'dev' })])).toBeNull();
    expect(flakyTwin(failed, [run({ number: 41, id: '41', conclusion: 'success' as const, workflowId: 'lint.yml' })])).toBeNull();
  });

  test('a twin older than a day does not count', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    const failed = run({ conclusion: 'failure', createdAt: now });
    const stale = run({ conclusion: 'success', createdAt: now - 86_400_001 });
    expect(flakyTwin(failed, [failed, stale])).toBeNull();
  });

  test('a passed run is never flaky', () => {
    const green = run({ number: 43, id: '43', conclusion: 'success' as const });
    expect(flakyTwin(green, [failed])).toBeNull();
  });
});

describe('trend geometry', () => {
  test('rising durations draw a rising line, left to right', () => {
    expect(trendPoints([1000, 3000], 100, 20)).toBe('0,20 100,0');
    expect(trendPoints([3000, 1000], 100, 20)).toBe('0,0 100,20');
  });

  test('equal durations draw a flat mid line; fewer than two points draw nothing', () => {
    expect(trendPoints([2000, 2000, 2000], 100, 20)).toBe('0,10 50,10 100,10');
    expect(trendPoints([2000], 100, 20)).toBe('');
    expect(trendPoints([], 100, 20)).toBe('');
  });

  test('the span names the fastest and the slowest', () => {
    expect(trendSpan([65_000, 180_000, 300_000])).toBe('1m 05s – 5m 00s');
    expect(trendSpan([180_000])).toBe('');
  });
});
