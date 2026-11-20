import { describe, expect, test } from 'bun:test';
import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';
import type { Run } from '../src/domain/types.ts';
import { blockAnswer, blockTitle, readBlockArgs } from '../src/ui/blockModel.ts';

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

describe('readBlockArgs', () => {
  test('accepts a repo key and a numeric run id', () => {
    expect(readBlockArgs({ repo: 'github:github.com/acme/app', runId: '100' })).toEqual({
      repo: 'github:github.com/acme/app',
      runId: '100',
    });
    expect(readBlockArgs({ repo: ' github:github.com/acme/app ', runId: ' 100 ' }).runId).toBe('100');
  });

  test('accepts a run URL in place of the id', () => {
    expect(readBlockArgs({ repo: 'r', runId: 'https://github.com/acme/app/actions/runs/100' }).runId).toBe('100');
    expect(readBlockArgs({ repo: 'r', runId: 'https://gitlab.com/acme/app/-/pipelines/4321' }).runId).toBe('4321');
  });

  test('rejects empty, missing and whitespace-only args', () => {
    expect(() => readBlockArgs({ repo: '', runId: '1' })).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: '   ', runId: '1' })).toThrow(/repo/);
    expect(() => readBlockArgs({ runId: '1' } as Record<string, string>)).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: 'r', runId: '' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'r', runId: '  ' })).toThrow(/runId/);
  });

  test('rejects a run id that is not digits or a run URL', () => {
    expect(() => readBlockArgs({ repo: 'r', runId: 'abc' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'r', runId: '12;rm -rf /' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'r', runId: 'https://github.com/acme/app' })).toThrow(/runId/);
  });
});

describe('blockTitle', () => {
  test('workflow, number and verdict', () => {
    expect(blockTitle(run())).toBe('CI #7 · failure');
    expect(blockTitle(run({ conclusion: null, status: 'in_progress' }))).toBe('CI #7 · in_progress');
  });
});

describe('blockAnswer', () => {
  test('never exceeds the block answer limit', () => {
    expect(blockAnswer('x'.repeat(20_000)).length).toBe(GUEST_BLOCK_ANSWER_MAX);
    expect(blockAnswer('short')).toBe('short');
  });
});
