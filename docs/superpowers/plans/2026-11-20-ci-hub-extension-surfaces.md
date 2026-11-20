# CI Hub Extension Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CI Hub 0.3.0: CI state on sidebar rows, a `CiRun` card in agent replies, four `ci_*` agent tools with card presentation, session-event toasts, Small-Model failure summaries, slash commands, and mobile access.

**Architecture:** The existing service stays the only token holder and the only poller. New sandboxed frames (chat block, background) are thin bundles over the existing `serviceRequest` API; the OpenCode plugin reaches the same localhost HTTP API through an endpoint file the service writes. New logic lives in pure, unit-tested modules; frames and routes are thin adapters.

**Tech Stack:** TypeScript, Bun (`bun test`, `bunx openchamber-guest-bundle`), `@openchamber/sdk` 2.7.1, plain ESM JavaScript for the OpenCode plugin (no package imports).

**Spec:** `docs/superpowers/specs/2026-11-20-ci-hub-extension-surfaces-design.md`

## Global Constraints

- One release, `0.3.0`, on one feature branch. No push, no PR, no npm publish unless asked.
- `bun run check` (typecheck + tests + build + `openchamber-guest-check`) must pass after every task.
- No new runtime dependencies. The plugin imports no packages at all; Node builtins only through dynamic `import()`.
- Tokens never leave the service. The plugin receives only `127.0.0.1` port + the per-process service token.
- `contributes.blocks`: 1 block only; `args` is an array of camelCase **name strings**; `entry` is package-local `.html`; `answers: true`.
- `contributes.marks: true` requires `service` and `service.keepRunning: true`; limits 200 marks, 60 changes/minute; `ServiceMarkTarget` is `{sessionId}` or `{directory, branch?}`; `ServiceMark` is `{icon, tone, text, url?}`.
- `contributes.sessionEvents`: `{events: ["turn-finished", "turn-failed"]}`, never `content: true`. Path constant `SESSION_EVENTS_PATH`, parser `readSessionEventRequest`, from `@openchamber/sdk`. One delivery may take 10 s (`SESSION_EVENT_TIMEOUT_MS`).
- `host.generate` needs `"model"` in `contributes.capabilities`; handle `NO_MODEL` and `onLateGenerateResult`.
- `contributes.background.entry` owns `onResolve`; never register `onResolve` in the panel.
- All user-facing copy in English. Existing style: `.ts` extensions in imports, `const` arrow functions, small pure modules, comment header saying what the file is for.
- Block answer text is capped at `GUEST_BLOCK_ANSWER_MAX` (2000) — `buildHandoff` allows 15 000, so slice.
- Polling: `POLL_FAST_MS = 20_000` (panel open), `POLL_SLOW_MS = 180_000` (status section), new idle cadence 60 000 ms.

## Review Focus

1. **Idle polling against a rate-limited account** — a blocked account must stay skipped at the new idle cadence; test in Task 2.
2. **A session event for a directory CI Hub does not watch** — answer `{ok:true}`, no throw, no mark, no toast; test in Task 4.
3. **Model-written block args** (`repo`/`runId` empty, wrong, or a URL) — show an error card and make no request; test in Task 7.
4. **Plugin with a stale or missing endpoint file / service down** — return readable `content` text, never throw a stack into the model; test in Task 11.
5. **Marks turned off while marks are on screen** — every mark we set is removed and nothing is set again until re-enabled; test in Task 3.
6. **`NO_MODEL` or a late generate answer after the panel reloaded** — a plain toast, no unhandled rejection; test the pure parts in Task 8.

---

### Task 1: Preferences store and `/prefs` routes

**Files:**
- Create: `src/service/prefs.ts`
- Modify: `src/service/engine.ts` (deps + two methods), `src/service/routes.ts`, `service/main.ts`
- Test: `test/prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Prefs { marks: boolean; toastOnTurnFailure: boolean }
  export const DEFAULT_PREFS: Prefs // { marks: true, toastOnTurnFailure: true }
  export const parsePrefs: (raw: string | undefined) => Prefs
  export interface PrefsStore { load(): Promise<Prefs>; save(prefs: Prefs): Promise<void> }
  export const createFilePrefsStore: (dir: string) => PrefsStore   // <dir>/prefs.json, 0600, tmp+rename
  export const createMemoryPrefsStore: (initial?: Prefs) => PrefsStore
  ```
  `EngineDeps` gains `prefs: PrefsStore`. Engine gains `getPrefs(): Promise<Prefs>` and `setPrefs(patch: Partial<Prefs>): Promise<Prefs>`. Routes: `GET /prefs`, `PUT /prefs`.

- [ ] **Step 1: Write the failing test** — `test/prefs.test.ts`:
  ```ts
  test('parsePrefs defaults and rejects junk', () => {
    expect(parsePrefs(undefined)).toEqual({ marks: true, toastOnTurnFailure: true });
    expect(parsePrefs('{"marks":false}')).toEqual({ marks: false, toastOnTurnFailure: true });
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"marks":"yes"}')).toEqual(DEFAULT_PREFS);
  });
  test('file store round-trips and survives a missing file', async () => { /* tmp dir, save {marks:false,...}, reload */ });
  ```
  Plus a routes test in the existing `test/routes.test.ts` style: `PUT /prefs` with `{marks:false}` then `GET /prefs` returns it; a non-boolean field is ignored.
- [ ] **Step 2: Run** `bun test test/prefs.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `src/service/prefs.ts` mirroring `configStore.ts` (same tmp+rename write, same memory-store shape). Wire `prefs` into `EngineDeps`, add `getPrefs`/`setPrefs` to the engine's returned object, add the two routes, and pass `createFilePrefsStore(dataDir)` in `service/main.ts`. Extend `Call['method']` in `src/ui/port.ts` with `'PUT'`. Update existing engine test fakes to include `prefs: createMemoryPrefsStore()`.
- [ ] **Step 4: Run** `bun test && bun run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat: service-side preferences with /prefs routes`

### Task 2: Idle polling cadence for marks

**Files:**
- Modify: `src/service/engine.ts:662-732` (`busy`, `watched`, `interval`, `pollAll`)
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `EngineDeps.prefs` (Task 1).
- Produces: `export const POLL_IDLE_MS = 60_000`; `engine.debug()` keeps returning `interval`.

- [ ] **Step 1: Failing tests** — with fake timers and `now`:
  ```ts
  test('idle: polls every POLL_IDLE_MS when marks are on and nothing is open', /* debug().interval === 60_000 with no panel/status reads */);
  test('idle: no polling when marks are off', /* interval() === null after setPrefs({marks:false}) */);
  test('idle: a rate-limit-blocked account is still skipped', /* pollAll() with a blocked account makes no fetch for it */);
  test('panel open still wins over idle', /* interval() === POLL_FAST_MS after state() */);
  ```
- [ ] **Step 2: Run** `bun test test/engine.test.ts` — FAIL on the first two.
- [ ] **Step 3: Implement** — `interval()` returns `POLL_IDLE_MS` when neither window is recent and `(await prefs).marks` is on (cache the loaded prefs in a field refreshed by `getPrefs`/`setPrefs`; `interval()` stays synchronous). `watched()` gains an idle branch: all enabled repos, hot ones every tick, quiet ones only when `now() - polledAt >= POLL_SLOW_MS`. `pollAll` keeps skipping blocked accounts.
- [ ] **Step 4: Run** `bun test` — PASS.
- [ ] **Step 5: Commit** `feat: keep CI polling at a slow idle cadence for sidebar marks`

### Task 3: Sidebar marks

**Files:**
- Create: `src/service/marks.ts`
- Modify: `src/service/engine.ts`, `service/main.ts`, `package.json` (`contributes.marks`, `service.keepRunning`)
- Test: `test/marks.test.ts`

**Interfaces:**
- Consumes: `Run`, `isActive`, `isFailed` from `src/domain/format.ts`; `repoForDirectory` inside the engine; `EngineDeps.prefs`.
- Produces:
  ```ts
  export const latestOnBranch: (runs: Run[], branch: string | null) => Run | null
  export const markFor: (run: Run | null) => ServiceMark | null
  export const createMarkSync: (deps: {
    setMark: (target: ServiceMarkTarget, mark: ServiceMark | null) => Promise<unknown>;
    maxPerMinute?: number;  // default 60
  }) => { sync(rows: { directory: string; branch: string | null; runs: Run[] }[]): Promise<void>; clear(): Promise<void> }
  ```
  `EngineDeps` gains optional `setMark`. Engine gains `refreshMarks(): Promise<void>`, called at the end of `pollAll` and exposed for Task 4. Manifest: `contributes.marks: true`, `service.keepRunning: true`.

- [ ] **Step 1: Failing tests**:
  ```ts
  test('latestOnBranch picks the newest run on the branch, null for another branch');
  test('markFor: failure → error tone, running → info, success → null', () => {
    expect(markFor(failedRun)).toEqual({ icon: 'error-warning-line', tone: 'error', text: `CI failed · ${failedRun.workflow} #${failedRun.number}` });
    expect(markFor(runningRun)?.tone).toBe('info');
    expect(markFor(greenRun)).toBeNull();
  });
  test('sync sets only changed targets and clears removed ones');
  test('sync never exceeds 60 setMark calls per minute');
  test('marks off clears every mark we set and sets nothing new');
  ```
- [ ] **Step 2: Run** `bun test test/marks.test.ts` — FAIL.
- [ ] **Step 3: Implement** `marks.ts` (pure diff on `JSON.stringify` of the mark, budget counter reset per minute, `clear()` writes `null` for every target we set). Engine: build rows from enabled repos with `directory` plus session-event directories (Task 4 adds them; use a `extraDirs: Set<string>` field now), resolve each through `repoForDirectory`, read `slotFor(key).runs`; when `prefs.marks` is false call `clear()`. Wire `setMark: (t, m) => host.setMark(t, m)` in `service/main.ts` guarded by `host?`, and add the manifest keys.
- [ ] **Step 4: Run** `bun run check` — PASS (guest-check validates the new manifest keys).
- [ ] **Step 5: Commit** `feat: CI status marks on sidebar rows`

### Task 4: Session events → refresh, mark, `turn-ci` emit

**Files:**
- Modify: `src/service/engine.ts`, `src/service/routes.ts`, `package.json` (`contributes.sessionEvents`)
- Test: `test/sessionEvents.test.ts`

**Interfaces:**
- Consumes: `SESSION_EVENTS_PATH`, `readSessionEventRequest`, `GuestSessionEventRequest` from the SDK; `refreshMarks` (Task 3); `latestOnBranch` (Task 3).
- Produces: `engine.sessionEvent(request: GuestSessionEventRequest): Promise<{ ok: true }>`; emits topic `turn-ci` with `{ directory, repo, branch, runId, number, workflow, conclusion, attempt }`.

- [ ] **Step 1: Failing tests**:
  ```ts
  test('turn-finished with a failing run emits turn-ci once per run attempt');
  test('a second event for the same run attempt does not emit again');
  test('an unwatched directory answers ok without polling or emitting');
  test('a green run emits nothing');
  test('toastOnTurnFailure:false emits nothing but still refreshes marks');
  test('POST /session-events with junk answers 400');
  ```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — engine: ignore other event types; read `request.event.project.directory`; `null` → `{ok:true}`; add to `extraDirs`; `repoForDirectory` → `pollRepo(key).catch()` → `refreshMarks()` → dedupe key `${run.repo}#${run.id}:${run.attempt}` in a `Set` → `deps.emit('turn-ci', …)`. Route with the SDK parser. Manifest `sessionEvents`.
- [ ] **Step 4: Run** `bun run check` — PASS.
- [ ] **Step 5: Commit** `feat: react to agent turn events with a CI refresh and turn-ci signal`

### Task 5: Panel toast and preferences popover

**Files:**
- Create: `src/ui/app/turnCi.ts`, `src/ui/app/prefs.ts`
- Modify: `src/ui/app.ts` (`onServiceEvent` at :266), `src/ui/app/bar.ts` (`mountBar`), `src/ui/styles.ts`
- Test: `test/turnCi.test.ts`

**Interfaces:**
- Consumes: `Svc` from `src/ui/port.ts`, `App` from `src/ui/app/state.ts`, the existing `toast` helper in `app.ts`.
- Produces:
  ```ts
  export interface TurnCi { directory: string; repo: string; branch: string | null; runId: string; number: number; workflow: string; conclusion: string; attempt: number }
  export const readTurnCi: (data: unknown) => TurnCi | null
  export const turnCiMessage: (t: TurnCi) => string   // "CI failed on <branch>: <workflow> #<number>"
  export const prefRows: (p: Prefs) => { id: 'marks' | 'toastOnTurnFailure'; label: string; on: boolean }[]
  export const mountPrefs: (app: App, anchor: HTMLElement) => { sync(): void }
  ```

- [ ] **Step 1: Failing tests** — `readTurnCi` accepts the Task 4 payload and rejects `{topic:'runs'}`, `null`, missing `runId`; `turnCiMessage` falls back to the repo name when `branch` is null; `prefRows` labels are exactly `Sidebar marks` and `Toast when CI fails after a turn`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — pure module first; then `app.ts` calls `toast('error', turnCiMessage(t))` for topic `turn-ci`; `bar.ts` adds a settings button whose popover (own CSS class in `styles.ts`, segmented on/off buttons with `aria-pressed`) loads `GET /prefs` and writes `PUT /prefs` through `app`'s svc.
- [ ] **Step 4: Run** `bun run check` — PASS.
- [ ] **Step 5: Commit** `feat: toast on post-turn CI failure and a preferences popover`

### Task 6: Mobile opt-in

**Files:**
- Modify: `package.json` (`panel.mobile: true`, page `mobile: true`), `src/ui/styles.ts` only if the check finds breakage
- [ ] **Step 1:** Add both manifest flags; `bun run check`.
- [ ] **Step 2:** Load the unpacked extension, open the page at 360 px and at 1080×1920 portrait; fix only overflow that actually appears (tables scroll, dispatch dialog fits).
- [ ] **Step 3: Commit** `feat: mobile panel and page`

### Task 7: `CiRun` chat block

**Files:**
- Create: `src/ui/blockModel.ts`, `src/ui/block.ts`, `panel/block.ts`, `panel/block.html`
- Modify: `package.json` (`contributes.blocks`, `files`, `build` script)
- Test: `test/blockModel.test.ts`

**Interfaces:**
- Consumes: `createSvc`, `buildHandoff`, `formatDuration`, `runDuration`, `isFailed`, `host.onBlock`/`setHeight`/`answerBlock`/`openCommit`; engine's existing `GET /run` (`{run, jobs}`), `GET /log`, `POST /action`.
- Produces:
  ```ts
  export const readBlockArgs: (args: Record<string, string>) => { repo: string; runId: string }  // throws Error with a user-readable line
  export const blockTitle: (run: Run) => string                   // "<workflow> #<number> · <conclusion|status>"
  export const blockAnswer: (handoffText: string) => string       // sliced to GUEST_BLOCK_ANSWER_MAX
  ```
  Manifest block: `{ name: 'CiRun', description: 'Show one CI run: status, jobs, failing log, re-run and hand-off.', args: ['repo', 'runId'], entry: 'panel/block.html', answers: true }`.

- [ ] **Step 1: Failing tests**:
  ```ts
  test('readBlockArgs accepts a repo key and a numeric run id');
  test('readBlockArgs rejects empty, missing and whitespace-only args', /* expect(() => readBlockArgs({repo:'', runId:'1'})).toThrow(/repo/) */);
  test('readBlockArgs rejects a run id that is not digits or a run URL');
  test('blockAnswer never exceeds 2000 characters');
  ```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the pure module, then `src/ui/block.ts`: `connectHost`, `applyHostReady`, `host.onBlock` → validate (on error render the message, `setHeight`, no request) → `GET /run` → render status line, branch, sha, duration, failing jobs; buttons re-run failed (`POST /action` then re-read), log excerpt toggle (`GET /log`), sha → `host.openCommit(run.sha)`, and "Fix with the agent" → `host.answerBlock(blockAnswer(buildHandoff({run, jobs, job: focusJob(jobs), log, logTruncated, mode: 'fix'}).text))`. Own compact CSS on the same theme variables; do not import `app.ts` or `styles.ts`. Thin `panel/block.ts` entry mirroring `panel/main.ts`; `block.html` mirroring `index.html` with `panel/block.js`.
- [ ] **Step 4: Run** `bun run check`; then live: ask an agent in OpenChamber to call `CiRun("github:github.com/<owner>/<repo>", "<id>")` and confirm the card, the buttons and the answer.
- [ ] **Step 5: Commit** `feat: CiRun chat block with re-run, log and hand-off`

### Task 8: "Why it failed" Small-Model summary

**Files:**
- Create: `src/domain/summary.ts`
- Modify: `src/ui/app/log.ts`, `src/ui/app.ts` (late results), `package.json` (`capabilities` + `"model"`)
- Test: `test/summary.test.ts`

**Interfaces:**
- Consumes: `errorExcerpt` (`src/domain/log.ts`), `host.generate`, `host.storage`, `host.onLateGenerateResult`.
- Produces:
  ```ts
  export const SUMMARY_INPUT_MAX = 12_000;
  export const summaryRequest: (run: Run, jobs: Job[], rawLog: string) => { system: string; prompt: string }
  export const summaryKey: (run: Run) => string   // `ci-hub:summary:<repo>#<id>:<attempt>`
  ```

- [ ] **Step 1: Failing tests** — prompt names the workflow, run number, branch and failing jobs; `prompt.length <= SUMMARY_INPUT_MAX` for a 1 MB log; `summaryKey` differs between attempts.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — pure module; in `renderLog` a "Why it failed" button on failed runs: cached value from `host.storage` first, else `host.generate({...summaryRequest(...), maxOutputTokens: 400})`; render above the log; `NO_MODEL` → existing toast "No small model is configured in OpenChamber."; `onLateGenerateResult` writes storage and re-renders if that run is still shown.
- [ ] **Step 4: Run** `bun run check` — PASS.
- [ ] **Step 5: Commit** `feat: Small-Model summary of a failing run`

### Task 9: Endpoint file

**Files:**
- Create: `src/service/endpoint.ts`
- Modify: `service/main.ts` (listen callback + shutdown)
- Test: `test/endpoint.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EndpointInfo { port: number; token: string; pid: number; startedAt: number; version: string }
  export const endpointPath: (home: string) => string   // <home>/.openchamber-ci-hub/endpoint.json
  export const writeEndpoint: (home: string, info: EndpointInfo) => Promise<void>
  export const removeEndpoint: (home: string, pid: number) => Promise<void>  // only when the file's pid matches
  ```

- [ ] **Step 1: Failing tests** — writes mode `0600` JSON at the fixed path regardless of the data dir; `removeEndpoint` with a different pid leaves the file; with the same pid removes it; a missing file is not an error.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; call `writeEndpoint(home, {port, token, pid: process.pid, startedAt: Date.now(), version})` in the `server.listen` callback and `removeEndpoint(home, process.pid)` in `shutdown`.
- [ ] **Step 4: Run** `bun test` — PASS.
- [ ] **Step 5: Commit** `feat: publish the service endpoint for the OpenCode plugin`

### Task 10: Agent-facing routes with capped payloads

**Files:**
- Create: `src/service/agentView.ts`
- Modify: `src/service/engine.ts`, `src/service/routes.ts`
- Test: `test/agentView.test.ts`, additions to `test/routes.test.ts`

**Interfaces:**
- Consumes: existing `runDetail`, `log`, `state`/`repoForDirectory`, `errorExcerpt`.
- Produces:
  ```ts
  export const AGENT_RUNS_MAX = 20;
  export const agentRunView: (run: Run) => { repo: string; id: string; number: number; workflow: string; branch: string; sha: string; status: RunStatus; conclusion: Conclusion; attempt: number; url: string; durationMs: number | null; finishedAt: number | null }
  export const agentRunsView: (runs: Run[], limit?: number) => { items: ReturnType<typeof agentRunView>[] }  // default 10, cap 20
  export const agentJobsView: (jobs: Job[]) => { id: string; name: string; status: string; conclusion: Conclusion; failingStep: string | null }[]
  ```
  Engine: `agentRuns({directory?, repo?, branch?, limit?})`, `agentRun(repo, runId)` → `{...agentRunView(run), jobs: agentJobsView(jobs)}`, `agentLog(repo, runId, jobId?)` → `{job, excerpt, truncated}` with the excerpt capped at 12 000 chars. Routes `GET /agent/runs`, `/agent/run`, `/agent/log`. Re-runs keep using `POST /action`.

- [ ] **Step 1: Failing tests** — `agentRunsView` defaults to 10 and never returns more than 20 even when asked for 100; `agentJobsView` keeps only failing step names; `/agent/runs` without a resolvable repo answers 400 with a readable message; `/agent/log` output stays ≤ 12 000 chars for a huge log.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** mappers + engine methods + routes.
- [ ] **Step 4: Run** `bun run check` — PASS.
- [ ] **Step 5: Commit** `feat: compact agent routes for runs, jobs and failing logs`

### Task 11: OpenCode plugin with four tools

**Files:**
- Create: `plugin/index.js`, `plugin/service.js`
- Modify: `package.json` (`contributes.opencodePlugin: "plugin"`, `files` + `"plugin"`)
- Test: `test/plugin.test.ts`

**Interfaces:**
- Consumes: Task 9's file layout, Task 10's routes.
- Produces: `plugin/index.js` default-exports `{ id: 'ci-hub', setup }`; `setup` returns `{ tool: { ci_list_runs, ci_run_detail, ci_failing_log, ci_rerun } }`, each `{ description, input: <JSON Schema>, execute(args) }` answering `{ content: [{ type: 'text', text }] }` with compact JSON text. `plugin/service.js` exports `readEndpoint(env)` (env `CI_HUB_ENDPOINT` overrides the default `~/.openchamber-ci-hub/endpoint.json` path) and `callService(endpoint, method, path, query, body)` (fetch, Bearer, 15 s `AbortController` timeout, `GET /health` check before first use).

- [ ] **Step 0 (spike, timebox 15 min):** confirm the host loads a plugin whose entry dynamically imports `node:fs/promises` and `node:os`; if builtins are blocked, fall back to reading the endpoint through the OpenCode plugin context and record the finding in the design doc.
- [ ] **Step 1: Failing tests** — import `plugin/index.js` in Bun, point `CI_HUB_ENDPOINT` at a temp file, stub `globalThis.fetch`:
  ```ts
  test('ci_list_runs returns JSON text with items from /agent/runs');
  test('a missing endpoint file returns a readable message, not a throw');
  test('a non-200 service answer returns the service message text');
  test('ci_rerun posts to /action with rerun-failed');
  ```
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the two files; tool descriptions tell the agent the repo-key format (`github:host/owner/name`) and that `ci_failing_log` is capped.
- [ ] **Step 4: Run** `bun run check`; live spike: in OpenCode ask "what CI runs failed lately?" and watch a tool call succeed.
- [ ] **Step 5: Commit** `feat: OpenCode plugin exposing CI tools to the agent`

### Task 12: Tool-call cards

**Files:**
- Modify: `package.json` (`contributes.tools`), `test/manifest.test.ts` if present, else covered by guest-check
- [ ] **Step 1 (spike):** with Task 11 live, check whether the host parses the tool's JSON text `content` into `output`; if not, use `output: "json"` and record it in the design doc.
- [ ] **Step 2:** Add entries: `ci_run_detail` and `ci_rerun` as `output: "card"` (`status.tones` for success/failure/cancelled/running, ≤ 8 `fields`), `ci_list_runs` as a card list over `output.items`, `ci_failing_log` as `output: "code"`.
- [ ] **Step 3:** `bun run check`; live: one chat turn showing each card.
- [ ] **Step 4: Commit** `feat: card presentation for CI tool calls`

### Task 13: Instructions and skill

**Files:**
- Create: `src/service/instructions.ts`, `skills/ci-hub/SKILL.md`
- Modify: `service/main.ts`, `package.json` (`instructions: true`, `skills: "skills"`, `files` + `"skills"`)
- Test: `test/instructions.test.ts`

**Interfaces:**
- Produces: `export const INSTRUCTIONS: string` — use the `ci_*` tools for CI questions, render a finished run with `CiRun("repo", "runId")`, never invent run ids, repo keys look like `github:host/owner/name`.

- [ ] **Step 1: Failing test** — `INSTRUCTIONS.length <= 4096` and it names all four tools plus `CiRun`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; call `host?.setInstructions(null, INSTRUCTIONS).catch(() => undefined)` after listen; write `SKILL.md` (frontmatter `name`, `description`; body: list → detail → failing log → fix → re-run → show `CiRun`). Verify the skills folder layout against `DOCUMENTATION.md` before writing.
- [ ] **Step 4: Run** `bun run check` — PASS.
- [ ] **Step 5: Commit** `feat: agent instructions and a CI triage skill`

### Task 14: Slash commands, session action, background frame

**Files:**
- Create: `src/ui/background.ts`, `panel/background.ts`, `panel/background.html`
- Modify: `package.json` (`background`, `commands`, `actions`, `files`, `build`)
- [ ] **Step 1:** Implement `src/ui/background.ts`: `connectHost`; `onResolve` for `ci-status` / `ci-fix` resolves the current directory through `GET /state` + `/agent/runs` and returns an `AttachIssueRequest` chip `{providerId: 'ci-hub', id, title, url: run.url, text}` with a compact summary (≤ 16 000 chars); `onAction` for the session action `ci-check` refreshes and toasts the outcome. Verify the chip `providerId` against `ResolveRequest` in the SDK while implementing.
- [ ] **Step 2:** Manifest: `background.entry`, `commands: [{name:'ci-status', description:'Latest CI run for this folder'}, {name:'ci-fix', description:'Hand a failing CI run to the agent'}]`, `actions: [{id:'ci-check', label:'Check CI', icon:'git-branch-line', where:'session', mode:'background'}]`; thin `panel/background.ts` entry and html; add both bundles to `build` and `files`.
- [ ] **Step 3:** `bun run check`; live: `/ci-status` in the composer produces a chip, the session action toasts, and the panel still works (it must not register `onResolve`).
- [ ] **Step 4: Commit** `feat: ci-status and ci-fix commands plus a Check CI session action`

### Task 15: Release 0.3.0

**Files:**
- Modify: `package.json` (version), `README.md` (new surfaces, preferences, agent tools, mobile), `docs/superpowers/specs/2026-11-20-ci-hub-extension-surfaces-design.md` (record spike findings)
- [ ] **Step 1:** Update version and README; record the outcomes of the four "left to the builder" verifications in the design doc.
- [ ] **Step 2:** `bun run check` — PASS, plus a full manual pass: marks appear/clear, prefs off clears them, idle polling at 60 s, toast after a turn, block card and answer, generate summary, four tools with cards, commands, mobile width.
- [ ] **Step 3: Commit** `chore: release 0.3.0 — sidebar marks, chat block, agent tools`
- [ ] **Step 4:** Report to the user; no push and no tag without being asked.
