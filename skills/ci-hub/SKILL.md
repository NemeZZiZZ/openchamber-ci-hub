---
name: ci-hub
description: Triage a failing CI run with CI Hub — find the run, read the failing log, fix, re-run. Use when the user mentions CI, a pipeline, a workflow run, a red build or a failed deploy.
---

# CI Hub triage

CI Hub's tools talk to the CI Hub service, which holds the provider tokens. Do not call `gh`, `glab` or provider HTTP APIs for what these tools answer.

## Flow

1. **Find the run.** `ci_list_runs` with no arguments uses the current project. Pass `branch` when the user names one, or `repo` (a key like `github:host/owner/name`) for another repository. If it answers "No CI repository", the project is not linked: ask the user to pick the repository in the CI Hub panel instead of guessing keys.
2. **Read the run.** `ci_run_detail` with the repo key and run id from step 1 gives status, conclusion, attempt, jobs and each failing step.
3. **Read the failure.** `ci_failing_log` returns the error excerpt of the first failed job; pass `jobId` for a different job. The excerpt is capped, so a missing line means the log was trimmed, not that the error is absent.
4. **Fix.** Change the code the log indicts. Never invent run ids, job names or log lines.
5. **Re-run.** `ci_rerun` with `failedOnly: true` retries just the failed jobs. Report the answer's `ok`; do not claim the run is green until a later `ci_run_detail` says so.
6. **Show it.** Put `CiRun("repo", "runId")` on its own line with the exact values from the tool answer. The user gets a live card with the status and the actions.

## Errors

Tool errors come back as text, not exceptions. "CI Hub is not running" means the user should open the CI Hub panel; "auth" or "rate limit" errors mean the provider account needs attention in CI Hub's settings. Neither is a reason to retry in a loop.
