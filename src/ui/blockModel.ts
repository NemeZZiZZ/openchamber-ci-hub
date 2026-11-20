// The `CiRun` chat block: pure helpers, shared by the frame and its tests.
// Block arguments come from the agent's text, so they are validated before
// anything is fetched.

import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';
import type { Run } from '../domain/types.ts';

const RUN_URL = /\/(?:actions\/runs|runs|pipelines)\/(\d+)(?:[/?#]|$)/;

export const readBlockArgs = (args: Record<string, string>): { repo: string; runId: string } => {
  const repo = typeof args.repo === 'string' ? args.repo.trim() : '';
  if (!repo) throw new Error('CiRun needs a "repo" argument: the repository key, as provider:host/owner/name.');
  const raw = typeof args.runId === 'string' ? args.runId.trim() : '';
  if (!raw) throw new Error('CiRun needs a "runId" argument: the run id or its URL.');
  const runId = /^\d+$/.test(raw) ? raw : RUN_URL.exec(raw)?.[1];
  if (!runId) throw new Error(`CiRun: runId "${raw.slice(0, 120)}" is not a run id or a run URL.`);
  return { repo, runId };
};

export const blockTitle = (run: Run): string => `${run.workflow} #${run.number} · ${run.conclusion ?? run.status}`;

export const blockAnswer = (handoffText: string): string => handoffText.slice(0, GUEST_BLOCK_ANSWER_MAX);
