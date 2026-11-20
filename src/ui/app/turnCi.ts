// The `turn-ci` service event: the agent's turn ended and the branch it worked
// on has a broken run. The panel shows a toast; the same preferences popover
// switches this and the sidebar marks off.

import { repoName } from '../../domain/repoKey.ts';
import type { Prefs } from '../../service/prefs.ts';
import { t } from '../i18n.ts';

export interface TurnCi {
  directory: string;
  repo: string;
  branch: string | null;
  runId: string;
  number: number;
  workflow: string;
  conclusion: string;
  attempt: number;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export const readTurnCi = (data: unknown): TurnCi | null => {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const directory = str(raw.directory);
  const repo = str(raw.repo);
  const runId = str(raw.runId);
  const workflow = str(raw.workflow);
  const conclusion = str(raw.conclusion);
  if (!directory || !repo || !runId || !workflow || !conclusion) return null;
  if (typeof raw.number !== 'number' || typeof raw.attempt !== 'number') return null;
  const branch = raw.branch === null ? null : str(raw.branch);
  if (raw.branch !== null && branch === null) return null;
  return { directory, repo, branch, runId, number: raw.number, workflow, conclusion, attempt: raw.attempt };
};

export const turnCiMessage = (turn: TurnCi): string =>
  t('turnCi.failedOn', { where: turn.branch ?? repoName(turn.repo), workflow: turn.workflow, number: turn.number });

export const prefRows = (p: Prefs): { id: 'marks' | 'toastOnTurnFailure'; label: string; on: boolean }[] => [
  { id: 'marks', label: t('prefs.marks'), on: p.marks },
  { id: 'toastOnTurnFailure', label: t('prefs.toastAfterTurn'), on: p.toastOnTurnFailure },
];
