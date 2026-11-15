import { describe, expect, test } from 'bun:test';
import { errorExcerpt, parseLog, stripAnsi, type LogLine } from '../src/domain/log.ts';

describe('github dialect', () => {
  const raw = [
    '2026-11-14T10:00:00.0000000Z ##[group]Run npm test',
    '2026-11-14T10:00:00.1000000Z npm test',
    '2026-11-14T10:00:00.2000000Z ##[endgroup]',
    '2026-11-14T10:00:01.0000000Z ok 1 parses',
    '2026-11-14T10:00:02.0000000Z FAIL src/parser.test.ts',
    '2026-11-14T10:00:03.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');

  test('parseLog collapses groups and marks errors', () => {
    const lines = parseLog(raw);
    expect(lines[0]).toMatchObject({ text: 'Run npm test', tone: 'group' });
    expect(lines[1]).toMatchObject({ text: 'npm test', depth: 1 });
    expect(lines.at(-1)).toMatchObject({ text: 'Process completed with exit code 1.', tone: 'error' });
  });

  test('excerpt starts at the cause, not the generic exit line', () => {
    const excerpt = errorExcerpt(raw, { context: 1 });
    expect(excerpt.lines[0]).toContain('earlier lines omitted');
    expect(excerpt.lines).toContain('FAIL src/parser.test.ts');
    expect(excerpt.lines.some((line) => line.startsWith('2026-'))).toBe(false);
  });

  test('excerpt is capped by bytes', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `error line ${i} ${'x'.repeat(60)}`).join('\n');
    const excerpt = errorExcerpt(big, { maxLines: 2000, maxBytes: 4096 });
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.lines.join('\n').length).toBeLessThanOrEqual(4096);
  });

  const GITHUB_SAMPLE = [
    '2026-11-14T10:00:00.0000000Z ##[group]Run npm test',
    '2026-11-14T10:00:00.1000000Z npm test',
    '2026-11-14T10:00:00.2000000Z ##[endgroup]',
    '2026-11-14T10:00:00.3000000Z ##[command]/usr/bin/git version',
    '2026-11-14T10:00:00.4000000Z ::warning file=a.ts,line=1::Deprecated API',
    '2026-11-14T10:00:01.0000000Z ok 1 parses',
    '2026-11-14T10:00:02.0000000Z FAIL src/parser.test.ts',
    '2026-11-14T10:00:03.0000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');
  // Captured from parseLog before dialects existed.
  const GITHUB_SAMPLE_EXPECTED: LogLine[] = [
    { text: 'Run npm test', depth: 0, group: null, tone: 'group' },
    { text: 'npm test', depth: 1, group: 'Run npm test', tone: 'normal' },
    { text: '/usr/bin/git version', depth: 0, group: null, tone: 'command' },
    { text: 'Deprecated API', depth: 0, group: null, tone: 'warning' },
    { text: 'ok 1 parses', depth: 0, group: null, tone: 'normal' },
    { text: 'FAIL src/parser.test.ts', depth: 0, group: null, tone: 'normal' },
    { text: 'Process completed with exit code 1.', depth: 0, group: null, tone: 'error' },
  ];

  test('github dialect is unchanged and the default', () => {
    expect(parseLog(GITHUB_SAMPLE)).toEqual(parseLog(GITHUB_SAMPLE, 'github'));
    expect(parseLog(GITHUB_SAMPLE, 'github')).toEqual(GITHUB_SAMPLE_EXPECTED);
  });

  test('github CRLF lines keep their markers', () => {
    const lines = parseLog('##[group]Build\r\nmake\r\n##[endgroup]\r\n', 'github');
    expect(lines[0]).toMatchObject({ text: 'Build', tone: 'group' });
    expect(lines[1]).toMatchObject({ text: 'make', depth: 1 });
  });
});

describe('gitlab dialect', () => {
  const GL = [
    'section_start:1700000000:prepare_script[collapsed=true]\r\u001b[0K\u001b[36;1mPreparing environment\u001b[0;m',
    'Running on runner-1',
    'section_end:1700000001:prepare_script\r\u001b[0K',
    'Downloading 10%\rDownloading 55%\rDownloading 100%',
    '\u001b[31;1mERROR: Job failed: exit code 1\u001b[0;m',
  ].join('\n');

  test('gitlab sections, ansi and progress lines', () => {
    const lines = parseLog(GL, 'gitlab');
    expect(lines.map((l) => [l.text, l.depth, l.tone])).toEqual([
      ['Preparing environment', 0, 'group'],
      ['Running on runner-1', 1, 'normal'],
      ['Downloading 100%', 0, 'normal'],
      ['ERROR: Job failed: exit code 1', 0, 'error'],
    ]);
    expect(lines[1]?.group).toBe('Preparing environment');
  });

  test('CRLF is a line ending, not a progress overwrite', () => {
    expect(parseLog('one\r\ntwo\r\n', 'gitlab').map((l) => l.text)).toEqual(['one', 'two']);
  });

  test('a section without a header is named after the section', () => {
    expect(parseLog('section_start:1:build_script\r\u001b[0K\nmake', 'gitlab')[0]).toMatchObject({
      text: 'build_script',
      tone: 'group',
    });
  });

  test('warnings are toned', () => {
    expect(parseLog('WARNING: cache not found', 'gitlab')[0]?.tone).toBe('warning');
  });

  test('plain keeps text as is and the gitlab excerpt skips the generic exit line', () => {
    expect(parseLog('##[group]x', 'plain')[0]).toMatchObject({ text: '##[group]x', depth: 0, tone: 'normal' });
    const ex = errorExcerpt('ok\nnpm ERR! missing script: lint\nERROR: Job failed: exit code 1', {}, 'gitlab');
    expect(ex.lines.some((l) => l.includes('missing script'))).toBe(true);
  });

  test('the gitlab excerpt has no escape codes', () => {
    const ex = errorExcerpt('\u001b[31;1mERROR: npm test failed\u001b[0;m\nERROR: Job failed: exit code 1', {}, 'gitlab');
    expect(ex.lines[0]).toBe('ERROR: npm test failed');
  });
});

test('stripAnsi removes CSI and OSC sequences', () => {
  expect(stripAnsi('\u001b[32mok\u001b[0m \u001b]8;;https://x\u0007link\u001b]8;;\u0007')).toBe('ok link');
});
