// The provider registry: which provider a remote, a key or a typed-in name
// belongs to. Nothing above `src/providers` asks which provider it is talking
// to; it asks the registry and reads the provider's words and capabilities.

import { parseRemote } from '../domain/format.ts';
import { formatRepoKey, legacyRepoKey, parseRepoKey, type RepoKey } from '../domain/repoKey.ts';
import type { ProviderId, ProviderView } from '../domain/types.ts';
import { forgejo } from './forgejo.ts';
import { bitbucket } from './bitbucket.ts';
import { gitea } from './gitea.ts';
import { github } from './github.ts';
import { gitlab } from './gitlab.ts';
import { woodpecker } from './woodpecker.ts';
import type { Provider } from './types.ts';

export { woodpecker } from './woodpecker.ts';

export const PROVIDERS: readonly Provider[] = [github, gitlab, gitea, forgejo, woodpecker, bitbucket];

export const providerFor = (id: ProviderId): Provider => {
  const provider = PROVIDERS.find((entry) => entry.id === id);
  if (!provider) throw new Error(`Unknown CI provider: ${id}`);
  return provider;
};

export const providerOfKey = (key: RepoKey): Provider | null => {
  const ref = parseRepoKey(key);
  return ref ? providerFor(ref.provider) : null;
};

/** A self-hosted server connected in OpenChamber. */
export interface KnownInstance {
  provider: ProviderId;
  host: string;
}

const withoutPort = (host: string): string => host.replace(/:\d+$/, '');

// Exact public host, then a connected server, then a name pattern. An ssh
// remote carries no web port, so a connected server matches by name alone and
// lends the key its own host.
const hostOwner = (host: string, ssh: boolean, known: readonly KnownInstance[]): { provider: Provider; host: string } | null => {
  for (const provider of PROVIDERS) if (provider.publicHosts.includes(host)) return { provider, host };
  const instance = known.find((entry) =>
    ssh ? withoutPort(entry.host.toLowerCase()) === host : entry.host.toLowerCase() === host,
  );
  if (instance) return { provider: providerFor(instance.provider), host: instance.host.toLowerCase() };
  for (const provider of PROVIDERS) if (provider.hostPattern?.test(withoutPort(host))) return { provider, host };
  return null;
};

/** A git remote URL → its repository key, or null when the host is not a known CI host. */
export const detectRemote = (url: string, known: readonly KnownInstance[]): RepoKey | null => {
  const parts = parseRemote(url);
  if (!parts) return null;
  const owner = hostOwner(parts.host, parts.ssh, known);
  if (!owner) return null;
  const path = owner.provider.repoPath(parts.segments);
  if (path === null) return null;
  const key = formatRepoKey({ provider: owner.provider.id, host: owner.host, path });
  return parseRepoKey(key) ? key : null;
};

/** What someone typed to watch a repository: a key, a URL, `host/path` or `owner/name`. */
export const resolveRepoInput = (input: string, known: readonly KnownInstance[]): RepoKey | null => {
  const value = input.trim();
  if (value === '') return null;
  const ref = parseRepoKey(value);
  if (ref) return formatRepoKey(ref);
  if (value.includes('://') || value.includes('@')) return detectRemote(value, known);
  const first = value.split('/')[0] ?? '';
  if (first.includes('.')) return detectRemote(`https://${value}`, known);
  return legacyRepoKey(value.replace(/\/+$/, '').replace(/\.git$/, ''));
};

/** The serialisable part the panel receives. */
export const providerView = (provider: Provider): ProviderView => ({
  id: provider.id,
  label: provider.label,
  words: provider.words,
  capabilities: provider.capabilities,
  logDialect: provider.logDialect,
});
