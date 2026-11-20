// The lines above the tree: service and account problems, the rate limit, the
// empty state and "nothing matches".

import { h } from '../dom.ts';
import { t } from '../i18n.ts';
import { ServiceError } from '../port.ts';
import { labels } from './providers.ts';
import { button, note, type App } from './state.ts';
import { showsLoadingPlaceholder } from './overviewCache.ts';

export const renderNotes = (app: App) => {
  const { s, listNotes } = app;
  listNotes.reset();
  if (s.overviewError) {
    const serviceDown = s.overviewError instanceof ServiceError && s.overviewError.kind === 'service';
    note(listNotes, 'error', serviceDown ? t('notes.startsOnDemand') : s.overviewError.message, [
      { label: t('notes.retry'), onClick: () => void app.refreshAll() },
    ]);
    if (!s.overview) return;
  }
  const overview = s.overview;
  if (showsLoadingPlaceholder(s)) {
    listNotes.el.append(h('div', { class: 'cih-quiet', text: t('notes.lookingFor', { labels: labels(app) }) }));
    return;
  }
  if (!overview) return;
  const auth = overview.accounts.find((account) => !account.ok);
  if (auth) {
    note(
      listNotes,
      'warning',
      auth.message ?? overview.providers.find((provider) => provider.id === auth.provider)?.words.noAccount ?? t('notes.noProviderAccount', { labels: labels(app) }),
      [
        { label: t('notes.checkAgain'), onClick: () => void app.refreshAll() },
        { label: t('notes.accountHelp'), onClick: () => app.openRepos() },
      ],
    );
  }
  for (const account of overview.accounts) {
    const blockedUntil = account.rateLimit?.blockedUntil;
    if (!blockedUntil) continue;
    const at = new Date(blockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    note(listNotes, 'warning', t('notes.rateLimited', { message: at }));
  }
  if (overview.repos.length === 0) {
    const box = h(
      'div',
      { class: 'cih-empty' },
      h('strong', { text: t('notes.noProjects', { labels: labels(app) }) }),
      h('div', {
        class: 'cih-muted',
        text: t('notes.emptyHint'),
      }),
    );
    box.append(button(listNotes, { label: t('notes.addRepo'), size: 'sm', variant: 'outline', onClick: () => app.openRepos() }));
    listNotes.el.append(box);
    return;
  }
  if (s.treeRowCount === 0 && s.query.trim()) {
    listNotes.el.append(h('div', { class: 'cih-quiet', text: t('notes.noMatch', { query: s.query.trim() }) }));
  }
};
