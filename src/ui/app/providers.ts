// The provider a repository belongs to, as the service describes it: its name,
// its words and what it can do. Surfaces take copy and buttons from here.

import { parseRepoKey, type RepoKey } from '../../domain/repoKey.ts';
import type { ProviderView } from '../../domain/types.ts';
import { t } from '../i18n.ts';
import type { App } from './state.ts';

/** What a surface needs of a provider; the id only matters where providers are listed. */
type ProviderCopy = Omit<ProviderView, 'id'>;

/**
 * Until the service has answered: neutral words, nothing offered, no provider.
 * Built lazily (not module-level) so it follows the active locale; every word
 * comes from the catalog, so nothing here names a provider host.
 */
export const unknownCopy = (): ProviderCopy => ({
  label: 'CI',
  words: {
    run: t('noun.run'),
    runs: t('noun.runs'),
    workflow: t('noun.workflow'),
    workflows: t('noun.workflows'),
    rerunFailed: t('providers.rerunFailedJobs'),
    rerunFailedShort: t('providers.rerunFailed'),
    rerunAll: t('providers.rerunAllJobs'),
    rerunAllShort: t('providers.rerunAll'),
    cancelDelay: t('providers.stopping'),
    logPending: t('providers.logWhenDone'),
    logMissing: t('providers.noJobLog'),
    dispatchHelp: '',
    repoPlaceholder: t('providers.repoPlaceholder'),
    tokenOrder: '',
    noAccount: t('providers.noAccount'),
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
});

/** Every provider's name, for copy that is not about one repository. */
export const known = (app: App): ProviderView[] => app.s.overview?.providers ?? app.s.state?.providers ?? [];

export const viewFor = (app: App, key: RepoKey | null): ProviderCopy => {
  const providers = known(app);
  const id = key ? parseRepoKey(key)?.provider : undefined;
  return providers.find((provider) => provider.id === id) ?? providers[0] ?? unknownCopy();
};

/** Every provider's name, for copy that is not about one repository. */
export const labels = (app: App): string => {
  const names = known(app).map((provider) => provider.label);
  return names.length > 0 ? names.join(' or ') : 'CI';
};
