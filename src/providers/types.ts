// The contract every CI provider fills: a client over its API, and what the
// service needs to find repositories, tokens and pages on its hosts.

import type { RepoKey, RepoRef } from '../domain/repoKey.ts';
import type { DispatchInput, Job, LogWindow, ProviderView, Run, WorkflowRef } from '../domain/types.ts';
import type { FetchLike } from './errors.ts';

export interface ListRunsOptions {
  branch?: string;
  event?: string;
  /** A provider status or conclusion used as the API filter. */
  status?: string;
  actor?: string;
  perPage?: number;
  page?: number;
}

export interface DispatchInputs {
  dispatchable: boolean;
  inputs: DispatchInput[];
  /** Why the provider would refuse to start it, when it would. */
  refusal: string | null;
}

export interface CiClient {
  listRuns(repo: RepoRef, options?: ListRunsOptions): Promise<Run[]>;
  listWorkflowRuns(
    repo: RepoRef,
    workflowId: string,
    options?: ListRunsOptions,
  ): Promise<{ runs: Run[]; total: number }>;
  getRun(repo: RepoRef, runId: string): Promise<Run>;
  listJobs(repo: RepoRef, runId: string): Promise<Job[]>;
  getJobLog(repo: RepoRef, jobId: string, options?: { tailBytes?: number; full?: boolean }): Promise<LogWindow>;
  rerunAll(repo: RepoRef, runId: string): Promise<void>;
  rerunFailed(repo: RepoRef, runId: string): Promise<void>;
  cancel(repo: RepoRef, runId: string): Promise<void>;
  /** Approves a gated run; only on providers whose capabilities allow it. */
  approve?(repo: RepoRef, runId: string): Promise<void>;
  /** Declines a gated run; only on providers whose capabilities allow it. */
  decline?(repo: RepoRef, runId: string): Promise<void>;
  listWorkflows(repo: RepoRef): Promise<WorkflowRef[]>;
  getDispatchInputs(repo: RepoRef, workflow: WorkflowRef, ref: string): Promise<DispatchInputs>;
  dispatch(repo: RepoRef, workflowId: string, ref: string, inputs: Record<string, string>): Promise<void>;
  defaultBranch(repo: RepoRef): Promise<string>;
  /** Server-backed providers only: the user's repositories, for discovery. */
  listServerRepos?(): Promise<ServerRepo[]>;
  /** Server-backed providers only: resolve a web run URL on the configured
   * server, since no git host belongs to the provider. */
  resolveRunUrl?(url: string): Promise<{ path: string; runId: string } | null>;
}

export interface ClientOptions {
  fetch: FetchLike;
  token: string;
  /** The web host the repository lives on (`github.com`, `ghe.acme.io:8443`). */
  host: string;
  /** Scheme+host(+port) as the user's server setting spells it, no trailing
   * slash; absent means the conventional `https://${host}`. */
  origin?: string;
  /** Username completing Basic credentials (the account email), when the
   * provider authenticates with a user:secret pair instead of a token. */
  user?: string;
  now?: () => number;
}

/** A repository as a server-backed provider's own list names it — the input
 * of clone-URL discovery and repo-id resolution. */
export interface ServerRepo {
  /** `owner/name` on the CI server. */
  path: string;
  /** The server's repository id, as a string. */
  id: string;
  /** Every clone URL the server knows for it. */
  cloneUrls: string[];
  /** The forge page, when the server names one. */
  forgeUrl: string | null;
}

export interface Provider extends ProviderView {
  /** Hosts that belong to this provider for everyone. */
  publicHosts: string[];
  /** Self-hosted servers recognisable by name alone (`github.acme.io`). */
  hostPattern: RegExp | null;
  /** The provider's key in OpenChamber's credential store; null when the
   * provider is not a platform source-control integration. */
  storeKey: string | null;
  /** The secret setting on the extension card; it only ever goes to a public host. */
  settingKey: string | null;
  /** The settings key holding this provider's server URL, when the provider
   * runs on a server of its own rather than on a git host. */
  serverSetting: string | null;
  /** A second, non-secret settings key completing the credentials (Basic
   * auth needs the account email next to its token). Null when the token
   * alone authenticates. */
  authSetting: string | null;
  cli: { program: string; tokenArgs(host: string): string[] } | null;
  apiOrigin(host: string): string;
  /** The repository path inside a remote's path segments, or null. */
  repoPath(segments: string[]): string | null;
  webUrl(ref: RepoRef): string;
  ciUrl(ref: RepoRef): string;
  parseRunUrl(url: string): { repo: RepoKey; runId: string } | null;
  createClient(opts: ClientOptions): CiClient;
}
