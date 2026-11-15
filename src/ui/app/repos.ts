// "Repositories and account": where the token comes from, watched repositories,
// adding one by name.

import { mountCheckbox, mountTextField } from '@openchamber/sdk/ui';
import type { RepoView } from '../../domain/types.ts';
import { h, slot } from '../dom.ts';
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
      button(side, { label: s.wide ? 'Close' : '← Runs', variant: 'ghost', size: 'sm', onClick: () => app.show({ kind: 'list' }) }),
      h('span', { class: 'cih-title cih-bar-grow', text: 'Repositories and account' }),
    ),
  );
  const accounts = s.state?.accounts ?? [];
  side.el.append(h('div', { class: 'cih-section', text: accounts.length > 1 ? 'Accounts' : 'Account' }));
  const box = h('div', { class: 'cih-pad' });
  if (accounts.length === 0) box.append(h('div', { class: 'cih-muted', text: 'Checking accounts…' }));
  for (const account of accounts) {
    const who = `${account.label} on ${account.host}`;
    box.append(
      account.ok
        ? h('div', { text: `${who}: signed in with ${account.sourceLabel ?? 'a token'}.` })
        : h('div', { class: 'cih-note', 'data-tone': 'warning', style: 'margin:0 0 6px', text: account.message ?? `${who}: no account yet.` }),
    );
  }
  const orders = [...new Set((s.state?.providers ?? []).map((provider) => provider.words.tokenOrder).filter(Boolean))];
  for (const order of orders) box.append(h('div', { class: 'cih-muted cih-small', style: 'margin-top:6px' }, order));
  box.append(h('div', { class: 'cih-actions', style: 'margin-top:8px' }, button(side, { label: 'Check again', size: 'xs', variant: 'outline', onClick: () => void app.refreshAll().then(() => app.renderSide()) })));
  side.el.append(box);

  side.el.append(h('div', { class: 'cih-section', text: 'Watched repositories' }));
  const repos = s.state?.repos ?? [];
  if (repos.length === 0) side.el.append(h('div', { class: 'cih-pad cih-muted', text: `None yet. The folder’s ${labels(app)} remote is added on its own; add others below.` }));
  for (const entry of repos) {
    const where =
      entry.key === s.state?.current
        ? 'this folder'
        : entry.origin === 'settings'
          ? 'from the CI Hub settings'
          : entry.directory
            ? entry.directory.replace(/^\/Users\/[^/]+/, '~')
            : 'added by hand';
    const row = h('div', { class: 'cih-repo' }, h('div', null, h('div', { text: entry.name }), h('div', { class: 'cih-muted cih-small', text: where })));
    if (entry.origin !== 'settings') {
      row.append(
        button(side, {
          label: 'Remove',
          size: 'xs',
          variant: 'ghost',
          onClick: () => {
            void app
              .svc<{ repos: unknown }>({ method: 'DELETE', path: '/repos', body: { repo: entry.key } })
              .then(async () => {
                app.toast('success', `Stopped watching ${entry.name}.`);
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
      label: 'Add a repository',
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
        label: 'Use it for this folder',
        description: 'The panel and the Work Status section open on it here, instead of the git remote.',
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
        label: 'Add',
        size: 'sm',
        loading: s.addingRepo,
        onClick: () => {
          const input = s.addRepoValue.trim();
          if (!input) {
            s.addRepoError = 'Enter a repository, for example cli/cli or its URL.';
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
              app.toast('success', `Watching ${added?.name ?? input}.`);
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
