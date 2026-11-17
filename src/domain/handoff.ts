// What an agent gets when the user sends a failure to it: the facts of the
// run and a focused excerpt of the failing log. No instructions — the user
// writes those; the agent should not need to be told the log again.

import { errorExcerpt } from './log.ts';
import { formatDuration, isFailed, isFailedConclusion, runDuration } from './format.ts';
import { parseRepoKey, repoName } from './repoKey.ts';
import type { Handoff, Job, Run, Step } from './types.ts';

export const failedJobs = (jobs: Job[]): Job[] => jobs.filter((job) => isFailedConclusion(job.conclusion));

/** The job a person looks at first: the first failed one, else the first unfinished one. */
export const focusJob = (jobs: Job[]): Job | null =>
  failedJobs(jobs)[0] ?? jobs.find((job) => job.status !== 'completed') ?? jobs[0] ?? null;

export const failingStep = (job: Job): Step | null =>
  job.steps.find((step) => step.conclusion === 'failure' || step.conclusion === 'timed_out') ?? null;

export const handoffTitle = (run: Run, job: Job | null): string => {
  const what = job?.name ?? run.workflow;
  const verdict = isFailed(run) || (job && failedJobs([job]).length > 0) ? 'failed' : run.conclusion ?? run.status;
  return `#${run.number} ${what} ${verdict}`.slice(0, 200);
};

export interface HandoffInput {
  run: Run;
  jobs: Job[];
  job: Job | null;
  /** Raw tail of the focused job's log, when it could be read. */
  log: string | null;
  logTruncated: boolean;
  /** `read` hands over facts; `fix` also instructs the agent to fix and commit. */
  mode?: 'read' | 'fix';
}

const TEXT_LIMIT = 15_000;

export const buildHandoff = ({ run, jobs, job, log, logTruncated, mode = 'read' }: HandoffInput): Handoff => {
  const step = job ? failingStep(job) : null;
  const duration = runDuration(run);
  const ref = parseRepoKey(run.repo);
  const lines: string[] = [
    `CI run ${run.workflow} #${run.number} on ${repoName(run.repo)} ${run.conclusion ?? run.status}.`,
    '',
    `- Repository: ${ref ? `${ref.host}/${ref.path}` : run.repo}`,
    `- Run: ${run.url}`,
    `- Workflow: ${run.workflow}`,
    `- Branch: ${run.branch || '—'} @ ${run.sha.slice(0, 12)}`,
    `- Commit: ${run.title || '—'}`,
    `- Event: ${run.event}, attempt ${run.attempt}${duration !== null ? `, ${formatDuration(duration)}` : ''}`,
  ];
  const failed = failedJobs(jobs);
  if (failed.length > 0) {
    lines.push(`- Failed jobs: ${failed.map((item) => item.name).join(', ')}`);
  }
  if (job) {
    lines.push(`- Job: ${job.name}${job.url ? ` (${job.url})` : ''}`);
    if (step) lines.push(`- Failing step: ${step.number}. ${step.name}`);
  }

  if (log !== null && log.trim() !== '') {
    const excerpt = errorExcerpt(log, { maxLines: 120, context: 20, maxBytes: 8 * 1024 });
    lines.push(
      '',
      `Log excerpt${logTruncated || excerpt.truncated ? ' (partial)' : ''}:`,
      '```',
      ...excerpt.lines.map((line) => line.replace(/```/g, "'''")),
      '```',
    );
  } else if (job) {
    lines.push('', 'The job log could not be read.');
  }
  if (mode === 'fix' && job) {
    lines.push('', 'Fix the failure in this job and commit the fix in the current branch. Do not push.');
  }

  let text = lines.join('\n');
  if (text.length > TEXT_LIMIT) text = `${text.slice(0, TEXT_LIMIT - 4)}\n…`;
  return { title: handoffTitle(run, job), text, url: run.url };
};
