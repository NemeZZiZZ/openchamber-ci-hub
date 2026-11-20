// "Why it failed": a two-sentence explanation of a failing run from the Small
// Model. The prompt carries the summary key on its first line so a late result
// (the frame was closed while the model thought) can still be filed.

import { errorExcerpt } from './log.ts';
import { failedJobs } from './handoff.ts';
import type { Job, Run } from './types.ts';

export const SUMMARY_INPUT_MAX = 12_000;

export const summaryKey = (run: Run): string => `ci-hub:summary:${run.repo}#${run.id}:${run.attempt}`;

const MARKER = 'CI-HUB-SUMMARY:';

export const summaryKeyFromPrompt = (prompt: string): string | null => {
  const first = prompt.split('\n', 1)[0] ?? '';
  if (!first.startsWith(MARKER)) return null;
  const key = first.slice(MARKER.length).trim();
  return key.startsWith('ci-hub:summary:') ? key : null;
};

const SYSTEM = [
  'You explain a failing CI run to the developer who owns it.',
  'Answer in at most three short sentences: what broke, where, and the most likely cause.',
  'Name the failing step or test. No preamble, no advice about CI in general, no markdown headings.',
].join(' ');

export const summaryRequest = (run: Run, jobs: Job[], rawLog: string): { system: string; prompt: string } => {
  const failed = failedJobs(jobs).map((job) => job.name);
  const head = [
    `${MARKER} ${summaryKey(run)}`,
    `Workflow: ${run.workflow} #${run.number} (attempt ${run.attempt})`,
    `Branch: ${run.branch || 'unknown'} @ ${run.sha.slice(0, 12)}`,
    `Commit: ${run.title || 'unknown'}`,
    `Failing jobs: ${failed.length > 0 ? failed.join(', ') : 'none listed'}`,
    '',
    'Log excerpt around the failure:',
    '',
  ].join('\n');
  const excerpt = errorExcerpt(rawLog, { maxBytes: 8 * 1024 }).lines.join('\n');
  const room = Math.max(0, SUMMARY_INPUT_MAX - head.length - 1);
  return { system: SYSTEM, prompt: `${head}${excerpt.slice(0, room)}`.slice(0, SUMMARY_INPUT_MAX) };
};
