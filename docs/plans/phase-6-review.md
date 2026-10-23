# Phase 6 step plan: independent review

Reviewer: fresh-context plan reviewer · Date: 2026-10-23 · Plan: `docs/plans/phase-6.md` (branch `phase-6-crm-analytics`, at 7c27520)

I checked the plan against the following:
- `docs/IMPLEMENTATION_PLAN.md`: Phase 6 tasks, data model "CRM (P6)", E2E mapping rows 12–14
- `docs/PRODUCT_SPEC.md`: PS-CRM-01..14, PS-ANALYTICS-01..19, PS-TRACK-01/10/11, PS-SEQ-21, PS-LEAD-04/19, PS-UI-04/07, and the ticked PS-LEAD-10..18 that PS-CRM-09 relies on
- `docs/TASKS.json` (P6 entries), `docs/HANDOFF.md` carry-forwards, `docs/DECISIONS.md` D21, D22, D26, D28, D31, D34, `CLAUDE.md`
- the code: `deliverability/{health,overview}.ts`, `mail/{stoprules,sync,events,tracking,classify,inbox}.ts`, `leads/{service,timeline}.ts` (`updateLead`, `bulkLeads`, `mergeLeads`, `gdprDeleteLead`), `campaigns/sequence.ts` (`settle`, `reorderSteps`), `apikeys.ts`, `audit.ts`, `schema.prisma` (Event, Note, AuditLog, Lead, Campaign, CampaignLead), and the raw-index migrations

## What holds up

These parts are correct as written:

- **Reused names exist with the stated shapes.** `TARGETED_SQL` and `HARD_BOUNCE_SQL` are `Prisma.Sql` over alias `e`. `perLead(where)` is `count(DISTINCT COALESCE(e."leadId", e.id)) FILTER (…)`. `recordEvent` is `createMany skipDuplicates` and returns whether it inserted. `applyInbound` updates the Lead after Suppression and before the REPLY Event, and a losing D26 twin throws P2034 at the REPLY insert. `withTxRetry`, `campaignOverview(prisma, ws, now)`, `listAccounts`, `remainingToday`, `effectiveAllowance`, `dayKey`, `isValidTimeZone`, `leadTimeline`, `createNote`/`noteInput`/`listNotes`, `csvResponse`, `csvCell`, `assertMembers`, `applyInterestChange`, `expectIsolated`, `seedCampaign`/`markFresh` and `getFakeProvider` are all present. Opens use `meta.machine` and clicks use `meta.scanner` (`tracking.ts:113`), which matches D42. CLICK events carry `scheduledMessageId`, so "sends with ≥ 1 click" can be computed.
- **Hook coverage.** The inbox `set_interest` action goes through `bulkLeads` (`inbox.ts:488`). So `updateLead`, `bulkLeads` and `applyInbound` are every writer of `interestStatus`, and nothing is missed.
- **Lock order.** Every caller writes Lead before Opportunity: `updateLead` (Suppression, then Lead), `bulkLeads`, `applyInbound`, `mergeLeads` (Lead rows `FOR UPDATE`) and `gdprDeleteLead` (Lead delete cascades). In the D26 twin case, the Lead update serializes the two transactions. The second one sees the first's committed opportunity and is then rolled back by the P2034 at the REPLY insert. So the twin race itself is safe, with the exceptions in C1, I1 and I2.
- **Fixture arithmetic.** I checked every expected value against the D42 definitions and the shared SQL: sent 5, contacted 4, opened 1, hard 2 (L2 once per lead, plus L5's recipient-scoped SEND_FAILED; L4's untargeted DSN is excluded), rates 0.25 / 0.2 / 0.5 / 0.4 / 1 / 0.4, the per-variant and per-account splits, and every crmReport value (500, 1000, 365000, 200, conversion 1.0 / 0.5 / 0). They are all correct.
- **Rulings.**
  - **Single currency per workspace:** sound, because sums would otherwise mix currencies. It is a recorded deviation from the master's per-row `currency`. See M12.
  - **Unique per (lead, campaign), NULLS NOT DISTINCT:** correct for PS-CRM-07, and raw unique indexes already have precedent (`Lead_workspaceId_email_live_key`). Prisma cannot upsert on a raw index, so writes need `INSERT … ON CONFLICT DO NOTHING` (C1).
  - **One-way status → stage:** removes the loop, but the direction needs guard rails (I4).
  - **Reminders are due dates only:** this meets PS-CRM-05 and PS-UI-04 ("pending reminders/tasks") without building a notifier.
  - **Merge refuses with 409:** better than silent loss. See M13.
  - **PS-CRM-09 already met:** the `/leads` view already covers it. PS-LEAD-10..18 are ticked, and `bulk-bar.tsx` exports the selection and assigns round-robin.
- **Deferrals.**
  - PS-ANALYTICS-19 goes to P7-T02 (no webhooks exist yet) and PS-CRM-12 to P7-T06 (it changes the sync path).
  - The AWAITING_APPROVAL producers go to P7-T05 and variant auto-pausing to P7-T04.
  - All are justified.
  - None of the P5 carry-forwards is needed here.
- **Proportion.** The plan is written at the level of decisions. The T02 and T04 "Files" lines are UI inventories rather than decisions, but they are short and they pin the exact copy text, so they can stay.

## Critical

**C1. A failure in the CRM hook stops the mailbox from syncing and sending.**
- **Location:** T01a `applyInbound` change; D40 (`value = lead.plValue ?? campaign.plValue ?? 0`, `Decimal(14,2)`, 0–1e12).
- **What happens:** `sync.ts` runs `ingestMessage` and `applyInbound` in one transaction. Any error other than P2034/P2002 is logged and rethrown (`sync.ts:378–385`). The watermark does not advance, so every later run fails on the same message: the mailbox goes stale, the freshness gate stops its sends, and `syncErrors` count toward SYNC_FAILING. Under the plan as written, the hook can throw in several ways:
  - `Lead.plValue` and `Campaign.plValue` are unbounded `Decimal?` (`updateLeadInput` has no `.max`). A lead worth 1e13 makes the opportunity insert overflow `Decimal(14,2)` (22003) on every run. The same message fails every time, so the mailbox never recovers.
  - A stage deleted between the hook's stage read and its insert or move gives an FK violation (23503).
  - Any later bug in `ensureStages`, attribution or event writing has the same effect.
- **Fix:**
  - Clamp the derived value: when it is outside 0..1e12, use 0. Also add `.max(1e12)` to the lead and campaign `plValue` inputs.
  - Run the hook inside `SAVEPOINT crm_hook`.
    - On a retryable code (P2034, 40P01, 40001), rethrow.
    - On any other error, `ROLLBACK TO SAVEPOINT crm_hook`, log it and continue, so the reply is still stored. Leave a `shortcut:` comment, or write an audit `crm.hook_failed`.
  - Read the target stage `FOR KEY SHARE` and skip the write when the stage is gone.
  - Create opportunities with raw `INSERT … ON CONFLICT DO NOTHING` (no conflict target) and then re-read. A concurrent `POST /crm/opportunities` then cannot fail ingest.
  - Call the hook after the REPLY `recordEvent` and its twin check, so a losing twin never runs it.
  - Tests in `crm.test.ts`:
    - a lead with `plValue` 1e13 gets an INTERESTED reply, which gives the message stored and an opportunity with value 0;
    - a stage is deleted (`moveTo`) concurrently with a positive reply's ingest, and ingest still commits;
    - `POST /crm/opportunities` runs concurrently with the ingest of the same lead, giving one row and the ingest committed.

## Important

**I1. Lock modes on stages: deleteStage can deadlock with ingest and card moves.**
- **Location:** `updateStage` "renumbers 0..n-1 under FOR UPDATE of the workspace's stages"; `deleteStage(…, moveTo)`.
- **What happens:**
  - Every Opportunity insert or `stageId` change takes `FOR KEY SHARE` on the referenced stage (FK check), and `FOR UPDATE` conflicts with it.
  - `deleteStage` locks the stages and then updates the Opportunities in that stage.
  - Ingest and a card move lock the Opportunity row and then key-share the target stage.
  - So the two lock orders run in opposite directions. A move out of the stage being deleted deadlocks. A card PATCH also waits behind every renumbering.
- **Fix:**
  - Use `FOR NO KEY UPDATE` for the workspace stage lock (renumbering and renaming never change the key). It does not conflict with KEY SHARE.
  - `deleteStage` takes that lock, moves the deals and only then deletes the row.
  - Map 23503 (a deal inserted meanwhile) to 409 `stage_not_empty`, and map a PATCH to a stage that has just been deleted to 404.
  - Add to D21: "PipelineStage is locked `FOR NO KEY UPDATE` only".
  - Test: `deleteStage` with `moveTo` runs concurrently with `updateOpportunity` moving a deal out of the deleted stage, and both finish with no 500.

**I2. Stage moves are not row-locked, so a deal can be won twice and the stage history can be wrong.**
- **Location:** D40 stage transitions; T02 drag (optimistic PATCH `stageId`); the hook's "existing opportunity … moves there".
- **What happens:** the plan does not say how a move reads the current stage. Two users dragging the same card, or a drag racing an ingest move, both read the same `from`:
  - both set `closedAt` and record `DEAL_WON` with different millisecond keys, so there are two Events for one win;
  - the `opportunity.stage {from, to}` audit chain no longer links up (PS-CRM-13).
- **Fix:**
  - Every stage change (PATCH, hook, `moveTo`) runs `SELECT … FROM "Opportunity" WHERE id = $1 AND "workspaceId" = $2 FOR UPDATE`, then computes from/to, `closedAt` and the events.
  - A move to the stage the deal is already in is a no-op (no audit, no event).
  - Test: two concurrent PATCHes to Closed Won give one `DEAL_WON` and one audit row, and the second PATCH is a no-op.

**I3. Changing a stage's kind, or deleting a stage with `moveTo` across kinds, skips the WON/LOST transition.**
- **Location:** `updateStage {kind?}`; `deleteStage moveTo`; D42 (won = WON-stage rows with `closedAt` in range; pipeline = OPEN-stage rows).
- **What happens:**
  - When a stage holding deals is switched from OPEN to WON, its rows keep `closedAt = null`. They leave the pipeline value and never count as won.
  - A `moveTo` into a WON stage has the same effect.
  - Going the other way, from WON to OPEN, leaves a stale `closedAt`.
- **Fix (smallest):** refuse a `kind` change on a stage that holds deals (409 `stage_not_empty`), and require `moveTo` to have the same kind (400 `move_kind_mismatch`). Add both cases to `stage rules`.

**I4. A global lead status has no clear target among per-campaign deals, and it can un-win a deal.**
- **Location:** D40 hook ("an existing opportunity of `(lead, campaign)` moves there"; the campaign is the latest send's campaign for `updateLead` and bulk); PS-LEAD-04.
- **What happens:**
  - `Lead.interestStatus` is one value per lead, but deals are per campaign. Take a lead whose deal came from campaign A and who was later mailed by campaign B. The user marks it "Meeting booked", and a second deal is created in B while the real deal in A stays put.
  - A deal dragged to Closed Won keeps the lead at "Interested", because the hook only runs one way. A later "Meeting booked" (2) then moves the won deal back to Meeting Scheduled and clears `closedAt`, so revenue disappears with no user intent.
  - `to = null` is not defined.
- **Fix:** in D40, define three rules:
  - **Target:** the `(lead, campaign)` deal when a campaign is given (reply ingest). Otherwise the lead's most recently updated deal. Create a deal only when the lead has none.
  - **Closed deals:** the hook never moves a deal that is in a WON/LOST stage unless the new code itself maps to a WON/LOST stage. Closed deals otherwise change only by an explicit move.
  - **Null and unmapped codes** leave deals untouched.
  - Tests:
    - a lead with a deal in A and a later send in B gets `updateLead {2}`: the A deal moves and no B deal is created;
    - a deal dragged to Won, then `updateLead {2}`: the deal stays Won and `closedAt` is unchanged.

**I5. The step, variant, account and day views have no usable rate denominator.**
- **Location:** D42 (open rate and reply rate use `contacted`, defined on step 1 only; "the account view always uses sent"); PS-ANALYTICS-12, PS-SEQ-21 ("reply rate … per step and variant").
- **What happens:** with `groupBy=step|variant`, every row after step 1 has `contacted 0`, so its open and reply rates are `null`. In the fixture, S2A has 1 reply and no rate. Day rows divide replies that day by first-step leads that day, which can exceed 100 %.
- **Fix:**
  - For the step, variant, account and day groupings, the rate base is the group's own sends: unique leads sent in the group, or `sent` when `replyBase=sent`. Return it as `rateBase` so PS-ANALYTICS-18 can show it.
  - `contacted` keeps the PS-ANALYTICS-03 meaning for the none, campaign and ESP views.
  - Fixture assertion: S2A reply rate 1.0 and S1A 0.5.

**I6. "Contacted" by minimum step `order` breaks after step 1 is deleted.**
- **Location:** D42 Contacted ("minimum `order`, deleted steps included"); T03 test `step 1 deleted`.
- **What happens:**
  - `settle()` renumbers the live steps after a deletion (`sequence.ts:104–110`), so the old step 2 becomes `order 1` next to the deleted step 1, which keeps `order 1`.
  - Once step 1 is deleted, every later step-2 send counts as "contacted" in its range.
  - The test only checks the all-time total, which `DISTINCT` hides.
- **Fix:**
  - Define contacted as leads whose first ACCEPTED in that campaign falls in the range: `min(occurredAt)` per `(lead, campaign)` over all time. The first send of an enrolment is always its first step, and the `SequenceStep` join goes away.
  - `newLeadsContacted` uses the same rule per workspace.
  - Test: S1 is deleted and step 2 is sent on a later day, so `contacted` in that day's range is 0.

**I7. CRM Events carry no attribution, so per-step meetings are always zero.**
- **Location:** D40 (`OPPORTUNITY`, `MEETING`, `DEAL_WON/LOST` Events); D42 "Meetings = MEETING Events"; PS-ANALYTICS-12 and PS-SEQ-21 (meetings booked per step and variant).
- **What happens:** the plan does not say which columns these Events set. Without `campaignId/stepId/variantId/accountId`:
  - `groupBy=step|variant|account` puts every meeting in the empty group;
  - every campaign filter drops them.
- **Fix:** these Events copy the opportunity's attribution columns, and the MEETING dedupe key is `meeting:<leadId>:<campaignId ?? "none">`. Fixture assertion: `groupBy=variant` gives S2A `meetings 1`.

**I8. Named tests that cannot be written or cannot fail.**
- **Location:** T01a `one opportunity under races`; T03 `exact fixture` and `warm-up and placement never counted`.
- **What happens:**
  - **Race test:** it expects "1 MEETING for code 2" from two concurrent `syncDue` calls. A reply never yields code 2, because `INTEREST_OF` maps MEETING_REQUESTED to 1, so the test cannot be written as planned.
  - **Exact fixture:** it asserts neither `newLeadsContacted` nor `complaints`. It also lacks an event outside the range, a second campaign (cross-campaign dedupe of `contacted`/`opened` in the total), and `scheduledMessageId` on L4's BOUNCE_SOFT (without it, soft is 0).
  - **Warm-up and placement test:** `warm-up and placement never counted` inserts `WarmupMessage` rows and `AccountDailyUsage.sent += 2` directly. Nothing turns those rows into Events, and the usage write is what lowers remaining capacity, so the test cannot fail.
- **Fix:**
  - **Race test:** use code 1 for the twin (one OPPORTUNITY Event). Test the MEETING dedupe with two concurrent `updateLead {2}` calls.
  - **Exact fixture:** add L1's first ACCEPTED one day before the range (so `newLeadsContacted` is 3 and `contacted` is 4), two COMPLAINT events from one lead plus one untargeted COMPLAINT (`complaints` 1), and a second campaign with a send to L1 (the total `contacted` stays distinct).
  - **Warm-up and placement test:** drop the unit version. The e2e test (real `warmupTick` and placement) is the real check, but see M17.

## Minor

- **M1. `ensureStages` cannot both use `skipDuplicates` on name and "add nothing after a rename".**
  - A renamed default would be inserted again.
  - Fix: seed only when the workspace has zero stages (with `skipDuplicates` for the concurrent first call). Call it once per transaction, outside the bulk loops.
- **M2. Bulk cost.** `bulkLeads` takes up to 1 000 leads within a 30 s budget, and running the full hook for each one adds about 8 statements per lead. Load the stages once, and run `lastSend` once for all leads (`DISTINCT ON (leadId)`).
- **M3. Workspace checks on referenced ids.**
  - `stageId`, `moveTo`, `campaignId` and `leadId` on opportunity writes must belong to the workspace. FKs do not scope by workspace, and `campaignId` has no FK.
  - Add to `crm-api.test.ts`: another workspace's stage gives 404, and another workspace's campaign gives 400.
- **M4. Reply attribution.** For ingest, prefer the matched send (`match.scheduledMessageId` → its step, variant and account) over "latest ACCEPTED in the campaign". The latest one can be a follow-up sent after the reply was written.
- **M5. Replies in the account view.**
  - A REPLY Event's `accountId` is the receiving mailbox (`stoprules.ts:168`), so a reply that lands in another mailbox is credited to it.
  - Fix: group and filter replies by `COALESCE(sm."accountId", e."accountId")` through `scheduledMessageId`.
- **M6. Range bounds in SQL.**
  - `occurredAt` is `timestamp without time zone` in UTC. Compute the bounds as `(${from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`, not in JS.
  - Map Postgres 22023 (a time zone Postgres does not know) to 400.
  - The DST test should also place events at 00:30 local and 23:30 local on 2026-11-01 in New York, not only count the rows.
- **M7. Label what the CRM figures measure.**
  - Pipeline value is limited to deals created in the range. Most users read it as the current open pipeline: either drop the range, or label it "created in range".
  - Conversion by stage uses the current stage, so a deal that reached Proposal and then Lost does not count at Proposal. The AuditLog has the history if this matters. Otherwise say so in the tooltip.
  - Positive reply rate can exceed 100 % because manual deals count. Show the denominators (PS-ANALYTICS-18).
- **M8. Non-campaign replies in the totals.** REPLY Events with no campaign enter `replied` in the unfiltered total, but `contacted` counts campaign sends only. Restrict rate numerators to campaign events, or state the difference.
- **M9. GDPR and revenue.**
  - Erasure cascades the deals away, so past won and revenue figures change while the erased lead's Events are kept. State this in D40.
  - Audit `meta` for `opportunity.*` must carry ids only. `title` defaults to the email, and `gdprDeleteLead` does not scrub AuditLog.
- **M10. Activity feed query.** AuditLog is indexed only on `(workspaceId, createdAt)`, and `target` is the deal id. Put `leadId` in the audit meta, or query `target = ANY(<the lead's deal ids>)`. Otherwise a deleted deal's history drops out of the lead feed.
- **M11. PS-TRACK-01 positive_reply and negative_reply.** These are not addressed. Record in D40 that `INTEREST_CHANGED` with `to > 0` or `to < 0` is that event, as D31 did for scheduled and send_attempt.
- **M12. Currency change.** Changing `Workspace.currency` relabels the stored amounts. Allow it only while no deal has a non-zero value, or show a warning.
- **M13. Merge 409 in the UI.** The lead merge UI must show `opportunity_conflict` as "Both leads have a deal in {campaign}; delete or move one first". Add this to T02, and check for the clash after the Lead locks.
- **M14. Dashboard capacity.**
  - `remainingToday` must be `min(Σ account remaining, workspace cap − workspace usage)` when `dailyCap` is set.
  - Add a test case with a cap below the sum.
- **M15. Sizing.**
  - T04 has two core modules on sonnet plus two pages and the charts. Move `dashboardSummary` and `exportActivityCsv` to T03 (opus, same SQL and definitions), so that T04 is UI only.
  - Optional: T03 does not use `Task`, so it can depend on T01a rather than T01b.
- **M16. T02 ∥ T03.**
  - The file sets are disjoint, so the plan's claim holds.
  - However, T02's `E2E_PROD=1` run needs a `next build` of the whole app, including T03's half-written `api/v1/analytics/**`, and each task's full typecheck and lint also see the other task's unfinished code. Run T02's build and e2e only between T03 commits, or give T02 its own worktree.
- **M17. E2E #14 capacity assertion.** "Usage summed > 3" is already true because of warm-up sends, so it shows nothing about placement. Assert the exact usage: 3 campaign sends + the warm-up sends + the placement seeds.

## Verdict

**Revise before execution.** The scope, the rulings and the reuse of D34 are sound, and the fixture arithmetic is right. The problem is T01a's placement inside the ingest transaction: as written, the hook can halt a mailbox (C1), and the plan leaves lock modes, row locks and stage-kind transitions open (I1–I3).

Before execution:
- **Before T01a is dispatched:** fix C1 and I1–I4 in D40 and in the T01a tests.
- **Before T03:** fix I5–I8, which change D42's denominators, the definition of `contacted`, the columns of the CRM Events and the fixture.
- **Minors:** fold them into the owning tasks' briefs.
