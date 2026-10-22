# Phase 5 step plan: independent review

Reviewer: fresh-context plan reviewer · Date: 2026-10-21 · Plan: `docs/plans/phase-5.md` (branch `phase-5-deliverability`, at 42ca49d)

I checked the plan against the following:
- `docs/IMPLEMENTATION_PLAN.md`: Global Constraints, Review Focus (#2, #5), Send pipeline, Reconciliation (P4), the Phase 5 tasks and the data model
- `docs/PRODUCT_SPEC.md`: PS-WARM-01..21, PS-REWARM-01..14, PS-ACC-11/16/24, PS-CAMP-04/27, PS-SEND-11, PS-LEAD-05/14/25
- `docs/PROVIDER_COMPLIANCE.md` "Rules our code must enforce", `docs/DECISIONS.md` D1–D31, the P5 entries in `docs/TASKS.json`, `docs/HANDOFF.md`, and `docs/REVIEW_LOG.md` (Phase 3 gate M-6/N-2, Phase 4 ledger)
- the code: `core/src/{quota,dispatch,rotation,sender,planner,explain}.ts`, `core/src/mail/{sync,match,stoprules,classify,reply}.ts`, `core/src/accounts/{health,status,service,diagnostics,open-account,test-send}.ts`, `core/src/campaigns/launch.ts`, `core/src/leads/{esp,domain,import}.ts`, `core/src/crypto.ts`, `providers/src/{types,net}.ts`, `apps/web/lib/launch-deps.ts`, `apps/worker/src/jobs/{lead-import,accounts-auto-resume}.ts`, `schema.prisma`

## What holds up

These parts are correct as written:

- **D33 look-ahead on the sync path.** The incremental watermark is the run's start, and an import's watermark is its first run's start. So an account written fresh by a run stays fresh until at most `commitTime + SYNC_MAX_STALENESS_SEC`. `computeLifecycle` evaluated at `now + staleness` in the same transaction therefore flags every account that crosses the threshold before its watermark goes stale. Idleness only grows with time. A stale account (sleep/wake, failing sync, no reconcile) cannot be claimed (`accountOk`). An account with no inbound mail still gets a caught-up run, so the check still runs. `openAccount` revival nulls `lastSyncCompletedAt`. NEEDS_ATTENTION accounts are not synced (`syncDue`), so they go stale. The claim reads the account row and `still` re-checks under the lock, and the look-ahead closes the remaining read/commit race. The gaps are the non-sync paths in I2.
- **D32 as columns.** `effectiveAllowance` stays pure and every caller already has the full row, so it is a sound deviation from the master's `RewarmPlan` table. Counting send-days rather than calendar days is the right way to get "no burst after downtime" for the ramp. Manual replies (`mail/reply.ts`) never write `lastSentAt`, so they cannot reset idleness, and their D29 cap is independent.
- **Lock order.** `computeLifecycle` runs in the sync transaction, which locks only `EmailAccount` and then writes `AuditLog`. The claim takes `EmailAccount` last, so no cycle. `evaluateHealth` writes are single-row conditional `updateMany`s on `EmailAccount` and `Campaign`. The claim never locks `Campaign`, and its `still` re-check makes a pause that commits mid-claim win.
- **Resume paths for campaigns.** `launch.ts` `FROM.resume` already accepts ACCOUNTS_UNHEALTHY and BOUNCE_PROTECT and re-runs launch validation, including the DNS gate once T01 wires it. Pause, archive, the clash check and `hooks.LIVE_STATUSES` already treat both statuses as live.
- **Warm-up honesty (D36).** Plain text, a self-describing subject and body, `Auto-Submitted: auto-generated`, no mailbox writes, no spam rescue, own opted-in pool only, and an explicit "not provided" list. This is stricter than PS-WARM-08 allows and satisfies the compliance and honesty rules. Exclusion keys on our own Message-ID, which the `OutboundMime` contract says every provider preserves. A header is never trusted, so outsiders cannot hide mail. Warm-up rows are inserted before the send and matched whatever their status, so an abandoned row's delivered copy is still excluded.
- **Interfaces named as existing exist** with the stated semantics: `runDiagnostics` (`dns: null`), `LaunchDeps.dnsGate`/`DnsFinding`, `MailProvider.locate`, `recordProviderError`, `accountOk`, `remainingToday`/`committedToday`, `routeAllowed` + the tag test in `pickAccount`, `housekeep`, `sticky_account_unassigned`, `detectEsp`/`ResolveMx`, `DISPOSABLE_DOMAINS`, `ENCRYPTED_COLUMNS`/`rotateColumns`, `assertPublicHost`, `bulkApply`, `optOutTx`, `markFresh`/`seedCampaign`. Exceptions: I9 (`lead-import` pattern), M1 (`FREE_MAIL_DOMAINS` is not exported), M13 (SMTP host lives only inside `credentialsEnc`).
- **Arithmetic.** The health-score examples (100, 70, 60, 90, 75, the −10 soft cap), the re-warm ramp (5/7/9, allowance 11 after three send-days, 37 % progress) and the cap rules (warm-up ≤ cap/10 plus campaign ≤ cap/2) all check out.
- **Carry-forwards** are all placed: P3-T05 dnsGate wiring, M-6, N-2, P3-T11a cc rejection, SOFT/UNKNOWN + SYNC into health, the sync `lastError` overwrite, `computeLifecycle` in `reconcileAccount`, and the 30-day downtime extension.

## Critical

None.

## Important

**I1. Auto-replies and DSNs to warm-up mail leak into the inbox, Events and stop rules (Review Focus 2).**
- **Location:** D36 sync exclusion; T03 `warmupReceipt` signature (`Pick<RemoteMessage, "rfcMessageId" | "folder">`); `mail/match.ts`; `mail/stoprules.ts bounce()`.
- **What happens:** `warmupReceipt` matches only a message's own Message-ID. Three kinds of mail answer a warm-up message with a new Message-ID:
  - an out-of-office reply from the peer mailbox (any responder that ignores `Auto-Submitted`),
  - a DSN, for example a full mailbox,
  - an ARF report.

  None of them matches a `WarmupMessage`, so each is ingested normally:
  - `matchMessage` step 4 matches the counterpart by address. When the peer is also a Lead (exactly the Review Focus 2 case), the OOO becomes a Thread on that lead and goes through `applyInbound`. Under `stopOnAutoReply` it stops the lead AUTO_REPLIED, otherwise it pushes the lead's sends.
  - Even when the peer is not a lead, it opens an inbox thread.
  - A DSN whose `originalMessageId` is the warm-up id finds no `ScheduledMessage`. It then takes the 14-day fallback ("newest SENT row from this mailbox to the recipient"). When this account recently mailed that address in a campaign, the warm-up bounce stops that lead BOUNCED and **suppresses** it (HARD), and it records a `BOUNCE_*` Event that T02 counts as the sender's hard bounce.
- **Fix:**
  - `warmupReceipt` takes `m: Pick<RemoteMessage, "rfcMessageId" | "inReplyTo" | "references" | "folder">` plus the classification's `originalMessageId` (BOUNCE/COMPLAINT). It returns true when any of those ids is a `WarmupMessage` of this account (sent by or to it).
  - For a DSN, mark the referenced row `error = "bounced"` and store nothing.
  - Run it after `classify` (pure) and before `ingestMessage`, so a DSN is never stored.
  - Tests in `warmup.test.ts`: (a) the peer (also a Lead in an ACTIVE `stopOnAutoReply` campaign) auto-replies to a warm-up message, giving zero Thread/Message/Event and the CampaignLead still ACTIVE; (b) a 5.1.1 DSN for a warm-up message, where the same account sent that address a campaign step within 14 days, giving no Suppression, no Event and the lead untouched.

**I2. Paths that put an account back into service skip both the lifecycle check and the REWARMING rule.**
- **Location:** D33 ("the first claim always sees the computed lifecycle"); T05 matrix "already REWARMING, PAUSED or NEEDS_ATTENTION → unchanged"; T05 changes only `service.ts` resume and `accounts-auto-resume`.
- **What happens (missing lifecycle check):** PAUSED accounts keep syncing (`syncDue` skips only NEEDS_ATTENTION), so they stay fresh. `computeLifecycle` ignores them. When a user resumes an account that has been paused for 40 days, or a timed pause ends, the account is ACTIVE and fresh at once. It can claim before the next sync (≤ `SYNC_POLL_SEC`), at the full allowance, or at all under RECOMMEND. The overshoot is about one send per account because of the gap (campaign `minGapSec` default 540), but it breaks Review Focus 1's "with RECOMMEND it sends nothing".
- **What happens (escapes):** Pausing an INACTIVE account and resuming it also escapes INACTIVE, because `resumeAccount` writes ACTIVE.
- **What happens (missing REWARMING rule):** these writers set `lifecycle: "ACTIVE"` with no REWARMING rule:
  - `markFixed` (`diagnostics.ts:111`)
  - `smtp-connect.ts:186`
  - `oauth.ts:213`
  - `openAccount`

  So a REWARMING account that hit NEEDS_ATTENTION comes back ACTIVE with `rewarmStartedAt` still set. The ramp still caps volume, but the dashboard says Active, and `completeRewarms` may never match it.
- **Fix:**
  - Add one core helper, `returnToService(tx, clock, a)`, that sets `rewarmStartedAt ? REWARMING : ACTIVE` and then runs `computeLifecycle(tx, clock, a.id, { lookaheadSec })` in the same transaction.
  - Call it from all six writers.
  - `completeRewarms` keys on `rewarmStartedAt IS NOT NULL`, not on the lifecycle.
  - Tests in `lifecycle.test.ts`: an account paused for 40 days (synced throughout), resumed, then `claimDue` immediately gives allowance 5 (AUTO) or nothing (RECOMMEND); INACTIVE → pause → resume gives INACTIVE; a REWARMING account goes NEEDS_ATTENTION and `markFixed` gives REWARMING.

**I3. Health windows ignore manual resumes and the cap time, so manual resume and stepwise restore do not work as specified.**
- **Location:** D34 actions; T02 tests `throttle and restore` and `BounceProtect`; T06 scenario 4 ("the user resumes → REWARMING … allowance 11").
- **What happens:**
  - **Pause:** the decision reads the last 7 days. After a manual resume, the next `evaluateHealth` run (≤ 5 min) sees the same bounces and pauses the account again, for up to 7 days. T06 scenario 4 then fails as soon as the health job runs in that e2e test.
  - **BounceProtect:** the last 24 h are re-read after `resumeCampaign`, so the campaign flips back to BOUNCE_PROTECT for up to 24 h.
  - **Restore:** "none holds for 24 h since `healthCapAt`" is evaluated on 7-day rates. 3 hard bounces in 100 sends stay at 3 % (> 2 %) for 7 days unless more than 50 clean sends dilute them, and the cap itself slows dilution. The test "after 24 h clean → 40" contradicts the rule unless it adds about 50 sends.
- **Fix:**
  - Add `EmailAccount.healthResetAt` (set by every return to service, I2) and `Campaign.bounceProtectResetAt` (set by `resumeCampaign`). Rates count only events after `max(window start, reset)`.
  - Restore condition: no hard bounce and fewer than 5 provider errors since `max(healthCapAt, last restore)`, and at least 24 h elapsed.
  - Tests: resume, then the next run does not re-pause (account and BounceProtect); restore after 24 h without extra sends.

**I4. The account pause fires on very small samples.**
- **Location:** D34 "pause the account when hard% > `bounceThresholdPct`" with the damped denominator `max(accepted7d, 20)`; T02 test `hard7d 1 / accepted7d 5 → 5 %`.
- **What happens:** One hard bounce in the first 20–33 sends is over 3 % and triggers a manual-resume-only pause. A re-warming account (5–9 sends a day) is paused by the first bad address. Combined with I3, it cannot be resumed for a week. PS-CAMP-27, which the plan cites for this threshold, sets a sample floor of ≥ 50 sends, and BounceProtect uses that floor.
- **Fix:**
  - Pause only when `accepted7d ≥ 50` (the same floor as BounceProtect).
  - Keep the damped rate for the score and the throttle.
  - Tests: 1 of 21 gives a throttle but no pause; scenario 4 uses ≥ 50 sends or expects a throttle instead.

**I5. `providerErrors24h` has no source.**
- **Location:** D34; `HealthInputs.providerErrors24h`; T02 `healthInputs`.
- **What happens:** The only existing counter is `EmailAccount.errorCount24h`. It only increments (`accounts/health.ts`) and resets on reconnect/markFixed, so it is not a 24 h window. Using it would keep "≥ 5 → throttle" and "−20" in force forever. "providerErrors24h ≥ 5" therefore cannot be implemented as written.
- **Fix:** name the source.
  - Count `SEND_FAILED` Events with `meta.scope IN ("account","unknown")` plus `SyncRun` rows with `error` in the last 24 h.
  - `errorCount24h` stays display-only, or is dropped.
  - Test: 5 errors at T, then at T+25 h the term is 0 and the cap restore is allowed.

**I6. Warm-up activity resets idleness, so re-warm never triggers for warm-up-enabled accounts.**
- **Location:** D33 `idleSince = GREATEST(lastSentAt, lastWarmupAt, activityResetAt, createdAt)`; T05 test "`lastWarmupAt` 2 days ago → not idle".
- **What happens:** An account with warm-up on (1–10/day) is never idle. If it sends no campaign mail for 60 days, the first campaign day runs at the full `dailyLimit`, which master Review Focus 2 and PS-REWARM-09 ("before the next campaign send") exist to prevent. PS-REWARM-10 defines the measure as "days since last send" of campaign volume, and warm-up ≤ 10/day does not support a 30–50/day campaign jump.
- **Fix:**
  - Drop `lastWarmupAt` from `idleSince`. Keep `lastWarmupAt` for display only.
  - Flip the T05 test: warm-up 2 days ago with the last campaign send 31 days ago gives REWARMING.

**I7. Warm-up and placement bypass D17.**
- **Location:** T03 tick step (3) eligibility; T04 "account not sendable → 409".
- **What happens:** Warm-up sends real mail automatically every day from any CONNECTED account, including providers without a recorded live check. D17's limits note that unverified relays may rewrite Message-ID, and D36's sync exclusion depends on Message-ID being preserved. On such a relay every warm-up message and reply would be ingested as normal mail (Review Focus 2 again).
- **Fix:**
  - Warm-up senders and receivers, the tested placement account and the placement seeds must all have `provider = ANY(sendableProviders())`.
  - `warmupState` reports PROVIDER_BLOCKED (reason "provider not live-verified") otherwise.
  - "Sendable" in T04 means `accountOk` minus freshness.
  - Test: with no `ProviderVerification` row and the Fake off, nothing is sent.

**I8. Placement renders a real lead's live unsubscribe and tracking links.**
- **Location:** D37 "the chosen campaign variant rendered for a sample lead"; T04 `startPlacementTest`.
- **What happens:** A seed mailbox's link scanner (Microsoft Defender Safe Links, Gmail) fetches those URLs, which writes CLICK/OPEN Events on the sample lead in that campaign (only flagged `meta.scanner` when the UA is known). Placement traffic thus enters campaign Events, against the Global Constraint. It also exercises a live unsubscribe token for a real lead. D25 M-5 already ruled that campaign test-send renders the dead "(unsubscribe disabled in test emails)" text for exactly this reason.
- **Fix:**
  - Render through the campaign test-send path (dead unsubscribe text, no tracking rewrite, no `List-Unsubscribe` token). Note the trade-off: the headers then differ from a real send.
  - Test: the placement MIME has no `/t/` or `/u/` link with a valid token.

**I9. The verification job has no storage, loses the previous status, and lets queued leads be mailed.**
- **Location:** D38; T08 `queueVerify`/`runVerify`; Fixed names "`lead-verify` (sent per request, like `lead-import`)".
- **What happens:**
  - **Wrong pattern:** `lead-import` is not sent per request. It is a cron (`* * * * *`) over `ImportJob` rows. No `BackgroundJob` table exists (that is P7), and the plan adds none, so `{jobId}` and `runVerify(…, jobId)` (no `workspaceId`, no lead ids) have nothing to read.
  - **Lost status:** `queueVerify` overwrites the status with `PENDING_JOB`. A `null` result or a thrown verifier then becomes NOT_VERIFIED, which contradicts D38 ("lookup errors → unchanged") and erases INVALID, RISKY or CATCH_ALL. A re-verified risky lead then gets mailed by a non-`allowRisky` campaign.
  - **Mailed while queued:** the planner (`planner.ts:509`) plans PENDING_JOB leads, so `verifyOnImport` combined with an import into a campaign mails leads before they are verified.
  - **Stuck rows:** with `retryLimit: 0`, a worker crash leaves the leads PENDING_JOB forever.
- **Fix:**
  - Add a `Lead.verifyPrevStatus` column.
  - Make `lead-verify` a cron, like `lead-import`, that takes up to N `PENDING_JOB` leads per workspace (`FOR UPDATE SKIP LOCKED`, verify outside the tx, conditional write).
  - A `null` result or an error restores `verifyPrevStatus`.
  - `queueVerify` returns `{ queued }` (202) and records the previous status.
  - The planner skips PENDING_JOB leads (it waits, no stop), and the claim does the same.
  - Tests: a RISKY lead re-verified with ETIMEOUT stays RISKY; an import into an ACTIVE campaign with `verifyOnImport` plans nothing until verification is done.

**I10. T04 ∥ T08 are not disjoint.**
- **Location:** "Task order, splits and parallelism".
- **What happens:** Both tasks edit `packages/db/prisma/schema.prisma`, create migrations (two `prisma migrate dev` runs on one schema in parallel) and edit `docs/DECISIONS.md` (D37, D38). CLAUDE.md allows parallel implementers only on disjoint files.
- **Fix:** either run them sequentially, or have the orchestrator land one migration with both schema changes (`PlacementTest`, `placementSeed`, `verifierKind`, `verifierConfigEnc`, `verifyPrevStatus`) before dispatching, and write D37/D38 itself.

**I11. PS-REWARM-07's DNS gate is not built.**
- **Location:** D34 actions; Coverage "REWARM 07 T02/T05/T06".
- **What happens:** PS-REWARM-07 says to pause or reduce, and hold the ramp step, when "bounce rate, provider errors, or DNS health cross thresholds". DNS only lowers the score. A REWARMING (or ACTIVE) account whose daily `dns-check` turns `block` keeps sending until the next launch or resume.
- **Fix:**
  - In `evaluateHealth`, an account whose domain's latest `DomainCheck.level = "block"` gets `healthCap` (so the ramp holds), with audit `account.health_throttle {reason:"dns_block"}`. The cap restores on the next non-block check.
  - Test in `health.test.ts`.

## Minor

- **M1. `FREE_MAIL_DOMAINS` is not exported.** It is a module-local `const` in `leads/domain.ts`. T01 must export it, so add the file to T01's list.
- **M2. RF4 numbers do not throttle.**
  - Review Focus 4 says "the accounts are throttled", but with X 60 + Y 60 accepted and 2 hard, the accounts' 7-day rate is 1.7 % (≤ 2 %).
  - Either drop that clause or use numbers that cross 2 %, and assert it in the `BounceProtect` test.
- **M3. Display gaps for the new stop reasons and the resume path.**
  - New `StopReason`s (`ACCOUNT_UNASSIGNED`, `COMPLAINED`) need entries in `campaigns/lead-status.ts` (`DONE`/`SKIPPED` lists, PS-LEAD-18 display). Add the file to T02.
  - A health pause writes `lastError {kind:"SOFT_BOUNCE"}`, and `displayStatus` ranks errors above lifecycle. Resume must clear a SOFT_BOUNCE `lastError`, or the account shows "Soft Bounce Error" forever.
- **M4. Event timestamps in health windows.**
  - `sendEvent` writes `SEND_FAILED` with `new Date()` (Phase 4 ledger), so with `fixedClock` the 7d/24h windows miss those events. T02 already edits `sendEvent`, so use the clock there.
  - Include the claim-error FAILED path (`dispatch.ts:409`, no event today) if it should count.
- **M5. Health score storage.**
  - `EmailAccount.healthScore Int?` already exists (and `openAccount` resets it). Write it in `evaluateHealth` and serialize from it.
  - Use `HealthSnapshot` only for the trend.
- **M6. Spamhaus DBL error answer.** `127.0.1.255` is the DBL error code "IP queries prohibited", not a listing. Treat `127.0.1.255` as `unknown` too, and add a test case.
- **M7. DNS checks on the SMTP host.**
  - DNSBL and PTR are run on the SMTP *submission* host's IPs, which are not the outbound MTA IPs.
  - Keep them as `warn` only (as planned) and label them "submission host" in the UI so a pass is not read as "your sending IP is clean".
- **M8. Domains the user did not connect.**
  - `domains/[domain]/check` (POST) and `PATCH` should 404 unless `domain` is a domain of a live account of the workspace. Otherwise any string triggers lookups and creates `DomainCheck` rows.
  - Add an isolation/ownership test.
- **M9. HTTP verifier SSRF details (low threat: ADMIN-only setting, but specify it).**
  - `assertPublicHost` refuses private addresses only when `mode === "vps"`, so the T08 test "private IP host → rejected" fails in local mode unless the verifier always refuses private hosts, or the test runs with `mode: "vps"`. State which.
  - Plain `fetch` cannot connect to the checked IP. Either use `node:https.request` with a `lookup` that returns the checked address (same rule as D15), or add `shortcut: DNS-rebinding window between check and fetch, pin the IP when webhooks (P7-T02) add a pinned HTTP helper`.
  - Cap the response body (for example 64 KB).
- **M10. Placement usage write.** Use the guarded `INSERT … ON CONFLICT … WHERE sent + reserved + n <= cap` upsert (as D29 does) instead of read-then-`sent += seeds`, so two placement tests or a claim cannot pass the cap together.
- **M11. Warm-up replies and the replier's schedule.** Reply rows (tick step 2) ignore the replier's 08:00–20:00 window and `weekdaysOnly`. Defer `dueAt` to the replier's next window (PS-WARM-06 "still receive", not "still send").
- **M12. Completion overwrites later warm-up changes.** Completion and cancel restore `warmupEnabled` from `rewarmPrevious` even if the user changed warm-up mid-plan. Restore only when the current value is still the one re-warm set.
- **M13. Source of `smtpHosts`.**
  - The SMTP host lives only inside `credentialsEnc`, so `dnsGate`, `recheckDomains` and diagnostics must decrypt credentials to obtain `smtpHosts`. Name the reader (`accounts/credentials.ts`).
  - Alternatively, store the SMTP host in a plain column at connect, since it is not a secret.
- **M14. Threshold boundary and test fixtures.**
  - The plan says "over the threshold" and its tests use 29/31 d. Say `≥ inactivityDays` (the downtime test at exactly 30 days relies on it).
  - Lifecycle and downtime fixtures must set `createdAt` explicitly: it defaults to DB `now()`, not the fixed clock.
- **M15. Launch with only INACTIVE accounts.**
  - `launch.ts` counts INACTIVE accounts as usable, so a campaign whose only accounts are INACTIVE launches and flips to ACCOUNTS_UNHEALTHY within 5 min.
  - Add INACTIVE to the `usable` exclusion (or a `warn` "accounts inactive: re-warm or resume").
- **M16. ARF availability.**
  - Gmail sends no ARF, and Yahoo/Microsoft FBL reports go to the address registered with the FBL, not necessarily to a connected mailbox.
  - Say so next to the complaint indicator ("complaint data only when a feedback loop delivers to a connected mailbox"), so a 0 % complaint rate is not read as proof.
- **M17. PS-WARM-15 display.**
  - The spec wants soft and unknown bounces, each with reasons; T07's row shows only `hardBouncePct30d`.
  - Add `softBouncePct30d` and the latest three bounce reasons (from `Event.meta.reason`).
- **M18. SPF flattening.**
  - "Gmail/Microsoft account whose SPF tree does not include `_spf.google.com` / `spf.protection.outlook.com` → block, no override" refuses domains that flatten SPF to the provider's IP ranges.
  - Accept: the master gives no override for SPF. Add the case to the fix text ("if you flatten SPF, include the provider's include").
- **M19. Reuse the diagnostics path.**
  - `startRewarm` should call `runDiagnostics` (it already maps AuthError to NEEDS_ATTENTION and stores `lastError`) instead of calling `provider.diagnostics()` directly, as the T06 test "account NEEDS_ATTENTION" expects.
  - Its `Opts` already carries `providerFor`.

## Verdict

**Approve after Revision 2.** There is no Critical finding, and the core design holds: D32's allowance on the row, D33's watermark-transaction look-ahead and D36's honest peer pool are sound and better than the master's alternatives, and each override is justified.

Before execution:
- Fix I1 (warm-up leak through auto-replies/DSNs) and I2 (return-to-service paths). These are the two places where a stated invariant of the plan (Review Focus 1 and 2) does not hold.
- Fix I3/I4/I5 before T02 is dispatched. As written, the health job would re-pause on every resume, pause re-warming accounts on one bounce, and throttle forever.
- I9 changes T08's interface (no job id), and I10 changes the T04 ∥ T08 dispatch.
- Minors can be folded into the owning tasks' briefs.
