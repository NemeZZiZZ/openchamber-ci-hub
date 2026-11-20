// Confirmations before a write, the writes themselves, and the hand-off of a
// run to an agent session.

import type { StartSessionRequest } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';
import { EXTENSION_ID, type Run } from '../../domain/types.ts';
import { h, slot } from '../dom.ts';
import { t } from '../i18n.ts';
import { errorText } from '../port.ts';
import { viewFor } from './providers.ts';
import { button, type App, type Confirm, type HandoffResponse, type RunActionKind } from './state.ts';

const renderConfirm = (app: App) => {
  const { s, confirmRegion } = app;
  confirmRegion.reset();
  if (!s.confirm) return;
  const current = s.confirm;
  let working = false;
  const box = h('div', { class: 'cih-note', 'data-tone': current.destructive ? 'error' : 'warning', role: 'alertdialog' }, h('div', { text: current.message }));
  const row = h('div', { class: 'cih-note-actions' });
  const go = slot();
  const goHandle = confirmRegion.keep(
    mountButton(go, {
      label: current.label,
      size: 'xs',
      variant: current.destructive ? 'destructive' : 'default',
      onClick: () => {
        if (working) return;
        working = true;
        goHandle.update({ loading: true });
        void current
          .work()
          .catch((err: unknown) => app.toast('error', errorText(err)))
          .finally(() => {
            if (s.confirm === current) {
              s.confirm = null;
              renderConfirm(app);
            }
          });
      },
    }),
  );
  row.append(
    go,
    button(confirmRegion, {
      label: t('confirm.keepAsIs'),
      size: 'xs',
      variant: 'ghost',
      onClick: () => {
        s.confirm = null;
        renderConfirm(app);
      },
    }),
  );
  box.append(row);
  confirmRegion.el.append(box);
};

export const ask = (app: App, next: Confirm) => {
  app.s.confirm = next;
  renderConfirm(app);
  app.confirmRegion.el.scrollIntoView({ block: 'nearest' });
};

export const askAction = (app: App, run: Run, kind: RunActionKind) => {
  const s = app.s;
  const name = `${run.workflow} #${run.number}`;
  const { words, capabilities } = viewFor(app, run.repo);
  const attempt = t('confirm.startsAttempt', { n: run.attempt + 1 });
  const copy = {
    'rerun-failed': {
      message: `${t('confirm.rerunFailedMsg', { name })} ${attempt}`,
      label: words.rerunFailedShort,
      done: t('confirm.rerunFailedDone', { name }),
    },
    'rerun-all': {
      message: `${t('confirm.rerunAllMsg', { name })} ${
        capabilities.rerunAll === 'new-pipeline'
          ? t('confirm.newPipelineOn', { noun: words.run, branch: run.branch })
          : attempt
      }`,
      label: words.rerunAllShort,
      done: t('confirm.rerunAllDone', { name }),
    },
    cancel: {
      message: t('confirm.cancelMsg', { name }),
      label: t('confirm.cancelRun'),
      done: `${t('confirm.cancelDone', { name })} ${words.cancelDelay}`,
    },
    approve: {
      message: t('confirm.approveMsg', { name }),
      label: t('confirm.approve'),
      done: t('confirm.approveDone', { name }),
    },
    decline: {
      message: t('confirm.declineMsg', { name }),
      label: t('confirm.decline'),
      done: t('confirm.declineDone', { name }),
    },
  }[kind];
  ask(app, {
    message: copy.message,
    label: copy.label,
    destructive: kind === 'cancel' || kind === 'decline',
    work: async () => {
      const key = `${run.id}:${kind}`;
      s.busy.add(key);
      app.renderSide();
      try {
        await app.svc({ method: 'POST', path: '/action', body: { repo: run.repo, runId: run.id, kind } });
        app.toast('success', copy.done);
        await app.loadOverview(true);
        if (s.detail?.runId === run.id) await app.loadDetail(true);
      } finally {
        s.busy.delete(key);
        app.renderSide();
      }
    },
  });
};

const projectFor = async (app: App, dir: string | null): Promise<string | undefined> => {
  if (!dir) return undefined;
  try {
    const snap = await app.host.listProjects();
    let best: { id: string; directory: string } | undefined;
    for (const project of snap.projects) {
      const base = project.directory.replace(/\/+$/, '');
      if (dir === base || dir.startsWith(`${base}/`)) {
        if (!best || base.length > best.directory.length) best = { id: project.id, directory: base };
      }
    }
    return best?.id;
  } catch {
    return undefined;
  }
};

export const sendToAgent = async (app: App, run: Run, jobId: string | null, worktree: boolean, mode: 'read' | 'fix' = 'read') => {
  const { s, host, toast } = app;
  const key = `${run.id}:agent`;
  if (s.busy.has(key)) return;
  s.busy.add(key);
  app.renderSide();
  try {
    const handoff = await app.svc<HandoffResponse>({ path: '/handoff', query: { repo: run.repo, runId: run.id, job: jobId, ...(mode === 'fix' ? { mode } : {}) } });
    const projectId = await projectFor(app, handoff.directory ?? s.directory);
    const request: StartSessionRequest = {
      providerId: EXTENSION_ID,
      id: handoff.id.slice(0, 128),
      title: handoff.title,
      url: handoff.url,
      text: handoff.text,
      kind: 'issue',
      data: { repo: run.repo, runId: run.id, jobId },
      worktree: worktree ? { kind: 'new', name: `fix-ci-${run.number}`, baseBranch: run.branch } : false,
      navigation: 'preserve',
    };
    if (projectId) request.projectId = projectId;
    const result = await host.startSession(request);
    if (result.sessionId === null) {
      toast(
        'error',
        result.failure === 'bootstrap-failed'
          ? t('confirm.worktreeBootstrap', { directory: result.directory })
          : t('confirm.noSession'),
      );
      return;
    }
    await host.openSession(result.sessionId).catch(() => undefined);
    if (result.sent === 'sent') toast('success', t('confirm.sentNew', { title: handoff.title }));
    else if (result.sent === 'no-model') toast('info', t('confirm.createdPick'));
    else if (result.sent === 'failed') toast('error', t('confirm.createdUnsent'));
    else toast('success', t('confirm.created'));
  } catch (err) {
    toast('error', t('confirm.handoffFailed', { message: errorText(err) }));
  } finally {
    s.busy.delete(key);
    app.renderSide();
  }
};
