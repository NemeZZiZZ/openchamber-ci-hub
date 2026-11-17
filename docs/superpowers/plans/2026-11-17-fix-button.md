# Fix Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fix button next to each failed job opens a new session with the failure attached and an instruction to fix and commit (no push).

**Architecture:** Two independent slices: (1) a `mode=fix` flavor of the existing `/handoff` text pipeline (domain + service, no UI), (2) a Fix button on failed job rows calling the existing `sendToAgent` with that mode (panel only). The session-creation mechanics are untouched.

**Tech Stack:** TypeScript (strict), Bun test, OpenChamber guest SDK 2.7.1. No new dependencies.

**Spec:** Short design approved in chat 2026-11-17 (no docs file — `docs/` was removed from the tree by the user): per-job Fix button (recommended approach picked on a render page); session + ready text + commit in the same branch; push NOT included (one-line handoff-text change if ever wanted); status section, board, tree untouched.

## Global Constraints

- `bun run check` green before every commit (typecheck + tests + bundle build + guest-check); bundles committed (`panel/main.js`, `service/main.js`).
- No CI writes without a user gesture — the Fix click is the gesture; the agent's commit happens in a user-visible session.
- `src/domain` and `src/providers` stay provider-neutral (neutral guard `test/neutral.test.ts`).
- No push, no PRs; never touch `.mimosa/` or `deploy/`.

## Review Focus

- A Fix click on a job whose log cannot be read still opens a session whose text says the log could not be read plus the fix instruction (no silent empty prompt). Pins to Task 1 Step 1, third test.
- A handoff opened without mode behaves exactly like today (byte-identical text). Pins to Task 1 Step 1, second test, plus the pre-existing `buildHandoff` test which must pass unchanged.
- The Fix button never nests inside the job row's select button (invalid HTML) and activating it does not fire row select. Pins to Task 2 Step 1 (assert Fix is a sibling control; activating it calls `svc` with `mode: 'fix'` without invoking the row-select handler).
- A running or passed job never shows Fix. Pins to Task 2 Step 1 (assert absence for both).
- The fix instruction names the current branch and forbids pushing. Pins to Task 1 Step 1, first test (assert both `current branch` and `Do not push.`).

---
### Task 1: Fix-mode handoff text

**Files:**
- Modify: `src/domain/handoff.ts:25-75`
- Modify: `src/service/engine.ts:1040-1053`
- Modify: `src/service/routes.ts:162-163`
- Test: `test/domain.test.ts:80-95`

**Interfaces:**
- Consumes: `buildHandoff(HandoffInput)`, `engine.handoff(repo, runId, jobId)`, `GET /handoff?repo=&runId=&job=`.
- Produces: `HandoffInput.mode?: 'read' | 'fix'` (default `'read'`); `engine.handoff(repo, runId, jobId, mode)`; `GET /handoff` accepts `mode=fix` (any other value = read).

- [ ] **Step 1: Write the failing test**

  In `test/domain.test.ts`, describe `'handoff'`, next to the existing `buildHandoff` test:
  ```ts
  test('fix mode appends the fix instruction', () => {
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: 'FAIL src/parser.test.ts\n', logTruncated: false, mode: 'fix' });
    expect(handoff.text).toContain('current branch');
    expect(handoff.text).toContain('Do not push.');
  });
  test('fix mode without a readable log still instructs', () => {
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: null, logTruncated: false, mode: 'fix' });
    expect(handoff.text).toContain('could not be read');
    expect(handoff.text).toContain('Do not push.');
  });
  test('read mode text is unchanged', () => {
    const handoff = buildHandoff({ run: run(), jobs, job: jobs[1]!, log: 'FAIL src/parser.test.ts\n', logTruncated: false });
    expect(handoff.text).not.toContain('Do not push.');
  });
  ```
  (`run()` / `jobs` are the existing helpers in that describe block.)

- [ ] **Step 2: Run test to verify it fails**

  Run: `bun test test/domain.test.ts`
  Expected: FAIL — `mode` does not exist on `HandoffInput`.

- [ ] **Step 3: Implement `mode` in `src/domain/handoff.ts`**

  `HandoffInput` gains `mode?: 'read' | 'fix'`. In `buildHandoff`, when `mode === 'fix'` and a job is present, append after the log block (before the `TEXT_LIMIT` cut):
  ```
  '',
  'Fix the failure in this job and commit the fix in the current branch. Do not push.',
  ```
  Read mode output is byte-identical to today (existing test at line 85-90 still passes unchanged).

- [ ] **Step 4: Thread `mode` through service**

  `engine.handoff(repo, runId, jobId, mode: 'read' | 'fix')` passes `mode` into `buildHandoff`. `routes.ts` `/handoff` reads `q('mode')` and passes `'fix'` only when it equals `'fix'`, else `'read'`.

- [ ] **Step 5: Run tests and check**

  Run: `bun test test/domain.test.ts`, then `bun run check`.
  Expected: all green (363 tests before this task).

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/handoff.ts src/service/engine.ts src/service/routes.ts test/domain.test.ts service/main.js
  git commit -m "feat(service): fix-mode handoff text — fix and commit, do not push"
  ```
  (Include `service/main.js` only if the bundle changed; verify with `git status`.)

### Task 2: Fix button on failed job rows

**Files:**
- Modify: `src/ui/app/detail.ts` (job rows ~229-253)
- Modify: `src/ui/app/confirm.ts:137` (`sendToAgent` gains `mode`)
- Modify: `src/ui/app/state.ts:216` (`sendToAgent` signature)
- Test: `test/app.test.ts`
- Callers of `sendToAgent` pass `'read'` (unchanged behavior): runMenu `agent`/`agent-worktree` cases, run-card button.

**Interfaces:**
- Consumes: Task 1 (`GET /handoff` accepts `mode=fix`).
- Produces: failed job rows render a Fix control invoking `sendToAgent(run, job.id, false, 'fix')`.

- [ ] **Step 1: Write the failing test**

  In `test/app.test.ts`, following the existing fake-app pattern: render the run detail for a run with one failed job, one passed job and one running job; assert a Fix control is present as a sibling of (never inside) the failed job's select button and absent for the passed and running jobs; assert activating Fix calls `svc` with path `/handoff` and `mode: 'fix'` without invoking the row-select handler.

- [ ] **Step 2: Run test to verify it fails**

  Run: `bun test test/app.test.ts`
  Expected: FAIL — no Fix control exists.

- [ ] **Step 3: Implement the button in `src/ui/app/detail.ts`**

  Next to (sibling of, never inside) the job row's select button, only when the job conclusion is failed: a small Fix button. Activating it stops propagation (row select must not fire) and calls `app.sendToAgent(run, job.id, false, 'fix')`, reusing the run card's busy-key pattern (`${run.id}:agent`).

- [ ] **Step 4: Thread `mode` through `sendToAgent`**

  `sendToAgent(app, run, jobId, worktree, mode: 'read' | 'fix' = 'read')`; the `/handoff` query gains `mode` only when `'fix'`. Existing callers pass nothing (default `'read'`).

- [ ] **Step 5: Run tests and check**

  Run: `bun test test/app.test.ts`, then `bun run check`.
  Expected: all green.

- [ ] **Step 6: Commit**

  ```bash
  git add src/ui/app/detail.ts src/ui/app/confirm.ts src/ui/app/state.ts test/app.test.ts panel/main.js
  git commit -m "feat(panel): Fix button on failed jobs — new session with a fix-and-commit instruction"
  ```
  (Include `panel/main.js`; verify with `git status`.)
