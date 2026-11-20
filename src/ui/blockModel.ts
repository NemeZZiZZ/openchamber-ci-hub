// The `CiRun` chat block: pure helpers, shared by the frame and its tests.
// Block arguments come from the agent's text, so they are validated before
// anything is fetched.

import { GUEST_BLOCK_ANSWER_MAX } from '@openchamber/sdk';
import { parseRepoKey } from '../domain/repoKey.ts';
import type { Run } from '../domain/types.ts';
import { conLabel, t } from './i18n.ts';

const DIGITS = /^\d+$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ID = String.raw`(\d+|\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?)`;
const RUN_URL = new RegExp(String.raw`\/(?:actions\/runs|runs|pipelines|pipeline)\/${ID}(?:[/?#]|$)`);

export const readBlockArgs = (args: Record<string, string>): { repo: string; runId: string } => {
  const repo = typeof args.repo === 'string' ? args.repo.trim() : '';
  if (!repo || !parseRepoKey(repo)) {
    throw new Error(t('block.needRepo'));
  }
  const raw = typeof args.runId === 'string' ? args.runId.trim() : '';
  if (!raw) throw new Error(t('block.needRunId'));
  const bare = raw.replace(/^\{|\}$/g, '');
  const candidate = DIGITS.test(bare) || UUID.test(bare) ? bare : RUN_URL.exec(raw)?.[1]?.replace(/^\{|\}$/g, '');
  const runId = candidate;
  if (!runId || !(DIGITS.test(runId) || UUID.test(runId))) {
    throw new Error(`CiRun: runId "${raw.slice(0, 120)}" is not a run id or a run URL.`);
  }
  return { repo, runId };
};

export const blockTitle = (run: Run): string =>
  t('block.titleStatus', { workflow: run.workflow, number: run.number, status: conLabel(run.conclusion ?? run.status) });

export const blockAnswer = (handoffText: string): string => handoffText.slice(0, GUEST_BLOCK_ANSWER_MAX);
