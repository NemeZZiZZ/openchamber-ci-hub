import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Everything a provider decides lives in src/providers. Above it, code reads
// the provider view (label, words, capabilities) and never names a host.

const ROOT = join(import.meta.dir, '..');
// A comparison against a literal provider id is branching on one provider;
// comparing two ids (`entry.provider === provider.id`) is not.
const LEAK = /GitHub|github\.com|\.github\/|\bgh auth\b|provider\s*===\s*['"`]|id\s*===\s*'github'|id\s*[:=]\s*['"`](?:github|gitlab|gitea|forgejo|woodpecker|bitbucket)['"`]/g;

// Literals that must stay: the v1 config only knew GitHub.
const ALLOWED: Record<string, string[]> = {
  'src/domain/repoKey.ts': ['github.com'],
};

const sources = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('no provider specifics above src/providers', () => {
  const files = ['src/domain', 'src/service', 'src/ui'].flatMap(sources);
  expect(files.length).toBeGreaterThan(20);
  for (const f of files) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    const allowed = ALLOWED[f] ?? [];
    const hits = (code.match(LEAK) ?? []).filter((hit) => !allowed.includes(hit));
    expect({ f, hits }).toEqual({ f, hits: [] });
  }
});

test('the guard sees a leak', () => {
  const code = stripComments("const url = 'https://github.com/x'; // GitHub\nif (p.provider === 'gitlab') {}\nconst fallback = { id: 'github' };\nconst sixth = { id: 'bitbucket' };");
  expect(code.match(LEAK)).toEqual(['github.com', "provider === '", "id: 'github'", "id: 'bitbucket'"]);
  expect(stripComments('if (entry.provider === provider.id) {}').match(LEAK)).toBeNull();
});
