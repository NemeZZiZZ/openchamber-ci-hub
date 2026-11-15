// Provider-neutral CI model. Adapters map their API onto this; nothing above
// `src/providers` knows which CI system a run came from.

import type { RepoKey } from './repoKey.ts';

export const EXTENSION_ID = 'ci-hub';

export const PROVIDER_IDS = ['github', 'gitlab', 'gitea', 'forgejo', 'woodpecker', 'bitbucket'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type RunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending'
  | 'unknown';

export type Conclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'
  | null;

export interface Run {
  id: string;
  provider: ProviderId;
  repo: RepoKey;
  /** Provider run number shown to people (`#1284`). */
  number: number;
  workflow: string;
  workflowId: string;
  branch: string;
  sha: string;
  /** Commit subject or PR title the provider reports for the run. */
  title: string;
  event: string;
  attempt: number;
  status: RunStatus;
  conclusion: Conclusion;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  actor: string;
  url: string;
  /** The commit on the provider's site, when it has a page for it. */
  commitUrl: string | null;
}

export interface Step {
  number: number;
  name: string;
  status: RunStatus;
  conclusion: Conclusion;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Job {
  id: string;
  runId: string;
  name: string;
  status: RunStatus;
  conclusion: Conclusion;
  startedAt: number | null;
  finishedAt: number | null;
  steps: Step[];
  url: string;
}

export interface LogWindow {
  text: string;
  /** True when the provider cut the beginning off because we asked for a tail. */
  truncated: boolean;
}

export interface WorkflowRef {
  id: string;
  name: string;
  path: string;
  /** The workflow file's name without the provider's folder (`ci.yml`). */
  file: string;
}

export interface DispatchInput {
  name: string;
  description: string;
  required: boolean;
  default: string;
  /**
   * `variables` carries a JSON object string mapping key to value; the panel
   * renders it as a key/value editor.
   */
  type: 'string' | 'choice' | 'boolean' | 'environment' | 'variables';
  options: string[];
}

export type RunFilter = 'attention' | 'all' | 'in_progress' | 'failed' | 'succeeded' | 'cancelled';

export interface RepoConfig {
  /** `provider:host/path`, see `repoKey.ts`. */
  key: string;
  /** Where the repository sits on disk, when the service detected it. */
  directory?: string;
  enabled: boolean;
  addedAt: number;
}

export interface Config {
  version: 2;
  repos: RepoConfig[];
  /** Manual overrides for directories whose remote is unusual: directory → repo key. */
  directoryMap: Record<string, string>;
}

export const EMPTY_CONFIG: Config = { version: 2, repos: [], directoryMap: {} };

/** How a provider writes job logs: GitHub's `##[group]` markers, GitLab's ANSI trace with sections, or plain text. */
export type LogDialect = 'github' | 'gitlab' | 'plain';

/** What a provider can do; the panel builds its menus and buttons from these. */
export interface Capabilities {
  /** Re-run every job in the same run, start a new pipeline on the ref, or neither. */
  rerunAll: 'same-run' | 'new-pipeline' | null;
  rerunFailed: boolean;
  cancel: boolean;
  retryJob: boolean;
  playManualJob: boolean;
  dispatch: 'workflow-inputs' | 'pipeline-variables' | null;
  /** What a job is made of in the detail view; `none` when jobs have no sub-steps. */
  jobDetail: 'steps' | 'stages' | 'none';
  /** Whether gated runs can be approved or declined from the panel. */
  approve: boolean;
  /** Whether runs page through a per-workflow history. */
  groupHistory: boolean;
}

/** The provider's own words for the copy the panel shows. */
export interface ProviderWords {
  run: string;
  runs: string;
  workflow: string;
  workflows: string;
  rerunFailed: string;
  rerunFailedShort: string;
  rerunAll: string;
  rerunAllShort: string;
  cancelDelay: string;
  logPending: string;
  logMissing: string;
  dispatchHelp: string;
  repoPlaceholder: string;
  tokenOrder: string;
  noAccount: string;
}

/** What the panel may know about a provider: words and flags, nothing callable. */
export interface ProviderView {
  id: ProviderId;
  label: string;
  words: ProviderWords;
  capabilities: Capabilities;
  logDialect: LogDialect;
}

/** A failure reduced to what an agent needs, plus the run it belongs to. */
export interface Handoff {
  title: string;
  text: string;
  url: string;
}

export interface RateLimitInfo {
  remaining: number | null;
  resetAt: number | null;
  /** Set when the provider refused us and we are backing off. */
  blockedUntil: number | null;
  message: string | null;
}

/** Where a token came from: the OpenChamber account, the card setting, or the provider's CLI. */
export type TokenSource = 'openchamber' | 'setting' | 'cli';

/** How CI Hub is signed in to one provider on one host. */
export interface AccountView {
  provider: ProviderId;
  host: string;
  /** The provider's name, such as GitHub. */
  label: string;
  ok: boolean;
  source: TokenSource | null;
  sourceLabel: string | null;
  message: string | null;
  /** Set while this host is making us wait. */
  rateLimit: RateLimitInfo | null;
}

export interface RepoView {
  key: RepoKey;
  provider: ProviderId;
  /** The path on its host, such as owner/name or group/sub/app. */
  name: string;
  webUrl: string;
  ciUrl: string;
  directory: string | null;
  enabled: boolean;
  /** How it got here: the folder's git remote, added by hand, or listed in settings. */
  origin: 'detected' | 'manual' | 'settings';
}

export interface StateView {
  providers: ProviderView[];
  repos: RepoView[];
  /** The repository of the folder the panel was opened in, when there is one. */
  current: RepoKey | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  accounts: AccountView[];
}

export interface OverviewProject {
  id: string;
  name: string;
  directory: string;
}

export interface OverviewRepo {
  key: RepoKey;
  provider: ProviderId;
  name: string;
  webUrl: string;
  ciUrl: string;
  /** The first OpenChamber project whose folder has this remote. */
  project: OverviewProject | null;
  defaultBranch: string | null;
  /** The branch checked out in the project's folder. */
  currentBranch: string | null;
  polledAt: number | null;
  error: string | null;
  runs: Run[];
}

export interface OverviewView {
  providers: ProviderView[];
  repos: OverviewRepo[];
  /** The repository of the folder the panel was opened in, when there is one. */
  current: RepoKey | null;
  accounts: AccountView[];
}
