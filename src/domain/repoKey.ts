// A repository is named by its CI provider, the host it lives on and its path
// there: `github:github.com/owner/name`, `gitlab:gitlab.com/group/sub/app`.
// The key is what config, caches, waits and the panel pass around.

import { PROVIDER_IDS, type ProviderId } from './types.ts';

export interface RepoRef {
  provider: ProviderId;
  host: string;
  path: string;
}

export type RepoKey = string;

const HOST = /^[a-z0-9.-]+(:\d+)?$/;
// Path segments go into API URLs, so `.` and `..` must never pass.
const SEGMENT = /^(?!\.\.?$)[\w.-]+$/;

const isProvider = (value: string): value is ProviderId => (PROVIDER_IDS as readonly string[]).includes(value);

export const formatRepoKey = (ref: RepoRef): RepoKey => `${ref.provider}:${ref.host.toLowerCase()}/${ref.path}`;

export const parseRepoKey = (key: string): RepoRef | null => {
  const colon = key.indexOf(':');
  if (colon <= 0) return null;
  const provider = key.slice(0, colon);
  if (!isProvider(provider)) return null;
  const rest = key.slice(colon + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const host = rest.slice(0, slash).toLowerCase();
  const path = rest.slice(slash + 1);
  if (!HOST.test(host)) return null;
  const segments = path.split('/');
  if (segments.length < 2 || !segments.every((segment) => SEGMENT.test(segment))) return null;
  return { provider, host, path };
};

/** Case-folded identity: the same repository however it was spelled. */
export const repoKeyId = (key: RepoKey): string => key.toLowerCase();

const pathOf = (key: RepoKey): string => parseRepoKey(key)?.path ?? key;

export const repoName = (key: RepoKey): string => pathOf(key);

export const repoLabel = (key: RepoKey): string => {
  const segments = pathOf(key).split('/');
  return segments[segments.length - 1] || key;
};

export const repoOwner = (key: RepoKey): string => pathOf(key).split('/')[0] ?? '';

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** `api.github.com` → `github.com`; an Enterprise API origin keeps its host. */
export const webHostForApi = (apiOrigin: string): string => {
  const host = hostOf(apiOrigin) ?? 'api.github.com';
  return host === 'api.github.com' ? 'github.com' : host;
};

// What config v1 accepted as a repository name.
const LEGACY_NAME = /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/;

/** Config v1 `owner/name` (+ optional API origin) → its v2 key. */
export const legacyRepoKey = (fullName: string, apiOrigin?: string): RepoKey | null => {
  if (!LEGACY_NAME.test(fullName)) return null;
  return formatRepoKey({ provider: 'github', host: webHostForApi(apiOrigin ?? 'https://api.github.com'), path: fullName });
};
