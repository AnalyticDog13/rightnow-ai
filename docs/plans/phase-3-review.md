# Phase 3 step plan: independent review

Reviewer: fresh-context plan reviewer · Date: 2026-10-20 · Plan: `docs/plans/phase-3.md` (branch `phase-3-campaigns`, at 38fa0a4)

I checked the plan against the following:
- `docs/IMPLEMENTATION_PLAN.md`: Global Constraints, the Send pipeline section, Reconciliation, P3 tasks, and P4-T03/T05/T07
- `docs/TASKS.json`
- `docs/PRODUCT_SPEC.md`
- `docs/PROVIDER_COMPLIANCE.md`, `docs/DECISIONS.md` and `CLAUDE.md`
- the Phase 1–2 code: `providers/src/{types,errors,mime}.ts`, `core/src/accounts/*`, `schema.prisma`, `web/lib/api.ts`, `worker/src/{boss,index}.ts`

I checked package versions with `npm view`: pg-boss 12.38.0, papaparse 5.7.0 and html-to-text 10.0.1 all exist.

## What holds up

These parts are correct as written:

- **Claim SQL.** It uses `FOR UPDATE OF sm SKIP LOCKED LIMIT 1` with a status re-check on the final update. That gives one row per transaction and no double claim.
- **Reservation statement.** It is a single statement and handles the first claim of the day correctly. `INSERT … SELECT … WHERE u<=allow ON CONFLICT … WHERE sent+reserved+u<=allow` is race-free under READ COMMITTED, and the allowance-0 and units>allowance cases create no row.
- **Usage days.** Usage days are stored on the row, so a midnight crossing commits to the claim day.
- **Claims and late writes.** `claimToken`/lease, the 120 s stale-claim check and the conditional writes are correct.
- **Late-accept table.** It is correct apart from I8.
- **Network calls.** I found no network call inside a transaction: send, `findSent`, MX lookups and DNS all run outside.
- **D16 is sound and safe.** No production code writes `lastSyncCompletedAt`. `openAccount` nulls it, and NULL fails the `>=` test. `markFresh` lives only in test code, so real sends cannot happen before P4-T05.
- **D17 cannot be bypassed through the Fake.** `MAIL_PROVIDER_FAKE=1` makes `sendableProviders` return all providers, but the same flag makes `createProvider` return the Fake, so no real mail is sent. `envSchema` also refuses the flag when `MODE=vps`. The row is written only by the script, which refuses the Fake.
- **D18 fits the frozen interface.** `PermanentSendError(code, detail?, opts?)` gains `opts.scope`, which is additive, and `MailProvider` is unchanged.
- **Template engine.** Values are inserted literally and HTML-escaped. The spintax seed is deterministic (`leadId:stepId:variantId` is stable across re-renders).
- **Dates.** All the DST and calendar dates in the tests are correct: 2026-10-19 is a Monday, US DST starts 2026-03-08, the London fall-back is 2026-10-25, and the Berlin and Auckland conversions are right.
- **Import test counts.** The counts add up (10 = 3 imported + 7 skipped).
- **Deferred PS-ACC items** (16, 21, 22, 27) are all covered.
- **PS-SEQ-10 "ignore account limits"** is rightly refused, because the master Global Constraint outranks PRODUCT_SPEC (see M10 for recording it).

## Critical

**C1. Cancelling a HELD row gets it re-planned and sent again automatically. Cancelling a SCHEDULED row does nothing.**
- **Location:** T11b `cancelScheduled`, the T10 planner (steps 1 and 7, the upsert), and the T12 Scheduled view "Cancel".
- **What happens:** `cancelScheduled` sets HELD or SCHEDULED to CANCELLED and does not touch the CampaignLead. The lead stays `ACTIVE`, keeps the same `currentStepId`, and has `nextDueAt <= now`. CANCELLED does not count as an open row. So the next `planDue` (within a minute) selects the lead and the upsert's `WHERE status='CANCELLED'` brings the row back to SCHEDULED, which also wipes `uncertainAt`. The dispatcher then sends a message the provider may already have accepted. This is the exact double send that D5 and the master plan's "unknown outcome is never resent automatically" rule forbid.
- **Same root cause later:** P4's out-of-office revive ("updates the existing row back to SCHEDULED") would also bring back a cancelled row that had been HELD.
- **Fix:**
  - In the same transaction as the cancel, `cancelScheduled` skips the step for the lead: it moves to the next step, or is COMPLETED/STOPPED MANUAL, with the same logic as `deleteStep`.
  - Bring back only rows that never had an unknown outcome: add `AND "ScheduledMessage"."uncertainAt" IS NULL` to the upsert's `WHERE`, and stop resetting `uncertainAt` in its `SET`.
  - Name a test in T11b: cancel a HELD row, then run 3 × (`planDue` + `dispatchTick`). Expect the row still CANCELLED, `sentRaw()` unchanged, and the lead past that step. Add the same case for a SCHEDULED row.

**C2. The claim does not check that the row is for the lead's current step, so a lead that moved on still gets its old step.**
- **Location:** the T09 claim SQL, T10 subsequence entry (`LEAD_STATUS`, `completed_no_reply`), and T06 `moveToSubsequence`.
- **What happens:** suppose `updateLead(interestStatus 1)` moves an ACTIVE lead into a subsequence while its main-sequence step-k row is SCHEDULED. That row stays claimable because the claim checks only `cl.state='ACTIVE'`. The lead then gets the stale main-sequence follow-up (for example "just bumping this") and also subsequence step 1. A positive replier gets a stale follow-up. Released HELD rows and `retryFailed` rows for steps that are no longer current behave the same way.
- **Fix:**
  - Add `AND sm."stepId" = cl."currentStepId"` to the claim SQL.
  - Subsequence entry, `moveToSubsequence`, `removeFromSubsequence` and `deleteStep` cancel the lead's open SCHEDULED rows in the same transaction.
  - `releaseHeld` and `retryFailed` return 409 when the row's step is no longer current.
  - Test in T09: a row whose step is not the current one is not claimed.

## Important

**I1. The sender's pre-call re-check puts rows for finished leads back to SCHEDULED, which leaves orphan rows.**
- **Location:** T11a step 2.
- **What happens:** a lead STOPPED by a P4 stop rule, `removeCampaignLead` or `unsubscribeLead` while its row was SENDING gets that row returned to SCHEDULED. The claim never picks it up again (the lead is not ACTIVE), so it is orphaned. It also blocks the T10 completion pass ("no open rows"), so the campaign never completes.
- **Fix:** when the CampaignLead is STOPPED or COMPLETED, or the campaign is ARCHIVED or deleted, release the reservation and set the row CANCELLED. Return to SCHEDULED only for states that can resume: campaign PAUSED, lead PAUSED, account ineligible.
- **Test:** stop the lead between claim and send. Expect CANCELLED, and the campaign completes.

**I2. An UNCERTAIN row can stay UNCERTAIN forever.**
- **Location:** T11b `resolveUncertain`, case "Throws: row unchanged".
- **What happens:** for an account that is deleted, disconnected or NEEDS_ATTENTION, `findSent` throws on every search. The row then keeps its reservation, blocks `gdprDeleteLead` with 409 `send_in_progress` (an erasure request is blocked indefinitely), and blocks `deleteStep` with 409.
- **Fix:** if the row is still unresolved 24 h after `uncertainAt` (or after N failed searches), set it HELD and run `releaseUsage`. HELD is safe because it is never resent automatically. Add a test.

**I3. The planner keeps re-processing leads whose current-step row is FAILED or SENT.**
- **Location:** T10 steps 1, 3 and 5, and T11a step 6.
- **What happens:**
  - A FAILED `max_attempts` row leaves the CampaignLead ACTIVE. The candidate filter ignores FAILED and SENT rows, so the lead is selected every minute.
  - The upsert does nothing for it, but `assigned += 1` (variant) and `newLeads += 1` have already run, which skews variant balancing and the new-lead cap.
  - The same happens after an `advanceLead` no-op.
- **Fix:**
  - The candidate filter excludes any non-CANCELLED row for `(cl, currentStepId)`.
  - `max_attempts` also sets the CampaignLead to PAUSED with `SEND_FAILED`, which is what `retryFailed` expects.
  - Increment the counters only when the upsert returns a row.

**I4. Lock order: the planner and the claim can deadlock, and only the claim retries.**
- **Location:** T10 steps 3 and 8 against the T09 claim. Also T11a step 9.
- **What happens:**
  - The planner's per-campaign transaction locks the `CampaignDailyUsage` row (`newLeads`) and then, in the re-route pass, updates SCHEDULED `ScheduledMessage` rows.
  - The claim locks the `ScheduledMessage` row first and then the campaign usage row. The two form a cycle, so Postgres aborts one with 40P01.
  - `withTxRetry` covers only the claim. If the planner is the one aborted, its whole 500-lead batch rolls back, and this can repeat.
  - In the AuthError path, `recordProviderError` (EmailAccount) runs before `releaseUsage` (usage rows), the reverse of the claim's order.
- **Fix:**
  - Document one lock order in the plan: sm → account usage → campaign usage → workspace usage → EmailAccount.
  - Run the re-route pass in its own transaction and select its rows with `FOR UPDATE SKIP LOCKED`.
  - Wrap the planner's per-campaign transaction and the sender's result transactions in `withTxRetry`.
  - Release before calling `recordProviderError`.

**I5. One bad row can block all sending, across every workspace.**
- **Location:** T09 `claimDue`, T05 `setSchedules`.
- **What happens:** an exception inside the claim transaction (`nextWindowStart` throws for `days 0`, an invalid stored timezone, a `TemplateError`) aborts that transaction. Rows are ordered by `dueAt`, so the same row comes first on every tick and the dispatcher is blocked for all workspaces.
- **Fix:**
  - `setSchedules` rejects `days` outside 1..127.
  - `claimDue` catches any error that is not a deadlock or serialization failure. In a fresh transaction it sets that row's `dueAt = now + 1 h` and `error`, or FAILED after N tries, and then continues.
- **Test:** a row with a broken schedule does not stop a healthy row from being claimed.

**I6. The D18 SMTP scope mapping treats policy blocks as bad recipients.**
- **Location:** T11a "Scope mapping".
- **What happens:** "a 5xx on `RCPT TO` → recipient" also matches `550 5.7.1 … blocked using Spamhaus` and other sender-reputation or policy rejections. Those would add a permanent HARD_BOUNCE suppression for good leads, at scale, and leave account health untouched. That is the opposite of what is true.
- **Fix:**
  - Any `5.7.x` → account (on MAIL FROM/AUTH) or unknown (elsewhere).
  - Recipient only for `5.1.x` and `5.2.1`, or a bare 550/551/553 on RCPT TO with no enhanced code.
  - Treat `5.2.2` (mailbox full) as unknown, not a hard bounce.
  - Add `550 5.7.1 … Spamhaus` on RCPT TO → not recipient to `errors-scope.test.ts`.

**I7. An account-scope permanent error pauses each lead, and the broken account keeps failing.**
- **Location:** T11a step 8.
- **What happens:** with scope `account` (SendAsDenied, relay denied), every later claim on that account fails another lead and pauses it with SEND_FAILED. Each one then needs a manual retry, and nothing takes the account out of rotation until P5.
- **Fix:**
  - Account scope: release the reservation, return the row to SCHEDULED, set the account to `PAUSED` with `lastError.kind SENDING` (a user resume clears it), and leave the lead untouched.
  - Unknown scope: keep the current behaviour, but pause the account after 3 consecutive unknown permanent errors.

**I8. A late accept on a row that is already SENT can under-count usage.**
- **Location:** the T11a late-accept table, row "SENT → no change".
- **What happens:** suppose the user releases a HELD row, it is re-claimed (T2), and the original claim (T1) then accepts. T1 commits T2's reservation. T2 has already passed its pre-call check, so it also sends, and finds the row SENT. Two messages went out, but `sent` was credited once, so the account can go over quota.
- **Fix:** when the row is SENT under a different `claimToken` than the caller's, `creditSent(units)`. Only the same-token case is "no change".

**I9. Setting a lead to "Not interested" does not suppress it.**
- **Location:** T01 `updateLead` and the compliance rule ("not interested … go to the suppression list immediately").
- **What happens:** the plan stores, stamps and audits `interestStatus`, but setting `-1` neither suppresses the lead nor stops its CampaignLeads. PS-LEAD-04 also says a status change "may complete the lead in campaigns".
- **Fix:**
  - `interestStatus -1` → `suppress(EMAIL, NOT_INTERESTED, "status")` in the same transaction, which stops the lead's CampaignLeads (the T06 extension).
  - Statuses 1..4 complete the lead's active CampaignLeads (stopReason MANUAL) unless a subsequence entry applies.
  - Add tests.

**I10. Unsubscribe and GDPR erasure can miss soft-deleted or merged lead rows.**
- **Location:** T08 `unsubscribeLead` ("an erased or missing lead → already") and T01 `gdprDeleteLead`.
- **What happens:**
  - An unsubscribe link from a lead that was later soft-deleted or merged (`mergedIntoId`) must still suppress, because CAN-SPAM requires opt-outs to work for 30 days. As written it may answer "already" and drop the request.
  - GDPR erasure hard-deletes one row. A soft-deleted duplicate with the same email (the partial unique index allows it) or a merged-away row keeps the address.
- **Fix:**
  - `unsubscribeLead` loads the lead including soft-deleted rows and suppresses by its email. "Already" applies only when no row exists.
  - `gdprDeleteLead` hard-deletes every Lead row in the workspace with the same email, plus rows with `mergedIntoId = id`.
  - It also clears `ImportJob.data` for jobs still PENDING or RUNNING that contain the address, or documents why not.
  - Extend the GDPR test with a soft-deleted duplicate.

**I11. A line break in a merge field makes the subject unsendable, and the message ends up HELD.**
- **Location:** T04 `render` (subject) and T11a step 7.
- **What happens:** lead values containing CR/LF go raw into the subject. `buildMime` throws a plain `Error` ("CR/LF not allowed in subject"). Under step 7 any non-ProviderError counts as UNCERTAIN, then not found, then HELD. Every such lead needs manual action and holds its reservation for 15 min.
- **Fix:**
  - The subject render collapses `[\r\n\t]+` to a space. The T04 test covers `firstName "A\r\nBcc: x@y"`.
  - The sender builds and validates the MIME before calling the provider, and maps a local build failure to FAILED.

**I12. T10 is too large for one sonnet task and holds re-plan logic that matters for correctness.**
- **Location:** T10, Models.
- **What it holds:** the planner, rotation, the upsert that brings rows back, re-routing, edit hooks, subsequence entry, completion, the explainer and E2E #7, in one task. The C1, C2, I3 and I4 defects all sit in it.
- **Fix:**
  - Split it. T10a (opus): planner, upsert, re-route, `advanceLead`, edit hooks. T10b (sonnet): rotation scoring, explainer, status route, E2E #7.
  - Update `TASKS.json` to match.

## Minor

- **M1.** T11a step 2: the stale tolerance lets a send happen up to 120 s after the window closes or after `endAt`. Re-check `isInWindow` and `endAt` in the pre-call check, then release and reschedule.
- **M2.** T09 `claimDue`: say whether rows pushed back (window, full quota, gap race) count toward `limit`. `dispatchTick` should stop only when the SELECT returns nothing, not when nothing was claimed.
- **M3.** T10: Prisma interactive transactions time out after 5 s by default. A 500-lead render batch can exceed that, so set `{ timeout }` explicitly or use smaller batches.
- **M4.** Indexes and SQL detail:
  - Add `CampaignLead @@index([campaignId, state, nextDueAt])` (planner) and `Lead @@index([workspaceId, companyDomain])` (per-company cap).
  - `ANY($sendable)` needs a `::"AccountProvider"[]` cast in Prisma raw SQL.
- **M5.** T06 `deleteStep`: a hard delete of a step that has CANCELLED or SCHEDULED rows fails on `onDelete: Restrict`. Soft-delete whenever any `ScheduledMessage` row references the step.
- **M6.** D17's "known limit" covers duplicate sends but not `Message-ID` rewriting:
  - One verified SMTP host, or one MS365 account, enables hosts and tenants that may rewrite the header, such as SES-style relays or outlook.com.
  - Record that P4 reply matching must fall back to the lead's address and the thread, or verify per SMTP host.
- **M7.** T10 step 6: "Re: + rendered step-1 subject" should take the subject from the lead's SENT step-1 row (the variant actually sent).
- **M8.** T09 and T11a: Cc/Bcc are read at claim time (units) and again at send time. Store them, or the units, at claim so a mid-flight edit cannot send to more recipients than were reserved.
- **M9.** T02:
  - Say how the web process enqueues `lead-import`. It has no PgBoss instance today. Send the job in the same DB transaction, or add a cron that picks up PENDING jobs so an ImportJob never stays PENDING.
  - `previewImport` should not parse the full 50 MB file in the request handler.
  - Check `Content-Length` to return 413 before reading the body.
- **M10.** Spec and decision records:
  - Record the PS-SEQ-10 refusal and the PS-CAMP-25 forced-on header as D19 in `DECISIONS.md`.
  - PS-CAMP-04 "Account Suspended" is missing from `CampaignStatus`. Add it or defer it explicitly.
  - PS-CAMP-16 allows `maxNewLeadsPerDay` ≥ 0; the plan requires ≥ 1.
- **M11.** PS-SEND-09 asks for backoff with jitter; T11a's backoff has none.
- **M12.** T01, T04 and T07 all edit `packages/core/src/index.ts`, so the "parallel-safe" claim needs an "exports added at merge" note.
- **M13.** Test setups that are underspecified:
  - `browser-closed.test.ts` needs gaps 0 and an anyTime schedule, or 2 leads cannot both send within 90 s under the default 540 s gap.
  - The second run in `import.test.ts` (`attached 1`) needs a fresh workspace.
  - `quota.test.ts` office hours need a Monday start.
- **M14.** `updateVariant`/`updateStep` on an ACTIVE campaign must run `validateTemplate` (400) before re-rendering. The planner should catch a per-lead `TemplateError` and skip that lead rather than abort the campaign's transaction.
- **M15.** `releaseHeld` should return 409 when the CampaignLead is STOPPED, COMPLETED or PAUSED (see also C2).
- **M16.** The blocklist CSV export needs the same formula-injection prefix as the lead export.
- **M17.** T05 `launchCampaign`: say that `dnsGate` runs before any transaction opens.
- **M18.** T09 tests: add a deterministic interleaving test. A third connection holds the usage row lock while two claims queue on it, which proves the guard is in the statement and does not depend on timing.
- **M19.** T11a builds `inReplyTo` from the last SENT message, but T11b `multistep.test.ts` asserts that step 3's In-Reply-To is step 1's Message-ID. Fix the test: In-Reply-To = the previous step, and References = all earlier steps.

## Coverage and proportion

- **Coverage:** the PS-LEAD, PS-CAMP, PS-SEQ and PS-SEND allocation is complete, apart from the gaps noted in I9 and M10. The deferrals are justified: anything that needs ingest or classification goes to P4, health goes to P5, analytics to P6 and A/B to P7.
- **Order and sizing:** sound, apart from I12.
- **Models:** opus on T09 and T11a/b is correct.
- **Proportion:** the plan is long but proportionate to the risk. I found no gold-plating; the features listed are spec-required.

## Counts
Critical 2 · Important 12 · Minor 19

VERDICT: Changes Required
