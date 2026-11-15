// The lines above the tree: service and account problems, the rate limit, the
// empty state and "nothing matches".

import { h } from '../dom.ts';
import { ServiceError } from '../port.ts';
import { labels } from './providers.ts';
import { button, note, type App } from './state.ts';
import { showsLoadingPlaceholder } from './overviewCache.ts';

export const renderNotes = (app: App) => {
  const { s, listNotes } = app;
  listNotes.reset();
  if (s.overviewError) {
    const serviceDown = s.overviewError instanceof ServiceError && s.overviewError.kind === 'service';
    note(
      listNotes,
      'error',
      serviceDown ? `${s.overviewError.message} It starts on demand; try again in a moment.` : s.overviewError.message,
      [{ label: 'Try again', onClick: () => void app.refreshAll() }],
    );
    if (!s.overview) return;
  }
  const overview = s.overview;
  if (showsLoadingPlaceholder(s)) {
    listNotes.el.append(h('div', { class: 'cih-quiet', text: `Looking for ${labels(app)} projects…` }));
    return;
  }
  if (!overview) return;
  const auth = overview.accounts.find((account) => !account.ok);
  if (auth) {
    note(
      listNotes,
      'warning',
      auth.message ?? overview.providers.find((provider) => provider.id === auth.provider)?.words.noAccount ?? `No ${auth.label} account for ${auth.host}.`,
      [
        { label: 'Check again', onClick: () => void app.refreshAll() },
        { label: 'Account help', onClick: () => app.openRepos() },
      ],
    );
  }
  for (const account of overview.accounts) {
    const blockedUntil = account.rateLimit?.blockedUntil;
    if (!blockedUntil) continue;
    const at = new Date(blockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    note(listNotes, 'warning', `${account.label} (${account.host}) asked CI Hub to slow down. Its projects resume at ${at}; what you see is from before.`);
  }
  if (overview.repos.length === 0) {
    const box = h(
      'div',
      { class: 'cih-empty' },
      h('strong', { text: `No ${labels(app)} projects yet` }),
      h('div', {
        class: 'cih-muted',
        text: `CI Hub lists every OpenChamber project whose folder has a ${labels(app)} remote. You can also watch a repository by name.`,
      }),
    );
    box.append(button(listNotes, { label: 'Add a repository', size: 'sm', variant: 'outline', onClick: () => app.openRepos() }));
    listNotes.el.append(box);
    return;
  }
  if (s.treeRowCount === 0 && s.query.trim()) {
    listNotes.el.append(h('div', { class: 'cih-quiet', text: `No project or workflow matches “${s.query.trim()}”.` }));
  }
};
