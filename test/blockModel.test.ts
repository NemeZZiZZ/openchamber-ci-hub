import { describe, expect, test } from 'bun:test';
import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';
import type { Run } from '../src/domain/types.ts';
import { blockAnswer, blockRunQuery, blockTitle, readBlockArgs, rerunKind } from '../src/ui/blockModel.ts';

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

describe('blockRunQuery', () => {
  test('names the run id "id", the parameter the /run route requires', () => {
    const target = readBlockArgs({ repo: 'github:github.com/acme/app', runId: '100' });
    expect(blockRunQuery(target)).toEqual({ repo: 'github:github.com/acme/app', id: '100' });
    expect(Object.keys(blockRunQuery(target))).not.toContain('runId');
  });
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
    expect(readBlockArgs({ repo: 'github:github.com/acme/app', runId: 'https://github.com/acme/app/actions/runs/100' }).runId).toBe('100');
    expect(readBlockArgs({ repo: 'github:github.com/acme/app', runId: 'https://gitlab.com/acme/app/-/pipelines/4321' }).runId).toBe('4321');
  });

  test('rejects empty, missing and whitespace-only args', () => {
    expect(() => readBlockArgs({ repo: '', runId: '1' })).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: '   ', runId: '1' })).toThrow(/repo/);
    expect(() => readBlockArgs({ runId: '1' } as Record<string, string>)).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: 'github:github.com/acme/app', runId: '' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'github:github.com/acme/app', runId: '  ' })).toThrow(/runId/);
  });

  test('rejects a run id that is not digits or a run URL', () => {
    expect(() => readBlockArgs({ repo: 'github:github.com/acme/app', runId: 'abc' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'github:github.com/acme/app', runId: '12;rm -rf /' })).toThrow(/runId/);
    expect(() => readBlockArgs({ repo: 'github:github.com/acme/app', runId: 'https://github.com/acme/app' })).toThrow(/runId/);
  });

  test('rejects a repo that is not a repository key', () => {
    expect(() => readBlockArgs({ repo: 'not a repo', runId: '100' })).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: 'acme/app', runId: '100' })).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: 'github:github.com/acme', runId: '100' })).toThrow(/repo/);
    expect(() => readBlockArgs({ repo: 'unknown:github.com/acme/app', runId: '100' })).toThrow(/repo/);
  });

  test('accepts a UUID run id and a UUID run URL', () => {
    const uuid = '0c7f4b2a-1234-4abc-9def-0123456789ab';
    expect(readBlockArgs({ repo: 'bitbucket:bitbucket.org/acme/app', runId: uuid }).runId).toBe(uuid);
    expect(readBlockArgs({ repo: 'bitbucket:bitbucket.org/acme/app', runId: `{${uuid}}` }).runId).toBe(uuid);
    expect(
      readBlockArgs({ repo: 'bitbucket:bitbucket.org/acme/app', runId: `https://bitbucket.org/acme/app/pipelines/${uuid}` }).runId,
    ).toBe(uuid);
    expect(
      readBlockArgs({ repo: 'bitbucket:bitbucket.org/acme/app', runId: `https://bitbucket.org/acme/app/pipelines/{${uuid}}` }).runId,
    ).toBe(uuid);
  });

  test('accepts a singular pipeline URL', () => {
    expect(readBlockArgs({ repo: 'woodpecker:ci.acme.io/acme/app', runId: 'https://ci.acme.io/repos/42/pipeline/128' }).runId).toBe('128');
  });
});

describe('blockTitle', () => {
  test('workflow, number and verdict', () => {
    expect(blockTitle(run())).toBe('CI #7 · failure');
    expect(blockTitle(run({ conclusion: null, status: 'in_progress' }))).toBe('CI #7 · in progress');
  });
});

describe('blockAnswer', () => {
  test('never exceeds the block answer limit', () => {
    expect(blockAnswer('x'.repeat(20_000)).length).toBe(GUEST_BLOCK_ANSWER_MAX);
    expect(blockAnswer('short')).toBe('short');
  });
});

describe('rerunKind', () => {
  test('a failed run retries its failed jobs, any other run starts over', () => {
    expect(rerunKind(run({ conclusion: 'failure' }))).toBe('rerun-failed');
    expect(rerunKind(run({ conclusion: 'success' }))).toBe('rerun-all');
    expect(rerunKind(run({ conclusion: 'cancelled' }))).toBe('rerun-all');
  });
});
