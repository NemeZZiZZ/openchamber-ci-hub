import { describe, expect, test } from 'bun:test';
import { CHIP_TEXT_MAX, fixChip, pickFixRun, statusChip, type AgentRun } from '../src/ui/background.ts';

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  repo: 'github:host/acme/app',
  id: 100,
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
    const runs = [run({ id: 3, conclusion: 'success' }), run({ id: 2, conclusion: 'failure' }), run({ id: 1 })];
    expect(pickFixRun(runs)?.id).toBe(2);
    expect(pickFixRun([run({ conclusion: 'success' })])).toBeNull();
    expect(pickFixRun([])).toBeNull();
  });
});
