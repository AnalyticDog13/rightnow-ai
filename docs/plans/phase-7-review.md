# Phase 7 step plan: independent review

Reviewer: fresh-context plan reviewer · Date: 2026-10-23 · Plan: `docs/plans/phase-7.md` (branch `phase-7-advanced`, at 0018c7a)

I checked the plan against the following:
- `rightnow_ai_master_prompt.md` §3, §12, §13, §14; `docs/IMPLEMENTATION_PLAN.md` Phase 7, Global Constraints, data model "Automation (P7)"
- `docs/PRODUCT_SPEC.md`: all 72 unticked items; `docs/HANDOFF.md` carry-forwards; `docs/DECISIONS.md` D15, D21, D38, D40, D42; `CLAUDE.md`
- the code:
  - web: `apps/web/lib/{api,apikey-auth,auth,auth-client,setup,workspace,nav}.ts`, `app/api/auth/[...all]`, `next.config.ts`, `app/layout.tsx`, `inbox/message-frame.tsx`, the 115 `route.ts` files (imports, `z.unknown()` bodies, ADMIN roles), `test/auth-org.test.ts`
  - worker: `apps/worker/src/{boss.ts,jobs/index.ts,jobs/mail-sync.ts}`
  - core: `dispatch.ts` (`claimDue`, `claimOne`, `withTxRetry`, `isRetryable`), `crm/opportunities.ts` (`inSavepoint`, `onInterestChange`), `accounts/health.ts` (`recordProviderError`), `campaigns/enroll.ts` (`enrollBatch`, `moveToSubsequence`), `mail/sync.ts` (`reconcileAccount`, `ingestOne`, `syncDue`), `mail/classify.ts`, `mail/stoprules.ts`, `leads/{service,verify,domain,export}.ts` (`gdprDeleteLead`, `httpVerifier`), `template.ts`, `planner.ts`, `deliverability/health.ts`, `crypto.ts`, `apikeys.ts`, `rotate.ts`, `analytics/crm-report.ts`
  - providers: `net.ts` (`assertPublicHost`, `isPrivate`), `errors.ts`, `index.ts`, `graph/http.ts`
  - schema: `Event`, `EventType`, `Task`, `LeadLabel`, `LeadListMember`, `Invitation`, `Member`, `StepVariant`, `InboxView`, `AuditLog`; `docker-compose.yml`, `docker/Caddyfile`

## What holds up

These parts are correct as written:

- **Reused names exist with the stated shapes.**
  - `route()` takes `auth/role/scope/body/query` and returns a plain function, so attaching `meta` works. API keys resolve to MEMBER in `apikey-auth.ts`.
  - `JobDef`/`JobDeps` are `{prisma, clock, bootId, signal}`.
  - `inSavepoint(tx, name, fn, onError)` rethrows retryable codes. `withTxRetry` and `isRetryable` exist.
  - `enrollBatch(tx, …)` takes 726004 itself. `stopOpenCampaignLeads(tx, …)`, `suppress(tx, …)` and `recordEvent` (createMany skipDuplicates) exist.
  - `assertPublicHost(host, {mode, allowPrivate, resolve})` checks every resolved address and IPv4-mapped, NAT64 and 6to4 forms, and returns `{address, servername}`.
  - `ENCRYPTED_COLUMNS` is a generic `{model, field}` list that `rotate.ts` walks.
  - `LeadLabel.aiDescription` and `Lead.personalization` already exist. `leads/domain.ts` and `leads/export.ts` exist, so T03a and T09 add to them.
  - `createTestDb`, `expectIsolated`, `fixedClock`, `seedCampaign`, `markFresh`, `runProviderContract` and `createFixtureFetch` all exist, and so do the `reply-sync` and `downtime` suites (`packages/core/test/e2e/`).
- **Outbox design.** It claims a flag (`dispatchedAt IS NULL … SKIP LOCKED`), not a watermark, so commit-order gaps cannot lose events. The per-rule savepoint, the `(ruleId, eventId)` unique and stamping in the same transaction give exactly-once rule runs. The `meta.ruleId` loop guard is sound: `create_opportunity` (an OPPORTUNITY Event) is the only action that writes an Event, and OPPORTUNITY is not a trigger.
- **Webhook delivery.** The lease plus the `attempts = :n` fencing token makes a late result write harmless. Row-scheduled retries (orchestrator ruling 3) are the right call, for the reason the plan gives. `BACKOFF_SEC` adds up to 84 960 s (23.6 h). HMAC over `"<t>.<raw body>"` with the event id gives consumers replay protection.
- **Push.** "Push only sets a flag" keeps the D16 watermark untouched. `lastSyncAttemptAt` is the run's start, so a push arriving mid-run re-arms the account correctly. The JWT checks (RS256 only, `kid` via JWKS, iss/aud/email/email_verified/exp/iat, refetch throttle) and Graph's clientState hash with `timingSafeEqual` are complete.
- **Rate limits.** `INSERT … ON CONFLICT DO UPDATE … RETURNING count` is exact under concurrency. A concurrent first insert waits and then updates, so "50 hits, max 10 → exactly 10" holds. `X-Real-IP` is trustworthy: Caddy's `header_up` overwrites it, and Compose publishes web only on `127.0.0.1:3000`.
- **A/B against the sender.** `claimOne` takes `StepVariant FOR SHARE` and cancels a row whose variant is inactive as `stale` (`dispatch.ts:197`), so the planner re-plans it. So a deactivation never sends the losing variant and never strands a lead.
- **Orchestrator rulings.** (1) Private hosts are refused in every mode unless `ALLOW_PRIVATE_HTTP_HOSTS=1`, which is safe; see M7 for metadata addresses under the flag. (2) A single OpenAI-compatible adapter is fine. (3) Row-scheduled retries are fine.
- **Coverage.** I checked all 72 unticked PS items against the self-check table. Every one is owned or deferred with a reason. PS-SEND-11's "campaign Accounts Unhealthy" half already exists (`deliverability/health.ts` `flipUnhealthy`), so the D51 ruling only needs to cover the "5 consecutive" half. Every HANDOFF carry-forward is mapped.
- **Fixture arithmetic.** These are correct: 23.6 h backoff, BounceProtect 3 / max(2000, 1000) = 0.15 % > 0.1 %, `revenuePerLead` 100 / 4 = "25.00" (campaign cash / contacted, D42), and the A/B row "A 100/12 vs B 100/10", where z ≈ 0.45 < 1.96. The exception is the `zScore` value in I10.

## Critical

**C1. One poison event stops every automation and webhook in every workspace.**
- **Location:** D43 Dispatch; T01 `dispatch races`.
- **What happens:** only the rule actions are isolated (`inSavepoint` per rule). Everything else in the batch transaction is not: `buildPayload`, the `WebhookDelivery` inserts, the `AutomationRun{FAILED}` insert in `onError`, and the stamp. Any non-retryable error there aborts the whole batch. After three retryable failures, `withTxRetry` also gives up. The next loop iteration claims the same 20 events again, because the claim is `ORDER BY "createdAt", id`, so the outbox never moves past them. Concrete triggers:
  - a payload builder that throws on one odd event (a deleted campaign, a message row erased mid-batch, JSON it cannot serialize);
  - the Prisma interactive transaction default timeout of 5 s (P2028, not retryable), when 20 events × rules × webhook payloads (thread and html reads) exceed it;
  - a rule deleted mid-batch, where the FAILED insert in `onError` hits 23503 outside the savepoint.

  Nothing alerts, and every later event of every workspace waits. `claimDue` solved the same problem with I5 isolation (`dispatch.ts:139`), but the plan does not carry that pattern over.
- **Fix:**
  - Wrap each event, meaning its rules plus its deliveries, in `inSavepoint(tx, "evt", …)`. A non-retryable error rolls back to that savepoint and stamps the event `dispatchedAt = now, dispatchError = code` (a new `String?` column in T01), so the other 19 commit.
  - Give the batch transaction `{ timeout: 30_000 }` (the existing pattern). If the batch fails as a whole, the loop retries those ids one at a time before claiming new rows.
  - Log `dispatch_isolated` with the event id and code.
  - Tests in `automations.test.ts`:
    - an event whose `buildPayload` throws (a test hook) is stamped with `dispatchError`, and the other 19 events' runs and deliveries commit;
    - after it, a new event is dispatched in the next batch.

## Important

**I1. GDPR erasure can race the dispatcher and leave a delivery that holds the erased address.**
- **Location:** D44 GDPR; T02 `gdpr purges deliveries`; Review Focus 3.
- **What happens:**
  - Dispatcher transaction T1 claims event E of lead L, builds a payload with L's email and inserts `WebhookDelivery(leadId L)`. `WebhookDelivery.leadId` has no FK.
  - `gdprDeleteLead` (T2) deletes the deliveries `WHERE leadId = L` from its snapshot, which cannot see T1's uncommitted row. It then blocks on E at `UPDATE "Event" SET "leadId" = null`.
  - T1 commits, and T2 continues. The new delivery survives, and `webhook-deliver` POSTs the erased address.
  - Separately, deliveries and suggestions with `leadId` null carry the address too: a reply from a non-lead in `lead_email`/`reply_text`, or a `REPLY_DRAFT`/`SUMMARY` on a thread of that address. Erasure deletes those messages (`fromEmail`/`to`/`cc` match) but keeps the derived rows.
- **Fix:**
  - Make `WebhookDelivery.leadId` a real FK to `Lead` with `onDelete: Cascade`. The FK check's KEY SHARE lock then serializes the insert against the Lead delete. The explicit delete in `gdprDeleteLead` is no longer needed.
  - Delete deliveries whose `payload::text ILIKE` any of the emails, with the same `like` patterns `gdprDeleteLead` already builds for Event meta.
  - Delete `AiSuggestion` rows by `threadId` of the deleted threads.
  - Test: run `gdprDeleteLead` concurrently with a dispatch batch holding that lead's event (a hook pauses T1 after the insert). Afterwards no `WebhookDelivery` row contains the address, and `deliverDue` POSTs nothing.

**I2. Background jobs: one job per minute for the whole install, and long AI jobs are reset as stale.**
- **Location:** D45 "The `background-jobs` cron runs the oldest PENDING job per tick, with the `lead-import` stale and 3-reset rules"; T05b `ai_personalize`; T09 `placement_run`.
- **What happens:**
  - `ai_personalize` over 500 leads under the 30-per-minute AI limit (D47) takes about 17 minutes. During that time, every other workspace's `leads_bulk` and `placement_run` waits.
  - At 30 minutes the "stale" rule resets the live job to PENDING. A second runner then starts it alongside the first. The `(jobId, leadId)` unique prevents duplicate suggestions, but not doubled AI spend.
  - The plan does not say what a handler does when `hit()` refuses an AI call (fail the job or wait).
- **Fix:**
  - The handler bumps `updatedAt` on every `progress()` call, and "stale" means no progress for 5 minutes, not a job running for 30 minutes.
  - The tick claims with `FOR UPDATE SKIP LOCKED` in a loop until 50 s, up to 2 jobs at once, at most one RUNNING job per workspace.
  - On an AI rate limit, the handler sleeps `retryAfterSec` (bounded by the signal), and the job does not fail.
  - Tests:
    - a job reporting progress every 10 s for 40 minutes is not reset;
    - workspace B's `leads_bulk` finishes while A's long job runs.

**I3. An `automations:write` or `webhooks:write` key can do or read more than its scopes allow.**
- **Location:** Global Constraints "Webhooks and automation rules are MEMBER routes … because a key with `leads:read` can already read the same data".
- **What happens:** that reasoning covers reads only.
  - **Rules:** a key holding only `automations:write` can create `reply_received → suppress_contact`, `→ pause_account` or `→ enroll_campaign`. Those writes otherwise need `blocklist:write`, `accounts:update` and `campaigns:write`.
  - **Webhooks:** a `webhooks:write` key gets every reply's `reply_text`/`reply_html`, which otherwise needs `inbox:read`.
- **Fix:**
  - `createRule`/`updateRule`, when called with an API key, require the key to hold each action's scope. Map: `stop_sequence`/`enroll_campaign`/`move_to_subsequence` → `campaigns:write`; `suppress_contact` → `blocklist:write`; `pause_account` → `accounts:write`; `add_to_list`/`assign_owner`/`add_tag` → `leads:write`; `create_task`/`create_opportunity` → `crm:write`; `send_webhook` → `webhooks:write`. A missing scope gives 403 `scope_required:<scope>`. `route()` must pass the key's scopes into the handler context.
  - Webhook create/update by key also requires `inbox:read` when `events` includes reply events or `all_events`.
  - Test in `automations-api.test.ts`: an `automations:write`-only key creating a `suppress_contact` rule → 403.

**I4. better-auth's organization endpoints stay open as a second, unaudited way to manage members.**
- **Location:** D50 Invites/Members; T07b.
- **What happens:**
  - `lib/auth.ts` loads `organization()`, and `/api/auth/[...all]` serves all of its endpoints. These include `invite-member`, `update-member-role`, `remove-member`, `leave-organization` and `cancel-invitation`.
  - `auth-org.test.ts` already asserts that "the OWNER can invite" through `invite-member`.
  - T07b adds its own `invites`, `members/[id]` and accept routes with OWNER-immutable rules and audits. The better-auth paths bypass both: an ADMIN can change roles un-audited, and the OWNER can `leave` and orphan the workspace.
  - The plan also writes roles in upper case (`MEMBER|ADMIN|VIEWER`), but `Member.role` and `Invitation.role` are lower case (`getSessionInfo` upper-cases on read).
- **Fix:**
  - Implement the new routes on `auth.api.createInvitation`, `auth.api.updateMemberRole` and `auth.api.removeMember` (better-auth's role checks), and add the plan's OWNER and self rules and audits around them. Keep only the custom public accept, since sign-up is disabled.
  - Set `disabledPaths` to the `/organization/*` endpoints the UI does not call, and at least `leave`, `update-member-role`, `remove-member` and `invite-member` on the raw handler.
  - Store roles in lower case.
  - Update `auth-org.test.ts`.
  - Test: `POST /api/auth/organization/leave` as the OWNER → 404/403.

**I5. 2FA codes can be brute-forced from many IPs, and the IP fallback is undefined.**
- **Location:** D49 limits table; T07a `sign-in`.
- **What happens:**
  - TOTP verify is limited only by `ip:<ip>:2fa` at 5 per 60 s. An attacker who holds the password and rotates IPs gets unlimited guesses against a 10⁶ code space, with about 3 valid codes per window.
  - The plan names one "2FA verify" path. better-auth has `/two-factor/verify-totp`, `/verify-backup-code` and `/verify-otp`.
  - In vps mode without `X-Real-IP` (a user's own proxy, or Caddy not used), the IP is undefined.
- **Fix:**
  - Add `user:<userId>:2fa` at 10 per 900 s. The user comes from better-auth's two-factor cookie, or from the sign-in email bucket.
  - Apply the 2FA limits to all three verify paths.
  - In vps mode without `X-Real-IP`, use the constant `unknown`, which is safe because it fails closed (documented).
  - The email bucket counts only failed sign-ins (hit after a 401). Document in `docs/API.md` that it can lock the owner out for 15 minutes under attack.
  - Test: 11 TOTP attempts for one user from 11 IPs → the 11th is 429.

**I6. With the CSP nonce, static pages and the theme script will not run.**
- **Location:** D49 CSP; T07a `csp.spec.ts`.
- **What happens:**
  - Next applies the nonce only to dynamically rendered pages. A prerendered page gets no nonce, and `'strict-dynamic'` blocks its scripts, so the page never hydrates. Such pages include the new `invite/[id]` and `sign-in/2fa`, `app/page.tsx` and `not-found`.
  - `app/layout.tsx` renders next-themes' `ThemeProvider`, which injects an inline script. Without a `nonce` prop it is blocked on every page, which breaks the no-flash theme and gives the CSP console error the spec forbids.
- **Fix:**
  - `proxy.ts` sets the CSP on both the request headers and the response, and puts the nonce in `x-nonce`.
  - The root layout reads `(await headers()).get("x-nonce")`, which makes every page dynamic, and passes `nonce` to `ThemeProvider`.
  - `csp.spec.ts` also loads `/sign-in`, `/invite/<id>` and a 404 page with no CSP errors, and asserts that the `<html>` class is set before hydration.

**I7. The link-target warning cannot be built the way T08b describes.**
- **Location:** T08b `inbox/message-frame.tsx` ("the frame posts the click to the parent").
- **What happens:** the frame is `sandbox="allow-popups allow-popups-to-escape-sandbox"`, with no `allow-scripts` and no same-origin, and its meta CSP has no `script-src` (D30). So the frame cannot run a click handler, and the parent cannot see clicks inside an opaque-origin frame. Adding scripts would undo D30.
- **Fix:** in `srcDoc()` (the parsed DOM already exists), rewrite each anchor whose visible text is a URL with a host different from its `href`. Its `href` becomes `${origin}/link-check?to=<encoded href>&shown=<host>`, which opens in a new tab through the existing `<base target="_blank">`. A small `(app)/link-check/page.tsx` shows "This link goes to <host>" with Continue and Cancel. Test: clicking the mismatched link opens `/link-check` showing `evil.test`, and Cancel navigates nowhere.

**I8. The OpenAPI and strict-body work misjudges what actually needs changing.**
- **Location:** T03b (strict bodies, `api-key reach`, `z.toJSONSchema`); the T01, T02 and T05a signatures (`input: unknown`).
- **What happens:**
  - **No loose `z.object` bodies exist.** There are 0 non-strict `z.object` route bodies. The real gap is 14 routes with `body: z.unknown()` that validate in core: `crm/*`, `inbox/{macros,notes,views,threads/bulk}`, `imports` and `campaigns/import`.
  - **The new services repeat the pattern.** `createRule`, `createWebhook` and `setAiSettings` all take `input: unknown`, so their routes would also be `z.unknown()` and document nothing.
  - **The strictness test is vacuous.** In zod 4, `z.toJSONSchema` in its default output mode emits `additionalProperties: false` for plain `z.object` too. And `.transform()`/`preprocess` query schemas throw unless `unrepresentable: "any"` is set.
  - **"Every ADMIN handler is session-only" fails on existing routes.** Routes such as `accounts` POST and `blocklist/[id]` are `session-or-apikey` + `role: "ADMIN"`, which is already safe, because keys are MEMBER and get 403.
  - **The script needs env.** Importing every route pulls `@rightnow/db`, which throws without `DATABASE_URL`.
- **Fix:**
  - Each core service exports its zod input (`ruleInput`, `webhookInput`, `aiSettingsInput`, plus the 14 existing ones). Routes pass it as `body`, and core keeps parsing it.
  - Generate with `z.toJSONSchema(s, { io: "input", unrepresentable: "any" })`.
  - The strict test checks every object branch (unions included) in input mode.
  - Restate `api-key reach` as "no API key reaches an ADMIN handler": `role` ADMIN, or `auth: "session"`.
  - `scripts/openapi.ts` sets a placeholder `DATABASE_URL` the way the Dockerfile build does.

**I9. The new long-running jobs have no heartbeat, so a crash blocks them for 15 minutes.**
- **Location:** Fixed names "Worker jobs … All `policy: "stately", retryLimit: 0`" (only `background-jobs` gets `heartbeatSeconds`).
- **What happens:** `event-dispatch` and `webhook-deliver` loop for up to 50 s. If the worker is killed mid-job, the active job stays active until pg-boss expiry (15 min by default), and the stately queue starts no new run. Automations and webhooks then stall for 15 minutes. `mail-sync` sets `heartbeatSeconds: 10` for exactly this reason (`mail-sync.ts:24`).
- **Fix:** give `event-dispatch`, `webhook-deliver`, `push-renew`, `ab-optimize` and `background-jobs` `heartbeatSeconds: 10`. Extend `apps/worker/test/crash.test.ts`: a killed `event-dispatch` run → a new run within 60 s.

**I10. Some named tests are wrong, cannot be written, or cannot fail.**
- **Location:** T04 `zScore`; T01 `dispatch races` and `backfill`; T07a `headers`; T06a `provider calls`; T05a `approval invariant`.
- **What happens:**
  - **zScore value:** `zScore(30,100,10,100)` with pooled p = 0.2 is 0.2 / √(0.2·0.8·0.02) = **3.54**, not 3.82 (unpooled it would be 3.65). A correct implementation fails the test.
  - **Throwing action:** the test makes the action throw by "`create_task` with an assignee deleted mid-run", but `Task.assigneeId` has no FK, so nothing throws.
  - **Backfill:** "after the migration on a DB seeded with 3 Events" cannot be set up, because `createTestDb` applies every migration before any seeding.
  - **nosniff:** `security.test.ts` calls route handlers directly, and `next.config` `headers()` never runs there.
  - **Error codes:** `ProviderError` and `TransientBeforeSendError` have no `code` field (`errors.ts`). So "code `pubsub_permission`", "code `not_found`" and `safeRequest`'s "codes" need a field that does not exist.
  - **Approval invariant:** its first assertion cannot fail, because the planner never reads `AiSuggestion`.
- **Fix:**
  - Expect 3.54 (±0.01).
  - Use `add_to_list` with the list deleted mid-run (the `LeadListMember` FK gives 23503), or an `ACTIONS` entry the test registers to throw.
  - Test the backfill SQL by running the migration's `UPDATE` statement against seeded rows, or drop the test (see M12).
  - Assert the security headers in `csp.spec.ts`.
  - Add `readonly code: string` to a new `HttpOutError extends ProviderError` in `http-out.ts`, and put the push codes in `TransientBeforeSendError.detail` / a `ProviderError` subclass with `code`.
  - In the approval test, assert instead that `reviewSuggestion` is the only writer: a grep test that no file other than `ai/suggestions.ts` writes `personalization` from an `AiSuggestion`.

**I11. T01 and T02 are oversized, and opus would build UI pages.**
- **Location:** T01 (schema, engine, 4 producers, 11 actions, rules API, built-ins, page, rule editor, e2e) and T02 (`safeRequest`, the webhook core, routes, a page with dialogs, the deliveries table and a Recharts chart, e2e); Models.
- **What happens:** CLAUDE.md gives opus "only concurrency/security design", but these two tasks put pages and charts on opus. They are also the largest tasks in the phase, at the riskiest point. The Phase 6 review flagged the same pattern (M15).
- **Fix:** split them.
  - T01a (opus): migration, engine, producers, actions, rules service, worker job.
  - T01b (sonnet): routes, Automations page, rule editor, e2e.
  - T02a (opus): `safeRequest`, the verifier switch, the webhook core, the worker job.
  - T02b (sonnet): routes, the Webhooks tab and the overview chart, e2e.

  Update the TASKS.json table and the deps.

## Minor

- **M1. `ACCOUNT_ERROR` dedupe.**
  - `recordProviderError`'s second AuthError `updateMany` is `lifecycle: { not: "PAUSED" }`, which matches an account that is already NEEDS_ATTENTION. So "a second call → none" needs `notIn: ["PAUSED", "NEEDS_ATTENTION"]`.
  - `diagnostics.ts:87` needs the same.
  - The Event also needs `workspaceId`, which `recordProviderError` does not read today (`updateManyAndReturn` or one select).
- **M2. `CAMPAIGN_COMPLETED`.** Housekeeping completes campaigns with one multi-row raw `UPDATE "Campaign" … SET status = 'COMPLETED'` (`planner.ts:736`), so "count = 1" does not apply. Use `RETURNING id` and write one Event per id.
- **M3. Delivery claim and failure counter.**
  - The claim joins `Webhook`, so it must be `FOR UPDATE OF d SKIP LOCKED`. Otherwise it locks webhook rows, a second worker skips every delivery of that webhook, and the counter `UPDATE` waits behind the claim.
  - Make the failure increment one statement: `SET "consecutiveFailures" = "consecutiveFailures" + 1, status = CASE WHEN "consecutiveFailures" + 1 >= 20 THEN 'ERROR' ELSE status END … RETURNING status`. Only the statement that flips the status writes `webhook.disabled` and fails the PENDING rows.
  - Decide whether a 429 counts toward the 20 (suggestion: no).
- **M4. In-flight rows at auto-disable.** A SENDING row whose POST finishes after the disable goes back to PENDING (attempts < 8) against an ERROR webhook, and on resume it sends next to the redelivered ones. State it, or fail SENDING rows too when their result write sees `status = 'ERROR'`.
- **M5. Signature timing and rotation.**
  - Say that `t` and `v1` are computed at each attempt, never stored with the payload, so a redelivery 20 h later passes the 300 s check.
  - Document that `rotate-secret` takes effect immediately with no overlap (or sign with both secrets, `v1=…,v1=…`, for 24 h, if wanted).
- **M6. Payload hygiene and retention.**
  - `ScheduledMessage.renderedBody`/`renderedText` contain the lead's rendered `{{unsubscribeLink}}` (`planner.ts:122`), so `email_html`/`email_text` hand a third party a working unsubscribe token. Replace `/u/<token>` URLs with `[unsubscribe link]` in the payload, as the AI prompts already exclude them.
  - Retention: a payload of up to 256 KB per (event × webhook) is kept 30 days. Add a 90-day purge for `AutomationRun`, and DONE/FAILED `BackgroundJob` rows.
- **M7. SSRF gaps.**
  - `isPrivate` misses `::ffff:0:a.b.c.d` (IPv4-translated, `::ffff:0:0:0/96`), `64:ff9b:1::/48`, Teredo `2001::/32`, `100::/64` and `2001:db8::/32`. Add them in `net.ts`, which also hardens D15.
  - Add tests for `http://2130706433/`, `http://0x7f.1/`, `http://[::1]/`, `http://localhost./` and `[fd00:ec2::254]`.
  - Even under `ALLOW_PRIVATE_HTTP_HOSTS=1`, keep `169.254.0.0/16` and `fd00:ec2::254` refused. The flag is for LAN services, not cloud metadata.
  - Simpler pinning: pass `lookup: (_h, _o, cb) => cb(null, address, family)` to `http(s).request`. Node then keeps `Host` and SNI from the URL, so no `servername` or `Host` code is needed.
  - Make `timeoutMs` cover DNS too.
- **M8. Push details.**
  - Lifecycle notifications carry `clientState` too. Check it before `subscriptionRemoved` → FAILED, so a forged lifecycle notification cannot churn subscriptions.
  - Flag only when not already pending: `WHERE "syncRequestedAt" IS NULL OR "syncRequestedAt" <= "lastSyncAttemptAt"`. It is equally correct, and 1000 notifications become one write instead of 1000.
  - `route()` reads bodies with `req.json()` and no cap, so the push routes need a capped stream reader (Content-Length can be absent) to return 413.
  - Gmail watch takes `labelFilterBehavior: "INCLUDE"` (upper case).
- **M9. AI.**
  - Drop `escapeTemplate`. `template.ts` parses the template once, does not re-parse merge values and HTML-escapes them (`template.ts:274`), so `{{unsubscribe_url}}` in a personalization already renders literally, and escaping only corrupts the text. For DRAFT it is harmful: a draft containing `{{firstName}}` is exactly the useful output, and the human reviews it in the editor. Keep the test that it renders literally.
  - `SyncDeps.aiClassify` is one function for a cross-workspace `syncDue`. Make it `aiClassifyFor(ws) → Promise<AiClassifier | undefined>`, memoized per run.
  - `LEASE_MS` is a module constant, so add a test-only `deps.leaseMs`.
  - An AI rate-limit refusal in the classifier leaves the reply UNCERTAIN permanently, because the AI runs only on first ingest. State it, or exempt the classifier from the 30-per-minute bucket.
- **M10. Rule semantics.**
  - Lead actions (`stop_sequence`, `add_tag`, `enroll_campaign`, …) on lead-less triggers (`quota_reached`, `account_error`, `campaign_completed`), and `pause_account` on events without `accountId`, are undefined. Reject the pair at create (400 `action_not_applicable`).
  - Actions in user order can take D21 tables in reverse order (for example `pause_account` then `stop_sequence`), and a mixed-workspace batch takes several 726004 locks in event order. Both deadlocks are absorbed by `withTxRetry`. Say so in the D21 sentence, or run actions sorted by D21 order.
- **M11. A/B.**
  - Lock the step's variants `ORDER BY id`.
  - A variant the user re-activates is paused again at the next hour from the same data. Skip variants re-activated after their last `variant.auto_paused` until `n` grows by 100.
  - Assert that B's SCHEDULED rows end CANCELLED `stale` and are re-planned onto A.
  - Note that hourly re-testing ("peeking") inflates false positives. The 100-per-variant floor is the guard.
- **M12. Event backfill.**
  - `UPDATE "Event" SET "dispatchedAt" = "createdAt"` rewrites the largest table in a migration. Use `ADD COLUMN "dispatchedAt" timestamp(3) DEFAULT '1970-01-01'` followed by `ALTER COLUMN … DROP DEFAULT`. Postgres 11+ applies the default to existing rows without a rewrite, and new rows get NULL. That also removes the untestable backfill test (I10).
  - Note that every Event gets one non-HOT update.
- **M13. Members and audit.**
  - Settings → Audit log is ADMIN, but `GET /audit-logs` is MEMBER (`audit:read`). Pick one and document it.
  - Removing a member leaves the API keys they created working. Revoke them, or list them in the confirm dialog.
- **M14. Rich text.** PS-INBOX-08 is the reply composer only. Putting it in the step editor changes the stored body format of existing variants, which are templates, and is not required. Limit it to the composer.
- **M15. Sweep gaps.**
  - PS-SEC-03's session cookie attributes (`HttpOnly`, `SameSite`, `Secure` in vps) and PS-SEC-12 (footer, `uploadMethod`) have no named sweep test. Add one each.
  - Document 2FA recovery for a lost device and lost backup codes (an ops command that disables 2FA for a user).
  - Consider `Strict-Transport-Security` in vps mode (Caddy does not add it).
- **M16. Fixed-name collisions.** A label named like a standard event (`email_sent`) makes the webhook `events` entry ambiguous. Reserve the `WEBHOOK_EVENTS` names in the label validator.
- **M17. PS-CRM-12 placement.**
  - Match runs inside `ingestMessage`'s transaction, so the non-lead skip belongs there (after `match`), not in `ingestOne` "after classify".
  - Do the cheap thread and lead check before the AI hook, so mail that will be discarded is never sent to the AI.

## Verdict

**Revise before execution.** The architecture (Event flag outbox, row-scheduled webhook retries, push as a flag, a separate suggestion table) is sound, the reused interfaces exist, and coverage is complete. The plan cannot be dispatched as written for two reasons. C1 leaves the outbox without liveness. I1, I3 and I4 leave security and GDPR holes in the new surfaces. I6–I8 and I10 describe mechanisms or tests that cannot work as written.

## Revision 2 (binding changes, each owned by a task)

1. **T01a:** per-event savepoint, `Event.dispatchError`, a 30 s transaction timeout and one-by-one retry of a failed batch, plus the isolation test (C1).
2. **T01a:** `heartbeatSeconds: 10` on `event-dispatch`. **T02a:** on `webhook-deliver`. **T03a:** on `background-jobs`. **T04:** on `ab-optimize`. **T06a:** on `push-renew`. Plus the crash test (I9).
3. **T01a:** the `dispatchedAt` fast-default migration instead of the backfill UPDATE, and drop the `backfill` test (M12, I10).
4. **T01a:** use `add_to_list` with a deleted list, or a registered throwing action, for the FAILED-run test (I10).
5. **T01a:** the `recordProviderError` and diagnostics conditions exclude NEEDS_ATTENTION, the event carries `workspaceId`, and `CAMPAIGN_COMPLETED` uses `RETURNING id` (M1, M2).
6. **T01a/T01b:** action scopes are enforced for API-key rule writes, and incompatible trigger/action pairs get 400 (I3, M10).
7. **T01/T02 split** into T01a (opus) / T01b (sonnet) and T02a (opus) / T02b (sonnet), with the TASKS.json table and deps updated (I11).
8. **T02a:** `WebhookDelivery.leadId` becomes an FK with cascade, plus the payload ILIKE purge and the concurrent-erasure test (I1).
9. **T02a:** `FOR UPDATE OF d SKIP LOCKED`, the single-statement failure counter with CASE … RETURNING, 429 not counted, and the in-flight rule at disable (M3, M4).
10. **T02a:** the signature is computed per attempt, rotation is documented, and `/u/` tokens are redacted from payloads (M5, M6).
11. **T02a:** `HttpOutError` with `code`, the `lookup`-based pinning, DNS inside the timeout, the extra private ranges in `net.ts` with their tests, and metadata addresses refused under the flag (I10, M7).
12. **T02b:** a `webhooks:write` key also needs `inbox:read` for reply or all events (I3).
13. **T03a:** progress-based staleness, a SKIP LOCKED multi-job tick with one RUNNING job per workspace, AI rate-limit waits, and the retention purges (I2, M6).
14. **T03b:** core services export their input schemas, the 14 `z.unknown()` routes use them, `io: "input", unrepresentable: "any"`, the strict test covers union branches, `api-key reach` is restated, and the script gets a placeholder `DATABASE_URL` (I8).
15. **T04:** expect `zScore` 3.54, lock variants in id order, the re-activation rule, and the re-plan assertion (I10, M11).
16. **T05a:** drop `escapeTemplate` (keep the literal-render test), `aiClassifyFor(ws)`, `deps.leaseMs`, the stated classifier rate-limit behaviour, and the single-writer test replacing the vacuous assertion (M9, I10).
17. **T05a/T05b:** erasure deletes suggestions by deleted `threadId` (I1).
18. **T06a:** push error codes on a field that exists, and `labelFilterBehavior: "INCLUDE"` (I10, M8).
19. **T06b:** clientState checked on lifecycle notifications, the "not already pending" flag condition, the capped body reader, and the non-lead skip inside `ingestMessage` before the AI hook (M8, M17).
20. **T07a:** a per-user 2FA bucket on all three verify paths, the `unknown` IP fallback, the failures-only email bucket documented (I5); proxy request and response CSP, the root-layout `x-nonce` read, the `ThemeProvider` nonce, the extra CSP page checks, and the security headers asserted in `csp.spec.ts` (I6, I10).
21. **T07b:** member and invite routes on `auth.api.*`, `disabledPaths` for unused organization endpoints, lower-case roles, the `auth-org.test.ts` update, the `leave` test, API keys on member removal, a consistent audit-log role, and the cookie, PS-SEC-12 and 2FA-recovery items (I4, M13, M15).
22. **T08b:** a `/link-check` interstitial through anchor rewriting in `srcDoc()` instead of frame messaging, and rich text in the composer only (I7, M14).
23. **T08a or T02b:** reserve webhook event names in the label validator (M16).
