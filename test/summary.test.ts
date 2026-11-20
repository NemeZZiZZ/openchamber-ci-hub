import { describe, expect, test } from 'bun:test';
import { GUEST_GENERATE_PROMPT_MAX, GUEST_GENERATE_SYSTEM_MAX } from '@openchamber/sdk';
import type { Job, Run } from '../src/domain/types.ts';
import { SUMMARY_INPUT_MAX, summaryKey, summaryKeyFromPrompt, summaryRequest } from '../src/domain/summary.ts';

const run = (over: Partial<Run> = {}): Run => ({
  id: '100',
  provider: 'github',
  repo: 'github:github.com/acme/app',
  number: 7,
  workflow: 'CI',
  workflowId: '3',
  branch: 'main',
  sha: 'abcdef1234567890',
  title: 'Commit',
  event: 'push',
  attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  createdAt: 0,
  startedAt: 0,
  finishedAt: 60_000,
  actor: 'octo',
  url: 'https://github.com/acme/app/actions/runs/100',
  commitUrl: null,
  ...over,
});

const job = (name: string): Job => ({
  id: name,
  runId: '100',
  name,
  status: 'completed',
  conclusion: 'failure',
  startedAt: 0,
  finishedAt: 1,
  steps: [],
  url: '',
});

describe('summaryRequest', () => {
  test('names the workflow, run number, branch and failing jobs', () => {
    const { prompt, system } = summaryRequest(run(), [job('build'), job('test')], 'Error: boom');
    expect(prompt).toContain('CI');
    expect(prompt).toContain('#7');
    expect(prompt).toContain('main');
    expect(prompt).toContain('build');
    expect(prompt).toContain('test');
    expect(prompt).toContain('boom');
    expect(system.length).toBeGreaterThan(0);
    expect(system.length).toBeLessThanOrEqual(GUEST_GENERATE_SYSTEM_MAX);
  });

  test('a huge log still fits the input budget', () => {
    const { prompt } = summaryRequest(run(), [job('build')], 'x'.repeat(1024 * 1024));
    expect(prompt.length).toBeLessThanOrEqual(SUMMARY_INPUT_MAX);
    expect(prompt.length).toBeLessThanOrEqual(GUEST_GENERATE_PROMPT_MAX);
  });
});

describe('summaryKey', () => {
  test('differs between attempts and runs', () => {
    expect(summaryKey(run())).toBe('ci-hub:summary:github:github.com/acme/app#100:1');
    expect(summaryKey(run({ attempt: 2 }))).not.toBe(summaryKey(run()));
    expect(summaryKey(run({ id: '101' }))).not.toBe(summaryKey(run()));
  });

  test('the prompt carries the key for late results', () => {
    const { prompt } = summaryRequest(run(), [job('build')], 'log');
    expect(summaryKeyFromPrompt(prompt)).toBe(summaryKey(run()));
    expect(summaryKeyFromPrompt('no marker here')).toBeNull();
  });
});
