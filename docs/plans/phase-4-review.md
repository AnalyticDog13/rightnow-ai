# Phase 4 step plan: independent review

Reviewer: fresh-context plan reviewer · Date: 2026-10-21 · Plan: `docs/plans/phase-4.md` (branch `phase-4-inbox`, at f1390b6)

I checked the plan against the following:
- `docs/IMPLEMENTATION_PLAN.md`: Global Constraints, Send pipeline, Reconciliation (P4), the P4 tasks and Review Focus
- `docs/PRODUCT_SPEC.md`: PS-INBOX, PS-TRACK, PS-SYNC, and the Phase 3 items deferred to P4 (`docs/plans/phase-3.md` "Deferred items")
- `docs/DECISIONS.md` (D16–D25), `docs/PROVIDER_COMPLIANCE.md`, and the P4 entries and carry-forwards in `docs/TASKS.json`
- the code: `core/src/{dispatch,sender,unsubscribe,planner,quota}.ts`, `core/src/campaigns/{hooks,launch,lead-status}.ts`, `core/src/leads/{service,timeline,domain,suppression}.ts`, `core/src/accounts/health.ts`, `providers/src/{types,errors,map-limit,index}.ts`, `providers/src/fake/provider.ts`, `providers/src/imap-smtp/provider.ts`, `schema.prisma` and the migrations, `apps/worker/src/jobs/*`, `docker/Caddyfile`, `core/test/campaign-fixture.ts`

## What holds up

These parts are correct as written:

- **Stop rules against the claim.** The claim locks `ScheduledMessage` (SKIP LOCKED) and then `CampaignLead FOR NO KEY UPDATE`, and it re-checks `cl.state` and `sm.stepId = cl.currentStepId` under that lock. A stop transaction that runs `cancelRows` and then updates the CampaignLead either waits for the claim to commit or makes the claim cancel the row as `stale`. Neither ordering deadlocks, because the claim never waits on a Thread, Message, Lead or Suppression row. The `stop races the claim` test (claim, then stop, then `sendClaimed`) is valid: `precheck` sees STOPPED, `cancel("stale")` releases the reservation and returns CANCELLED.
- **Incremental watermark.** For INCREMENTAL runs, including runs that span several ticks, `lastSyncCompletedAt = syncStartedAt` of the run that reaches `hasMore false` is sound. The change stream is ordered after the saved cursor, the cursor is saved only after its page's ingests commit, and every cursor and watermark write is conditional on the lease. A worker that takes over an expired lease restarts from the last saved cursor, so it re-reads anything the old worker had not committed. `GREATEST(...)` keeps the watermark from moving backwards.
- **Full-reconcile window.** `since = min(lastSyncCompletedAt − 2 d, now − 30 d)` matches PS-SYNC-03, "max(30 days, downtime + margin)" measured as a duration. The master's `lastSyncCompletedAt − 2 d` is the lower bound.
- **Interfaces that exist with the stated semantics:** `withTxRetry`, `cancelRows` (SCHEDULED only by default, SKIP LOCKED), `stopLead`, `stopOpenCampaignLeads`, `editHooks`, `enterSubsequence`, `leadStatusTrigger`, `unsubscribeMode`, `unsubscribeKeys`, `markFresh`/`seedCampaign`, `getFakeProvider`, `FakeProvider.expireCursors`/`sentRaw`/`receiveInbound`, `expectIsolated` (from `@rightnow/db/test-db`), `leads/timeline.ts`. Exceptions are listed under I3 and M8.
- **Tracking security.** The click target `u` sits inside the HMAC, so there is no open redirect. HKDF uses a separate `info`. The scheme check on `u` covers `javascript:` and relative URLs. The Caddy `ask` endpoint only allows VERIFIED domains, and the catch-all site proxies only `/t/*` and `/u/*`. The sandbox in D30 has no `allow-scripts`, `allow-forms` or `allow-same-origin`, and browsers ignore `<meta http-equiv=refresh>` in a sandboxed document.
- **N-3** is in the right place: `FROM.resume` includes COMPLETED (D25 I-4), so `activate()` is where the refusal belongs.
- **D27 bounce classes** are conservative: 5.7.x is UNKNOWN and never suppresses, which matches D18.
- **Message dedupe.** `(accountId, rfcMessageId)` plus a synthetic id, with event dedupe on `${type}:${ws}:${rfcMessageId}`, handles Review Focus 2.

## Critical

**C1. A HISTORICAL or FULL import that spans several runs can lose messages or set the watermark too late.**
- **Location:** T05 `reconcileAccount` steps 2 and 4; the Fixed names `syncProgress` shape.
- **What happens:**
  - Step 2 takes `currentCursor()` first, imports pages (≤ 10 per run, continuing in later runs through `syncProgress.pageToken`), and only "then the cursor saved". `syncProgress` is `{mode, fetched, since}`, so nothing persists the cursor taken in run 1.
  - If the next run takes a fresh `currentCursor()` again, mail that arrived between run 1 and run N is in neither the listing nor the change stream. Gmail lists newest first, so a page token never returns mail that arrived after page 1. Those messages are **never ingested**: a reply that arrived during a 7-day-wake FULL reconcile is lost, and its lead gets follow-ups.
  - If instead the cursor goes into `syncCursor` at run 1, the next run sees a cursor, takes the INCREMENTAL branch, and abandons the rest of the import.
  - Even with the cursor kept, step 4 writes the watermark as the **final** run's `syncStartedAt`. The change stream between the run-1 cursor and the final run has not been read yet, so the watermark claims "everything before T_N is applied" when it is only true up to T_1.
- **Fix:**
  - `syncProgress` becomes `{ mode, folder, pageToken, since, cursor, startedAt, fetched }`. Run 1 sets `cursor = currentCursor()` and `startedAt = syncStartedAt`. Later runs resume from `syncProgress` whatever `syncCursor` says, and the branch test is "`syncProgress` non-null → resume" before "no `syncCursor` → HISTORICAL".
  - On completion, write `syncCursor = syncProgress.cursor` and `lastSyncCompletedAt = GREATEST(old, syncProgress.startedAt)`. The next INCREMENTAL run brings it current.
  - Tests in `sync.test.ts`: a HISTORICAL import across 2 runs with a reply delivered to the Fake between the runs. Expect the reply ingested by the following incremental run, and after the import run the watermark equals run 1's start. Repeat the case for FULL after `expireCursors()`.

## Important

**I1. `applyInbound` has no defined order, and the order the bullets imply breaks D21 and makes two of the plan's own tests impossible.**
- **Location:** T03 `applyInbound` bullets; tests `interest set only when empty` and `stopOnReply off keeps sending, keyword subsequence fires`.
- **What happens:**
  - The first bullet writes Lead counters (`replies`, `lastReplyAt`, `lastEngagement`) before the CampaignLead stops. The sender's `recordSent` locks CampaignLead and then Lead, so the two transactions can deadlock. `withTxRetry` absorbs it, but the plan claims D21 is respected.
  - Interest after the stop: with `stopOnReply` on (the schema default), every CampaignLead is already STOPPED. `applyInterestChange` only looks at `OPEN_STATES`, so the LEAD_STATUS subsequence that the test expects never fires.
  - Interest before the stop: the lead enters the subsequence, and the REPLY stop then kills it.
  - With `stopOnReply` off, a reply containing "pricing" is classified INTERESTED (the T02 regex matches `pricing`). `applyInterestChange(1)` then sets every CampaignLead without a LEAD_STATUS subsequence to **COMPLETED MANUAL**, so "keeps sending" fails.
  - With default settings, REPLY_KEYWORD subsequences can never fire, because they are allowed only when `stopOnReply` is off. PS-SEQ-09(c) is effectively dead. `enterSubsequence` already accepts a STOPPED CampaignLead (it sets ACTIVE), and that is how subsequences pick up repliers.
  - `applyInterestChange` does not write `Lead.interestStatus` or `lastInterestChangeAt` (`updateLead` does that afterwards).
- **Fix:** spell out one order and name it in D26:
  1. `cancelRows`, then the CampaignLead stops (`stopOnReply`, company).
  2. Subsequence entry for the matched campaign. The first REPLY_KEYWORD trigger whose `phrases` match, else the first LEAD_STATUS trigger for the new interest, calls `enterSubsequence`. This is allowed from STOPPED REPLIED.
  3. Set `Lead.interestStatus` and `lastInterestChangeAt` directly when they were null. Call `applyInterestChange` only for `-1` (suppression), never its 1..4 branch, because that branch would COMPLETE other campaigns.
  4. Then the Lead counters, then Suppression, then Event.
  - Rewrite the two tests to match: with `stopOnReply` on, the lead is STOPPED REPLIED in the main flow and is ACTIVE in the keyword subsequence.

**I2. A HARD bounce of a Cc or Bcc copy stops and suppresses the lead.**
- **Location:** T03 BOUNCE bullet.
- **What happens:** the target is found by `originalMessageId`, so the bounce of a campaign `cc` address (PS-CAMP-29) stops the lead BOUNCED. Depending on which value `suppress` gets, it may also suppress the lead's working address.
- **Fix:** stop the CampaignLead and suppress the lead only when `recipient` equals the lead's email, or when `recipient` is null and the message had one recipient. Otherwise suppress `recipient` only and record the event against the lead with `meta.recipient`. Test: a campaign with `cc`, a DSN for the cc → lead still ACTIVE, the cc address suppressed.

**I3. Three functions the plan calls as existing do not work the way it uses them.**
- **Location:** T03 UNSUBSCRIBE bullet and `unsubscribe.ts`; T05 step 5.
- **What happens:**
  - `suppressMailtoUnsubscribe(prisma: PrismaClient, …)` and `unsubscribeLead` open their own `withTxRetry(db.$transaction)`. They cannot be called with the ingest `tx`, which is what `applyInbound` "inside the ingest transaction" needs. Calling them on `prisma` after the ingest commit would break the T05 invariant that stop rules commit before the cursor and watermark move.
  - `recordProviderError` does nothing for errors that are neither `AuthError` nor `PermanentSendError`. The step 5 escalation "at 5 → `recordProviderError` with `lastError.kind "SYNC"` (status ERROR)" is therefore a no-op.
- **Fix:**
  - Export a tx-level `optOutTx(tx, clock, ws, email, leadIds, source)` from `unsubscribe.ts`, which `optOut` wraps. `applyInbound` calls it with `[sender's leads] ∪ [match.leadId]`, so an unsubscribe sent from an alias also stops the lead it replies about.
  - For the sync escalation, either write `status ERROR`, `lastError {kind:"SYNC", code}` and `lastErrorAt` directly (lease-conditional), or add a `kind` parameter to `recordProviderError`. Name the choice in the plan.

**I4. Our own campaign sends that are read back from the Sent folder are not matched to their row, and the recovery path never writes the outbound Message.**
- **Location:** T01 matching order and ingest rules; the `sender.ts` change.
- **What happens:**
  - `matchMessage` looks up `inReplyTo` and `references` but never the message's **own** `rfcMessageId`.
  - When sync imports a step-1 send from SENT without an existing Message row, it matches nothing and is stored `outsideApp true`. That happens when `recordOutboundMessage` failed ("errors logged, never thrown") or when `resolveUncertain` set the row SENT, since only the sender calls `recordOutboundMessage`.
  - A step-2 send matches step 1's row through `inReplyTo` and gets the wrong `scheduledMessageId`.
- **Fix:**
  - Add step 0 for OUT: the own `rfcMessageId` equals `ScheduledMessage.rfcMessageId` in the workspace → that row.
  - Call `recordOutboundMessage` from `resolveUncertain` after its `recordAccepted` too, or from one place after every `recordAccepted`.
  - Test: delete the OUT Message, sync the Fake's SENT, expect `scheduledMessageId` set and `outsideApp false`.

**I5. `ScheduledMessage.rfcMessageId` has no index.**
- **Location:** T01 schema and migration; `matchMessage` step 1; T03 bounce `originalMessageId`.
- **What happens:** every inbound message makes 1 + |references| lookups by `rfcMessageId` across all of the workspace's ScheduledMessage rows. Without an index each one is a sequential scan, so a 2,000-message history import against a year of sends scans the table thousands of times.
- **Fix:** add `@@index([workspaceId, rfcMessageId])` on ScheduledMessage in the T01 migration.

**I6. The sync lease is never renewed, and a run has no time budget.**
- **Location:** T05 step 1 (10 min lease), step 3 (AI classify up to 10 s per message), and the `mail-sync` job options.
- **What happens:**
  - One run can process 10 pages × up to 200 messages. With the `aiClassify` hook (10 s each) or large attachments, it outlasts the 10 min lease. The run then loses every lease-conditional write and does all its work again on the next tick, which can repeat forever on a busy mailbox. The account stays stale meanwhile.
  - The job also lacks `heartbeatSeconds: 10` and the worker stop `signal` that every Phase 3 job has (D24, D25).
- **Fix:**
  - Renew the lease after every page (`UPDATE … SET "syncLeaseUntil" = now + 10 min WHERE "syncLeaseId" = $id`). If it matches 0 rows, stop the run as `skipped`.
  - Give `syncDue` a wall-time budget (like `dispatchTick`'s `maxMs`) and check `signal` between messages.
  - Use `{ policy: "stately", retryLimit: 0, heartbeatSeconds: 10 }` and `boot: true`.

**I7. The `enrolledAt` guard trusts the sender's `Date:` header.**
- **Location:** D26 and T03 "Messages dated before the CampaignLead's `enrolledAt` never stop it".
- **What happens:** `RemoteMessage.date` is the header date, which a client with a wrong clock or timezone can set to before enrolment. A genuine reply to our send would then not stop the lead, which is the outcome Review Focus 2 forbids.
- **Fix:** apply the date guard only when `match.scheduledMessageId` is null. A message that threads to one of our sends cannot predate it, so it always stops. Test: a threaded reply with `Date:` a year in the past still stops the lead.

**I8. A company stop triggered by a non-lead sender reaches every campaign, from any mail.**
- **Location:** D26 and the T03 REPLY company-stop bullet.
- **What happens:**
  - A non-lead sender "stops the other leads of that domain in that campaign", but a message from a non-lead has no campaign unless it threads.
  - As written, any inbound mail classified REPLY from `@acme.test` stops acme leads in every `stopForCompanyOnReply` campaign. That includes an invoice, a support ticket without auto headers, or a newsletter without `precedence`. The T02 default for unknown mail is REPLY UNCERTAIN, so this is the common case.
- **Fix:** for a non-lead sender, company-stop only in `match.campaignId`, and only when the message threads to one of our sends (`match.scheduledMessageId` non-null). Lead senders keep the D26 rule. Add the negative case to the `company stop` test.

**I9. The T02 NOT_INTERESTED regex can permanently suppress interested leads.**
- **Location:** T02 rule (4) and `INTEREST_OF` (`NOT_INTERESTED -1`), together with `applyInterestChange(-1)`, which writes a NOT_INTERESTED suppression.
- **What happens:**
  - `we('re| are) (all )?set` matches "we are set up for Tuesday", and NOT_INTERESTED is tested before MEETING_REQUESTED.
  - `no thanks` matches "no thanks needed, send pricing".
  - A rule misfire becomes a workspace-wide suppression that a later category correction does not undo.
- **Fix:**
  - Anchor the phrases: `we('re| are) all set\b(?!\s+(up|for|to))`.
  - Evaluate MEETING_REQUESTED and INTERESTED before NOT_INTERESTED when both match, or classify UNCERTAIN on conflict.
  - Add corpus cases for both false positives.
  - In T06, when a user changes a RULE-sourced `NOT_INTERESTED` category, remove the `NOT_INTERESTED` suppression with source `status` that it created (D20 path).

**I10. The "opened" and "clicked" subsequence triggers were deferred to P4 and are not planned.**
- **Location:** T03/T04 ownership; `phase-3.md` Deferred: "PS-SEQ-09 REPLY_KEYWORD, opened and clicked triggers → P4-T03". `triggerSchema` already stores `{kind:"ACTIVITY", activity:"opened"|"clicked"}`.
- **Fix:** in T04, `recordOpen` (non-machine only) and `recordClick` (non-scanner only) call `enterSubsequence` for the first active `ACTIVITY` subsequence of the row's campaign that matches. Lock order: CampaignLead `FOR NO KEY UPDATE`, then `enterSubsequence`, then Lead counters. Test each trigger. Add the IDs to the coverage self-check.

**I11. GDPR erasure leaves the lead's mail behind.**
- **Location:** T01 schema (no FK from `Message`/`Thread`/`Event` `leadId` to Lead); `leads/service.ts` `gdprDeleteLead` and `mergeLeads` are not in any task.
- **What happens:** after `gdprDeleteLead` hard-deletes the Lead, its Messages (bodies, addresses), Attachments, Threads, Notes and Events stay. PROVIDER_COMPLIANCE requires that "GDPR delete/export removes personal data". A merge leaves threads pointing at the merged-away lead.
- **Fix:** add `gdprDeleteLead` and `mergeLeads` to T01's file list:
  - Erase deletes the lead's Threads (cascading Messages and Attachments), Notes, and the Messages whose `fromEmail` is the lead's address, and nulls `leadId` on Events.
  - Merge re-points `leadId` on Thread, Message, Event and Note.
  - Test both. PS-LEAD-22 "export" also needs the lead's messages in the lead export (see M12).

**I12. Scenario (f) in T07 contradicts the company-stop freshness gate.**
- **Location:** T07 scenario and assertion (f).
- **What happens:** the single campaign has `stopForCompanyOnReply` on, so `companyGateOk` blocks **every** account of the campaign while one account's sync keeps failing. "The other one does [send]" cannot pass. An implementer who tries to make it pass would be weakening the gate.
- **Fix:** run (f) on a second campaign without `stopForCompanyOnReply`, and assert that in the company-stop campaign neither account sends while one is stale.

## Minor

- **M1. The lock-order wording contradicts the ingest.** Global Constraints say Thread and Message are written "after the send-state rows", but `ingestMessage` writes them before `applyInbound` in the same transaction. That order is safe, because no send-state transaction ever locks a Thread or Message, but say so: "ingest tx: Thread → Message → (D21 order)". The OOO `dueAt` push should select its rows `FOR UPDATE SKIP LOCKED` like `cancelRows` instead of using a plain UPDATE.
- **M2. The plan overstates the sender's pre-send check.** `precheck` reads the CampaignLead without a lock before `provider.send`. A stop that commits after that read and before the send does not prevent the send. The window is milliseconds and is inherent (a reply can always arrive at the provider after the last sync), but the Global Constraints sentence should say "narrows" and not "prevents".
- **M3. D29 checks the cap without the units.** The rule `sent + reserved ≥ floor(providerCap/2)` admits a 5-recipient reply at cap/2 − 1. Use `sent + reserved + units > floor(providerCap / 2)`. Also state in D29 that this deliberately departs from the Global Constraint "never exceed per-account allowances" for the user limit (as D19 does), and check every recipient (to, cc and bcc) against suppression, not only "the address".
- **M4. D30 rendering:**
  - `img-src cid:` loads nothing in a browser. Rewrite `cid:` references to `data:` URIs from stored attachment data (≤ 1 MB) server-side, or drop them.
  - Add `<meta name="referrer" content="no-referrer">`.
  - Add a `<meta http-equiv=refresh>` and a CSS `@import` to the `rendering is inert` fixture.
- **M5. Key rotation breaks old tracked links.** `trackingKeys` derives from `ENCRYPTION_KEY`, so once `OLD_ENCRYPTION_KEY` is dropped, every click link in mail already sent returns 400 (unsubscribe links behave the same). Add this to `docs/ops/KEY_ROTATION.md` (keep the old key for ≥ 90 days), or derive tracking keys from a dedicated secret.
- **M6. Attach-lead leaves the earlier unattributed REPLY event.** The original ingest already inserted `REPLY:ws:rfc` with `leadId null`, so attach-lead's `recordEvent` returns false and `replies` never moves. Update that event's `leadId`/`campaignId` and bump the counters when it had no lead.
- **M7. N-1 details:**
  - The signature is `PermanentSendError(code, detail?, { scope })`. The plan passes `{ scope }` as `detail`.
  - A 4xx on the lead (greylisting) should pass `countsTowardPause: false`, or three greylists pause a healthy mailbox (D18).
  - Amend D25 M-3, which currently says a 4xx with an accepted Cc retries.
- **M8. Names and Fake capabilities:**
  - The REPLY_KEYWORD trigger is `{kind:"REPLY_KEYWORD", phrases: string[]}`, not `keyword` (T03 test).
  - `FailKind` has no `"ambiguous"`; use `api_5xx` or `timeout_after_write`. Both write the copy to SENT, which is fine for the test.
  - `FakeProvider.failNext` affects only `send`/`diagnostics`, not `currentCursor`/`listChangesSince`/`listMessages`, so the T05 tests "transient errors escalate after 5" and "AuthError → NEEDS_ATTENTION" need a read-side failure queue. Add `fake/provider.ts` to T05's files.
  - `FREE_MAIL_DOMAINS` is not exported; use `companyDomainOf()`.
  - `mapLimit` is not exported from `@rightnow/providers`; export it.
  - `stopOpenCampaignLeads` only accepts `SKIPPED|MANUAL|SUPPRESSED|UNSUBSCRIBED`; widen it, and stop PAUSED CampaignLeads too (`stopLead` skips PAUSED, so a paused replier could later be resumed).
- **M9. The `the watermark waits for stop rules` test cannot produce `more`.** With `limit 1` and 2 messages, one run reads both pages (10 pages per run). Inject `maxPages` through `SyncDeps` (test-only), or seed ≥ 11 messages.
- **M10. Sync pacing:**
  - The refine `SYNC_POLL_SEC < SYNC_MAX_STALENESS_SEC` lets accounts flicker stale. Use `2 × SYNC_POLL_SEC + 60 ≤ SYNC_MAX_STALENESS_SEC` (the master's "2 × poll + margin").
  - Accounts whose last result was `more` should be due on the next tick, not after the poll interval, or a FULL reconcile keeps an account unsendable for `pages / 10 × 120 s`.
- **M11. I-7 covers `listChangesSince` but not `listMessages`.** A page token persisted in `syncProgress` that expires between runs throws. Define it: restart that folder's listing from `since` (ingest is idempotent).
- **M12. Coverage gaps:**
  - PS-LEAD-22 also asks for **export** of historical conversations (add the lead's messages to the lead export, or defer it explicitly).
  - PS-INBOX-03 "Scheduled emails" view is missing from the `view` enum (link it to the P3 scheduled view).
  - PS-SEQ-08 / compliance rule 63 ("out-of-office … stops the sequence"): an OOO without a date changes nothing; record that choice in D26 or push follow-ups by a default (e.g. 7 days).
  - Replies filtered to spam are never reported (`types.ts`); list that in `OFFLINE_RECOVERY.md`.
- **M13. T07 assertion (c) cannot show spreading.** It runs with only leads 7 and 8 left. Add about 25 silent leads so "≤ 10 per account-day, spread over days" is exercised.
- **M14. T08 names a dev route that does not exist.** "run one sync via the dev route the e2e helpers already use": the only `_fake` route is `GET mailbox/[address]`, and Playwright runs no worker. Either add `POST /api/v1/_fake/sync` (Fake only, refused when `MODE=vps`) that calls `syncDue`, or seed the thread through `ingestMessage` in global setup. Pick one.
- **M15. Undefined rules:**
  - `direction` is never defined. Use OUT when `from` is the account address, else IN, whatever the folder.
  - Primary and Others overlap for a deleted lead. Primary needs `lead.deletedAt IS NULL`.
  - A HARD bounce with no target: say whether `recipient` is suppressed (recommend yes).
- **M16. `sendReply`'s post-send insert must tolerate sync.** It must use the `(accountId, rfcMessageId)` upsert that `ingestMessage` uses. If sync imports the reply from SENT between `send` and the insert, a plain insert hits the unique key, returns 500 after a successful send, and invites the user to send again.
- **M17. Optional: a reply proves an earlier send.** A reply whose `In-Reply-To` matches an UNCERTAIN or HELD row proves that row was delivered. Settling it through `recordAccepted` would stop a later Release from sending it twice.
- **M18. `TASKS.json` must match the plan.** It still lists T03 and T05 as sonnet and has strictly linear deps. Update the models (T03, T05 and T07 on opus) and the deps (T02 and T04 on T01; T03 on T02; T05 on T03 and T04; T06 and T07 on T05; T08 on T06) when T01 starts.

## Counts

Critical 1 · Important 12 · Minor 18.

VERDICT: Revise. C1 and I1–I4 must change before T01/T03/T05 start. The other findings can be fixed in their owning tasks.
