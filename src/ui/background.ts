// The hidden frame behind /ci-status, /ci-fix and the Check CI session action.
// It owns onResolve/onAction for the whole extension: the visible panel never
// registers them. Every run is resolved against the folder the command or the
// action ran in, and each answer is a chip, never a guessed run id.

import type { AttachIssueRequest, GuestActionItem, HostClient, HostReadyContext } from '@openchamber/sdk';
import { isFailedConclusion } from '../domain/format.ts';
import type { Conclusion } from '../domain/types.ts';
import { createSvc, errorText } from './port.ts';

export interface AgentRun {
  repo: string;
  id: number;
  number: number;
  workflow: string;
  branch: string | null;
  sha: string;
  status: string;
  conclusion: Conclusion;
  attempt: number;
  url: string;
}

export const CHIP_TEXT_MAX = 16_000;

const describeRun = (run: AgentRun): string =>
  [
    `CI run: ${run.workflow} #${run.number} (${run.repo})`,
    `Branch: ${run.branch ?? 'unknown'}; commit ${run.sha}; attempt ${run.attempt}`,
    `Status: ${run.status}; conclusion: ${run.conclusion ?? 'none'}`,
    `Run id: ${run.id}`,
    run.url,
  ].join('\n');

export const statusChip = (run: AgentRun): AttachIssueRequest => ({
  providerId: 'ci-hub',
  id: String(run.id),
  title: `${run.workflow} #${run.number} · ${run.conclusion ?? run.status}`,
  url: run.url,
  text: describeRun(run).slice(0, CHIP_TEXT_MAX),
});

export const fixChip = (run: AgentRun): AttachIssueRequest => ({
  providerId: 'ci-hub',
  id: String(run.id),
  title: `Fix ${run.workflow} #${run.number}`,
  url: run.url,
  text: [
    'The latest CI run failed. Fix it.',
    describeRun(run),
    `Repository key: ${run.repo}`,
    'Use ci_run_detail and ci_failing_log to read the failure, change the code the log indicts, then ci_rerun with failedOnly: true. Do not claim the run is green until ci_run_detail says so.',
  ]
    .join('\n\n')
    .slice(0, CHIP_TEXT_MAX),
});

export const pickFixRun = (runs: AgentRun[]): AgentRun | null => runs.find((run) => isFailedConclusion(run.conclusion)) ?? null;

export const startBackground = (host: HostClient, ctx: HostReadyContext): void => {
  const svc = createSvc(host);

  const latest = async (directory: string | null): Promise<AgentRun[]> => {
    const res = await svc<{ runs: AgentRun[] }>({
      path: '/agent/runs',
      query: { directory, limit: '10' },
    });
    return res.runs;
  };

  host.onResolve(async (request) => {
    if (request.command !== 'ci-status' && request.command !== 'ci-fix') return null;
    const runs = await latest(ctx.directory);
    if (request.command === 'ci-status') {
      const run = runs[0];
      if (!run) throw new Error('No CI runs for this folder yet.');
      return statusChip(run);
    }
    const failed = pickFixRun(runs);
    if (!failed) throw new Error(runs.length ? 'The latest CI runs for this folder are not failing.' : 'No CI runs for this folder yet.');
    return fixChip(failed);
  });

  host.onAction(async (item: GuestActionItem) => {
    if (item.action !== 'ci-check') return;
    try {
      const runs = await latest(item.directory);
      const run = runs[0];
      if (!run) {
        await host.toast({ kind: 'info', message: 'No CI runs for this folder yet.' });
        return;
      }
      const label = `${run.workflow} #${run.number} on ${run.branch ?? run.repo}`;
      if (isFailedConclusion(run.conclusion)) await host.toast({ kind: 'error', message: `CI failed: ${label}` });
      else if (run.status !== 'completed') await host.toast({ kind: 'info', message: `CI running: ${label}` });
      else await host.toast({ kind: 'success', message: `CI ${run.conclusion ?? 'finished'}: ${label}` });
    } catch (err) {
      await host.toast({ kind: 'error', message: errorText(err) });
    }
  });
};
