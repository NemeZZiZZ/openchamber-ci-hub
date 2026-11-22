# Changelog

All notable changes to CI Hub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`CiRun` cards drew as plain text.** The agent instructions and the
  `ci-hub` skill told the agent to put `CiRun("repo", "runId")` on its own
  line, so replies carried it bare in prose and the chat showed the call as
  text. Both now show it inside an `openui-lang` fence under
  `root = Stack([...])`, the only place a UI block draws.

## [0.3.0] — 2026-11-20

Extension surfaces beyond the panel: CI state shows up on the sidebar, inside
agent replies and in the agent's own hands. A failed run finds the user, and
the agent reads and acts on CI without a pasted mention.

### Added

- **Sidebar marks.** The branch's latest run marks its session/worktree row
  (`ServiceMark`): error tone on failure, info while running, cleared when
  green. Kept fresh by 60-second idle polling even with no CI Hub frame open;
  rate-limited accounts stay skipped.
- **`CiRun` chat block.** `CiRun("repo", "runId")` renders a live run card in
  the reply — status, jobs, failing log excerpt, re-run failed, the commit
  diff and a capped hand-off answer. Its own small bundle, not the panel's.
- **Agent tools with cards.** The bundled OpenCode plugin exposes
  `ci_list_runs`, `ci_run_detail`, `ci_failing_log` and `ci_rerun` through the
  service's endpoint file (`~/.openchamber-ci-hub/endpoint.json`, mode 0600,
  removed on shutdown). `contributes.tools` renders the answers as cards;
  payloads are capped for the agent's context.
- **Slash commands and a session action.** `/ci-status` attaches the latest run on
  the folder's current branch as a chip; `/ci-fix` attaches the latest failing run with fix
  instructions; **Check CI** refreshes the folder and toasts the outcome. The
  hidden background frame owns `onResolve`; the panel never does.
- **"Why it failed" summary.** A failed run's log view can ask the host's
  Small Model for a short explanation; the answer is cached per
  `repo#runId:attempt` and late results still land.
- **Session-event reaction.** On `turn-finished`/`turn-failed` the service
  refreshes that one repo, recomputes marks and emits `turn-ci`, which an open
  frame shows as a toast — deduped per run attempt, nothing posted to chat.
- **Service-side preferences.** ⚙ in the panel bar toggles sidebar marks and
  the post-turn toast; they live in `prefs.json` so the service honours them
  even with no frame open. Turning marks off clears every mark.
- **Mobile.** The panel and the full-screen page are opted in for phones.
- **Localization.** The panel, block and background frames ship in 16 locales
  (English, German, French, Spanish, Brazilian Portuguese, Dutch, Turkish,
  Polish, Ukrainian, Russian, Japanese, Korean, Simplified and Traditional
  Chinese, Hebrew, Arabic) with test-enforced key and placeholder parity,
  `Intl.PluralRules` plural forms, and right-to-left layout for Hebrew and
  Arabic. Agent- and model-facing text stays English on purpose.

## [0.2.0] — 2026-11-17

The first release since 0.1.0: a Fix button for failed jobs, calmer tree
paging, and a GitLab scope fix.

### Added

- **Fix button on failed job rows.** Every job that failed (`failure`,
  `timed_out`, `startup_failure`) carries a **Fix** control beside its row.
  It opens a new agent session with the run's facts, the focused job and the
  log excerpt, plus one instruction: fix the failure and commit the fix in the
  current branch, without pushing. The commit is left for review.
- `GET /handoff` accepts `mode=fix`. Without it the handoff text is unchanged
  byte for byte, so existing read handoffs behave exactly as before.

### Changed

- The run tree no longer pages in older runs by itself. An explicit
  **Load older runs** click is the only thing that fetches more history.

### Fixed

- GitLab merge request pipelines stay visible when the branch scope is
  narrowed to the branch checked out in the folder.

## [0.1.1] — 2026-11-15 (not published)

Release-pipeline work that never reached the registry: the npm publish failed
with E404 because the release token had no publish rights for the package.
Nothing user-facing changed.

### Fixed

- The release build pins `@types/bun`, so the workflow typechecks on a clean
  runner.
- The first publish passes `--access public`, which provenance requires for a
  new package.

## [0.1.0] — 2026-11-15

First public release.

### Added

- One console for six CI providers: GitHub Actions, GitLab CI, Gitea Actions,
  Forgejo Actions, Woodpecker CI and Bitbucket Pipelines, self-hosted servers
  included.
- Run tree per project (project → workflow → runs) with status, branch scope,
  service, actor and repo filters, and virtualised rows.
- The failing job and the log around the first error open with the run; tails
  are byte-accurate and UTF-8 safe.
- Actions where the provider's API supports them: re-run all, re-run failed,
  cancel, approve gated pipelines, and manual dispatch with inputs or
  key/value variables.
- Board page: the latest run of every watched repository, fresh failures
  first, with queue-aware durations (`queued 12s + ran 3m 00s`).
- `@CI Hub runs` mentions in the composer, carrying status, duration and the
  failing log tail into the prompt.
- Agent handoff with the repository, run URL and log excerpt attached, plus
  the `ci-hub/run-finished` wait agents can block on.
- Flaky detection (`flaky · passed in #41`) and a per-workflow duration
  sparkline of the last 20 runs.
- Tokens stay in the service process only and go to their own host.

[0.2.0]: https://github.com/NemeZZiZZ/openchamber-ci-hub/releases/tag/v0.2.0
[0.1.1]: https://github.com/NemeZZiZZ/openchamber-ci-hub/releases/tag/v0.1.1
[0.1.0]: https://github.com/NemeZZiZZ/openchamber-ci-hub/releases/tag/v0.1.0
