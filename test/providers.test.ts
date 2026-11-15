import { describe, expect, test } from 'bun:test';
import { parseRemote, remoteIdentity } from '../src/domain/format.ts';
import { repoKeyId, type RepoRef } from '../src/domain/repoKey.ts';
import { detectRemote, providerFor, providerOfKey, providerView, resolveRepoInput } from '../src/providers/index.ts';
import { parseVariablesObject } from '../src/providers/compat.ts';

const KEY = 'github:github.com/acme/app';

describe('parseRemote', () => {
  test('scp, ssh and https forms', () => {
    expect(parseRemote('git@github.com:acme/app.git')).toEqual({ host: 'github.com', segments: ['acme', 'app'], ssh: true });
    expect(parseRemote('ssh://git@gitlab.example.com:2222/group/sub/app.git')).toEqual({
      host: 'gitlab.example.com',
      segments: ['group', 'sub', 'app'],
      ssh: true,
    });
    expect(parseRemote('https://Code.Example.com:8443/group/app/')).toEqual({
      host: 'code.example.com:8443',
      segments: ['group', 'app'],
      ssh: false,
    });
    expect(parseRemote('')).toBeNull();
    expect(parseRemote('not a remote')).toBeNull();
  });
});

describe('remoteIdentity', () => {
  test('https, scp and ssh spellings collapse to one identity', () => {
    expect(remoteIdentity('https://codeberg.org/alicia/pixelflare.git')).toBe('codeberg.org/alicia/pixelflare');
    expect(remoteIdentity('https://user@codeberg.org:443/Alicia/PixelFlare/')).toBe('codeberg.org/alicia/pixelflare');
    expect(remoteIdentity('git@codeberg.org:Alicia/PixelFlare.git')).toBe('codeberg.org/alicia/pixelflare');
    expect(remoteIdentity('ssh://git@codeberg.org:2222/alicia/pixelflare')).toBe('codeberg.org/alicia/pixelflare');
    expect(remoteIdentity('not a url')).toBeNull();
  });
});

describe('detectRemote', () => {
  test('one repository, many spellings', () => {
    for (const url of [
      'git@github.com:acme/app.git',
      'https://github.com/acme/app/',
      'ssh://git@github.com:22/acme/app.git',
      'https://GitHub.com/acme/app.git',
      'https://user@github.com/acme/app/tree/main',
    ])
      expect(repoKeyId(detectRemote(url, [])!)).toBe(repoKeyId(KEY));
  });

  test('enterprise and unknown hosts', () => {
    expect(detectRemote('https://ghe.acme.io:8443/acme/app', [{ provider: 'github', host: 'ghe.acme.io:8443' }])).toBe(
      'github:ghe.acme.io:8443/acme/app',
    );
    expect(detectRemote('git@github.acme.io:acme/app.git', [])).toBe('github:github.acme.io/acme/app');
    expect(detectRemote('https://code.acme.io/acme/app', [])).toBeNull();
    expect(detectRemote('https://git.acme.io/acme/app', [])).toBeNull();
    expect(detectRemote('https://github.com/acme', [])).toBeNull();
  });
});

describe('registry', () => {
  test('repo input: key, url or owner/name', () => {
    expect(resolveRepoInput(KEY, [])).toBe(KEY);
    expect(resolveRepoInput('https://github.com/acme/app', [])).toBe(KEY);
    expect(resolveRepoInput('acme/app', [])).toBe(KEY);
    expect(resolveRepoInput('github.com/acme/app', [])).toBe(KEY);
    expect(resolveRepoInput('nonsense', [])).toBeNull();
  });

  test('typed owner/name spellings collapse to one repository', () => {
    for (const input of ['acme/app.git', 'acme/app/', ' acme/app.git/ ', 'github.com/acme/app.git']) {
      expect(resolveRepoInput(input, [])).toBe(KEY);
    }
  });

  test('github run urls', () => {
    expect(providerFor('github').parseRunUrl('https://github.com/acme/app/actions/runs/42/job/7')).toEqual({ repo: KEY, runId: '42' });
    expect(providerFor('github').parseRunUrl('https://github.com/acme/app/pull/42')).toBeNull();
  });

  test('keys find their provider', () => {
    expect(providerOfKey(KEY)?.id).toBe('github');
    expect(providerOfKey('acme/app')).toBeNull();
  });

  test('github urls and api origins', () => {
    const github = providerFor('github');
    const ref = { provider: 'github' as const, host: 'github.com', path: 'acme/app' };
    expect(github.webUrl(ref)).toBe('https://github.com/acme/app');
    expect(github.ciUrl(ref)).toBe('https://github.com/acme/app/actions');
    expect(github.apiOrigin('github.com')).toBe('https://api.github.com');
    expect(github.apiOrigin('ghe.acme.io')).toBe('https://ghe.acme.io/api/v3');
    expect(github.cli?.tokenArgs('ghe.acme.io')).toEqual(['auth', 'token', '--hostname', 'ghe.acme.io']);
  });

  test('views carry words and flags only', () => {
    const v = providerView(providerFor('github'));
    expect(Object.keys(v).sort()).toEqual(['capabilities', 'id', 'label', 'logDialect', 'words']);
    expect(v.words.rerunFailed).toBe('Re-run failed jobs');
    expect(v.capabilities.rerunAll).toBe('same-run');
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('gitlab provider', () => {
  const gitlab = providerFor('gitlab');

  test('gitlab remotes detect through public host, pattern and known instance', () => {
    expect(detectRemote('git@gitlab.com:g/p.git', [])).toBe('gitlab:gitlab.com/g/p');
    expect(detectRemote('https://gitlab.acme.io/g/p.git', [])).toBe('gitlab:gitlab.acme.io/g/p');
    const known = [{ provider: 'gitlab' as const, host: 'gitlab.gurunetwork.ai' }];
    expect(detectRemote('https://gitlab.gurunetwork.ai/DEXGURU/e8-markets.git', known)).toBe(
      'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets',
    );
    expect(detectRemote('git@gitlab.gurunetwork.ai:DEXGURU/e8-markets.git', known)).toBe(
      'gitlab:gitlab.gurunetwork.ai/DEXGURU/e8-markets',
    );
  });

  test('subgroups keep their whole path', () => {
    expect(detectRemote('https://gitlab.com/group/sub/deep/app', [])).toBe('gitlab:gitlab.com/group/sub/deep/app');
  });

  test('bare group/project stays a github.com repo', () => {
    expect(resolveRepoInput('DEXGURU/e8-markets', [{ provider: 'gitlab', host: 'gitlab.gurunetwork.ai' }])).toBe(
      'github:github.com/DEXGURU/e8-markets',
    );
    expect(resolveRepoInput('https://gitlab.com/g/p', [])).toBe('gitlab:gitlab.com/g/p');
  });

  test('pipeline urls parse, job urls do not', () => {
    expect(gitlab.parseRunUrl('https://gitlab.com/g/sub/app/-/pipelines/42')).toEqual({
      repo: 'gitlab:gitlab.com/g/sub/app',
      runId: '42',
    });
    expect(gitlab.parseRunUrl('https://gitlab.com/g/app/-/jobs/99')).toBeNull();
  });

  test('gitlab urls, api origin and cli', () => {
    const ref = { provider: 'gitlab' as const, host: 'gitlab.com', path: 'g/p' };
    expect(gitlab.webUrl(ref)).toBe('https://gitlab.com/g/p');
    expect(gitlab.ciUrl(ref)).toBe('https://gitlab.com/g/p/-/pipelines');
    expect(gitlab.apiOrigin('gitlab.gurunetwork.ai')).toBe('https://gitlab.gurunetwork.ai/api/v4');
    expect(gitlab.cli?.tokenArgs('gitlab.gurunetwork.ai')).toEqual([
      'config',
      'get',
      'token',
      '--host',
      'gitlab.gurunetwork.ai',
    ]);
  });

  test('providerView round-trips gitlab', () => {
    const v = providerView(gitlab);
    expect(Object.keys(v).sort()).toEqual(['capabilities', 'id', 'label', 'logDialect', 'words']);
    expect(v.label).toBe('GitLab');
    expect(v.words.rerunFailed).toBe('Retry failed jobs');
    expect(v.capabilities.rerunAll).toBe('new-pipeline');
    // No per-job retry or manual play endpoint is wired for GitLab yet.
    expect(v.capabilities.retryJob).toBe(false);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('gitea provider', () => {
  const gitea = providerFor('gitea');

  test('gitea remotes detect through public host, pattern and known instance', () => {
    expect(detectRemote('git@gitea.com:g/p.git', [])).toBe('gitea:gitea.com/g/p');
    expect(detectRemote('https://gitea.acme.io/g/p.git', [])).toBe('gitea:gitea.acme.io/g/p');
    const known = [{ provider: 'gitea' as const, host: 'gitea.internal.example' }];
    expect(detectRemote('https://gitea.internal.example/g/p.git', known)).toBe('gitea:gitea.internal.example/g/p');
    expect(detectRemote('git@gitea.internal.example:g/p.git', known)).toBe('gitea:gitea.internal.example/g/p');
  });

  test('run urls parse, job urls do not', () => {
    expect(gitea.parseRunUrl('https://gitea.com/g/p/actions/runs/91')).toEqual({
      repo: 'gitea:gitea.com/g/p',
      runId: '91',
    });
    expect(gitea.parseRunUrl('https://gitea.com/g/p/actions/runs/91/jobs/0')).toBeNull();
  });

  test('gitea urls, api origin and the absence of a cli', () => {
    const ref = { provider: 'gitea' as const, host: 'gitea.com', path: 'g/p' };
    expect(gitea.webUrl(ref)).toBe('https://gitea.com/g/p');
    expect(gitea.ciUrl(ref)).toBe('https://gitea.com/g/p/actions');
    expect(gitea.apiOrigin('gitea.acme.io')).toBe('https://gitea.acme.io/api/v1');
    expect(gitea.cli).toBeNull();
    expect(gitea.settingKey).toBe('gitea-token');
    expect(gitea.storeKey).toBe('gitea');
  });

  test('providerView round-trips gitea', () => {
    const v = providerView(gitea);
    expect(Object.keys(v).sort()).toEqual(['capabilities', 'id', 'label', 'logDialect', 'words']);
    expect(v.label).toBe('Gitea');
    expect(v.capabilities.rerunAll).toBe('same-run');
    expect(v.capabilities.cancel).toBe(false);
    expect(v.capabilities.dispatch).toBe('workflow-inputs');
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('forgejo provider', () => {
  const forgejo = providerFor('forgejo');

  test('codeberg and forgejo remotes detect through public host, pattern and known instance', () => {
    expect(detectRemote('git@codeberg.org:g/p.git', [])).toBe('forgejo:codeberg.org/g/p');
    expect(detectRemote('https://forgejo.acme.io/g/p.git', [])).toBe('forgejo:forgejo.acme.io/g/p');
    const known = [{ provider: 'forgejo' as const, host: 'forgejo.internal.example' }];
    expect(detectRemote('https://forgejo.internal.example/g/p.git', known)).toBe(
      'forgejo:forgejo.internal.example/g/p',
    );
  });

  test('run urls parse, job urls do not', () => {
    expect(forgejo.parseRunUrl('https://codeberg.org/g/p/actions/runs/71')).toEqual({
      repo: 'forgejo:codeberg.org/g/p',
      runId: '71',
    });
    expect(forgejo.parseRunUrl('https://codeberg.org/g/p/actions/runs/71/jobs/0')).toBeNull();
  });

  test('forgejo urls, api origin and the absence of a cli', () => {
    const ref = { provider: 'forgejo' as const, host: 'codeberg.org', path: 'g/p' };
    expect(forgejo.webUrl(ref)).toBe('https://codeberg.org/g/p');
    expect(forgejo.ciUrl(ref)).toBe('https://codeberg.org/g/p/actions');
    expect(forgejo.apiOrigin('forgejo.acme.io')).toBe('https://forgejo.acme.io/api/v1');
    expect(forgejo.cli).toBeNull();
    expect(forgejo.settingKey).toBe('forgejo-token');
    expect(forgejo.storeKey).toBe('forgejo');
  });

  test('providerView round-trips forgejo', () => {
    const v = providerView(forgejo);
    expect(Object.keys(v).sort()).toEqual(['capabilities', 'id', 'label', 'logDialect', 'words']);
    expect(v.label).toBe('Forgejo');
    expect(v.capabilities.rerunAll).toBe('same-run');
    expect(v.capabilities.cancel).toBe(true);
    expect(v.capabilities.rerunFailed).toBe(false);
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('woodpecker provider', () => {
  const ref = { provider: 'woodpecker' as const, host: 'ci.codeberg.org', path: 'alicia/pixelflare' };

  test('registers and never claims by host', () => {
    expect(providerFor('woodpecker').id).toBe('woodpecker');
    expect(providerOfKey('woodpecker:ci.codeberg.org/alicia/pixelflare')?.id).toBe('woodpecker');
    // Codeberg stays the forge's provider: Woodpecker claims by its server list, not by host.
    expect(detectRemote('https://codeberg.org/alicia/pixelflare', [])).toBe('forgejo:codeberg.org/alicia/pixelflare');
  });

  test('run urls stay unparsed; the server host needs the client', () => {
    expect(providerFor('woodpecker').parseRunUrl('https://ci.codeberg.org/repos/42/pipeline/128')).toBeNull();
  });

  test('urls and api origin', () => {
    const wp = providerFor('woodpecker');
    expect(wp.webUrl(ref)).toBe('https://ci.codeberg.org/repos/alicia/pixelflare');
    expect(wp.ciUrl(ref)).toBe('https://ci.codeberg.org/repos/alicia/pixelflare');
    expect(wp.apiOrigin('ci.codeberg.org')).toBe('https://ci.codeberg.org/api');
    expect(wp.repoPath(['alicia', 'pixelflare'])).toBe('alicia/pixelflare');
    expect(wp.repoPath(['alicia'])).toBeNull();
    expect(wp.settingKey).toBe('woodpecker-token');
    expect(wp.serverSetting).toBe('woodpecker-server');
    expect(wp.storeKey).toBeNull();
    expect(wp.cli).toBeNull();
  });

  test('providerView round-trips woodpecker', () => {
    const v = providerView(providerFor('woodpecker'));
    expect(Object.keys(v).sort()).toEqual(['capabilities', 'id', 'label', 'logDialect', 'words']);
    expect(v.label).toBe('Woodpecker');
    expect(v.capabilities.rerunAll).toBe('new-pipeline');
    expect(v.capabilities.rerunFailed).toBe(false);
    expect(v.capabilities.jobDetail).toBe('none');
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe('parseVariablesObject', () => {
  test('parses a JSON object string, keeping only string values', () => {
    expect(parseVariablesObject('{"a":"1","empty":""}')).toEqual({ a: '1', empty: '' });
    expect(parseVariablesObject('{"a":1}')).toEqual({});
    // An empty key is a panel draft row, never a variable to send.
    expect(parseVariablesObject('{"":"draft","a":"1"}')).toEqual({ a: '1' });
    expect(parseVariablesObject('not json')).toEqual({});
    expect(parseVariablesObject('')).toEqual({});
    expect(parseVariablesObject(null)).toEqual({});
    expect(parseVariablesObject('[1,2]')).toEqual({});
  });
});

describe('bitbucket provider', () => {
  const bitbucket = providerFor('bitbucket');
  const REF = { provider: 'bitbucket', host: 'bitbucket.org', path: 'acme/web' } as RepoRef;

  test('the registry exposes bitbucket with cloud-only claiming', () => {
    expect(bitbucket.publicHosts).toEqual(['bitbucket.org']);
    expect(bitbucket.storeKey).toBeNull();
    expect(bitbucket.settingKey).toBe('bitbucket-token');
    expect(bitbucket.authSetting).toBe('bitbucket-email');
    expect(bitbucket.cli).toBeNull();
    expect(bitbucket.capabilities).toEqual({
      rerunAll: 'new-pipeline',
      rerunFailed: false,
      cancel: true,
      retryJob: false,
      playManualJob: false,
      dispatch: 'pipeline-variables',
      jobDetail: 'none',
      groupHistory: true,
      approve: false,
    });
  });

  test('repoPath takes exactly workspace/slug', () => {
    expect(bitbucket.repoPath(['acme', 'web'])).toBe('acme/web');
    expect(bitbucket.repoPath(['acme'])).toBeNull();
    expect(bitbucket.repoPath(['acme', 'web', 'extra'])).toBeNull();
  });

  test('a bitbucket.org remote claims the repo', () => {
    expect(detectRemote('git@bitbucket.org:acme/web.git', [])).toBe('bitbucket:bitbucket.org/acme/web');
    expect(detectRemote('https://bitbucket.org/acme/web.git', [])).toBe('bitbucket:bitbucket.org/acme/web');
  });

  test('run urls parse with or without the uuid braces', () => {
    expect(bitbucket.webUrl(REF)).toBe('https://bitbucket.org/acme/web');
    expect(bitbucket.ciUrl(REF)).toBe('https://bitbucket.org/acme/web/pipelines');
    expect(bitbucket.parseRunUrl('https://bitbucket.org/acme/web/pipelines/deadbeef-1234')).toEqual({
      repo: 'bitbucket:bitbucket.org/acme/web',
      runId: 'deadbeef-1234',
    });
    expect(bitbucket.parseRunUrl('https://bitbucket.org/acme/web/pipelines/{deadbeef-1234}')).toEqual({
      repo: 'bitbucket:bitbucket.org/acme/web',
      runId: 'deadbeef-1234',
    });
    expect(bitbucket.parseRunUrl('https://bitbucket.org/acme/web')).toBeNull();
  });
});
