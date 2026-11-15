import { expect, test } from 'bun:test';
import { formatRepoKey, legacyRepoKey, parseRepoKey, repoKeyId, repoLabel, repoName, repoOwner, webHostForApi } from '../src/domain/repoKey.ts';
import { EMPTY_CONFIG } from '../src/domain/types.ts';
import { parseConfig } from '../src/service/configStore.ts';

test('keys round-trip, nested paths and ports', () => {
  expect(formatRepoKey({ provider: 'github', host: 'GitHub.com', path: 'Acme/App' })).toBe('github:github.com/Acme/App');
  expect(parseRepoKey('github:ghe.acme.io:8443/acme/app')).toEqual({ provider: 'github', host: 'ghe.acme.io:8443', path: 'acme/app' });
  expect(parseRepoKey('github:github.com/group/sub/app')?.path).toBe('group/sub/app');
  for (const bad of ['acme/app', 'svn:github.com/a/b', 'github:github.com/app', 'github:github.com/a/..', 'github:/a/b']) expect(parseRepoKey(bad)).toBeNull();
  expect(repoKeyId('github:github.com/Acme/App')).toBe(repoKeyId('github:GITHUB.com/acme/app'));
  expect(repoLabel('github:github.com/group/sub/app')).toBe('app');
  expect(repoName('github:github.com/group/sub/app')).toBe('group/sub/app');
  expect(repoOwner('github:github.com/group/sub/app')).toBe('group');
});

test('web host for an API origin', () => {
  expect(webHostForApi('https://api.github.com')).toBe('github.com');
  expect(webHostForApi('https://ghe.acme.io/api/v3')).toBe('ghe.acme.io');
});

test('parseRepoKey accepts gitlab keys', () => {
  expect(parseRepoKey('gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets')).toEqual({
    provider: 'gitlab',
    host: 'gitlab.gurunetwork.ai',
    path: 'DEXGURU/e8-markets',
  });
  expect(parseRepoKey('gitlab:gitlab.com/g/p')?.path).toBe('g/p');
  expect(parseRepoKey('gitlab:gitlab.com/app')).toBeNull();
});

test('parseRepoKey accepts gitea keys', () => {
  expect(parseRepoKey('gitea:gitea.acme.io/g/p')).toEqual({
    provider: 'gitea',
    host: 'gitea.acme.io',
    path: 'g/p',
  });
  expect(parseRepoKey('gitea:gitea.com/g/p')?.host).toBe('gitea.com');
  expect(parseRepoKey('gitea:gitea.com/app')).toBeNull();
});

test('parseRepoKey accepts forgejo keys', () => {
  expect(parseRepoKey('forgejo:codeberg.org/g/p')).toEqual({
    provider: 'forgejo',
    host: 'codeberg.org',
    path: 'g/p',
  });
  expect(parseRepoKey('forgejo:forgejo.acme.io/g/p')?.host).toBe('forgejo.acme.io');
  expect(parseRepoKey('forgejo:codeberg.org/app')).toBeNull();
});

test('parseRepoKey accepts woodpecker keys', () => {
  expect(parseRepoKey('woodpecker:ci.codeberg.org/alicia/pixelflare')).toEqual({
    provider: 'woodpecker',
    host: 'ci.codeberg.org',
    path: 'alicia/pixelflare',
  });
  expect(parseRepoKey('woodpecker:wp.acme.io:8443/g/p')?.host).toBe('wp.acme.io:8443');
  expect(parseRepoKey('woodpecker:ci.codeberg.org/app')).toBeNull();
});

test('legacy owner/name becomes a github key on its host', () => {
  expect(legacyRepoKey('acme/app')).toBe('github:github.com/acme/app');
  expect(legacyRepoKey('acme/app', 'https://ghe.acme.io/api/v3')).toBe('github:ghe.acme.io/acme/app');
  expect(legacyRepoKey('acme')).toBeNull();
});

test('a v1 config is migrated to v2', () => {
  const v1 = JSON.stringify({
    version: 1,
    repos: [
      { fullName: 'NemeZZiZZ/leonard-memento', provider: 'github', directory: '/r/lm', enabled: true, addedAt: 1 },
      { fullName: 'acme/app', provider: 'github', apiOrigin: 'https://ghe.acme.io/api/v3', enabled: false, addedAt: 2 },
      { fullName: 'not a repo', provider: 'github', enabled: true, addedAt: 3 },
    ],
    directoryMap: { '/r/lm': 'NemeZZiZZ/leonard-memento' },
  });
  expect(parseConfig(v1)).toEqual({
    version: 2,
    repos: [
      { key: 'github:github.com/NemeZZiZZ/leonard-memento', directory: '/r/lm', enabled: true, addedAt: 1 },
      { key: 'github:ghe.acme.io/acme/app', enabled: false, addedAt: 2 },
    ],
    directoryMap: { '/r/lm': 'github:github.com/NemeZZiZZ/leonard-memento' },
  });
});

test('v2 round-trips and duplicate keys collapse', () => {
  const c = {
    version: 2,
    repos: [
      { key: 'github:github.com/acme/app', enabled: true, addedAt: 1 },
      { key: 'github:github.com/ACME/app', enabled: true, addedAt: 2 },
    ],
    directoryMap: {},
  };
  expect(parseConfig(JSON.stringify(c)).repos.map((r) => r.addedAt)).toEqual([1]);
  expect(parseConfig('{"version":3}')).toEqual(EMPTY_CONFIG);
});
