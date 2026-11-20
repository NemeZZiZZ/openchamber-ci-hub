// Types for the plain-JavaScript plugin, so the test suite can drive it.

export interface CiToolResult {
  content: { type: string; text: string }[];
}

export interface CiTool {
  description: string;
  input: { type: string; [key: string]: unknown };
  execute(args: {
    directory?: string;
    repo?: string;
    branch?: string;
    limit?: number;
    runId?: string;
    jobId?: string;
  }): Promise<CiToolResult>;
}

export interface CiHubPlugin {
  id: string;
  setup(context?: unknown): Promise<{
    tool: {
      ci_list_runs: CiTool;
      ci_run_detail: CiTool;
      ci_failing_log: CiTool;
      ci_rerun: CiTool;
    };
  }>;
}

declare const plugin: CiHubPlugin;
export default plugin;
