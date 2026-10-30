# Phase 8 — Final verification: step plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (review fixes; supersedes Revision 1):**
- T00: only `appUrl` is threaded (`dispatchEvents` chain); `createProvider`/`hostPolicy`/`getOAuthClient` threading dropped; spacing-floor test made discriminating (RED first); AI auto-approve dropped (D47); `$connect` guard and warmup 10x runs dropped; real test files named.
- T01: concrete placement recipe (direct-seeded `PlacementTest` + `WarmupMessage` rows, `page.clock` for the 15 s poll); axe step dropped; resume drill made agent-executable (child `npm run dev`, kill tree, fresh subagent).
- T02: logic in `packages/core/src` (thin `scripts/migration-check.ts`), no marker row, no Dockerfile change. **Correction to the controller ruling:** a `PAUSED` account is NOT skipped by `mail-sync` (`syncDue` excludes only `lifecycle = 'NEEDS_ATTENTION'` and null credentials; `reconcileAccount` checks neither), so the fixture account is `NEEDS_ATTENTION`. The rotate-key step asserts 1, and verify re-runs under the new key.
- T04: `license-checker-rseidelsohn` pinned to 5.0.1 (`npm view`); final short sonnet review of the T04 doc edits added.
- The "controller applies TASKS.json" section is removed (P8-T00 already exists with deps `["P7-T08b"]`; P8-T01 deps `["P8-T00"]`).

**Goal:** Close the Phase 7 debt, fill the last gaps in the spec §28 E2E mapping, prove a local-to-VPS migration in CI (dump, restore into a fresh stack, attachments and encrypted credentials intact), get an independent whole-system review, and finish with a release legal check.

**Architecture:** No new subsystem. T00 is small code fixes with tests. T01 adds only the E2E flows that are missing. T02 extends the existing `compose-smoke` job and reuses `scripts/backup.sh` and `scripts/restore.sh`. T03 and T04 are review/report tasks that write docs and fix findings.

**Tech Stack:** TypeScript 5.9, Prisma 7.10.1, PostgreSQL 18, Vitest + embedded-postgres, Playwright 1.64 (from `apps/web`), Docker Compose (CI only), POSIX sh.

**Spec:** `docs/IMPLEMENTATION_PLAN.md` ("Phase 8 — Final verification", "Spec §28 E2E mapping", "Phase-end gate"); `docs/PRODUCT_SPEC.md` (PS-DEPLOY-11 and the 6 unticked items); `docs/HANDOFF.md` (debt list); `docs/TASKS.json` (P8-T00..T04); `CLAUDE.md`.

> Branch `phase-8-final`. Commit and push after every task, then poll CI yourself (`curl -s "https://api.github.com/repos/AnalyticDog13/rightnow-ai/actions/runs?per_page=1"`; `gh` is not installed). Stage by explicit path. On this low-RAM Windows machine run vitest per project with `--maxWorkers=2`; a worker crash with exit 3221226505 is a known flake: rerun that file alone. Docker is not installed locally: the compose work in T02 is verified only by CI, and `.ps1` files are syntax-checked, never run.

## Global Constraints (every task inherits CLAUDE.md; the ones this phase can break)

- Workspace scoping on every query; worker writes conditional on the state read; no network call inside a DB transaction; no new advisory lock.
- `credentialsEnc` is written only through `setCredentials()`; rows are created only through `openAccount()`. T02's fixture uses both, never a direct update. D47: `reviewSuggestion` is the only writer of `AiSuggestion.status`.
- No new runtime dependency. Dev tooling used by T04 runs through `npx` with an exact version and is not added to `package.json`.
- Per task: tests first (show RED), then `npm run lint`, `npm run typecheck` and the named vitest projects, all green, before the commit. Playwright specs run with `E2E_PROD=1` from `apps/web`.
- Nothing destructive without the user: no history rewrite, no force-push, no rotation of real credentials performed by an agent on its own.

## Review Focus (input classes no acceptance test covers; each has a test in its owning task)

- Repeated bad bearer tokens from one client are limited, but only after verification fails: a valid key is never counted, so valid keys are unaffected. In `MODE=local` every caller shares the single `local` bucket (`clientIp`), so 20 bad guesses lock out bad-token attempts for everyone locally for the window; valid keys still work. (T00-B)
- A push notification right after a sync attempt began must not re-flag the account within the floor. (T00-C)
- Calling `recommend` twice, or an AI answer that repeats a title, must not stack duplicate `AWAITING_APPROVAL` tasks. (T00-D)
- Restoring a dump under a different `ENCRYPTION_KEY` must fail loudly, not decrypt to garbage. (T02)
- A restore must not lose attachment bytes (`Attachment.data` is `Bytes`, inside the dump). (T02)

## Task order and models

| Task | Title | Model | Deps |
|---|---|---|---|
| P8-T00 | Phase 7 debt fixes | sonnet | P7-T08b |
| P8-T01 | Missing E2E flows + resume drill | sonnet | T00 |
| P8-T02 | Local-to-VPS migration in CI | sonnet | T01 |
| P8-T03 | Final cross-system review, `docs/FINAL_ASSESSMENT.md`, fix rounds | opus | T02 |
| P8-T04 | Release legal check | sonnet | T03 |

Sequential. No parallel implementers.

## Debt disposition (every item in HANDOFF "Current task")

| Debt item | Disposition |
|---|---|
| `buildPayload` (APP_URL) calls `getEnv()` | Fixed, T00-A (`appUrl` only) |
| `createProvider` (factory.ts) / `hostPolicy` / `getOAuthClient` call `getEnv()` | Accepted, not fixed: no production caller holds an env (`JobCtx` is `{prisma, clock, signal}`); tests stub `getEnv` |
| Failed API-key lookup is not rate limited | Fixed, T00-B |
| Push sync spacing floor | Fixed, T00-C |
| `recommend` dedupe | Fixed, T00-D (also a duplicate title within one AI answer); a concurrent-call race can still stack duplicates, accepted: the tasks are `AWAITING_APPROVAL` and a person reviews them |
| PENDING non-recipient suggestions (SUMMARY / CAMPAIGN_ANALYSIS) | Accepted, not fixed: D47 makes `reviewSuggestion` the only writer of `AiSuggestion.status`; auto-approving would add a second writer |
| `$connect` duck-typing (Prisma 7.10.1) | Accepted, not fixed: `recordProviderError`'s tests (`packages/core/test/health.test.ts`) fail if a transaction client ever gains `$connect` (nested transaction), and a Prisma upgrade runs them |
| Test-only exports `BACKOFF_SEC`, `resetStaleJobs`, `zScore` | Accepted, not fixed: tests import them; moving them into test files would duplicate the logic |
| Shortcut `warmup.ts` DST | Accepted, not fixed: an hour's error on two days a year inside a 10-minute-minimum gap scheme |
| Shortcut `import.ts:78` (multi-line cell inflates the preview count) | Accepted, not fixed: preview only, the import uses the real CSV parser |
| Shortcut `push/renew.ts` (disconnect mid-transaction) | Accepted, not fixed: the next renewal sweep sees the cleared credentials and skips the account |
| `WebhookDelivery` ILIKE erasure scan | Accepted, not fixed: bounded by 30-day retention; an index adds write cost for a rare GDPR path |
| Events at or above `BATCH` stuck and starving the outbox | Accepted, not fixed: non-transient failures are isolated per event and stamped; a transient failure means the database is unhealthy and everything stops anyway |
| Flakes (vitest 3221226505, warmup A-7) | Accepted, not fixed: the exit code is a Windows-only worker crash; warmup A-7 is judged by CI (Linux) passing |
| Placement polling has no e2e | Fixed, T01 |
| D17 live provider verification needs user credentials | Accepted, not fixed: external dependency on the user (`docs/ops/LIVE_VERIFICATION.md`); T03 restates it as a release blocker for real-provider sends |

---

## P8-T00 Phase 7 debt fixes

**Files:**
- Modify: `packages/core/src/webhooks/deliver.ts` (`insert`, `insertDeliveries`, `enqueueDelivery`), `packages/core/src/automations/engine.ts` (`Limits`, `dispatchEvents`, `dispatchBatch`, `runBatch`, `runRule`, the `send_webhook` action's `run`), `apps/worker/src/jobs/event-dispatch.ts`
- Modify: `apps/web/lib/apikey-auth.ts`, `packages/core/src/push/handle.ts` (`requestSync`), `packages/core/src/ai/features.ts` (`recommend`)
- Test: `packages/core/test/webhooks.test.ts` and `packages/core/test/automations.test.ts` (both already call `dispatchEvents`), `apps/web/test/apikeys.test.ts`, `packages/core/test/push.test.ts`, `packages/core/test/ai-features.test.ts` (has `describe("recommend")`)

**Interfaces:**
- Produces: `dispatchEvents(prisma, clock, o: { batch?; maxMs; signal?; appUrl?: string } & Limits)`, and optional `appUrl?: string` on `insertDeliveries(tx, e, now, hooks, appUrl?)` and `enqueueDelivery(tx, e, now, webhookId, appUrl?)`, passed to `buildPayload(tx, e, appUrl ?? getEnv().APP_URL)`. `Limits` gains `appUrl?: string`; it already flows `dispatchEvents` → `dispatchBatch(…, o)` → `runBatch(sel)` → `runRule` → `ACTIONS.send_webhook.run(tx, clock, e, input, ruleId)`, so add the parameter along that path (read the handler signature at `engine.ts` where `a.run` is called). `apps/worker/src/jobs/event-dispatch.ts` is **not** changed: it omits `appUrl`, so the default `getEnv().APP_URL` applies (no production caller holds an env). `PUSH_MIN_GAP_SEC = 15` exported from `push/handle.ts`.

- [ ] **A. appUrl threading.** Failing test in `webhooks.test.ts`: `dispatchEvents(P(), clock, { maxMs: 0, appUrl: "https://inject.test" })` on a seeded REPLY event with an ACTIVE webhook inserts a `WebhookDelivery` whose payload links start with `https://inject.test` while `getEnv().APP_URL` is different; same through the `send_webhook` rule action in `automations.test.ts`. Run `npx vitest run --project @rightnow/core --maxWorkers=2 packages/core/test/webhooks.test.ts packages/core/test/automations.test.ts` — expect FAIL. Implement along the chain above; expect PASS. Existing tests, which pass no `appUrl`, stay green.
- [ ] **B. Failed key lookups limited.** In `apps/web/lib/apikey-auth.ts`, when a token is present and `verifyApiKey` returns null, call `hit(prisma, \`ip:${clientIp(req, getWebEnv().MODE)}:apikey_fail\`, 20, 60, new Date())` (`clientIp` from `apps/web/lib/ratelimit.ts`) and throw `HttpError(429, "rate_limited", retryAfterSec)` when not ok; otherwise return null as before. The success path is untouched (valid keys never touch this bucket). Test in `apps/web/test/apikeys.test.ts` (it already imports `apiKeyResolver`): 20 bad tokens resolve to null, the 21st throws 429 with `retryAfterSec >= 1`, a valid key from the same client still resolves; with no token at all nothing is counted. Show RED first. Run `npx vitest run --project @rightnow/web --maxWorkers=2 apps/web/test/apikeys.test.ts`.
- [ ] **C. Push spacing floor.** `requestSync` already skips an account whose request is newer than its last attempt, so the trivial case passes today. The discriminating test (`push.test.ts`, in `describe("handleGmailPush")`): account with `lastSyncAttemptAt = now - 1s` and `syncRequestedAt = now - 60s` (older request, fresh attempt). Expect `handleGmailPush(...)` to return 0 and `syncRequestedAt` unchanged. Run it first against current code — it must FAIL (returns 1). Add to the UPDATE: `AND ("lastSyncAttemptAt" IS NULL OR "lastSyncAttemptAt" <= ${now - PUSH_MIN_GAP_SEC s})`. Also assert: `lastSyncAttemptAt = now - 16s` flags again (returns 1); `lastSyncAttemptAt` null flags. Same for `handleGraphPush` with one case. The poll path still covers a skipped notification.
- [ ] **D. Recommend dedupe.** In `recommend` (`ai/features.ts`), before `task.create`, drop candidate actions (1) whose lowercase trimmed title repeats an earlier one in the same answer, and (2) whose title matches an existing `Task` with the same `workspaceId`, `leadId`, `opportunityId` (null-safe) in status `AWAITING_APPROVAL` or `OPEN`. Tests in `ai-features.test.ts` `describe("recommend")`: two identical calls with the same fake answer create the tasks once; an answer with two identical titles creates one; a different title is created; the same title for another workspace's lead is not suppressed. Show RED first. A concurrent double call can still stack duplicates (accepted, see table). No change to `AiSuggestion.status`.
- [ ] **E. Gate.** `npm run lint && npm run typecheck`, then `npx vitest run --project @rightnow/core --maxWorkers=2`, `--project @rightnow/web --maxWorkers=2`, `--project @rightnow/worker --maxWorkers=2`.
- [ ] **F. Commit.**

```bash
git add packages/core/src/webhooks/deliver.ts packages/core/src/automations/engine.ts apps/web/lib/apikey-auth.ts packages/core/src/push/handle.ts packages/core/src/ai/features.ts packages/core/test/webhooks.test.ts packages/core/test/automations.test.ts apps/web/test/apikeys.test.ts packages/core/test/push.test.ts packages/core/test/ai-features.test.ts
git commit -m "fix(phase8): appUrl through dispatch, limit failed key lookups, push spacing floor, recommend dedupe"
```

## P8-T01 Missing E2E flows and the resume drill

Audit result: mapping rows 1-15 already exist (`accounts-google`, `test-send`, `leads-import`, `campaign-create`, `inbox-thread`, `crm`, `crm-revenue` specs; `packages/core/test/e2e/{multistep,quota,rotation,reply-sync,followup-cancel,bounce,analytics}.test.ts`; `apps/worker/test/restart.test.ts`; `browser-closed.test.ts`). Missing: the placement-polling UI flow and row 16's `docs/ops/RESUME_DRILL.md` with its execution. `a11y.spec.ts` already covers `/deliverability/placement`, so no axe step.

**Files:**
- Create: `apps/web/e2e/placement.spec.ts`, `docs/ops/RESUME_DRILL.md`
- Modify: `docs/PROGRESS.md` (drill result line); `apps/web/app/(app)/deliverability/placement/placement-manager.tsx` only if a needed accessible hook is missing

**Interfaces:**
- Consumes: `GET /api/v1/placement-tests/:id` → `placementReport(prisma, ws, id)` (`packages/core/src/deliverability/placement.ts`); the manager polls it every 15 s while a test is shown and maps folders to labels (`INBOX` "Inbox", `SPAM` "Spam", `PENDING` "Waiting for the result", `MISSING` "Not found"); `ensureSession`/`STATE` from `apps/web/e2e/session.ts`; the account seeding pattern in `apps/web/e2e/deliverability.spec.ts` (`createPrisma(process.env.E2E_DATABASE_URL!, 2)`, `encryptCredentials` after setting `ENCRYPTION_KEY`).

- [ ] **Step 1: Failing spec** `apps/web/e2e/placement.spec.ts`. `beforeAll` seeds with prisma (no provider call, no `startPlacementTest`): the owner's workspace; tested account `t@pl-e2e.io` (GMAIL, `GMAIL_WORKSPACE`, as in deliverability.spec); two seed accounts `s1@pl-e2e.io` and `s2@pl-e2e.io` with `placementSeed: true`; one `PlacementTest { workspaceId, accountId: t.id, subject: "Placement e2e" }`; two `WarmupMessage` rows with `kind: "PLACEMENT"`, `status: "SENT"`, `placementTestId`, `fromAccountId: t.id`, `toAccountId` s1/s2, unique `rfcMessageId`, `subject`, `dueAt`, `sentAt`; s1 `landedFolder: "INBOX"`, s2 `landedFolder: null`. Test: `await page.clock.install()`, open `/deliverability/placement`, pick the test in the select, assert the s1 row shows "Inbox" and the s2 row shows "Waiting for the result"; update s2's row to `landedFolder: "SPAM"` via prisma, `await page.clock.fastForward(15_000)`, assert s2 now shows "Spam". If installing the clock breaks the page's hydration, fall back to `page.reload()` and assert the same after reload, and record that the 15 s interval is covered only by the component code path.
- [ ] **Step 2:** From `apps/web`: `E2E_PROD=1 npx playwright test e2e/placement.spec.ts` — expect FAIL first (assert before seeding the update, or run before the spec's seed is complete). Fix the spec; add an `aria-label`/role in `placement-manager.tsx` only if a row cannot be located by role.
- [ ] **Step 3:** Same command passes. Then the whole suite once: `E2E_PROD=1 npx playwright test` (needs a prior `next build` with the Dockerfile placeholder env vars; delete `apps/web/.next` afterwards; Playwright may exit 1 on Windows from temp-dir cleanup even when all pass).
- [ ] **Step 4: Write `docs/ops/RESUME_DRILL.md`** (under 60 lines), an agent-executable drill. Prerequisites: Postgres reachable (dev `.env` `DATABASE_URL` points at port 5433; start the project's usual dev database first), `MAIL_PROVIDER_FAKE=1`. Steps: (1) the executor makes a small uncommitted partial edit to a file of the next task (a marker comment is enough) and records `git status`; (2) spawns `npm run dev` as a child process (Bash `run_in_background`) and confirms web :3000 and worker health :8081 respond; (3) kills the whole process tree mid-task (`taskkill /PID <pid> /T /F` on Windows, `kill -- -<pgid>` elsewhere) and confirms both ports are closed; (4) spawns a FRESH subagent (Agent tool) given only the text "keep going" and the repo path, and told to stop after it has stated, without changing anything, (a) which task is next per `docs/RESUME_INSTRUCTIONS.md` and (b) which uncommitted change it believes was interrupted; (5) compares its answer with the first `todo` task in `docs/TASKS.json` and the recorded `git status`; (6) cleanup: revert only the marker edit, kill any orphaned embedded-postgres processes. Results table: date, expected next task, expected interrupted change, subagent answer, pass/fail. The drill adds no code to the app; the "no duplicate send after a crash" half of row 16 stays proved by `restart.test.ts`, `browser-closed.test.ts` and `downtime.test.ts`.
- [ ] **Step 5: Execute the drill** once and fill the table. Record any deviation; do not edit the drill to match.
- [ ] **Step 6: Gate:** `npm run lint`, `npm run typecheck`.
- [ ] **Step 7: Commit.**

```bash
git add apps/web/e2e/placement.spec.ts docs/ops/RESUME_DRILL.md docs/PROGRESS.md
git commit -m "test(e2e): placement polling flow and executed resume drill"
```

## P8-T02 Local-to-VPS migration test in CI (PS-DEPLOY-11)

The dump already contains `Attachment.data` and the encrypted credential columns, so "still decrypts" is proven by reading them back after a restore into a fresh volume with the same `.env` key, and by failing under a wrong key. The existing `compose-smoke` steps already do backup, `down -v`, restore, and key rotation; the checks run inside that flow, no second stack.

**Files:**
- Create: `packages/core/src/migration-check.ts` (exported from `packages/core/src/index.ts`), `scripts/migration-check.ts` (thin CLI, like `scripts/rotate-key.ts`), `packages/core/test/migration-check.test.ts`
- Modify: `docker/entrypoint.sh` (new `migration-check` role and the usage string `web|worker|migrate|rotate-key|live-verify|migration-check`; no Dockerfile change, it already does `COPY . .`), `.github/workflows/ci.yml` (`compose-smoke`), `docs/ops/VPS.md`, `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, `docs/ops/KEY_ROTATION.md` only if it quotes "re-encrypted 0"

**Interfaces:**
- Produces in `migration-check.ts`: `seedMigrationFixture(prisma: PrismaClient, clock: Clock): Promise<void>` and `verifyMigrationFixture(prisma: PrismaClient, key?: Buffer): Promise<void>`. Seed (idempotent, fixed slug `migration-check` and email `mig@migration-check.test`) creates a `Workspace`, an account through `openAccount(tx, clock, ws, {...})` then `setCredentials(prisma, ws, id, { kind: "oauth", accessToken: "mig-access", refreshToken: "mig-refresh", expiresAt: …, scope: "s" }, { lifecycle: "NEEDS_ATTENTION" })`, a `Thread`, a `Message` (`direction: "IN"`, `folder: "INBOX"`, `kind: "OTHER"`) and an `Attachment` of 4096 deterministic bytes (`byte i = i % 251`). The account is `NEEDS_ATTENTION` because `syncDue` (`packages/core/src/mail/sync.ts`) skips exactly `lifecycle = 'NEEDS_ATTENTION'` and null credentials; `PAUSED` is not skipped. Before relying on this, the implementer re-reads `syncDue`, `push/renew.ts` and the account-touching jobs in `apps/worker/src/jobs/` and picks `provider`/state so no worker job contacts a provider for this account. Verify (no marker row): loads the fixture by slug, `decrypt(row.credentialsEnc, key)` (default key from env) and checks the access token, regenerates the 4096 bytes and compares `sha256` with the stored `Attachment.data`, checks the Message/Thread link. Errors carry no credential values.

- [ ] **Step 1: Failing unit test** `packages/core/test/migration-check.test.ts` (embedded Postgres via `createTestDb`, `testEnv()` from `accounts-fixture.ts`): seed then `verifyMigrationFixture(prisma)` resolves; with `verifyMigrationFixture(prisma, randomBytes(32))` rejects (wrong key, via `decrypt(enc, key)`); after flipping byte 0 of the attachment it rejects with a checksum error; seeding twice does not duplicate. Run `npx vitest run --project @rightnow/core --maxWorkers=2 packages/core/test/migration-check.test.ts` — expect FAIL (module missing).
- [ ] **Step 2: Implement** `packages/core/src/migration-check.ts`, export it, then `scripts/migration-check.ts` (`seed` | `verify` arg, `createPrisma` like `rotate-key.ts`; exit 1 on error). Expect PASS.
- [ ] **Step 3: Entrypoint role** `migration-check) shift; cd /app && exec node --import tsx scripts/migration-check.ts "$@" ;;` plus the usage string.
- [ ] **Step 4: CI** in `compose-smoke`, three edits and two new steps:
  1. In the existing "Backup" step, before `sh scripts/backup.sh`: `docker compose run --rm --no-deps migrate migration-check seed`.
  2. New step after "Healthy after restore, data back": "Migration fixture survives restore": `docker compose run --rm --no-deps migrate migration-check verify` must succeed (same key, fresh volume, restored dump).
  3. New step after it: "Wrong key is detected": `if docker compose run --rm --no-deps -e ENCRYPTION_KEY="$(openssl rand -base64 32)" migrate migration-check verify; then echo "wrong key accepted"; exit 1; fi`.
  4. In the existing "Rotate key runs in Compose" step: the fixture is now a credential row, so assert `EmailAccount.credentialsEnc: re-encrypted 1` (was `0`), update the `# limit:` comment, capture the new key from the script output (`sed -n 's/^New ENCRYPTION_KEY[^:]*: //p'`) and run `docker compose run --rm --no-deps -e ENCRYPTION_KEY="$new" migrate migration-check verify` (must succeed), plus the existing old-key readiness check. Keep every other assertion of "Bad dump is rejected", "Restore" and the rotate step unchanged.
  The first-start sync gate is not re-tested in CI: it is covered by the existing freshness-gate tests (`packages/core/test/dispatch.test.ts`, `packages/core/test/e2e/downtime.test.ts`); VPS.md cites them.
- [ ] **Step 5: Docs.** `docs/ops/VPS.md` new section "Moving from local to a VPS", with checkpoints: `scripts/backup.sh` on the laptop; copy `backups/*.dump` and the `.env` `ENCRYPTION_KEY` out of band; fresh VPS per sections 1-2 with the same `ENCRYPTION_KEY`; `scripts/restore.sh`; verify (sign in, `/api/readyz` green, a mailbox shows its state, **manually** download one attachment from the inbox); add the new domain's redirect URI in the Google and Microsoft consoles (link GOOGLE_SETUP.md, MICROSOFT_SETUP.md) and reconnect any account that shows `NEEDS_ATTENTION`; switch DNS and tracking-domain CNAMEs only after verification; stop the local stack so two instances never send from one mailbox; accounts sync before they send (freshness gate, proved by the tests named above). Tick PS-DEPLOY-11 and drop its "(DEFERRED → P8-T02)" note. Record D52 in `DECISIONS.md`: migration is proven in CI with a seeded fixture; redirect-URI rotation, DNS switch and UI attachment download are procedural, checked by the VPS.md checklist.
- [ ] **Step 6: Local gate** (no Docker): `npm run lint`, `npm run typecheck`, the Step 1 test, `sh -n docker/entrypoint.sh`. Push and wait for CI `check` and `compose-smoke`; if `compose-smoke` fails, fix from its Diagnostics output, never by weakening assertions.
- [ ] **Step 7: Commit** (one per CI fix as needed).

```bash
git add packages/core/src/migration-check.ts packages/core/src/index.ts scripts/migration-check.ts packages/core/test/migration-check.test.ts docker/entrypoint.sh .github/workflows/ci.yml docs/ops/VPS.md docs/PRODUCT_SPEC.md docs/DECISIONS.md
git commit -m "test(deploy): local-to-VPS migration check in compose-smoke (PS-DEPLOY-11)"
```

## P8-T03 Final independent cross-system review

**Model:** opus. The reviewer gets the code, `docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md`, `CLAUDE.md`, `docs/DECISIONS.md`; the debt table's dispositions are not given as conclusions to confirm.

**Files:**
- Create: `docs/FINAL_ASSESSMENT.md`
- Modify: whatever the findings require; `docs/REVIEW_LOG.md`, `docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/TASKS.json`

- [ ] **Step 1: Review.** One opus reviewer reads the whole branch and writes `docs/FINAL_ASSESSMENT.md`: scope and method; the CLAUDE.md invariants checked one by one with file:line evidence (single-send guarantee and HELD on unknown outcome, freshness gate, quota reserved in the claim transaction, `workspaceId` scoping, credential write paths, secrets never returned by an API, `assertPublicHost` on every outbound connect, `safeRequest` for webhook/AI/verifier, no network call in a transaction, unsubscribe always honoured, no fabricated engagement, approval before any AI text reaches a recipient); PRODUCT_SPEC parity (count ticked; each partial/deferred with reason and whether still acceptable); the 16-scenario E2E mapping with the test proving each; the ops story (backup, restore, migration, key rotation, offline recovery); known limits and external blockers (D17 live verification, no local Docker); findings ranked BLOCKER / SIGNIFICANT / MINOR, each with a suggested fix; a verdict.
- [ ] **Step 2: Fix.** A sonnet implementer per BLOCKER and SIGNIFICANT finding (opus only for concurrency/security), TDD, own commit, CI check. MINOR: fix if trivial, else list as accepted with a reason.
- [ ] **Step 3: Repeat.** A fresh opus reviewer re-reviews the diff since Step 1 against the findings; append "Round N" to `FINAL_ASSESSMENT.md`. Stop when a round has no BLOCKER or SIGNIFICANT. Cap at 3 rounds; if still failing, stop and report to the user.
- [ ] **Step 4: Full gate:** `npm test`, `npm run lint`, `npm run typecheck`, `E2E_PROD=1` Playwright from `apps/web`, CI green on the pushed head.
- [ ] **Step 5: Commit.**

```bash
git add docs/FINAL_ASSESSMENT.md docs/REVIEW_LOG.md docs/PROGRESS.md docs/HANDOFF.md docs/TASKS.json
git commit -m "docs: final assessment"
```

## P8-T04 Release legal check

The agent audits and reports; the user decides on lawyer review and on anything touching history. `gh` is not installed. These edits land after T03, so Step 9 reviews them.

**Files:**
- Create: `docs/LICENSES.md`, `CONTRIBUTING.md`, `NOTICE`, `docs/RELEASE_CHECK.md`
- Modify: `README.md` (branding and lawful-use wording only)

- [ ] **Step 1: Dependency licenses.** From the repo root run `npx --yes license-checker-rseidelsohn@5.0.1 --production --summary` and again with `--json` (one-off, not added to `package.json`; 5.0.1 is the current `npm view license-checker-rseidelsohn version`). Write `docs/LICENSES.md`: summary table, command, date, and any package whose license is not MIT/ISC/BSD/Apache-2.0/0BSD/BlueOak/CC0, or is `UNKNOWN`/`UNLICENSED`, with disposition. A copyleft (GPL/AGPL/LGPL) production dependency is a finding for the user, never swapped silently. List the Docker base images (node, postgres, caddy) by name and license only.
- [ ] **Step 2: NOTICE.** Packages that need attribution (Apache-2.0 NOTICE, BSD attribution) from the Step 1 JSON: name, version, license, URL, one line each.
- [ ] **Step 3: Full-history secret scan.** Scan every commit on every branch: `git log --all -p` piped to `grep -E -n` for `-----BEGIN .*PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `xox[baprs]-`, `sk-[A-Za-z0-9]{20,}`, `GOCSPX-`, `client_secret`, `password=` and `SETUP_TOKEN=` with non-placeholder values, base64 32-byte `ENCRYPTION_KEY=`. Also `git ls-files` for `.env`, `*.pem`, `*.key`, `backups/`. Classify every hit by hand (test fixture / `.env.example` placeholder / real) in `docs/RELEASE_CHECK.md` with counts, never the values. If anything is real: stop, tell the user, recommend rotating it. Do not purge history without the user's explicit approval; never force-push `main`.
- [ ] **Step 4: Branding and trademark.** Grep README, docs, UI strings and package metadata for "Instantly". Allowed: factual comparison ("alternative to", parity checklist) with a "not affiliated with or endorsed by Instantly.ai" line in README; no logos, screenshots, copied marketing copy or "official" claims. Flag `docs/PRODUCT_SPEC.md` passages that quote Instantly documentation verbatim (summarise or cite instead). `RELEASE_CHECK.md` notes that a "rightnow.ai" name/domain/trademark search was not done by the agent and is for the user.
- [ ] **Step 5: Lawful-use wording.** README "Responsible use" section: you need a lawful basis to email recipients (CAN-SPAM, GDPR/PECR, CASL as applicable), honest sender identity, the unsubscribe is built in and cannot be disabled, mailbox provider terms apply, no warranty, not legal advice. Link `docs/COMPLIANCE.md` and `docs/PROVIDER_COMPLIANCE.md`.
- [ ] **Step 6: CONTRIBUTING with DCO.** `CONTRIBUTING.md`: pointer to CLAUDE.md commands, test/lint/typecheck requirements, conventional commits, DCO 1.1 text and the `Signed-off-by` rule (`git commit -s`), a security-reporting line. No CI enforcement of DCO.
- [ ] **Step 7: Verify.** `npm run lint` and `npm run typecheck` pass; each relative link added to README resolves (check with a grep over `ls`).
- [ ] **Step 8: Report.** `docs/RELEASE_CHECK.md` ends with a summary for the user: clean items, findings, items needing a decision (lawyer review, trademark search, history purge if any). Repeat it in the final message.
- [ ] **Step 9: Short review.** A sonnet reviewer reads only the diff of `CONTRIBUTING.md`, `NOTICE`, `README.md`, `docs/LICENSES.md` and `docs/RELEASE_CHECK.md` for accuracy (NOTICE matches the JSON, no unsupported legal claims, links resolve, no secret values). Fix what it finds.
- [ ] **Step 10: Commit.**

```bash
git add docs/LICENSES.md NOTICE CONTRIBUTING.md docs/RELEASE_CHECK.md README.md docs/PROGRESS.md docs/HANDOFF.md docs/TASKS.json
git commit -m "docs: release legal check, licenses, NOTICE, CONTRIBUTING (DCO)"
```

---

## Phase gate

Per `IMPLEMENTATION_PLAN.md` "Phase-end gate": full test suite, lint, typecheck, Playwright, CI green (`check`, `compose-smoke`, `imap-real`); T03 replaces the usual ponytail-audit reviewer with the opus final review; tick PS-DEPLOY-11 only (partials stay); update PROGRESS, HANDOFF, REVIEW_LOG; fast-forward `main` to `phase-8-final` and push. Kill leftover embedded-postgres processes at session end.

## Coverage self-check

PS-DEPLOY-11 → T02. Mapping row 16 → T01 (`RESUME_DRILL.md`, executed). Placement polling e2e → T01. Debt items → table above. Unticked items other than DEPLOY-11 (SYNC-01, WARM-08, WARM-18, SEC-15, CAMP-14) stay partial/deferred by their decisions (D48, D51, D50, D19); T03 re-judges each in FINAL_ASSESSMENT.
