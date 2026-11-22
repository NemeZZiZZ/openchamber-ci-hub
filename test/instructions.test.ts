import { describe, expect, test } from 'bun:test';
import { INSTRUCTIONS } from '../src/service/instructions.ts';

describe('agent instructions', () => {
  test('fits the host limit and names every CI surface', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    for (const tool of ['ci_list_runs', 'ci_run_detail', 'ci_failing_log', 'ci_rerun']) {
      expect(INSTRUCTIONS).toContain(tool);
    }
    expect(INSTRUCTIONS).toContain('CiRun');
  });

  test('puts CiRun inside an openui-lang fence, not bare in prose', () => {
    expect(INSTRUCTIONS).toContain('```openui-lang');
    expect(INSTRUCTIONS).toContain('root = Stack([');
    expect(INSTRUCTIONS).not.toContain('on its own line');
  });

  test('never invites invented run ids and explains repo keys', () => {
    expect(INSTRUCTIONS).toContain('github:host/owner/name');
    expect(INSTRUCTIONS.toLowerCase()).toContain('never invent');
  });
});
