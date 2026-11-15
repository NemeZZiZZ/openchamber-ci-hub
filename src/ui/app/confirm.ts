// Confirmations before a write, the writes themselves, and the hand-off of a
// run to an agent session.

import type { StartSessionRequest } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';
import { EXTENSION_ID, type Run } from '../../domain/types.ts';
import { h, slot } from '../dom.ts';
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
      label: 'Keep as is',
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
  const again =
    capabilities.rerunAll === 'new-pipeline'
      ? `This starts a new ${words.run} on ${run.branch} and uses runner minutes.`
      : `This starts attempt ${run.attempt + 1} and uses runner minutes.`;
  const copy = {
    'rerun-failed': {
      message: `Re-run the failed jobs of ${name}? This starts attempt ${run.attempt + 1} and uses runner minutes.`,
      label: words.rerunFailedShort,
      done: `Re-running the failed jobs of ${name}.`,
    },
    'rerun-all': {
      message: `Re-run every job of ${name}? ${again}`,
      label: words.rerunAllShort,
      done: `Re-running ${name}.`,
    },
    cancel: {
      message: `Cancel ${name}? Jobs that are running stop where they are.`,
      label: 'Cancel run',
      done: `Cancelling ${name}. ${words.cancelDelay}`,
    },
    approve: {
      message: `Approve ${name}? It starts running.`,
      label: 'Approve',
      done: `Approved ${name}.`,
    },
    decline: {
      message: `Decline ${name}? It will not run.`,
      label: 'Decline',
      done: `Declined ${name}.`,
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

export const sendToAgent = async (app: App, run: Run, jobId: string | null, worktree: boolean) => {
  const { s, host, toast } = app;
  const key = `${run.id}:agent`;
  if (s.busy.has(key)) return;
  s.busy.add(key);
  app.renderSide();
  try {
    const handoff = await app.svc<HandoffResponse>({ path: '/handoff', query: { repo: run.repo, runId: run.id, job: jobId } });
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
          ? `The worktree was created at ${result.directory}, but it did not finish setting up, so no session was started.`
          : 'OpenChamber could not create the session.',
      );
      return;
    }
    await host.openSession(result.sessionId).catch(() => undefined);
    if (result.sent === 'sent') toast('success', `Sent “${handoff.title}” to a new session.`);
    else if (result.sent === 'no-model') toast('info', 'Session created with the failure attached. Pick a model there to send it.');
    else if (result.sent === 'failed') toast('error', 'Session created, but the first message did not send. The failure is attached; send it from there.');
    else toast('success', 'Session created with the failure attached.');
  } catch (err) {
    toast('error', `Could not hand this run to an agent: ${errorText(err)}`);
  } finally {
    s.busy.delete(key);
    app.renderSide();
  }
};
