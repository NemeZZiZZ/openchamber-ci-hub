import { describe, expect, test } from 'bun:test';
import manifest from '../package.json';

type Card = { status?: { value: string; tones: Record<string, string> } };
const tools = (manifest.openchamber.contributes.tools ?? []) as { match: string; card?: Card }[];

describe('tool cards', () => {
  test('run cards show a badge for runs still in flight', () => {
    for (const name of ['ci_list_runs', 'ci_run_detail']) {
      const status = tools.find((tool) => tool.match === name)!.card!.status!;
      expect(status.value).toBe('{output.state}');
      expect(status.tones.in_progress).toBe('info');
      expect(status.tones.queued).toBe('info');
    }
  });
});
