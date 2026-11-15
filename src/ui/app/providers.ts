// The provider a repository belongs to, as the service describes it: its name,
// its words and what it can do. Surfaces take copy and buttons from here.

import { parseRepoKey, type RepoKey } from '../../domain/repoKey.ts';
import type { ProviderView } from '../../domain/types.ts';
import type { App } from './state.ts';

/** What a surface needs of a provider; the id only matters where providers are listed. */
type ProviderCopy = Omit<ProviderView, 'id'>;

/** Until the service has answered: neutral words, nothing offered, no provider. */
const UNKNOWN: ProviderCopy = {
  label: 'CI',
  words: {
    run: 'run',
    runs: 'runs',
    workflow: 'workflow',
    workflows: 'workflows',
    rerunFailed: 'Re-run failed jobs',
    rerunFailedShort: 'Re-run failed',
    rerunAll: 'Re-run all jobs',
    rerunAllShort: 'Re-run all',
    cancelDelay: 'It may take a few seconds to stop.',
    logPending: 'The log appears when the job finishes.',
    logMissing: 'There is no log for this job.',
    dispatchHelp: '',
    repoPlaceholder: 'owner/name or a repository URL',
    tokenOrder: '',
    noAccount: 'No account for this host.',
  },
  capabilities: {
    rerunAll: null,
    rerunFailed: false,
    cancel: false,
    retryJob: false,
    playManualJob: false,
    dispatch: null,
    jobDetail: 'steps',
    approve: false,
    groupHistory: false,
  },
  logDialect: 'plain',
};

/** Every provider's name, for copy that is not about one repository. */
export const known = (app: App): ProviderView[] => app.s.overview?.providers ?? app.s.state?.providers ?? [];

export const viewFor = (app: App, key: RepoKey | null): ProviderCopy => {
  const providers = known(app);
  const id = key ? parseRepoKey(key)?.provider : undefined;
  return providers.find((provider) => provider.id === id) ?? providers[0] ?? UNKNOWN;
};

/** Every provider's name, for copy that is not about one repository. */
export const labels = (app: App): string => {
  const names = known(app).map((provider) => provider.label);
  return names.length > 0 ? names.join(' or ') : 'CI';
};
