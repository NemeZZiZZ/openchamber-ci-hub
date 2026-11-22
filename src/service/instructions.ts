// What every agent in every session reads about CI Hub. Set once, globally,
// by the service: the tools come from our OpenCode plugin, the block from our
// package, so both are present wherever these instructions apply.

export const INSTRUCTIONS = `CI Hub watches this machine's CI runs across the configured providers.

When the user asks about CI, pipelines, workflows, a failing run or a deploy, use the CI Hub tools instead of shelling out to a provider CLI:
- ci_list_runs: recent runs for the current project (or an explicit repo), optionally one branch.
- ci_run_detail: one run with its jobs and each failing step.
- ci_failing_log: the error excerpt of the failed job (or a chosen job).
- ci_rerun: re-run a run, or only its failed jobs, and report whether the retry started.

Repository keys look like "github:host/owner/name" (the provider prefix changes with the provider). Prefer ci_list_runs with no repo argument: it resolves the current project itself. Run ids come from tool answers only — never invent a run id, and never guess one from a URL slug.

To fix a failure: ci_list_runs → ci_run_detail → ci_failing_log, then change the code, then ci_rerun. Report what the log actually showed; do not speculate about causes the log does not contain.

When you report a run, show it with the CiRun block, using the exact repo key and run id from the tool answer. CiRun is a UI block component: it draws only inside an openui-lang fence, never as a bare line of prose (bare, the user sees the text CiRun(...), not a card). Several runs go in one block:
\`\`\`openui-lang
root = Stack([a, b])
a = CiRun("github:host/owner/name", "123")
b = CiRun("github:host/owner/name", "124")
\`\`\`
The block draws the live status, the failed jobs and the actions.`;
