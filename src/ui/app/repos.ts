// "Repositories and account": where the token comes from, watched repositories,
// adding one by name.

import { mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { RepoView } from '../../domain/types.ts';
import { h, slot } from '../dom.ts';
import { t } from '../i18n.ts';
import { errorText } from '../port.ts';
import { projectKey } from '../treeModel.ts';
import { labels, viewFor } from './providers.ts';
import { button, type App } from './state.ts';

export const renderRepos = (app: App) => {
  const { side, s } = app;
  side.el.append(
    h(
      'div',
      { class: 'cih-bar' },
      button(side, { label: s.wide ? t('repos.close') : t('state.backRuns'), variant: 'ghost', size: 'sm', onClick: () => app.show({ kind: 'list' }) }),
      h('span', { class: 'cih-title cih-bar-grow', text: t('repos.title') }),
    ),
  );
  const accounts = s.state?.accounts ?? [];
  side.el.append(h('div', { class: 'cih-section', text: accounts.length > 1 ? t('repos.accounts') : t('repos.account') }));
  const box = h('div', { class: 'cih-pad' });
  if (accounts.length === 0) box.append(h('div', { class: 'cih-muted', text: t('repos.checking') }));
  for (const account of accounts) {
    const who = `${account.label} on ${account.host}`;
    box.append(
      account.ok
        ? h('div', { text: `${who}: ${t('repos.signedIn', { login: account.sourceLabel ?? 'a token' })}.` })
        : h('div', { class: 'cih-note', 'data-tone': 'warning', style: 'margin:0 0 6px', text: account.message ?? `${who}: ${t('repos.noAccountYet')}.` }),
    );
  }
  const orders = [...new Set((s.state?.providers ?? []).map((provider) => provider.words.tokenOrder).filter(Boolean))];
  for (const order of orders) box.append(h('div', { class: 'cih-muted cih-small', style: 'margin-top:6px' }, order));
  box.append(h('div', { class: 'cih-actions', style: 'margin-top:8px' }, button(side, { label: t('repos.checkAgain'), size: 'xs', variant: 'outline', onClick: () => void app.refreshAll().then(() => app.renderSide()) })));
  side.el.append(box);

  side.el.append(h('div', { class: 'cih-section', text: t('repos.watched') }));
  const repos = s.state?.repos ?? [];
  if (repos.length === 0) side.el.append(h('div', { class: 'cih-pad cih-muted', text: t('repos.noneYet', { labels: labels(app) }) }));
  for (const entry of repos) {
    const where =
      entry.key === s.state?.current
        ? t('repos.thisFolder')
        : entry.origin === 'settings'
          ? t('repos.fromSettings')
          : entry.directory
            ? entry.directory.replace(/^\/Users\/[^/]+/, '~')
            : t('repos.addedByHand');
    const row = h('div', { class: 'cih-repo' }, h('div', null, h('div', { text: entry.name }), h('div', { class: 'cih-muted cih-small', text: where })));
    if (entry.origin !== 'settings') {
      row.append(
        button(side, {
          label: t('repos.remove'),
          size: 'xs',
          variant: 'ghost',
          onClick: () => {
            void app
              .svc<{ repos: unknown }>({ method: 'DELETE', path: '/repos', body: { repo: entry.key } })
              .then(async () => {
                app.toast('success', t('repos.stoppedWatching', { name: entry.name }));
                await app.loadState();
                await app.loadOverview(true);
                app.renderSide();
              })
              .catch((err: unknown) => app.toast('error', errorText(err)));
          },
        }),
      );
    }
    side.el.append(row);
  }

  const form = h('div', { class: 'cih-form' });
  const fieldAt = slot();
  side.keep(
    mountTextField(fieldAt, {
      label: t('repos.addRepo'),
      value: s.addRepoValue,
      placeholder: viewFor(app, s.state?.current ?? null).words.repoPlaceholder,
      mono: true,
      error: s.addRepoError ?? undefined,
      onChange: (value) => {
        s.addRepoValue = value;
      },
    }),
  );
  form.append(fieldAt);
  if (s.directory) {
    const at = slot();
    side.keep(
      mountCheckbox(at, {
        label: t('repos.useFolder'),
        description: t('repos.useHere'),
        checked: s.addRepoForFolder,
        onChange: (checked) => {
          s.addRepoForFolder = checked;
          app.renderSide();
        },
      }),
    );
    form.append(at);
  }
  form.append(
    h(
      'div',
      { class: 'cih-actions' },
      button(side, {
        label: t('repos.add'),
        size: 'sm',
        loading: s.addingRepo,
        onClick: () => {
          const input = s.addRepoValue.trim();
          if (!input) {
            s.addRepoError = t('repos.repoHint');
            app.renderSide();
            return;
          }
          const before = new Set((s.state?.repos ?? []).map((repo) => repo.key.toLowerCase()));
          s.addingRepo = true;
          s.addRepoError = null;
          app.renderSide();
          void app
            .svc<{ repos: RepoView[] }>({ method: 'POST', path: '/repos', body: { repo: input, directory: s.addRepoForFolder ? s.directory : undefined } })
            .then(async ({ repos }) => {
              const added = repos.find((repo) => !before.has(repo.key.toLowerCase()));
              app.toast('success', t('repos.watchingNow', { name: added?.name ?? input }));
              s.addRepoValue = '';
              if (added) s.expanded.add(projectKey(added.key));
              await app.loadState();
              await app.loadOverview(true);
            })
            .catch((err: unknown) => {
              s.addRepoError = errorText(err);
            })
            .finally(() => {
              s.addingRepo = false;
              if (s.view.kind === 'repos') app.renderSide();
            });
        },
      }),
    ),
  );
  side.el.append(form);
};
