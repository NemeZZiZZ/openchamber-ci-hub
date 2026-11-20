import { describe, expect, test } from 'bun:test';
import { DEFAULT_PREFS } from '../src/service/prefs.ts';
import { prefRows, readTurnCi, turnCiMessage } from '../src/ui/app/turnCi.ts';

const payload = {
  directory: '/work/app',
  repo: 'github:github.com/acme/app',
  branch: 'main',
  runId: '100',
  number: 7,
  workflow: 'CI',
  conclusion: 'failure',
  attempt: 1,
};

describe('readTurnCi', () => {
  test('accepts the service payload', () => {
    expect(readTurnCi(payload)).toEqual(payload);
  });

  test('accepts a null branch', () => {
    expect(readTurnCi({ ...payload, branch: null })?.branch).toBeNull();
  });

  test('rejects junk', () => {
    expect(readTurnCi(null)).toBeNull();
    expect(readTurnCi({ topic: 'runs' })).toBeNull();
    expect(readTurnCi({ ...payload, runId: undefined })).toBeNull();
    expect(readTurnCi({ ...payload, runId: 100 })).toBeNull();
    expect(readTurnCi({ ...payload, number: '7' })).toBeNull();
    expect(readTurnCi({ ...payload, directory: null })).toBeNull();
    expect(readTurnCi({ ...payload, conclusion: null })).toBeNull();
  });
});

describe('turnCiMessage', () => {
  test('names the branch, workflow and run', () => {
    expect(turnCiMessage(readTurnCi(payload)!)).toBe('CI failed on main: CI #7');
  });

  test('falls back to the repo name when the branch is unknown', () => {
    const t = readTurnCi({ ...payload, branch: null })!;
    expect(turnCiMessage(t)).toBe('CI failed on acme/app: CI #7');
  });
});

describe('prefRows', () => {
  test('labels and values', () => {
    expect(prefRows(DEFAULT_PREFS)).toEqual([
      { id: 'marks', label: 'Sidebar marks', on: true },
      { id: 'toastOnTurnFailure', label: 'Toast when CI fails after a turn', on: true },
    ]);
    expect(prefRows({ marks: false, toastOnTurnFailure: false }).map((row) => row.on)).toEqual([false, false]);
  });
});
