# CI Hub — CI dashboard for OpenChamber

[![License: MIT](https://img.shields.io/badge/License-MIT-6cc644.svg)](LICENSE)
[![OpenChamber](https://img.shields.io/badge/OpenChamber-%E2%89%A5%202.7.1-7c3aed.svg)](#install)
[![CI providers](https://img.shields.io/badge/CI%20providers-6-0969da.svg)](#supported-ci-providers)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6.svg)](#develop)

One console for **all** your CI, inside OpenChamber. CI Hub watches the pipelines of every project you have open, shows what is building or broken at a glance, and puts the failing job's log one click away — no browser tab switching. Works with **GitHub Actions**, **GitLab CI**, **Gitea Actions**, **Forgejo Actions**, **Woodpecker CI** and **Bitbucket Pipelines**, including self-hosted servers.

- **Run tree per project** — project → workflow → runs, coloured by result, virtualised, with filters by status, branch scope, service, actor and repo.
- **Failing logs fast** — the failing step and the log around the first error open with the run; tails are byte-accurate and UTF-8 safe.
- **Act, not just watch** — re-run (all or failed jobs), cancel, approve gated pipelines, and start manual runs with inputs or key/value variables.
- **Board** — every watched repository's latest run on one list, fresh failures first, with queue-aware durations (`queued 12s + ran 3m 00s`).
- **`@CI Hub runs` mentions** — search runs in the chat composer by number, branch, repo or title; the chip brings status, duration and the failing log's tail into the prompt.
- **Agent handoff** — send a failure to an agent with the repo, run URL and the log excerpt attached; the `ci-hub/run-finished` wait lets an agent block on a run and wake with a verdict.
- **Flaky & trend signals** — a failed run whose same commit passed is marked `flaky · passed in #41`; each workflow row carries a duration sparkline of its last 20 runs.
- **Tokens stay home** — credentials live in the service process only, each token goes to its own host, pages never poll, and no CI write happens without a click.

Requires OpenChamber 2.7.1 or newer (desktop or web; extensions do not load in VS Code or on mobile).

## Supported CI providers

| | GitHub Actions | GitLab CI | Gitea Actions | Forgejo Actions | Woodpecker CI | Bitbucket Pipelines |
|---|---|---|---|---|---|---|
| Watch pipelines | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Jobs & steps | steps | stages | steps | steps | steps | steps |
| Re-run all | ✅ same run | ✅ new pipeline | ✅ same run | ✅ same run | ✅ new pipeline | ✅ new pipeline |
| Re-run failed | ✅ | ✅ | ✅ (Gitea 1.26+) | — | — | — |
| Cancel | ✅ | ✅ | — | ✅ | ✅ | ✅ (stop) |
| Retry single job | — | — | — | ✅ | — | — |
| Approve gated | — | — | — | — | ✅ | — |
| Manual dispatch | ✅ inputs | ✅ variables | ✅ inputs | ✅ inputs | ✅ variables | ✅ variables |
| Self-hosted | ✅ GHES | ✅ | ✅ | ✅ | ✅ own server | — |

"—" means the provider's API has no such endpoint; the button is simply not offered.

## Install

The package is not in a catalog yet. Clone the repository, run `bun run check` once (installs, typechecks, tests and builds `panel/main.js` / `service/main.js`), then add the folder in OpenChamber: **Settings → Extensions → Add** — or open an `openchamber://extensions/install?path=…` link pointing at the checkout. Tokens go on the extension's card afterwards; see [Account](#account) and the provider notes below.

```sh
git clone https://github.com/NemeZZiZZ/openchamber-ci-hub.git
cd openchamber-ci-hub
bun run check
```

## Surfaces

- **Rail panel "CI Hub"** — the run tree beside your editor; the detail pane (jobs, steps, failing log) sits next to it from 640 px wide. Status tabs, branch scope (default + the branch checked out in the folder), service, actor and name filters in one compact bar.
- **Page "CI Hub"** (sidebar → Extension pages) — the same console full-screen; it opens on the **Board**.
- **Board** — latest run per watched repository, fresh failures → running → recency, provider and status filters. Also a tab in the panel bar.
- **Work Status section "CI"** — building/failed counts and the newest failure with a one-click re-run.
- **`@CI Hub runs` mentions** — run search for the composer; the resolved chip carries the log tail to the agent.
- **Wait `ci-hub/run-finished`** — agents block on a run (`repo`, `runId`, optional `conclusion`) and wake once with a report.

## Account

The service looks for a GitHub token in this order:

1. The GitHub account connected in OpenChamber (`~/.config/openchamber/source-control-auth.json`).
2. The token pasted into the "GitHub token" field on the CI Hub card (Settings → Extensions). It is sent to github.com only.
3. `gh auth token --hostname <host>` from the GitHub CLI.

A GitHub Enterprise server only gets a credential tied to that exact host (1 or 3). The token needs `repo` and `workflow` scopes for re-runs, cancel and dispatch. Other providers follow the same pattern — connected OpenChamber account first, then the card field — with the differences below.

## Provider notes

**GitLab CI** — gitlab.com, `gitlab.*` hosts or a self-hosted server connected in OpenChamber; `glab` CLI as the third source. `read_api` to watch, `api` to retry/cancel/dispatch. Pipelines group by name (else by source) on 19.4+; add repos by URL or folder, bare `group/project` still names a github.com repository; traces load the last 128 KiB (1 MiB full).

**Gitea Actions** (1.25+) — gitea.com, `gitea.*` or self-hosted. Re-run (all/failed) needs Gitea 1.26; there is no cancel API. Workflows group by file name (`build.yml`).

**Forgejo Actions** — codeberg.org, `forgejo.*` or self-hosted. Re-run all, cancel and single-job retry work; no re-run-failed endpoint. A server without the runs API refuses with a clear line.

**Woodpecker CI** — the one CI not tied to the git remote: set `woodpecker-server` (e.g. `https://ci.codeberg.org`) and a `woodpecker-token` (a Woodpecker personal access token, not the forge's) on the card. Projects whose git remote matches the server's repo list show Woodpecker first; gated pipelines show as waiting with Approve / Decline; restart creates a new pipeline; jobs are the pipeline's steps (clone/service filtered); logs decode Woodpecker's base64 entries.

**Bitbucket Pipelines** (Cloud) — paste `bitbucket-email` + `bitbucket-token` (Atlassian API token; app passwords stopped working in June 2026); Basic auth to `api.bitbucket.org` only. No re-run endpoint — re-run starts a fresh pipeline for the same target; log windows use real `Range` requests. Data Center is out of scope.

## Develop

```sh
bun install
bun run check     # typecheck (TS 7), tests, bundles, openchamber-guest-check
```

Try the service alone:

```sh
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js &
curl -H 'Authorization: Bearer t' localhost:4599/health
```

```
package.json          manifest (openchamber key)
panel/                index.html, page.html, main.ts → main.js (IIFE)
service/main.ts       → main.js (Node bundle), the only process holding a token
src/domain            pure types and logic (repo keys, format, log dialects, handoff, waits, status view)
src/providers         registry (index.ts), CiClient contract (types.ts), one adapter per provider, pure over fetch
src/service           auth, config store, engine (cache, poller, actions), routes
src/ui                app for the rail panel and the full-screen page
test/                 bun tests (361)
```

Repositories are stored by repo key, `provider:host/path` (for example `github:github.com/acme/app`). Config and the action log (`actions.log`, every re-run/cancel/dispatch) live in the service data folder, outside the package.

## License

[MIT](LICENSE) © NemeZZiZZ
