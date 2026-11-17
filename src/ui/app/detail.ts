// The side column: the run detail (head, actions, jobs and steps) and the
// switch between the run, dispatch and repositories surfaces.

import { mountBadge, mountMenu, mountSpinner } from '@openchamber/sdk/ui';
import { conclusionLabel, conclusionTone, formatAgo, formatDuration, formatEvent, isActive, isFailed, queueTime, runDuration } from '../../domain/format.ts';
import { failedJobs, failingStep, focusJob } from '../../domain/handoff.ts';
import { parseLog } from '../../domain/log.ts';
import { repoName } from '../../domain/repoKey.ts';
import type { Job, Run } from '../../domain/types.ts';
import { h, slot } from '../dom.ts';
import { errorText, ServiceError } from '../port.ts';
import { viewFor } from './providers.ts';
import { backBar, button, dot, note, Region, shortSha, type App, type Detail } from './state.ts';

let detailSeq = 0;

/** Only a failed job offers the Fix button: a green or running job has nothing to fix. */
export const fixableJob = (job: Job): boolean => job.conclusion === 'failure';

export const loadDetail = async (app: App, quiet: boolean) => {
  const s = app.s;
  const current = s.detail;
  if (!current) return;
  const seq = ++detailSeq;
  if (!quiet) {
    current.loading = true;
    app.renderSide();
  }
  try {
    const data = await app.svc<{ run: Run; jobs: Job[] }>({ path: '/run', query: { repo: current.repo, id: current.runId } });
    if (seq !== detailSeq || s.detail !== current) return;
    const wasJob = current.jobs.find((job) => job.id === current.jobId) ?? null;
    current.run = data.run;
    current.jobs = data.jobs;
    current.error = null;
    if (!current.jobId || !data.jobs.some((job) => job.id === current.jobId)) {
      current.jobId = focusJob(data.jobs)?.id ?? null;
    }
    const job = data.jobs.find((entry) => entry.id === current.jobId) ?? null;
    const finishedNow = job && job.status === 'completed' && wasJob && wasJob.status !== 'completed';
    if (job && (!current.log || current.log.jobId !== job.id || finishedNow || current.log.error)) {
      void app.loadLog(job, current.log?.jobId === job.id ? current.log.full : false);
    }
  } catch (err) {
    if (seq !== detailSeq || s.detail !== current) return;
    current.error = errorText(err);
  }
  current.loading = false;
  app.renderSide();
};

export const loadLog = async (app: App, job: Job, full: boolean) => {
  const s = app.s;
  const current = s.detail;
  if (!current) return;
  current.log = { jobId: job.id, loading: true, text: null, truncated: false, full, error: null, lines: [] };
  current.query = '';
  current.hit = 0;
  current.toggled = new Set();
  app.renderLog();
  if (job.status !== 'completed') {
    current.log = { ...current.log, loading: false, error: viewFor(app, current.repo).words.logPending };
    app.renderLog();
    return;
  }
  try {
    const data = await app.svc<{ text: string; truncated: boolean }>({
      path: '/log',
      query: { repo: current.repo, job: job.id, full: full ? '1' : undefined },
    });
    if (s.detail !== current || current.log?.jobId !== job.id) return;
    current.log = { jobId: job.id, loading: false, text: data.text, truncated: data.truncated, full, error: null, lines: parseLog(data.text, viewFor(app, current.repo).logDialect) };
  } catch (err) {
    if (s.detail !== current || current.log?.jobId !== job.id) return;
    const missing = err instanceof ServiceError && err.status === 404;
    current.log = {
      jobId: job.id,
      loading: false,
      text: null,
      truncated: false,
      full,
      error: missing ? viewFor(app, current.repo).words.logMissing : errorText(err),
      lines: [],
    };
  }
  app.renderLog();
  app.scrollToFailure();
};

export const renderSide = (app: App) => {
  const s = app.s;
  const side = app.side;
  side.reset();
  s.logRegion?.reset();
  s.logRegion = null;
  s.logBody = null;
  if (s.view.kind === 'board') return app.renderBoard();
  if (s.view.kind === 'repos') return app.renderRepos();
  if (s.view.kind === 'dispatch') return app.renderDispatch();
  if (s.view.kind !== 'run' || !s.detail) {
    if (s.wide) {
      side.el.append(
        h('div', { class: 'cih-empty' }, h('strong', { text: 'Pick a run' }), h('div', { text: 'Its jobs, the failing step and the log open here.' })),
      );
    }
    return;
  }
  renderDetail(app, s.detail);
};

const renderDetail = (app: App, current: Detail) => {
  const { host, side } = app;
  const busy = app.s.busy;
  const run = current.run;
  const back = backBar(app, run ? `${run.workflow} #${run.number}` : 'Run');
  if (back) side.el.append(back);
  if (!run) {
    const at = slot();
    side.keep(mountSpinner(at, { label: 'Loading run…' }));
    side.el.append(h('div', { class: 'cih-empty' }, at));
    return;
  }
  const provider = viewFor(app, run.repo);
  const { capabilities, words } = provider;
  const now = Date.now();
  const tone = conclusionTone(run.conclusion, run.status);
  const label = conclusionLabel(run.conclusion, run.status);
  const badgeAt = slot();
  side.keep(
    mountBadge(badgeAt, {
      label,
      tone: tone === 'muted' ? 'neutral' : tone,
    }),
  );
  const duration = runDuration(run, now);
  const queued = queueTime(run);
  const sha = h('button', { class: 'cih-link cih-mono', type: 'button', title: run.sha, onclick: () => void host.openCommit(run.sha).catch(() => (run.commitUrl ? host.openUrl(run.commitUrl) : undefined)) }, shortSha(run.sha));
  const head = h(
    'div',
    { class: 'cih-card cih-head' },
    h('div', { class: 'cih-muted cih-small', text: repoName(run.repo) }),
    h('div', { class: 'cih-head-top' }, h('h2', { class: 'cih-title cih-bar-grow', text: `${run.workflow} #${run.number}` }), badgeAt),
    run.title ? h('div', { text: run.title }) : null,
    h(
      'div',
      { class: 'cih-kv' },
      h('span', { class: 'cih-branch', title: run.branch, text: run.branch }),
      sha,
      h('span', { text: formatEvent(run.event) }),
      run.actor ? h('span', { text: run.actor }) : null,
      run.attempt > 1 ? h('span', { text: `attempt ${run.attempt}` }) : null,
      duration !== null ? h('span', { text: `${isActive(run) ? 'running' : 'took'} ${formatDuration(duration)}` }) : null,
      queued !== null && queued >= 5_000 ? h('span', { text: `queued ${formatDuration(queued)}` }) : null,
      h('span', { text: formatAgo(run.createdAt, now) }),
      h('button', { class: 'cih-link', type: 'button', onclick: () => void host.openUrl(run.url) }, `${provider.label} ↗`),
    ),
  );
  const actions = h('div', { class: 'cih-actions' });
  const active = isActive(run);
  if (active && capabilities.approve && run.status === 'waiting') {
    actions.append(button(side, { label: 'Approve', size: 'sm', variant: 'outline', loading: busy.has(`${run.id}:approve`), onClick: () => app.askAction(run, 'approve') }));
    actions.append(button(side, { label: 'Decline', size: 'sm', variant: 'destructive', loading: busy.has(`${run.id}:decline`), onClick: () => app.askAction(run, 'decline') }));
  }
  if (!active && isFailed(run) && capabilities.rerunFailed) {
    actions.append(button(side, { label: words.rerunFailedShort, size: 'sm', loading: busy.has(`${run.id}:rerun-failed`), onClick: () => app.askAction(run, 'rerun-failed') }));
  }
  if (!active && capabilities.rerunAll) {
    actions.append(button(side, { label: words.rerunAllShort, size: 'sm', variant: 'outline', loading: busy.has(`${run.id}:rerun-all`), onClick: () => app.askAction(run, 'rerun-all') }));
  } else if (active && capabilities.cancel) {
    actions.append(button(side, { label: 'Cancel', size: 'sm', variant: 'destructive', loading: busy.has(`${run.id}:cancel`), onClick: () => app.askAction(run, 'cancel') }));
  }
  const agentAt = slot();
  side.keep(
    mountMenu(agentAt, {
      label: busy.has(`${run.id}:agent`) ? 'Sending…' : 'Send to agent',
      variant: 'outline',
      size: 'sm',
      items: [
        { id: 'agent', label: 'New session in this project' },
        { id: 'agent-worktree', label: `New session in a worktree of ${run.branch}`.slice(0, 60) },
      ],
      onSelect: (id) => app.onRunMenu(run, id, current.jobId),
    }),
  );
  actions.append(agentAt);
  const moreAt = slot();
  side.keep(
    mountMenu(moreAt, {
      label: '⋯',
      variant: 'ghost',
      size: 'sm',
      items: [
        { id: 'copy', label: 'Copy run link' },
        { id: 'copy-log', label: 'Copy log link', disabled: !current.jobId },
        { id: 'web', label: `Open on ${provider.label}` },
        { id: 'refresh', label: 'Refresh' },
      ],
      onSelect: (id) => (id === 'refresh' ? void app.loadDetail(false) : app.onRunMenu(run, id, current.jobId)),
    }),
  );
  actions.append(moreAt);
  head.append(actions);
  side.el.append(head);

  if (current.error) {
    note(side, 'error', current.error, [{ label: 'Try again', onClick: () => void app.loadDetail(false) }]);
  }

  // Jobs and steps.
  const failedCount = failedJobs(current.jobs).length;
  const jobsCard = h(
    'section',
    { class: 'cih-card cih-card-jobs' },
    h(
      'div',
      { class: 'cih-card-head' },
      h('span', { class: 'cih-card-title', text: 'Jobs' }),
      current.jobs.length
        ? h('span', { class: 'cih-card-sub', 'data-tone': failedCount ? 'error' : null, text: failedCount ? `${failedCount} failed of ${current.jobs.length}` : `${current.jobs.length}` })
        : null,
    ),
  );
  side.el.append(jobsCard);
  if (current.loading && current.jobs.length === 0) {
    const at = slot();
    side.keep(mountSpinner(at, { size: 'sm', label: 'Loading jobs…' }));
    jobsCard.append(h('div', { class: 'cih-pad' }, at));
  } else if (current.jobs.length === 0) {
    jobsCard.append(h('div', { class: 'cih-pad cih-muted', text: active ? 'No jobs have started yet.' : 'This run has no jobs.' }));
  }
  const jobs = h('div', { class: 'cih-jobs' });
  for (const job of current.jobs) {
    const jt = conclusionTone(job.conclusion, job.status);
    const jl = conclusionLabel(job.conclusion, job.status);
    const jd = job.startedAt ? (job.finishedAt ?? now) - job.startedAt : null;
    const selected = job.id === current.jobId;
    const row = h('div', { class: 'cih-job-row' });
    row.append(
      h(
        'button',
        {
          class: 'cih-job',
          type: 'button',
          'aria-current': selected ? 'true' : 'false',
          onclick: () => {
            if (current.jobId === job.id) return;
            current.jobId = job.id;
            current.mode = 'focus';
            app.renderSide();
            void app.loadLog(job, false);
          },
        },
        dot(jt, jl),
        h('span', { class: 'cih-job-name', text: job.name }),
        h('span', { class: 'cih-small cih-muted', text: jd !== null && jd >= 0 ? formatDuration(jd) : jl }),
      ),
    );
    if (fixableJob(job)) {
      row.append(
        h('button', {
          class: 'cih-job-fix',
          type: 'button',
          text: 'Fix',
          title: 'Open a new session to fix this job',
          onclick: (event: Event) => {
            event.stopPropagation();
            void app.sendToAgent(run, job.id, false, 'fix');
          },
        }),
      );
    }
    jobs.append(row);
    if (selected && job.steps.length > 0) {
      const failed = failingStep(job);
      const steps = h('div', { class: 'cih-steps' });
      for (const step of job.steps) {
        const st = conclusionTone(step.conclusion, step.status);
        const sl = conclusionLabel(step.conclusion, step.status);
        const sd = step.startedAt && step.finishedAt ? step.finishedAt - step.startedAt : null;
        steps.append(
          h(
            'div',
            { class: 'cih-step', 'data-failed': failed?.number === step.number ? 'true' : 'false' },
            dot(st, sl),
            h('span', { text: step.name }),
            h('span', { class: 'cih-muted', text: sd !== null ? formatDuration(sd) : step.conclusion === 'skipped' ? 'skipped' : '' }),
          ),
        );
      }
      jobs.append(steps);
    }
  }
  if (current.jobs.length) jobsCard.append(jobs);

  // The log, in its own region so typing in the search box redraws only it.
  const logHost = h('section', { class: 'cih-card cih-log' });
  side.el.append(logHost);
  app.s.logRegion = new Region(logHost);
  app.renderLog();
};
