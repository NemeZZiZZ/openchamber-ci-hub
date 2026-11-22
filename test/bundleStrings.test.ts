import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKGROUND_KEYS, BLOCK_KEYS } from '../src/ui/i18n/surfaces.ts';

const root = resolve(import.meta.dir, '..');

async function build(entry: string) {
  const result = await Bun.build({
    entrypoints: [resolve(root, entry)],
    format: 'iife',
    target: 'browser',
    minify: true,
    metafile: true,
  });
  expect(result.success).toBe(true);
  const output = result.outputs[0]!;
  const inputs = Object.keys(Object.values(result.metafile!.outputs)[0]!.inputs);
  return { code: await output.text(), inputs };
}

/** Catalog keys a source file asks for by literal: t('a.b'), tPlural('a.b', …). */
function usedKeys(file: string): string[] {
  const text = readFileSync(resolve(root, file), 'utf8');
  return [...text.matchAll(/\bt(?:Plural)?\(\s*'([a-zA-Z]+\.[a-zA-Z.]+)'/g)].map((m) => m[1]!);
}

describe.each([
  ['panel/background.ts', BACKGROUND_KEYS as readonly string[], 'background.latestOk', 'bar.board'],
  ['panel/block.ts', BLOCK_KEYS as readonly string[], 'block.rerun', 'bar.board'],
] as const)('%s', (entry, prefixes, own, foreign) => {
  test('every key its code asks for is in the picked catalog', async () => {
    const { inputs } = await build(entry);
    const sources = inputs.filter((f) => f.startsWith('src/') && !f.startsWith('src/ui/i18n'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      for (const key of usedKeys(file)) {
        expect(prefixes.some((p) => key.startsWith(p)), `${file}: ${key}`).toBe(true);
      }
      // conLabel and agoText look their keys up inside i18n.ts.
      const text = readFileSync(resolve(root, file), 'utf8');
      if (/\bconLabel\(/.test(text)) expect(prefixes, `${file}: conLabel`).toContain('con.');
      if (/\bagoText\(/.test(text)) expect(prefixes, `${file}: agoText`).toContain('ago.');
    }
  });

  test('carries its own strings in every locale and not the panel catalog', async () => {
    const { code, inputs } = await build(entry);
    expect(inputs.some((f) => /src\/ui\/i18n\/(ru|de|ja)\.ts$/.test(f))).toBe(false);
    expect(code).toContain(`"${own}"`);
    expect(code).not.toContain(`"${foreign}"`);
    expect(code.length).toBeLessThan(120_000);
  });
});
