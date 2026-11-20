// The CiRun block frame: one run as a compact card inside the agent's reply.
// It fetches only when the block is drawn or a button is clicked — never polls.

import { applyHostReady } from '@openchamber/sdk/ui';
import type { GuestBlockCall, HostClient } from '@openchamber/sdk';
import { GUEST_FRAME_HEIGHT_MAX } from '@openchamber/sdk';
import { isFailed, runDurationLabel } from '../domain/format.ts';
import { buildHandoff, failedJobs, focusJob } from '../domain/handoff.ts';
import type { Job, Run } from '../domain/types.ts';
import { blockAnswer, blockTitle, readBlockArgs } from './blockModel.ts';
import { h } from './dom.ts';
import { createSvc, errorText } from './port.ts';

const CSS = `
html,body{margin:0}
body{font-family:var(--oc-font,system-ui,sans-serif);font-size:13px;color:var(--oc-fg,inherit);background:transparent}
*{box-sizing:border-box}
[hidden]{display:none!important}
.cihb{border:1px solid var(--oc-border,color-mix(in srgb,currentColor 18%,transparent));border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.cihb-title{font-weight:600;font-size:13px;overflow-wrap:anywhere}
.cihb-meta{font-size:12px;color:var(--oc-muted,color-mix(in srgb,currentColor 60%,transparent));display:flex;flex-wrap:wrap;gap:4px 10px}
.cihb-sha{background:none;border:0;padding:0;font:inherit;font-family:var(--oc-mono,ui-monospace,monospace);font-size:12px;color:var(--oc-primary-text,inherit);cursor:pointer;text-decoration:underline}
.cihb-jobs{display:flex;flex-direction:column;gap:3px;font-size:12px}
.cihb-job{display:flex;gap:6px;align-items:baseline}
.cihb-job[data-tone="error"]{color:var(--oc-error-text,var(--oc-error,inherit))}
.cihb-actions{display:flex;flex-wrap:wrap;gap:6px}
.cihb-btn{border:1px solid var(--oc-border,color-mix(in srgb,currentColor 18%,transparent));background:var(--oc-muted-surface,transparent);color:inherit;font:inherit;font-size:12px;border-radius:7px;padding:4px 10px;cursor:pointer}
.cihb-btn:hover{background:var(--oc-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cihb-btn:disabled{opacity:.5;cursor:default}
.cihb-log{margin:0;max-height:260px;overflow:auto;font-family:var(--oc-mono,ui-monospace,monospace);font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid var(--oc-border,transparent);padding-top:8px}
.cihb-error{color:var(--oc-error-text,var(--oc-error,inherit));font-size:12px;overflow-wrap:anywhere}
`;

export const startBlock = (host: HostClient, root: HTMLElement): void => {
  document.head.append(h('style', null, CSS));
  const svc = createSvc(host);
  const box = h('div', { class: 'cihb' });
  root.append(box);

  const resize = () => {
    const height = Math.ceil(box.getBoundingClientRect().height);
    void host.setHeight(Math.min(Math.max(height, 24), GUEST_FRAME_HEIGHT_MAX)).catch(() => undefined);
  };

  const renderError = (message: string) => {
    box.textContent = '';
    box.append(h('div', { class: 'cihb-error', text: message }));
    resize();
  };

  const draw = async (call: GuestBlockCall) => {
    let target: { repo: string; runId: string };
    try {
      target = readBlockArgs(call.args);
    } catch (err) {
      renderError(errorText(err));
      return;
    }

    let run: Run;
    let jobs: Job[];
    box.textContent = '';
    box.append(h('div', { class: 'cihb-meta', text: 'Loading the run…' }));
    resize();
    try {
      ({ run, jobs } = await svc<{ run: Run; jobs: Job[] }>({ path: '/run', query: target }));
    } catch (err) {
      renderError(errorText(err));
      return;
    }

    const job = focusJob(jobs);
    let log: string | null = null;
    let logTruncated = false;
    let logOpen = false;

    const render = () => {
      box.textContent = '';
      const duration = runDurationLabel(run);
      box.append(h('div', { class: 'cihb-title', text: blockTitle(run) }));
      box.append(
        h(
          'div',
          { class: 'cihb-meta' },
          h('span', { text: run.branch || '—' }),
          h('button', {
            class: 'cihb-sha',
            type: 'button',
            title: 'Open the commit diff',
            text: run.sha.slice(0, 7),
            onClick: () => void host.openCommit(run.sha).catch(() => undefined),
          }),
          duration ? h('span', { text: duration }) : null,
          h('span', { text: `attempt ${run.attempt}` }),
        ),
      );
      const failed = failedJobs(jobs);
      if (failed.length > 0) {
        box.append(
          h(
            'div',
            { class: 'cihb-jobs' },
            failed.slice(0, 6).map((entry) =>
              h('div', { class: 'cihb-job', 'data-tone': 'error' }, h('span', { text: `✕ ${entry.name}` })),
            ),
          ),
        );
      }

      const actions = h('div', { class: 'cihb-actions' });
      const rerun = h('button', {
        class: 'cihb-btn',
        type: 'button',
        text: isFailed(run) ? 'Re-run failed jobs' : 'Re-run',
        onClick: async () => {
          rerun.disabled = true;
          try {
            await svc({ method: 'POST', path: '/action', body: { kind: 'rerun-failed', repo: run.repo, runId: run.id } });
            ({ run, jobs } = await svc<{ run: Run; jobs: Job[] }>({ path: '/run', query: target }));
          } catch (err) {
            box.append(h('div', { class: 'cihb-error', text: errorText(err) }));
          }
          render();
        },
      });
      actions.append(rerun);

      if (job) {
        actions.append(
          h('button', {
            class: 'cihb-btn',
            type: 'button',
            text: logOpen ? 'Hide the log' : 'Failing log',
            onClick: async () => {
              logOpen = !logOpen;
              if (logOpen && log === null) {
                try {
                  const window = await svc<{ text: string; truncated: boolean }>({
                    path: '/log',
                    query: { repo: run.repo, job: job.id },
                  });
                  log = window.text;
                  logTruncated = window.truncated;
                } catch (err) {
                  log = errorText(err);
                }
              }
              render();
            },
          }),
        );
      }

      actions.append(
        h('button', {
          class: 'cihb-btn',
          type: 'button',
          text: 'Fix with the agent',
          onClick: () => {
            const handoff = buildHandoff({ run, jobs, job, log, logTruncated, mode: 'fix' });
            void host.answerBlock(blockAnswer(handoff.text)).catch(() => undefined);
          },
        }),
      );
      box.append(actions);

      if (logOpen && log !== null) {
        box.append(h('pre', { class: 'cihb-log', text: `${logTruncated ? '… (tail of the log)\n' : ''}${log.slice(-8000)}` }));
      }
      resize();
    };
    render();
  };

  host.onBlock((call) => {
    void draw(call).catch((err) => renderError(errorText(err)));
  });
};
