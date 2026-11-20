// The ⋯ menu of a run, shared by the tree rows and the run detail.

import type { MenuItem } from '@openchamber/sdk/ui';
import { isActive, isFailed } from '../../domain/format.ts';
import { focusJob } from '../../domain/handoff.ts';
import type { Job, Run } from '../../domain/types.ts';
import { errorText } from '../port.ts';
import { t } from '../i18n.ts';
import { viewFor } from './providers.ts';
import type { App } from './state.ts';

export const runMenuItems = (app: App, run: Run): MenuItem[] => {
  const active = isActive(run);
  const { label, capabilities } = viewFor(app, run.repo);
  const writes: MenuItem[] = [];
  if (capabilities.rerunFailed) writes.push({ id: 'rerun-failed', label: t('providers.rerunFailedJobs'), disabled: active || !isFailed(run) });
  if (capabilities.rerunAll) writes.push({ id: 'rerun-all', label: t('providers.rerunAllJobs'), disabled: active });
  if (capabilities.approve && run.status === 'waiting') {
    writes.push({ id: 'approve', label: t('runMenu.approve') });
    writes.push({ id: 'decline', label: t('runMenu.decline'), destructive: true });
  }
  if (capabilities.cancel) writes.push({ id: 'cancel', label: t('runMenu.cancelRun'), destructive: true, disabled: !active });
  return [
    { id: 'open', label: t('runMenu.openDetails') },
    ...writes,
    { separator: true as const },
    { id: 'agent', label: t('runMenu.sendAgent') },
    { id: 'agent-worktree', label: t('runMenu.sendWorktree') },
    { separator: true as const },
    { id: 'web', label: t('runMenu.openOn', { name: run.workflow, label }) },
    { id: 'copy', label: t('runMenu.copyRun') },
    { id: 'copy-log', label: t('runMenu.copyLog') },
  ];
};

const copy = (app: App, text: string, done: string) =>
  app.host
    .writeClipboard(text)
    .then(() => app.toast('success', done))
    .catch((err: unknown) => app.toast('error', t('runMenu.copyFailed', { message: errorText(err) })));

/** The log link of the given job, or of the job a failure would open on. */
const copyLogLink = async (app: App, run: Run, jobId: string | null) => {
  const detail = app.s.detail;
  try {
    const jobs =
      detail && detail.repo === run.repo && detail.runId === run.id && detail.jobs.length > 0
        ? detail.jobs
        : (await app.svc<{ run: Run; jobs: Job[] }>({ path: '/run', query: { repo: run.repo, id: run.id } })).jobs;
    const job = (jobId ? jobs.find((entry) => entry.id === jobId) : null) ?? focusJob(jobs);
    if (!job) {
      app.toast('info', t('runMenu.jobNotFound'));
      return;
    }
    await copy(app, job.url, t('runMenu.logLinkCopied', { name: job.name }));
  } catch (err) {
    app.toast('error', `Could not find the job: ${errorText(err)}`);
  }
};

export const onRunMenu = (app: App, run: Run, id: string, jobId: string | null = null) => {
  switch (id) {
    case 'open':
      app.openRun(run);
      break;
    case 'rerun-failed':
    case 'rerun-all':
    case 'cancel':
    case 'approve':
    case 'decline':
      app.askAction(run, id);
      break;
    case 'agent':
      void app.sendToAgent(run, jobId, false);
      break;
    case 'agent-worktree':
      void app.sendToAgent(run, jobId, true);
      break;
    case 'web':
      void app.host.openUrl(run.url);
      break;
    case 'copy':
      void copy(app, run.url, t('runMenu.linkCopied'));
      break;
    case 'copy-log':
      void copyLogLink(app, run, jobId);
      break;
  }
};
