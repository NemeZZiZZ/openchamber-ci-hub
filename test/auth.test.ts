import { describe, expect, test } from 'bun:test';
import { providerFor } from '../src/providers/index.ts';
import type { Provider } from '../src/providers/types.ts';
import { knownInstances, resolveToken, serverOf, sourceLabel, tokenFromStore, type AuthDeps } from '../src/service/auth.ts';
import { woodpecker } from '../src/providers/woodpecker.ts';

const cred = (token: string) => ({ credentials: [{ credentialId: 'a', token, status: 'valid' }] });

describe('credential store', () => {
  const store = (status: string) =>
    JSON.stringify({
      providers: {
        github: {
          instances: {
            'https://github.com': {
              activeCredentialId: 'b',
              credentials: [
                { credentialId: 'a', token: 'old', status: 'valid' },
                { credentialId: 'b', accessToken: 'active', status },
              ],
            },
          },
        },
      },
    });
  test('active valid credential wins', () => {
    expect(tokenFromStore(store('valid'), 'github', 'github.com')).toBe('active');
  });
  test('an invalid active credential falls back to a valid one', () => {
    expect(tokenFromStore(store('invalid'), 'github', 'github.com')).toBe('old');
  });
  test('garbage means no credential', () => {
    expect(tokenFromStore('{', 'github', 'github.com')).toBeNull();
    expect(tokenFromStore(undefined, 'github', 'github.com')).toBeNull();
  });
  test('another provider key never answers', () => {
    expect(tokenFromStore(store('valid'), 'gitlab', 'github.com')).toBeNull();
  });
  test('a null store key never reads the store', () => {
    const mistyped = JSON.stringify({ providers: { null: { instances: { 'https://wp.acme.io': cred('stored') } } } });
    expect(tokenFromStore(mistyped, null, 'wp.acme.io')).toBeNull();
    expect(tokenFromStore(store('valid'), null, 'github.com')).toBeNull();
  });
});

describe('resolveToken', () => {
  const github = providerFor('github');
  const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => ({ 'github-token': 'pasted' }),
    cliToken: async () => 'from-gh',
    ...over,
  });

  test('store, then the pasted token, then gh', async () => {
    const store = JSON.stringify({ providers: { github: { instances: { 'https://github.com': cred('stored') } } } });
    expect(await resolveToken(deps({ readStore: async () => store }), github, 'github.com')).toEqual({ token: 'stored', source: 'openchamber' });
    expect(await resolveToken(deps(), github, 'github.com')).toEqual({ token: 'pasted', source: 'setting' });
    expect(await resolveToken(deps({ readSettings: async () => ({}) }), github, 'github.com')).toEqual({ token: 'from-gh', source: 'cli' });
  });

  test('a provider with no store key skips the store, pasted still answers', async () => {
    const wp: Provider = {
      ...github,
      id: 'woodpecker',
      label: 'Woodpecker',
      publicHosts: ['wp.acme.io'],
      storeKey: null,
      settingKey: 'woodpecker-token',
      cli: null,
    };
    const store = JSON.stringify({ providers: { github: { instances: { 'https://wp.acme.io': cred('stored') } } } });
    const result = await resolveToken(
      deps({ readStore: async () => store, readSettings: async () => ({ 'woodpecker-token': 'pasted' }) }),
      wp,
      'wp.acme.io',
    );
    expect(result).toEqual({ token: 'pasted', source: 'setting' });
  });

  test('another host never gets the pasted github.com token', async () => {
    const calls: [string, string[]][] = [];
    const result = await resolveToken(
      deps({ cliToken: async (program, args) => (calls.push([program, args]), null) }),
      github,
      'github.evil.com',
    );
    expect(result.token).toBeNull();
    expect(calls).toEqual([['gh', ['auth', 'token', '--hostname', 'github.evil.com']]]);
    if (result.token === null)
      expect(result.message).toBe(
        'No GitHub account for github.evil.com. Connect that server in OpenChamber or run gh auth login --hostname github.evil.com.',
      );
  });

  test('github.com without any token keeps the old line', async () => {
    const result = await resolveToken(deps({ readSettings: async () => ({}), cliToken: async () => null }), github, 'github.com');
    if (result.token !== null) throw new Error('expected no token');
    expect(result.message).toBe(
      'No GitHub account for github.com. Connect GitHub in OpenChamber, paste a token on the CI Hub card, or run gh auth login.',
    );
  });

  test('credentials never cross hosts or providers', async () => {
    const raw = JSON.stringify({
      providers: {
        gitlab: { instances: { 'https://gitlab.com': cred('glpat') } },
        github: { instances: { 'https://ghe.acme.io': cred('ghe-token') } },
      },
    });
    const calls: string[][] = [];
    const all = deps({
      readStore: async () => raw,
      readSettings: async () => ({ 'github-token': 'pasted' }),
      cliToken: async (_p, a) => (calls.push(a), null),
    });
    expect((await resolveToken(all, github, 'github.com')).token).toBe('pasted');
    expect((await resolveToken(all, github, 'ghe.acme.io')).token).toBe('ghe-token');
    expect((await resolveToken(all, github, 'github.evil.com')).token).toBeNull();
    expect(calls).toEqual([['auth', 'token', '--hostname', 'github.evil.com']]);
  });

  test('source labels name the provider CLI', () => {
    expect(sourceLabel('openchamber', github)).toBe('OpenChamber account');
    expect(sourceLabel('setting', github)).toBe('token on the CI Hub card');
    expect(sourceLabel('cli', github)).toBe('gh CLI');
  });
});

describe('known instances', () => {
  test('known instances come from registered providers only', () => {
    const raw = JSON.stringify({
      providers: {
        gitlab: { instances: { 'https://gitlab.gurunetwork.ai': cred('x') } },
        github: { instances: { 'https://ghe.acme.io/': cred('y') } },
        bitbucket: { instances: { 'https://bitbucket.org': cred('z') } },
      },
    });
    expect(knownInstances(raw)).toEqual([
      { provider: 'github', host: 'ghe.acme.io' },
      { provider: 'gitlab', host: 'gitlab.gurunetwork.ai' },
    ]);
  });
  test('garbage means none', () => {
    expect(knownInstances('{')).toEqual([]);
    expect(knownInstances(undefined)).toEqual([]);
  });
});

describe('gitlab tokens', () => {
  const gitlab = providerFor('gitlab');
  const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => ({ 'gitlab-token': 'pasted' }),
    cliToken: async () => null,
    ...over,
  });

  test('a gitlab instance credential is found by host', () => {
    const raw = JSON.stringify({ providers: { gitlab: { instances: { 'https://gitlab.gurunetwork.ai': cred('glpat') } } } });
    expect(tokenFromStore(raw, 'gitlab', 'gitlab.gurunetwork.ai')).toBe('glpat');
    expect(tokenFromStore(raw, 'gitlab', 'gitlab.com')).toBeNull();
  });

  test('the pasted gitlab token only goes to gitlab.com', async () => {
    expect((await resolveToken(deps(), gitlab, 'gitlab.com')).token).toBe('pasted');
    const other = await resolveToken(deps(), gitlab, 'gitlab.example.com');
    expect(other.token).toBeNull();
    if (other.token === null)
      expect(other.message).toBe(
        'No GitLab account for gitlab.example.com. Connect that server in OpenChamber or run glab auth login --hostname gitlab.example.com.',
      );
  });

  test('source labels name glab', () => {
    expect(sourceLabel('cli', gitlab)).toBe('glab CLI');
  });
});

describe('gitea tokens', () => {
  const gitea = providerFor('gitea');
  const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => ({ 'gitea-token': 'pasted' }),
    cliToken: async () => null,
    ...over,
  });

  test('a gitea instance credential is found by host', () => {
    const raw = JSON.stringify({ providers: { gitea: { instances: { 'https://gitea.internal.example': cred('gt') } } } });
    expect(tokenFromStore(raw, 'gitea', 'gitea.internal.example')).toBe('gt');
    expect(tokenFromStore(raw, 'gitea', 'gitea.com')).toBeNull();
  });

  test('the pasted gitea token only goes to gitea.com', async () => {
    expect((await resolveToken(deps(), gitea, 'gitea.com')).token).toBe('pasted');
    const other = await resolveToken(deps(), gitea, 'gitea.example.com');
    expect(other.token).toBeNull();
    if (other.token === null)
      expect(other.message).toBe('No Gitea account for gitea.example.com. Connect that server in OpenChamber.');
  });

  test('source labels never claim a cli gitea does not have', () => {
    expect(sourceLabel('setting', gitea)).toBe('token on the CI Hub card');
  });
});

describe('forgejo tokens', () => {
  const forgejo = providerFor('forgejo');
  const deps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => ({ 'forgejo-token': 'pasted' }),
    cliToken: async () => null,
    ...over,
  });

  test('a forgejo instance credential is found by host', () => {
    const raw = JSON.stringify({
      providers: { forgejo: { instances: { 'https://forgejo.internal.example': cred('fj') } } },
    });
    expect(tokenFromStore(raw, 'forgejo', 'forgejo.internal.example')).toBe('fj');
    expect(tokenFromStore(raw, 'forgejo', 'codeberg.org')).toBeNull();
  });

  test('the pasted forgejo token only goes to codeberg.org', async () => {
    expect((await resolveToken(deps(), forgejo, 'codeberg.org')).token).toBe('pasted');
    const other = await resolveToken(deps(), forgejo, 'forgejo.example.com');
    expect(other.token).toBeNull();
    if (other.token === null)
      expect(other.message).toBe('No Forgejo account for forgejo.example.com. Connect that server in OpenChamber.');
  });
});

describe('server-backed settings (woodpecker)', () => {
  const woodpecker = providerFor('woodpecker');
  const wpDeps = (settings: Record<string, string>): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => settings,
    cliToken: async () => null,
  });

  test('serverOf parses the server setting', () => {
    expect(serverOf({ 'woodpecker-server': 'ci.codeberg.org' }, woodpecker)).toEqual({
      origin: 'https://ci.codeberg.org',
      host: 'ci.codeberg.org',
    });
    expect(serverOf({ 'woodpecker-server': 'http://ci.lan:8000/' }, woodpecker)).toEqual({
      origin: 'http://ci.lan:8000',
      host: 'ci.lan:8000',
    });
    expect(serverOf({ 'woodpecker-server': '  https://CI.Codeberg.org ' }, woodpecker)?.host).toBe('ci.codeberg.org');
    expect(serverOf({ 'woodpecker-server': '' }, woodpecker)).toBeNull();
    expect(serverOf({}, woodpecker)).toBeNull();
  });

  test('the token answers on the configured server host only', async () => {
    const settings = { 'woodpecker-server': 'ci.codeberg.org', 'woodpecker-token': 'wp' };
    expect(await resolveToken(wpDeps(settings), woodpecker, 'ci.codeberg.org')).toEqual({ token: 'wp', source: 'setting' });
    const missing = await resolveToken(wpDeps(settings), woodpecker, 'evil.example');
    expect(missing.token).toBeNull();
  });

  test('a token without a server is never read', async () => {
    const missing = await resolveToken(wpDeps({ 'woodpecker-token': 'wp' }), woodpecker, 'ci.codeberg.org');
    expect(missing.token).toBeNull();
  });

  test('a server without a token explains the two settings, not OpenChamber', async () => {
    const missing = await resolveToken(wpDeps({ 'woodpecker-server': 'ci.codeberg.org' }), woodpecker, 'ci.codeberg.org');
    expect(missing.token).toBeNull();
    if (missing.token === null) {
      expect(missing.message).toContain('woodpecker-server');
      expect(missing.message).toContain('woodpecker-token');
      expect(missing.message).not.toContain('OpenChamber');
    }
  });
});

describe('server setting edge cases (review minors)', () => {
  test('a server url with a path is rejected, not silently cut', () => {
    expect(serverOf({ 'woodpecker-server': 'https://ci.example.com/woodpecker' }, woodpecker)).toBeNull();
  });
});

describe('companion credential setting (bitbucket)', () => {
  const bbDeps = (settings: Record<string, string>): AuthDeps => ({
    readStore: async () => undefined,
    readSettings: async () => settings,
    cliToken: async () => null,
  });
  const bitbucket = {
    ...providerFor('github'),
    id: 'bitbucket',
    label: 'Bitbucket',
    publicHosts: ['bitbucket.org'],
    storeKey: null,
    serverSetting: null,
    settingKey: 'bitbucket-token',
    authSetting: 'bitbucket-email',
    cli: null,
  } as unknown as Provider;

  test('a token without the companion setting is withheld and both fields are named', async () => {
    const missing = await resolveToken(bbDeps({ 'bitbucket-token': 't' }), bitbucket, 'bitbucket.org');
    expect(missing.token).toBeNull();
    if (missing.token === null) {
      expect(missing.message).toContain('bitbucket-email');
      expect(missing.message).toContain('bitbucket-token');
      expect(missing.message).toContain('bitbucket.org');
    }
  });

  test('email and token together answer as a setting', async () => {
    const result = await resolveToken(bbDeps({ 'bitbucket-email': 'a@b.co', 'bitbucket-token': 't' }), bitbucket, 'bitbucket.org');
    expect(result).toEqual({ token: 't', source: 'setting' });
  });
});
