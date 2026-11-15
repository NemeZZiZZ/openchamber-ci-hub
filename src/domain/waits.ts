// `ci-hub/run-finished`: an agent waits on one run and is woken once, when it
// finishes — or, with `conclusion: failure`, as soon as any job fails. The
// state OpenChamber stores between checks is all the service needs, so a
// restarted service picks the wait up where it was.

import { formatDuration, runDuration } from './format.ts';
import { legacyRepoKey, parseRepoKey, repoName, type RepoKey } from './repoKey.ts';
import { failedJobs, failingStep } from './handoff.ts';
import type { Job, Run } from './types.ts';

export const RUN_FINISHED = 'run-finished';

export interface WaitArgs {
  /** Null when the agent left it out: the service uses the session's project. */
  repo: RepoKey | null;
  runId: string;
  /** Wake early when a job ends with this conclusion (usually `failure`). */
  conclusion: string | null;
}

export interface WaitState {
  repo: RepoKey;
  runId: string;
  conclusion: string | null;
  attempt: number;
  number: number;
  workflow: string;
}

export type RunUrlParser = (
  url: string,
) => { repo: RepoKey; runId: string } | null | Promise<{ repo: RepoKey; runId: string } | null>;

/** A CI Hub key or a config-v1 `owner/name`. */
const keyOrLegacy = (input: string): RepoKey | null => (parseRepoKey(input) ? input : legacyRepoKey(input));

/**
 * Accepts a repo key, `owner/name` or a repository URL plus an id, a run URL in
 * either field, `#id`, or an id alone. Throws with the line the agent sees.
 */
export const readWaitArgs = async (
  params: unknown,
  parseRunUrl: RunUrlParser,
  resolveRepo: (input: string) => RepoKey | null | Promise<RepoKey | null> = keyOrLegacy,
): Promise<WaitArgs> => {
  const args = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const rawRepo = typeof args.repo === 'string' ? args.repo.trim() : '';
  const rawRun = typeof args.runId === 'string' ? args.runId.trim() : typeof args.runId === 'number' ? String(args.runId) : '';
  const conclusion = typeof args.conclusion === 'string' && args.conclusion.trim() ? args.conclusion.trim().toLowerCase() : null;

  const fromUrl = (await parseRunUrl(rawRun)) ?? (await parseRunUrl(rawRepo));
  if (fromUrl) return { repo: fromUrl.repo, runId: fromUrl.runId, conclusion };

  const runId = rawRun.replace(/^#/, '');
  if (!/^\d+$/.test(runId)) throw new Error('runId must be a run id or a run URL.');
  if (rawRepo === '') return { repo: null, runId, conclusion };
  const repo = await resolveRepo(rawRepo);
  if (repo === null) throw new Error('repo must be owner/name, a repository URL or a CI Hub repo key.');
  return { repo, runId, conclusion };
};

/** Waits stored before repo keys carry `owner/name`; they still resume. */
export const readWaitState = (
  state: unknown,
  resolveRepo: (input: string) => RepoKey | null = keyOrLegacy,
): WaitState | null => {
  if (!state || typeof state !== 'object') return null;
  const value = state as Record<string, unknown>;
  if (typeof value.repo !== 'string' || typeof value.runId !== 'string') return null;
  const repo = resolveRepo(value.repo);
  if (repo === null) return null;
  return {
    repo,
    runId: value.runId,
    conclusion: typeof value.conclusion === 'string' ? value.conclusion : null,
    attempt: typeof value.attempt === 'number' ? value.attempt : 1,
    number: typeof value.number === 'number' ? value.number : 0,
    workflow: typeof value.workflow === 'string' ? value.workflow : '',
  };
};

export const waitLabel = (run: Run): string => `${run.workflow} #${run.number} on ${repoName(run.repo)}`.slice(0, 80);

export type WaitVerdict = { fired: false } | { fired: true; early: boolean };

export const judgeWait = (state: WaitState, run: Run, jobs: Job[] | null): WaitVerdict => {
  if (run.status === 'completed') return { fired: true, early: false };
  if (state.conclusion && jobs) {
    const hit = jobs.some((job) => job.status === 'completed' && job.conclusion === state.conclusion);
    if (hit) return { fired: true, early: true };
  }
  return { fired: false };
};

const clean = (text: string) => text.replace(/[<>]/g, '');

export const waitSummary = (run: Run, jobs: Job[], early: boolean, excerpt: string[] | null): string => {
  const duration = runDuration(run);
  const verdict = early ? 'has a failed job (run still in progress)' : run.conclusion ?? run.status;
  const parts = [
    `CI run ${run.workflow} #${run.number} on ${repoName(run.repo)} (${run.branch || 'no branch'}) ${verdict}` +
      (duration !== null && !early ? ` after ${formatDuration(duration)}` : '') +
      '.',
    `Run: ${run.url}`,
  ];
  const failed = failedJobs(jobs);
  if (failed.length > 0) {
    parts.push(
      `Failed jobs: ${failed
        .map((job) => {
          const step = failingStep(job);
          return step ? `${job.name} (step "${step.name}")` : job.name;
        })
        .join('; ')}.`,
    );
  }
  let text = parts.join('\n');
  if (excerpt && excerpt.length > 0) {
    const room = 1900 - text.length;
    let block = '';
    for (const line of excerpt) {
      if (block.length + line.length + 1 > room - 40) break;
      block += `${line}\n`;
    }
    if (block) text += `\nLog excerpt:\n${block.trimEnd()}`;
  }
  return clean(text).slice(0, 2000);
};
