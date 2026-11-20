// Compact views for the OpenCode plugin and slash commands. An agent's
// context is expensive: runs keep only the fields a decision needs, jobs keep
// only the failing step, and log excerpts are hard-capped.

import type { Conclusion, Job, Run, RunStatus } from '../domain/types.ts';
import { failingStep } from '../domain/handoff.ts';

export const AGENT_RUNS_MAX = 20;
export const AGENT_LOG_MAX = 12_000;

export interface AgentRun {
  repo: string;
  id: string;
  number: number;
  workflow: string;
  branch: string;
  sha: string;
  status: RunStatus;
  conclusion: Conclusion;
  attempt: number;
  url: string;
  durationMs: number | null;
  finishedAt: number | null;
}

export const agentRunView = (run: Run): AgentRun => ({
  repo: run.repo,
  id: run.id,
  number: run.number,
  workflow: run.workflow,
  branch: run.branch,
  sha: run.sha,
  status: run.status,
  conclusion: run.conclusion,
  attempt: run.attempt,
  url: run.url,
  durationMs: run.startedAt !== null && run.finishedAt !== null ? run.finishedAt - run.startedAt : null,
  finishedAt: run.finishedAt,
});

export const agentRunsView = (runs: Run[], limit = 10): { items: AgentRun[] } => {
  const cap = Math.max(0, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 10, AGENT_RUNS_MAX));
  return { items: [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, cap).map(agentRunView) };
};

export interface AgentJob {
  id: string;
  name: string;
  status: string;
  conclusion: Conclusion;
  failingStep: string | null;
}

export const agentJobsView = (jobs: Job[]): AgentJob[] =>
  jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    failingStep: failingStep(job)?.name ?? null,
  }));
