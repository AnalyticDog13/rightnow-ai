# Phase 6 — CRM & analytics: step plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A positive reply or a lead status change opens or moves an opportunity in a configurable pipeline. Opportunities carry deal value and cash collected and are attributed to the campaign, step, variant and account of the send behind them. Tasks, reminders, notes and logged calls form the CRM activity history. Analytics, the dashboard and the CSV exports compute every number from stored Events and CRM rows, with the D34 bounce and complaint definitions. Warm-up and placement mail are never counted.

**Architecture:** New core modules in `packages/core/src/crm/` (`stages`, `opportunities`, `tasks`, `activity`) and `packages/core/src/analytics/` (`query`, `metrics`, `crm-report`, `accounts`, `dashboard`, `export`). The interest-to-opportunity hook runs inside the caller's transaction as a leaf write after `Lead`. In reply ingest it runs after the REPLY Event and its twin check, inside `SAVEPOINT crm_hook`, so a CRM failure never undoes or blocks ingest or sync (Rev 2 C1). Analytics is one grouped SQL statement per view over `Event` (`GROUPING SETS`, so the totals and the per-group rows come from one pass), joining `Lead` for segments and `Campaign` for status, tag and owner. It reuses `TARGETED_SQL`, `HARD_BOUNCE_SQL` and `perLead` from `deliverability/health.ts`. Opportunity, won and revenue figures read the `Opportunity` table, which always holds the current state, so a reopened deal is never counted twice. UI: `apps/web/app/(app)/crm/`, `analytics/` and `dashboard/` replace their EmptyStates.

**Tech Stack:** TypeScript 5.9, Prisma 7.10.1, PostgreSQL 18 (`UNIQUE NULLS NOT DISTINCT`, `GROUPING SETS`, savepoints), zod 4, Next.js 16, React 19, Recharts 3.10.1 (already in `docs/STACK.md`, installed by T04), Vitest + embedded-postgres, Playwright. Drag and drop uses native HTML5 events with a keyboard fallback. The only new dependency is Recharts.

**Spec:** `docs/IMPLEMENTATION_PLAN.md` is binding ("Phase 6 — CRM & analytics", Global Constraints, data model "CRM (P6)", E2E mapping rows 12–14). Also `docs/PRODUCT_SPEC.md` (PS-CRM-*, PS-ANALYTICS-*, PS-TRACK-01/10/11, PS-SEQ-21, PS-LEAD-04/19, PS-UI-04/07), `docs/DECISIONS.md` (D21, D26, D27, D28, D31, D34, D36, D37), `CLAUDE.md`, the Phase 5 rulings and carry-forwards in `docs/HANDOFF.md` / `docs/REVIEW_LOG.md` (all P5 carry-forwards stay with P7; none is needed by this scope), and the review `docs/plans/phase-6-review.md` (Revision 2 below).

> Branch `phase-6-crm-analytics`. Commit and push after every task; check CI after every push. Phase 1–5 interfaces are used as they are: `route()` (`auth`, `role`, `scope`, `query`, `body`), `run`/`actor` (`lib/accounts-http.ts`), `csvResponse` (`lib/csv-stream.ts`), `csvCell` (`leads/export.ts`), `AccountError`/`LeadError`, `audit`, `recordEvent`, `applyInterestChange`, `applyInbound`, `withTxRetry`, `listLeads`/`leadQuery`, `bulkLeads`, `mergeLeads`, `gdprDeleteLead`, `leadTimeline`, `createNote`/`noteInput`/`listNotes` (`mail/inbox-library.ts`), `campaignOverview`, `listAccounts` (`sentToday`, `remainingToday`), `effectiveAllowance`, `dayKey`, `isValidTimeZone`, `TARGETED_SQL`/`HARD_BOUNCE_SQL`/`perLead`, `HealthSnapshot`, `createTestDb`/`expectIsolated`, `fixedClock`, `seedCampaign`/`markFresh`, `getFakeProvider`, the `Tabs` component and the `EmptyState` pages.

## Global Constraints (from the master plan; every task inherits them)

- Every service read and write takes `workspaceId` and filters by it. Every id a request references (`stageId`, `moveTo`, `campaignId`, `leadId`, `opportunityId`, `assigneeId`) is checked against the workspace: FKs do not scope by workspace and `campaignId` has none (Rev 2 M3). Every new route gets `expectIsolated`.
- Lock order (D21) is extended, not changed. `Opportunity` and `Task` are leaf writes after `Lead`/`Suppression`. In `applyInbound` the CRM step runs after the Events, inside a savepoint. `PipelineStage` is locked only `FOR NO KEY UPDATE` (stage edits) or `FOR KEY SHARE` (reads before a write), never `FOR UPDATE` except by its own `DELETE` (Rev 2 I1). A stage change locks its `Opportunity` row `FOR UPDATE` first (Rev 2 I2).
- No network call inside a DB transaction. CRM and analytics make none.
- API keys act as MEMBER. Pipeline stage configuration and the CRM settings are ADMIN and session-only. Everything else accepts `session-or-apikey` with scope `crm:read`/`crm:write` (new resource in `API_SCOPES`) or `analytics:read`.
- Metrics come only from stored rows (`Event`, `CampaignLead`, `Opportunity`, `HealthSnapshot`, and usage rows for capacity), never synthetic or placeholder numbers (PS-ANALYTICS-17). "Sent" means "accepted by provider" and is never called "delivered". Opens are "estimated". Machine opens and scanner clicks are reported only in their own counters.
- Warm-up (`WarmupMessage` SEND/REPLY) and placement (`WarmupMessage` PLACEMENT) never become Events (D36, D37), so Event metrics exclude them by construction. Capacity reads usage rows, where placement sends count and warm-up sends do not, so remaining capacity is correct. The real-pipeline test pins both facts (T03).
- Bounce and complaint figures use `TARGETED_SQL`, `HARD_BOUNCE_SQL` and `perLead` from `deliverability/health.ts` and never re-define them: a DSN or ARF that matched no send does not count, and a lead counts once.
- Timestamps are stored in UTC. Analytics buckets in UTC by default, or in an IANA `tz` the user chooses (PS-UI-07, PS-TRACK-12).
- Every task writes its tests first, then runs `npm test`, `npm run lint` and `npm run typecheck`, all green, before committing. UI tasks also run their Playwright spec (`E2E_PROD=1` on the Windows dev machine, from `apps/web`).

## Decisions taken by this plan (record as D40–D42 in `docs/DECISIONS.md` in the task that implements them)

- **D40 · Pipeline, opportunities and the interest hook (T01a).**
  - **Stages.** `PipelineStage(position, kind OPEN|WON|LOST, interestCodes Int[])`.
    - `ensureStages` seeds the defaults only when the workspace has zero stages (`createMany skipDuplicates` on `@@unique[workspaceId, name]` absorbs two concurrent first calls), so a renamed default is never re-added (Rev 2 M1).
    - Defaults: Not Contacted, Contacted, Replied, Interested `[1]`, Meeting Scheduled `[2,3]`, Proposal Sent, Negotiation (all OPEN), Closed Won WON `[4]`, Closed Lost LOST `[-3,-1]`.
    - Interest codes are unique across a workspace's stages.
    - A workspace keeps ≥ 1 OPEN, 1 WON and 1 LOST stage, and at most 20 stages.
    - A stage that holds deals cannot change `kind` (409 `stage_not_empty`), and can be deleted only with a `moveTo` of the same kind (400 `move_kind_mismatch`). A deal therefore never changes between open and closed without a stage transition (Rev 2 I3).
  - **Opportunities.**
    - Unique per `(leadId, campaignId)` with **NULLS NOT DISTINCT** (raw index in the migration). Automatic creation uses raw `INSERT … ON CONFLICT DO NOTHING` (no conflict target) and then re-reads the row, so a concurrent create never fails.
    - One currency per workspace (`Workspace.currency`, ISO 4217, default `USD`) instead of per-row currency (deviation from the master model: sums would mix currencies). It can change only while every deal has value and cash 0 (409 `currency_in_use`, Rev 2 M12).
    - Money is `Decimal(14,2)`, 0–1e12. Lead and campaign `plValue` inputs get `.max(1e12)`. A derived value outside 0..1e12 becomes 0 (Rev 2 C1).
  - **The hook** (`onInterestChange`, in the caller's transaction after the Lead write) (Rev 2 I4).
    - *Target:* with a campaign given (reply ingest), the `(lead, campaign)` deal. Without one (manual, bulk), the lead's most recently updated deal.
    - *Creation:* only when the lead has no deal yet (with a campaign given, none in that campaign), the code is in 1..4 and `Workspace.crmAutoOpportunity` (default true).
    - *Closed deals:* a deal in a WON/LOST stage is moved only when the new code itself maps to a WON/LOST stage.
    - *No-ops:* `null`, unmapped codes and a move to the current stage change nothing.
    - *Attribution:* from the matched send when ingest has one (`sm` → campaign, step, variant, account; Rev 2 M4). Otherwise the lead's latest ACCEPTED Event in the given campaign, else in any campaign, else none.
    - *New-deal defaults:* `value = lead.plValue ?? campaign.plValue ?? 0` (clamped), `ownerId = lead.ownerId ?? campaign.ownerId ?? actor`, `title = companyName || email`.
    - *Manual changes:* the manual paths record `INTEREST_CHANGED {from, to, source:"manual"}`, as the reply path already does. `to > 0` / `to < 0` is the spec's positive_reply / negative_reply (Rev 2 M11, as D31 did for scheduled/send_attempt).
    - *Meetings:* code 2 records one `MEETING` per `(lead, campaign)` (dedupe `meeting:<leadId>:<campaignId ?? "none">`).
    - *One-way only:* moving a card never changes the lead's status.
  - **Ingest isolation (Rev 2 C1).** In `applyInbound` the hook runs only for a fresh REPLY, after its `recordEvent` and twin check, inside `SAVEPOINT crm_hook`.
    - Retryable errors (P2034, 40P01, 40001) are re-thrown, so `withTxRetry` reruns the whole ingest.
    - Any other error does `ROLLBACK TO SAVEPOINT crm_hook`, writes audit `crm.hook_failed {leadId, code}` and continues, so the message, its stops and its Events commit and the watermark advances.
    - Manual and bulk paths run the hook without a savepoint: a status change and its deal stay atomic, and an error is the request's error.
  - **Stage transitions** (PATCH, hook, `moveTo`; Rev 2 I2). Lock the Opportunity `FOR UPDATE`, read the target stage `FOR KEY SHARE` (gone → skipped in the hook, 404 on PATCH), then compute from/to. Entering WON/LOST sets `closedAt` and records `DEAL_WON`/`DEAL_LOST` (dedupe `won:<id>:<closedAt ms>`). Leaving it clears `closedAt`. Creation records `OPPORTUNITY` (`opp:<id>`).
  - **CRM Events and audit.** CRM Events copy the opportunity's `campaignId/stepId/variantId/accountId` (Rev 2 I7). Stage history is the AuditLog: `opportunity.stage {leadId, from, to}` with actor and time (PS-CRM-13). `opportunity.*` audit meta carries ids and amounts only, never the title or the email (Rev 2 M9, M10).
  - **GDPR, merge and deleted leads.**
    - GDPR erasure deletes the lead's deals and tasks (FK cascade). Past won and revenue figures drop accordingly, while the erased lead's anonymised Events stay (Rev 2 M9).
    - Merge repoints deals to the kept lead, checked after the Lead locks. A `(lead, campaign)` clash returns 409 `{error: "opportunity_conflict", campaignId}`.
    - The board hides the deals of soft-deleted leads, and analytics keeps them.
- **D41 · Tasks, reminders, activity (T01b).**
  - `Task(status OPEN|DONE|AWAITING_APPROVAL)`.
  - A reminder is a task's `dueAt`. Due and overdue tasks, plus inbox threads whose `reminderAt` has passed, appear on the dashboard and under the CRM Tasks "Due" filter. There is no email or push notification.
  - `AWAITING_APPROVAL` serves the PS-CRM-08 view. Its producers come with P7-T05; approving sets OPEN.
  - Calls, SMS and meetings are manual log entries: `Note.kind` `note|call|sms|meeting`, on the lead. Opportunity notes are the lead's notes.
  - The activity feed (PS-CRM-01 "Inbox") merges the lead's notes, `REPLY` Events, and AuditLog rows `opportunity.*`/`task.*` selected by `meta->>'leadId'`. Deleted deals keep their history; `shortcut: AuditLog has no meta index, add one if the feed gets slow`. Newest first, keyset on `(at, id)`.
- **D42 · Analytics definitions (T03).**
  - **Range.** The local days `from..to` (inclusive) in `tz`, at most 400 days. Bounds are computed in SQL as `(${from}::date::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'` (`occurredAt` is UTC `timestamp`); Postgres 22023 maps to 400 (Rev 2 M6).
  - **Sent** = ACCEPTED Events.
  - **Contacted** = distinct leads whose first ACCEPTED in a campaign (all-time `min(occurredAt)` per `(lead, campaign)`) falls in the range (Rev 2 I6: no step join, safe after step deletion). **New leads contacted** = leads whose first ACCEPTED in the workspace falls in the range.
  - **Opened** = leads with ≥ 1 OPEN where `meta.machine` is not true.
  - **Clicked** = leads with a non-scanner CLICK. **Clicked sends** = sends with ≥ 1 such click.
  - **Replied** = leads with REPLY; auto-replies are counted apart, and `includeAutoReplies` adds them.
  - **Bounced** = hard `perLead(HARD_BOUNCE_SQL)`, soft BOUNCE_SOFT, unknown BOUNCE_UNKNOWN. **Complaints** = `perLead(COMPLAINT)`. All of these sit under `TARGETED_SQL`. **Unsubscribed** = leads with UNSUBSCRIBE.
  - Rate numerators count only events with a campaign (Rev 2 M8).
  - **Rate base** (`rateBase`, returned with every row, Rev 2 I5). The none, campaign and ESP views divide by contacted (or by sent with `replyBase=sent`). The step, variant, account and day views divide by the group's unique leads sent (or by its sends with `replyBase=sent`). Rates are open = opened / rateBase, reply = replied / rateBase, click = clicked sends / sent, bounce = hard / sent, positive reply = opportunities / replied. A zero denominator gives `null`.
  - **Account view.** Grouped and filtered by the sending account, `COALESCE(sm."accountId", e."accountId")` through `scheduledMessageId`, so a reply received by another mailbox counts for the sender (Rev 2 M5).
  - **Completed** = CampaignLeads COMPLETED with `completedAt` in range (none, campaign, day and ESP views only).
  - **Meetings** = MEETING Events.
  - **Opportunities** = rows created in range, with their value. **Won / conversions** = rows in a WON stage with `closedAt` in range, with `cashCollected`.
  - **Pipeline value** = the current open pipeline (all OPEN-stage rows, range-independent, labelled "current", Rev 2 M7). Average deal size = won value / won. Annualized closed = won value × 365 / range days. Revenue per lead = cash collected / contacted.
  - **Conversion by stage** = deals currently in this stage or a later OPEN/WON stage, divided by the deals created in range (LOST counts only in its own stage). The tooltip says "by current stage" (Rev 2 M7).
  - **Progress** = (COMPLETED + STOPPED) / enrolled, the current state, from `campaignOverview`.
  - Every unique count uses `perLead` (`COALESCE(leadId, id)`), so a GDPR-erased lead's events still count once each.
  - **Campaign filters.** Status active = not DRAFT/COMPLETED/ARCHIVED; completed = COMPLETED/ARCHIVED. `campaignTag`; campaign `ownerId`. These filters drop events that have no campaign.
  - PS-ANALYTICS-14 "combined score" = the D34 health score.
  - **Dashboard capacity.** Remaining = `min(Σ account remainingToday, dailyCap − (workspace sent + reserved))` when `dailyCap` is set (Rev 2 M14).

## Fixed names (every later task and phase relies on these)

| Thing | Value |
|---|---|
| Enums | T01a `StageKind OPEN\|WON\|LOST`; `EventType` + `OPPORTUNITY`, `MEETING`, `DEAL_WON`, `DEAL_LOST`. T01b `TaskStatus OPEN\|DONE\|AWAITING_APPROVAL` |
| `Workspace` + | T01a `currency String @default("USD")`, `crmAutoOpportunity Boolean @default(true)` (both in the `settings.ts` patch, ADMIN) |
| New tables | T01a `PipelineStage(id, workspaceId (cascade), name, position Int, kind StageKind, interestCodes Int[], createdAt; @@unique[workspaceId,name], @@index[workspaceId,position])`; `Opportunity(id, workspaceId (cascade), leadId (FK Lead cascade), campaignId String? (no FK, campaigns are soft-deleted), stageId (FK Restrict), title, value Decimal(14,2) @default(0), cashCollected Decimal(14,2) @default(0), expectedCloseAt DateTime?, ownerId String?, closedAt DateTime?, stepId String?, variantId String?, accountId String?, createdAt, updatedAt; @@index[workspaceId,stageId], @@index[workspaceId,createdAt], @@index[workspaceId,closedAt])` + raw `CREATE UNIQUE INDEX "Opportunity_leadId_campaignId_key" ON "Opportunity"("leadId","campaignId") NULLS NOT DISTINCT`. T01b `Task(id, workspaceId (cascade), title, body String?, dueAt DateTime?, assigneeId String?, status TaskStatus @default(OPEN), leadId String? (FK cascade), opportunityId String? (FK cascade), createdById String?, completedAt DateTime?, createdAt, updatedAt; @@index[workspaceId,status,dueAt])`; `Note` + `kind String @default("note")` |
| Advisory locks | none new (stage seeding relies on the unique index; deal moves use row locks; every write is conditional) |
| Routes (`apps/web/app/api/v1/…`) | T01a `crm/stages/route.ts` (GET; POST ADMIN), `crm/stages/[id]/route.ts` (PATCH, DELETE `?moveTo=` ADMIN), `crm/opportunities/route.ts` (GET, POST), `crm/opportunities/[id]/route.ts` (GET, PATCH, DELETE). T01b `crm/tasks/route.ts` (GET, POST), `crm/tasks/[id]/route.ts` (PATCH, DELETE), `crm/activity/route.ts` (GET). T03 `analytics/route.ts` (GET, `format=csv`), `analytics/accounts/route.ts`, `analytics/bounces/route.ts`, `analytics/crm/route.ts`, `analytics/activity/route.ts` (CSV), `dashboard/route.ts` (Rev 2 M15) |
| Scopes | `crm:read` / `crm:write` (T01a adds `"crm"` to `API_SCOPES`); `analytics:read` (exists) |
| Audit actions | `stage.create`, `stage.update`, `stage.delete`, `opportunity.create`, `opportunity.update`, `opportunity.stage`, `opportunity.delete`, `crm.hook_failed`, `task.create`, `task.update`, `task.delete` |
| Pages | `apps/web/app/(app)/crm/page.tsx` (tabs Opportunities, Tasks, Activity, Leads → `/leads`), `analytics/page.tsx`, `dashboard/page.tsx`; `lib/nav.ts` `arrives` text removed for the three |

Core signatures (exact; `Db = PrismaClient | Prisma.TransactionClient`, `Tx = Prisma.TransactionClient`, `Actor = string | null | undefined`):

```ts
// crm/stages.ts (T01a)
export function ensureStages(db: Db, ws: string): Promise<PipelineStage[]>; // seeds only when zero stages; ordered by position
export function createStage(prisma: PrismaClient, ws: string, actor: Actor, input: unknown): Promise<PipelineStage>; // {name, kind, interestCodes?}
export function updateStage(prisma: PrismaClient, ws: string, actor: Actor, id: string, input: unknown): Promise<PipelineStage[]>; // {name?, position?, kind?, interestCodes?}; renumbers 0..n-1 under FOR NO KEY UPDATE of the workspace's stages
export function deleteStage(prisma: PrismaClient, ws: string, actor: Actor, id: string, moveTo?: string): Promise<{ moved: number }>; // FOR NO KEY UPDATE, move deals (row-locked), then DELETE; 23503 → 409 stage_not_empty
// crm/opportunities.ts (T01a)
export type Attribution = { campaignId: string | null; stepId: string | null; variantId: string | null; accountId: string | null };
export function lastSends(tx: Tx, ws: string, leadIds: string[], campaignId?: string | null): Promise<Map<string, Attribution>>; // one DISTINCT ON ("leadId") query
export type InterestChange = { leadId: string; from: number | null; to: number | null };
export function onInterestChange(tx: Tx, clock: Clock, ws: string, actor: Actor, changes: InterestChange[], o: { source: "reply" | "manual"; campaignId?: string | null; scheduledMessageId?: string | null }): Promise<void>; // stages loaded once per call (Rev 2 M2)
export function inSavepoint(tx: Tx, name: string, fn: () => Promise<void>, onError: (code: string) => Promise<void>): Promise<void>; // retryable codes re-thrown
export const opportunityQuery: z.ZodType; // campaignId, listId, ownerId, stageId, from, to (createdAt), q (email or domain contains), take ≤ 200, cursor
export function listOpportunities(db: Db, ws: string, q: unknown): Promise<{ opportunities: ApiOpportunity[]; nextCursor: string | null }>;
export function pipelineBoard(db: Db, ws: string, q: unknown): Promise<{ currency: string; stages: { id: string; name: string; kind: StageKind; count: number; value: string; opportunities: ApiOpportunity[]; more: boolean }[] }>; // ≤ 200 cards per stage, `shortcut:` comment
export function createOpportunity(prisma: PrismaClient, clock: Clock, ws: string, actor: Actor, input: unknown): Promise<ApiOpportunity>; // {leadId, campaignId?, stageId?, title?, value?, cashCollected?, expectedCloseAt?, ownerId?}; 409 opportunity_exists
export function updateOpportunity(prisma: PrismaClient, clock: Clock, ws: string, actor: Actor, id: string, input: unknown): Promise<ApiOpportunity>;
export function deleteOpportunity(prisma: PrismaClient, ws: string, actor: Actor, id: string): Promise<void>;
export type ApiOpportunity = { id: string; lead: { id: string; email: string; companyName: string | null }; campaign: { id: string; name: string } | null; stageId: string; title: string; value: string; cashCollected: string; expectedCloseAt: Date | null; ownerId: string | null; closedAt: Date | null; stepId: string | null; variantId: string | null; accountId: string | null; createdAt: Date };
// crm/tasks.ts (T01b)
export type ApiTask = Pick<Task, "id" | "title" | "body" | "dueAt" | "assigneeId" | "status" | "leadId" | "opportunityId" | "completedAt" | "createdAt"> & { lead: { id: string; email: string } | null };
export function listTasks(db: Db, ws: string, q: unknown, now: Date): Promise<ApiTask[]>; // status, assigneeId, leadId, opportunityId, due: "overdue"|"today"|"upcoming"
export function createTask(prisma: PrismaClient, clock: Clock, ws: string, actor: Actor, input: unknown): Promise<ApiTask>;
export function updateTask(prisma: PrismaClient, clock: Clock, ws: string, actor: Actor, id: string, input: unknown): Promise<ApiTask>; // DONE sets completedAt, OPEN clears it
export function deleteTask(prisma: PrismaClient, ws: string, actor: Actor, id: string): Promise<void>;
// crm/activity.ts (T01b)
export type ActivityItem = { id: string; at: Date; kind: "note" | "call" | "sms" | "meeting" | "reply" | "stage" | "opportunity" | "task"; actorId: string | null; leadId: string | null; opportunityId: string | null; detail: Record<string, unknown> };
export function crmActivity(db: Db, ws: string, q: { leadId?: string; opportunityId?: string; cursor?: string; take?: number }): Promise<{ items: ActivityItem[]; nextCursor: string | null }>;
// analytics/query.ts (T03)
export const analyticsQuery: z.ZodType<AnalyticsQuery>; // from, to (YYYY-MM-DD), tz (default "UTC"), campaignIds, accountIds (comma lists, ≤ 100), campaignTag, ownerId, status "active"|"completed", esp, listId, tag, customKey, customValue, includeAutoReplies, replyBase "contacted"|"sent", groupBy "none"|"campaign"|"account"|"step"|"variant"|"day"|"esp"
export function eventScope(ws: string, q: AnalyticsQuery): Prisma.Sql; // WHERE fragment over Event e / Lead l / Campaign c / ScheduledMessage sm, includes TARGETED_SQL and the SQL range bounds
// analytics/metrics.ts (T03)
export type Metrics = { sent: number; contacted: number; newLeadsContacted: number; rateBase: number; opened: number; opens: number; machineOpens: number; clicked: number; clicks: number; clickedSends: number; replied: number; replies: number; autoReplies: number; hardBounced: number; softBounced: number; unknownBounced: number; unsubscribed: number; complaints: number; completed: number | null; meetings: number; opportunities: number; opportunityValue: string; won: number; wonValue: string; cashCollected: string; rates: { open: number | null; click: number | null; reply: number | null; positiveReply: number | null; bounce: number | null } };
export function analytics(db: Db, ws: string, q: AnalyticsQuery): Promise<{ total: Metrics; rows: (Metrics & { key: string; label: string })[] }>; // day rows zero-filled
// analytics/crm-report.ts (T03)
export function crmReport(db: Db, ws: string, q: AnalyticsQuery): Promise<{ currency: string; pipelineValue: string; openCount: number; avgDealSize: string | null; wonValue: string; cashCollected: string; annualizedClosed: string; revenuePerLead: string | null; conversionByStage: { stageId: string; name: string; count: number; reachedPct: number | null }[]; revenueByCampaign: { campaignId: string | null; name: string; won: number; cashCollected: string }[] }>;
// analytics/accounts.ts (T03)
export function accountAnalytics(db: Db, ws: string, q: AnalyticsQuery, now: Date): Promise<{ id: string; email: string; sent: number; contacted: number; opened: number; replied: number; replyRate: number | null; healthScore: number | null; trend: { day: string; score: number }[]; remainingToday: number }[]>;
export function bounceBreakdown(db: Db, ws: string, q: AnalyticsQuery): Promise<{ hard: number; soft: number; unknown: number; reasons: { type: "BOUNCE_HARD" | "BOUNCE_SOFT" | "BOUNCE_UNKNOWN" | "SEND_FAILED"; reason: string; count: number }[] }>; // top 20 reasons
// analytics/dashboard.ts, analytics/export.ts (T03, Rev 2 M15)
export function dashboardSummary(prisma: PrismaClient, ws: string, now: Date): Promise<{ sentToday: number; allowanceToday: number; remainingToday: number; workspaceCap: number | null; campaigns: Awaited<ReturnType<typeof campaignOverview>>; rates7d: Metrics["rates"]; accounts: { id: string; email: string; displayStatus: string; healthScore: number | null }[]; tasksDue: ApiTask[]; remindersDue: number }>;
export function exportActivityCsv(db: Db, ws: string, q: AnalyticsQuery): AsyncIterable<string>; // date, action, lead_email, account, campaign, step, variant, link, flags; keyset (occurredAt, id) 500 per page
export function metricsCsv(r: Awaited<ReturnType<typeof analytics>>): string;
```

## Review Focus (riskiest inputs no acceptance test covers; each has a test in its owning task)

1. **Ingest must survive the CRM step** (T01a `crm step never blocks ingest`, `one opportunity under races`).
   - *Inputs:* a positive reply for a lead whose `plValue` is huge; the reply's stage deleted mid-ingest; a manual POST racing the ingest; a forced CRM error; the same reply in two mailboxes.
   - *Expected:* the message, its stops and Events commit and the watermark advances; at most one deal per `(lead, campaign)`; no retry loop.
2. **Exact counts with noise present** (T03 `exact fixture`; e2e `analytics.test.ts`).
   - *Inputs:* warm-up, placement, inbox replies, test-sends, a DSN or ARF that matched no send, forged repeat bounces, machine opens, a second campaign, an event outside the range, and the events of a GDPR-erased lead.
   - *Expected:* every metric equals the hand count, and placement lowers capacity.
3. **Timezones, bad queries, deleted step 1** (T03 `day buckets follow tz`, `query validation`, `step 1 deleted`).
   - *Inputs:* an event at 23:30 UTC with `tz=Asia/Tokyo`; events at 00:30 and 23:30 local on the New York DST day; `to < from`; more than 400 days; an unknown `tz`; step 1 deleted with later step-2 sends.
   - *Expected:* the right bucket, 400 for bad input, and no false "contacted".
4. **Stage edits under concurrency** (T01a `stage rules`, `stage locks`).
   - *Inputs:* a stage deleted while a deal moves out of it; the last WON stage deleted; overlapping interest codes; a kind change on a stage that holds deals; a `moveTo` of another kind.
   - *Expected:* no deadlock and no 500; 409/400 for the invalid calls; positions stay 0..n-1.
5. **Deal state is counted once** (T01a `stage moves are serialized`, `reopen and merge`, `status never un-wins`; T03 `reopened deal counted once`).
   - *Inputs:* two users win the same deal at once; a deal goes Won → Negotiation → Won; a won deal gets "Meeting booked"; two leads that each have a deal in one campaign are merged.
   - *Expected:* one DEAL_WON per transition; revenue counted once; a won deal stays won; the merge returns 409.

## Task order, splits and parallelism

**Split:** P6-T01 becomes **P6-T01a** (pipeline, opportunities, the interest hook, revenue fields, CRM events) and **P6-T01b** (tasks, reminders, logged calls, activity feed, lead timeline).
- **Why:** T01a writes inside the reply-ingest transaction and needs opus with an opus reviewer, while T01b is plain CRUD. A reviewer can reject either one independently.
- **`docs/TASKS.json`:** P6-T01a (deps P5-T08), P6-T01b (deps P6-T01a), P6-T02 (deps P6-T01b), P6-T03 (deps P6-T02), P6-T04 (deps P6-T03).

**Order (strictly sequential, controller ruling on M16):** T01a → T01b → T02 → T03 → T04. No parallel implementers.
- T01a and T01b are the only tasks that change `schema.prisma` and migrations.
- T02 and T03 have disjoint files but share the build, typecheck and lint of the whole app, so they also run one after the other.

---

## P6-T01a Pipeline stages, opportunities, interest hook, revenue fields

Model: **opus** (savepoint inside `applyInbound`, row and stage locks, uniqueness under races), with an opus reviewer.
**Owns:** PS-CRM-02, -03, -05 (record), -06 (API filters), -07, -10 (value, cash, attribution), -13 (stage history), -14 (rows that analytics reads live); PS-TRACK-01 (meeting/opportunity/deal events, positive/negative via INTEREST_CHANGED), PS-TRACK-11; PS-LEAD-04 (opportunity side effect); D40.

Files:
- **Schema:** schema + migration `20261103000000_crm` (enums, `PipelineStage`, `Opportunity`, the NULLS NOT DISTINCT index, the Workspace columns).
- **New core:** `packages/core/src/crm/stages.ts`, `crm/opportunities.ts`, `src/index.ts` exports.
- **`packages/core/src/leads/service.ts`:**
  - export `assertMembers`;
  - `plValue` `.max(1e12)`;
  - `updateLead` and `bulkLeads` `set_interest` call `onInterestChange(…, { source: "manual" })` once per request, after the Lead write, with all changed leads;
  - `mergeLeads` repoints `Opportunity` after the Lead locks and returns 409 `opportunity_conflict` on a clash.
- **`packages/core/src/campaigns/schema.ts`:** `plValue` `.max(1e12)`.
- **`packages/core/src/mail/stoprules.ts`:** in `applyInbound`, after the REPLY `recordEvent` and the twin check, when the reply was fresh and set an interest: `inSavepoint(tx, "crm_hook", () => onInterestChange(tx, clock, ws, null, [{ leadId, from: null, to: interest }], { source: "reply", campaignId: match.campaignId, scheduledMessageId: sm?.id }), code => audit(… "crm.hook_failed" …))`.
- **Other code:** `packages/core/src/settings.ts` (`currency` `^[A-Z]{3}$` with the `currency_in_use` check, `crmAutoOpportunity`); `packages/core/src/apikeys.ts` (`"crm"`); routes in Fixed names (route errors carry `campaignId` for `opportunity_conflict`).
- **Docs:** `docs/DECISIONS.md` (D40, plus a D21 sentence: Opportunity/Task are leaf writes; PipelineStage is locked `FOR NO KEY UPDATE` only; the CRM step in ingest runs after the Events in a savepoint).
- **Tests:** `packages/core/test/crm.test.ts`, `apps/web/test/crm-api.test.ts`.

- [ ] Write the failing tests (`crm.test.ts`):
  - **`default stages`:**
    - `ensureStages` on a fresh workspace gives the 9 D40 names in order with positions 0–8, their kinds and their interest codes.
    - Two concurrent calls still give 9 rows.
    - After "Replied" is renamed "Responded", another call adds nothing.
  - **`stage rules` (Review Focus 4)** (each case is an error, with nothing changed):

    | Call | Result |
    |---|---|
    | code 1 on a second stage | 400 `interest_code_taken` |
    | delete the only WON stage | 409 `last_stage_of_kind` |
    | delete a stage with 2 deals, no `moveTo` | 409 `stage_not_empty` |
    | `moveTo` into a WON stage from an OPEN one | 400 `move_kind_mismatch` |
    | `kind` change on a stage with deals | 409 `stage_not_empty` |
    | a 21st stage | 400 |

    - The valid calls: a same-kind `moveTo` gives `{moved: 2}`; moving position 8 to 0 leaves positions 0..8 with no gaps.
    - Cross-workspace ids (M3): another workspace's stage as `stageId` or `moveTo` gives 404; another workspace's `campaignId` gives 400.
  - **`stage locks` (Rev 2 I1):** `deleteStage(S, moveTo T)` runs concurrently with `updateOpportunity` moving a deal out of S into U. Both finish with no 500 and the deal ends in U. A deal inserted into S during the delete gives 409 `stage_not_empty`.
  - **`stage moves are serialized` (Rev 2 I2):** two concurrent PATCHes of one deal to Closed Won give one `DEAL_WON` Event and one `opportunity.stage` audit row; the second PATCH is a no-op.
  - **`interest creates and moves`:** a lead with one ACCEPTED in campaign C (S1, variant A, account X) and `plValue` 250.
    - `updateLead {1}` creates one deal in Interested with attribution `{C, S1, A, X}`, value `"250.00"`, an `OPPORTUNITY` Event carrying the same attribution, and `INTEREST_CHANGED {from:null, to:1, source:"manual"}`.
    - Then `{2}` moves it to Meeting Scheduled, records one `MEETING` Event with C/S1/A/X, and writes audit `opportunity.stage {leadId, from, to}` (no title in meta).
    - Then `{4}` moves it to Won, sets `closedAt` and records `DEAL_WON`.
    - Separately: `crmAutoOpportunity false` with `{1}` on a new lead creates nothing; `{0}`, `{-2}` and `null` touch no deal.
  - **`status targets the right deal` (Rev 2 I4):** a lead with a deal in campaign A and a later send from campaign B. `updateLead {2}` moves the A deal, and no B deal is created.
  - **`status never un-wins` (Rev 2 I4):** a deal dragged to Won, then `updateLead {2}`. The deal stays Won and `closedAt` is unchanged; `{-3}` then moves it to Closed Lost.
  - **`reply creates opportunity` (Rev 2 M4):** an INTERESTED reply through `applyInbound` to the lead's step-1 send in C, after a step-2 send in C. The deal is attributed to the step-1 send. A reply when the interest is already set creates none.
  - **`crm step never blocks ingest`** (Rev 2 C1, Review Focus 1; one test per trigger):
    1. A lead with `plValue` 1e13 (seeded directly) gets an INTERESTED reply. The message is stored, the watermark advances, and the deal has value `"0.00"`.
    2. `deleteStage(Interested, moveTo Replied)` runs concurrently with that ingest. Ingest commits with no retry loop, and the deal is in Replied or the step is skipped.
    3. `POST /crm/opportunities` for the same lead and campaign runs concurrently with the ingest. There is one row and ingest commits.
    4. A test-only trigger `RAISE EXCEPTION` on `INSERT INTO "Opportunity"`. The message is still stored, its REPLY Event, stop and watermark commit, and one `crm.hook_failed` audit row is written.
    5. A losing D26 twin never runs the step.
    - Also: `updateLead` with `plValue 1e13` returns 400.
  - **`one opportunity under races` (Rev 2 I8):**
    - The same INTERESTED reply is ingested from two mailboxes concurrently, as in the D26 twin test. There is 1 deal and 1 `OPPORTUNITY` Event.
    - Two concurrent `updateLead {2}` for one lead give 1 `MEETING` Event.
    - A lead with no send gets two concurrent `updateLead {1}`. There is 1 deal with `campaignId null` and no error.
  - **`reopen and merge` (Review Focus 5, M9, M12):**
    - Won → Negotiation clears `closedAt`. Won again sets a new `closedAt`, gives two `DEAL_WON` Events with distinct keys, and still one row.
    - A `cashCollected` edit after the win writes an `opportunity.update` audit row with amounts only.
    - Merging two leads with deals in campaign C returns 409 `opportunity_conflict` and changes nothing. A merge without a clash repoints the deals.
    - `gdprDeleteLead` removes the lead's deals.
    - A currency change returns 409 `currency_in_use` while a deal has a non-zero value.
  - **`filters`:**
    - `listOpportunities` by campaignId, listId, ownerId, stageId, `from`/`to` and `q` (`acme.io` matches by domain and by email) returns exactly the expected ids.
    - `pipelineBoard` column `count` and `value` sums are exact (`"1250.00"`).
    - A soft-deleted lead's deal is not on the board.
    - `bulkLeads set_interest` on 200 leads stays within the existing bulk statement budget (M2: stages and `lastSends` loaded once).
  - **`crm-api.test.ts`:**
    - `expectIsolated` on every route.
    - MEMBER and API keys get 403 on stage POST/PATCH/DELETE. A `crm:read` key gets 200 on GET and 403 on POST.
    - Value `-1` or `1e13` gives 400. POST for an existing `(lead, campaign)` gives 409 `opportunity_exists`. An unknown `ownerId` gives 400.
    - Settings PATCH with `currency "usd"` gives 400. Merge gives 409 with `{error, campaignId}`.
- [ ] Run → FAIL. Implement. Run `npx vitest run packages/core/test/crm.test.ts apps/web/test/crm-api.test.ts` → PASS, then the full checks (the existing `stoprules`, `leads`, `reply-sync` and `sync` suites must stay green).
- [ ] Commit `feat(crm): pipeline stages, opportunities, interest-to-stage hook and revenue fields`.

## P6-T01b Tasks, reminders, logged activity, lead timeline

Model: sonnet.
**Owns:** PS-CRM-01 (Tasks and Activity backends), PS-CRM-05 (tasks, reminders, notes, history), PS-CRM-08, PS-LEAD-19 (notes and tasks in the timeline); D41.

Files:
- **Schema:** schema + migration `20261104000000_tasks` (`TaskStatus`, `Task`, `Note.kind`).
- **New core:** `packages/core/src/crm/tasks.ts`, `crm/activity.ts`, `src/index.ts`.
- **Changed core:**
  - `packages/core/src/mail/inbox-library.ts`: `noteInput` + `kind: z.enum(["note","call","sms","meeting"]).default("note")`.
  - `packages/core/src/leads/timeline.ts`: kinds `note`, `task`, `opportunity`, from the lead's Notes, Tasks and the `opportunity.*` audit rows with `meta.leadId`.
  - `packages/core/src/leads/service.ts`: `mergeLeads` repoints Tasks.
- **Routes:** as in Fixed names. Task title 1–200, body ≤ 10 000, `assigneeId` through `assertMembers`, and `leadId`/`opportunityId` must exist in the workspace.
- **Docs:** `docs/DECISIONS.md` (D41).
- **Tests:** `packages/core/test/tasks.test.ts`, `apps/web/test/tasks-api.test.ts`, and additions to `timeline.test.ts`.

- [ ] Write the failing tests:
  - **`tasks.test.ts` `due filters`:** clock at 2026-11-05 10:00, workspace tz `Europe/Berlin`. Tasks due 11-04 (overdue), 11-05 18:00 (today) and 11-06 (upcoming), plus one DONE overdue task.
    - `due=overdue` returns [first], `today` [second], `upcoming` [third].
    - A DONE task is never in a due list.
  - **`complete and reopen`:**
    - PATCH `status DONE` sets `completedAt` to now and writes audit `task.update {status}`. Back to OPEN sets `completedAt null`.
    - An `AWAITING_APPROVAL` task is listed only under `status=AWAITING_APPROVAL`. Approving it (OPEN) puts it in the due lists.
  - **`activity feed`:** a lead with a note, a `call` note, an INTERESTED reply Event, a deal created and moved, and a task done.
    - `crmActivity({leadId})` returns newest first, with kinds `[task, stage, opportunity, reply, call, note]`.
    - The `stage` item carries `actorId` and the `{from, to}` names.
    - `take 2` with the cursor pages without duplicates.
    - `opportunityId` scopes the feed to that deal.
    - After the deal is deleted, its history still shows in the lead feed (Rev 2 M10).
  - **`timeline.test.ts` `notes, tasks and deals`:** `leadTimeline` contains `note`, `task` and `opportunity` entries.
  - **`cascade`:** `gdprDeleteLead` removes the lead's tasks. Deleting a deal removes its tasks.
  - **`tasks-api.test.ts`:**
    - Isolation on every route.
    - A VIEWER POST gives 403.
    - An `assigneeId` that is not a member gives 400 `unknown_owner`. An `opportunityId` from another workspace gives 404.
    - A note POST with `kind "fax"` gives 400.
- [ ] Run → FAIL. Implement. Run `npx vitest run packages/core/test/tasks.test.ts packages/core/test/timeline.test.ts apps/web/test/tasks-api.test.ts` → PASS, then the full checks.
- [ ] Commit `feat(crm): tasks, reminders, logged calls and the activity history`.

## P6-T02 CRM UI (accessible Kanban, opportunity drawer, tasks)

Model: sonnet.
**Owns:** PS-CRM-01 (UI), PS-CRM-04, PS-CRM-05/06/08 (UI), PS-CRM-09, PS-CRM-10 (entry); E2E rows 12, 13.
- PS-CRM-09 is met by the existing `/leads` view, which the CRM Leads tab opens. Since P3 it filters by campaign, list, status and owner, creates and imports leads, shows custom fields, downloads selected leads and assigns them round-robin.

Files:
- **`apps/web/app/(app)/crm/page.tsx`:** server page; `ensureStages` plus the first board; replaces the EmptyState.
- **`crm/board.tsx`:** columns with count and an `Intl.NumberFormat` currency total.
  - Cards are `draggable`, with `onDragStart`/`onDrop` sending PATCH `stageId`, optimistic with rollback on error. A 404 (stage just deleted) reloads the board.
  - Each card has a labelled "Stage" `<select>` as the keyboard path.
  - An `aria-live="polite"` region announces "Moved {title} to {stage}".
- **`crm/filters.tsx`:** campaign, list, owner, stage, created from/to and search, all kept in the URL query.
- **`crm/opportunity-drawer.tsx`:**
  - Fields: title, stage, value, cash collected, expected close and owner.
  - Attribution line: "From {campaign} · step {n} · variant {label} · {account}".
  - Lead notes, with "Log call / SMS / meeting" through the notes API `kind`.
  - Tasks, with add and complete.
  - Activity from `crm/activity`.
  - A "New opportunity" form with a lead picker using `GET /api/v1/leads?q=`.
- **`crm/tasks-tab.tsx`:** status and due filters, assignee, and approve for AWAITING_APPROVAL.
- **`crm/activity-tab.tsx`.**
- **`crm/stage-settings.tsx`** (ADMIN only):
  - add and rename stages; reorder with up/down buttons;
  - kind, disabled while the stage holds deals;
  - interest codes, using the `INTEREST` labels from `leads/labels.ts`;
  - delete with a required "Move deals to" select that lists only stages of the same kind;
  - the currency setting (disabled with the `currency_in_use` reason) and the "Create opportunities from positive statuses" setting.
- **`lib/nav.ts`:** drop the CRM `arrives`.
- **e2e:** `apps/web/e2e/crm.spec.ts`, `apps/web/e2e/crm-revenue.spec.ts`.

- [ ] Write the failing specs:
  - **`crm.spec.ts` (E2E #12):** a seeded lead with one ACCEPTED send in campaign "CRM E2E".
    - Setting its interest to "Interested" in the lead drawer puts the card on the CRM board in "Interested", with the campaign attribution.
    - Moving it to "Meeting Scheduled" with the card's Stage select (keyboard only) is announced by the live region and survives a reload.
    - Dragging a second, manual opportunity to "Proposal Sent" moves it.
    - A task "Send proposal" due today, added in the drawer, appears under Tasks "Due today"; completing it removes it from the list.
    - The Activity tab shows "Interested → Meeting Scheduled" with the user's name.
    - The Leads tab links to `/leads`.
  - **`crm-revenue.spec.ts` (E2E #13):**
    - Open a deal, set value 5000 and an expected close date, move it to "Closed Won" and enter cash collected 4500. The "Closed Won" column total reads `$5,000.00`, the drawer shows the closed date, and the values survive a reload.
    - Typing `-5` shows a field error and saves nothing.
    - As ADMIN: rename "Negotiation"; delete "Proposal Sent" moving its deals to "Contacted" (the move list offers no WON/LOST stage), and the card then shows in "Contacted".
- [ ] Run → FAIL. Implement. Run `E2E_PROD=1 npm run e2e -- crm` from `apps/web` → PASS, then the full checks.
- [ ] Commit `feat(crm): pipeline board, opportunity drawer, tasks and activity UI`.

## P6-T03 Analytics, dashboard and export queries (campaign/account/variant/step/segment/date; capacity; revenue; conversion; exact fixtures)

Model: **opus** (aggregation correctness, D34 reuse, timezone buckets), with an opus reviewer.
**Owns:** PS-TRACK-10, PS-ANALYTICS-01 (API filters), -02..-14 (computed), -16 (export queries), -17, -18 (denominators and `rateBase` returned), PS-SEQ-21 (data), PS-CRM-11, PS-UI-04 (data), PS-UI-07 (tz bucketing); E2E row 14; D42.

Files:
- **Core:** `packages/core/src/analytics/query.ts`, `metrics.ts`, `crm-report.ts`, `accounts.ts` (`remainingToday` from `listAccounts`, the trend from `HealthSnapshot` over 30 days), `dashboard.ts`, `export.ts`, `src/index.ts`.
- **Routes:** as in Fixed names: `route({ auth: "session-or-apikey", scope: "analytics:read", query: analyticsQuery })`; `format=csv` → `csvResponse(metricsCsv)`; `analytics/activity` → `csvResponse(exportActivityCsv(...), "activity.csv")`.
- **Docs:** `docs/DECISIONS.md` (D42).
- **Tests:** `packages/core/test/analytics.test.ts`, `packages/core/test/dashboard.test.ts`, `packages/core/test/analytics-export.test.ts`, `packages/core/test/e2e/analytics.test.ts`, `apps/web/test/analytics-api.test.ts`.

How `analytics` builds its numbers:
- **Event statement.** `WITH firsts AS (SELECT "leadId", "campaignId", min("occurredAt") … WHERE type='ACCEPTED' GROUP BY 1,2) SELECT <key>, … FROM "Event" e LEFT JOIN "ScheduledMessage" sm … LEFT JOIN "Lead" l … LEFT JOIN "Campaign" c … WHERE ${eventScope} GROUP BY GROUPING SETS ((<key>), ())`.
- **Opportunity statement.** `Opportunity` grouped the same way: day = `createdAt` for opportunities and `closedAt` for won; step, variant and account from the attribution columns.
- **`completed`.** One more statement, for the none, campaign, day and ESP views.
- **Keys.**
  - Day = `(e."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date`.
  - Account = `COALESCE(sm."accountId", e."accountId")`.
  - Labels: one lookup per entity.
- **Filters only.** List, tag and custom-field values filter but never group, because a lead can be in many lists and tags.

- [ ] Write the failing tests:
  - **`analytics.test.ts` `exact fixture`** (Review Focus 2, Rev 2 I5/I7/I8/M5): direct inserts.
    - **Campaign C**, on 2026-11-02 UTC:
      - Setup: steps S1 (variants A, B) and S2 (A); accounts X and Y; leads L1 (GOOGLE, list K, tag `vip`) and L2–L5 (MICROSOFT).
      - ACCEPTED: L1·S1A·X, L2·S1B·X, L3·S1A·Y, L4·S1B·Y, L1·S2A·X.
      - OPEN: L1 ×2 human, L2 machine. CLICK: L1 human, L3 scanner.
      - REPLY: L1 (to its S2A send), and L3 (to its S1A send, received in X's mailbox, so `e.accountId` = X). AUTO_REPLY: L4.
      - BOUNCE_HARD: L2 ×2 (targeted), and L4 untargeted (`scheduledMessageId null`). BOUNCE_SOFT: L4, targeted at its S1B send. SEND_FAILED: L5 with `scope recipient`.
      - COMPLAINT: L3 ×2 (targeted), plus one untargeted. UNSUBSCRIBE: L3. MEETING: L1, attributed S2A·X.
      - Opportunities: L1 WON (value 1000, cash 800, attributed S2A·X); L3 Interested (value 500, attributed S1A·Y).
    - **Campaign C2:** ACCEPTED L1 on 2026-11-01 (outside the range) and L2 on 2026-11-02.
    - **With `campaignIds=[C]`, range 11-02:**
      - Counts: sent 5, contacted 4, newLeadsContacted 3 (L1 was first mailed on 11-01), opened 1, opens 2, machineOpens 1, clicked 1, clickedSends 1.
      - Replies and bounces: replied 2, autoReplies 1 (`includeAutoReplies` gives 3), hardBounced 2, softBounced 1, unknownBounced 0, complaints 1, unsubscribed 1.
      - CRM: meetings 1, opportunities 2 (`"1500.00"`), won 1, cashCollected `"800.00"`.
      - Rates: open 0.25, click 0.2, reply 0.5 (`replyBase=sent` gives 0.4), positiveReply 1, bounce 0.4.
    - **`groupBy=variant`:**

      | Variant | sent | rateBase | replied | reply rate | meetings |
      |---|---|---|---|---|---|
      | S1A | 2 | 2 | 1 | 0.5 | 0 |
      | S1B | 2 | 2 | 0 | 0 | 0 |
      | S2A | 1 | 1 | 1 | 1.0 | 1 |

    - **`groupBy=account`:** X sent 3, replied 1 (L1); Y sent 2, replied 1 (L3, credited to the sender).
    - **Segments:** `esp=GOOGLE` gives sent 2, contacted 1; `listId=K` and `tag=vip` give the same.
    - **Unfiltered:** sent 6, contacted 4 (L2 counted once across C and C2), newLeadsContacted 3.
  - **`GDPR-erased lead`:** with `leadId = null` on L3's events, replied is still 2 and unsubscribed still 1.
  - **`day buckets follow tz` (Review Focus 3, M6):**
    - ACCEPTED at 2026-11-02T23:30Z: `groupBy=day` in UTC gives day `2026-11-02`, in `Asia/Tokyo` day `2026-11-03`.
    - `from=to=2026-11-02` with `tz=Asia/Tokyo` excludes it.
    - In `America/New_York`, events at 00:30 and 23:30 local on 2026-11-01 (DST end) both land in `2026-11-01`.
    - A 7-day range across that date has 7 zero-filled rows.
  - **`query validation` (Review Focus 3):** `to < from`, 401 days, `tz=Mars/Base`, a zone Postgres rejects (22023), 101 campaign ids and `groupBy=list` each give 400 via `AccountError`.
  - **`step 1 deleted` (Rev 2 I6):** soft-delete S1 and settle, then send S2 to L2 on 2026-11-03. `contacted` for range 11-03 is 0; `groupBy=step` labels S1 "Step 1 (deleted)".
  - **`crmReport`** on the fixture:
    - pipelineValue `"500.00"` (current), openCount 1, avgDealSize `"1000.00"`, wonValue `"1000.00"`;
    - annualizedClosed for a 1-day range `"365000.00"`, revenuePerLead `"200.00"`;
    - conversionByStage `reachedPct`: Interested 1.0, Closed Won 0.5, Closed Lost 0;
    - revenueByCampaign `[{C, won 1, "800.00"}]`.
  - **`reopened deal counted once` (Review Focus 5):** move L1's deal Won → Negotiation → Won, with `closedAt` inside the range. Won is still 1 and cash `"800.00"`.
  - **`filters by campaign fields`:** `status=completed` while C is ACTIVE gives all zeros, as do `campaignTag`, `ownerId` and `campaignIds=[other]`. A REPLY with no campaign never counts in `replied` (M8).
  - **`bounceBreakdown`:** hard 2, soft 1, unknown 0, and the reasons grouped by `meta.reason` with counts.
  - **`query count`:** `analytics` with `groupBy=variant` runs ≤ 4 statements (Prisma query event counter, as in `overview.test.ts`).
  - **`dashboard.test.ts` (M14):**
    - Two live accounts (allowance 30 and 20; usage 5 sent + 1 reserved, and 0) plus a soft-deleted one give `sentToday 5`, `allowanceToday 50`, `remainingToday 44`.
    - With `dailyCap 40` and workspace usage 6, `remainingToday` is 34.
    - Only ACTIVE-family campaigns are listed.
    - `tasksDue` holds only the overdue and today OPEN tasks (≤ 10, by due date).
    - `remindersDue` counts threads with `reminderAt ≤ now`.
    - `rates7d` equals `analytics` over the last 7 local days.
  - **`analytics-export.test.ts`:**
    - On the fixture, the activity CSV header is `date,action,lead_email,account,campaign,step,variant,link,flags`.
    - There is one row per Event in range; the untargeted DSN and ARF are excluded, and the machine open is flagged `machine`.
    - A CLICK row carries `meta.url`.
    - 1 200 events stream in three pages with no duplicates.
    - A lead email `=cmd@x.io` is written as `'=cmd@x.io`.
  - **`e2e/analytics.test.ts` (E2E #14; Rev 2 I8, M17; real pipeline on the Fake):**
    - Setup: `seedCampaign` with 3 leads and 2 steps; planner → claim → send step 1 to all 3. Lead 1 replies "Interested" (Fake mailbox + `syncDue`), which creates a deal through T01a. Lead 2 gets a 5.1.1 DSN. Then a `warmupTick` between the two accounts, and a placement test with one seed.
    - `analytics` for C gives sent 3, contacted 3, replied 1, hardBounced 1, opportunities 1, positiveReply 1.
    - `Σ AccountDailyUsage.sent` is exactly 3 + 1. Placement counts toward capacity; warm-up sends never touch usage (D36). No metric changes after the warm-up and placement mail.
  - **`analytics-api.test.ts`:**
    - Isolation on all six routes.
    - An `analytics:read` key gets 200; a `leads:read` key gets 403.
    - `format=csv` returns `text/csv` with a header row and one row per group.
    - A campaign name starting with `=` comes out prefixed by `csvCell`.
- [ ] Run → FAIL. Implement. Run `npx vitest run packages/core/test/analytics.test.ts packages/core/test/dashboard.test.ts packages/core/test/analytics-export.test.ts packages/core/test/e2e/analytics.test.ts apps/web/test/analytics-api.test.ts` → PASS, then the full checks.
- [ ] Commit `feat(analytics): event-based metrics, CRM revenue report, dashboard and export queries`.

## P6-T04 Dashboard + Analytics pages + CSV export (UI)

Model: sonnet. The task is UI only after Rev 2 M15.
**Owns:** PS-UI-04, PS-UI-07 (date range and timezone display), PS-ANALYTICS-01 (UI), -11, -12 (the variant toggle calls the existing variant PATCH `active`), -14 (UI), -15, -16 (download buttons; the optional image share is not built), -18 (tooltips), PS-SEQ-21 (UI), PS-CRM-11 (shown).

Files:
- **`apps/web/package.json`:** `recharts` `3.10.1`, exact; `npm install` updates `package-lock.json`.
- **`apps/web/app/(app)/dashboard/page.tsx`:** tiles for sent today / allowance (with progress), remaining capacity, workspace cap, and the 7-day reply, positive reply and bounce rates, each with its denominator in a `title` tooltip; active campaign progress bars; an account health strip linking to `/accounts`; due tasks and inbox reminders.
- **`apps/web/app/(app)/analytics/page.tsx`:**
  - **`analytics/filters.tsx`:** campaign and account multi-select, campaign tag, owner, status, presets 7/30/90 days and custom, tz "UTC" or the workspace timezone, ESP, list, tag; all in the URL, so a view can be bookmarked.
  - **`analytics/charts.tsx`** (`"use client"` Recharts): volume over time, rates, the funnel sent → replied → positive → meeting → won, A/B bars per variant. A gear menu hides and shows metrics, stored in `localStorage` inside try/catch.
  - **Tables:**
    - campaigns;
    - steps and variants, with the active toggle and the hint "Use at least 3 months of data before pausing a variant";
    - accounts, with the health trend and remaining capacity;
    - the bounce breakdown;
    - the revenue report in the workspace currency, with "Pipeline (current)" and conversion "by current stage" labels.
  - **Downloads:** "Download CSV" on each table, and "Export sending activity".
- **Elsewhere:** the campaign detail page links to `/analytics?campaignIds=<id>`; `lib/nav.ts` drops `arrives` for Dashboard and Analytics.
- **e2e:** `apps/web/e2e/analytics.spec.ts`, `apps/web/e2e/dashboard.spec.ts`.

Copy (exact):
- The tooltip on the Sent tile: "Accepted by the provider (not proof of delivery)".
- Open-rate tiles: "Estimated: pixel-based, machine opens excluded".
- Every rate tooltip: "{numerator} of {denominator} {base}", with `base` from `rateBase`.

- [ ] Write the failing specs:
  - **`analytics.spec.ts`** (events seeded through Prisma, as in `deliverability.spec.ts`):
    - The Sent and Replied tiles equal the API total. The open-rate tile says "Estimated" and its tooltip shows the denominator.
    - The campaign filter plus the 7-day preset updates both the URL and the numbers.
    - The variant table toggle pauses variant B, and the campaign builder shows it inactive.
    - "Download CSV" on the campaigns table downloads a file whose first line is the header.
    - Hiding "Clicked" in the gear menu removes it, and it stays hidden after a reload.
  - **`dashboard.spec.ts`:**
    - The tiles show the seeded sent / allowance and the remaining capacity.
    - A due task appears and links to CRM Tasks.
    - The account strip lists each account's health score.
- [ ] Run → FAIL. Implement. Run `E2E_PROD=1 npm run e2e -- analytics dashboard` from `apps/web` → PASS, then the full checks.
- [ ] Commit `feat(analytics): dashboard, analytics pages, charts and CSV exports`.

---

## Deferred items (each with owner and reason)

- **PS-ANALYTICS-19** webhook delivery analytics → P7-T02 (no webhooks exist yet).
- **PS-CRM-12** a preference to stop storing non-lead mail → P7-T06. It changes the sync ingest path, not CRM data; the inbox already keeps non-lead mail under "Others", which covers the "may store" part.
- **PS-CRM-07** "if automation on" → `crmAutoOpportunity` here. P7-T01 turns it into the default rule "positive reply → create opportunity" (PS-AUTO-04) and removes the setting.
- **PS-CRM-08** producers of AWAITING_APPROVAL tasks (AI suggestions) → P7-T05.
- **PS-CAMP-30** automatic variant pausing → P7-T04; T04 ships the manual toggle.
- Reminder notifications (email or push) → not built; due tasks show on the dashboard and in CRM Tasks (D41).
- Image share of a campaign chart (PS-ANALYTICS-16, optional) → not built.
- The P5 carry-forward "Recharts sparkline" on the deliverability page stays with P7-T08. T04 makes Recharts available but does not touch that page.

## Models

T01a and T03 on **opus**, each with an opus reviewer: T01a writes inside the ingest transaction and must stay unique under races, and T03 carries the aggregation and timezone correctness the user relies on for decisions. T01b, T02 and T04 on sonnet, with sonnet reviewers. `ponytail-review` on every task.

## Coverage self-check

- **CRM:**
  - T01a: 02, 03 (+ T02 settings), 07, 14 (+ T03).
  - T01b: 01 (backend; T02 UI), 08 (+ T02).
  - T02: 04, 09 (the existing `/leads`).
  - Shared: 05 T01a/T01b/T02 · 06 T01a/T02 · 10 T01a/T02 · 11 T03/T04 · 13 T01a (audit) / T01b (feed).
  - Deferred: 12 → P7-T06.
- **ANALYTICS:** 01 T03/T04 · 02–10 T03 · 11–14 T03/T04 · 15 T04 · 16 T03/T04 · 17 T03 · 18 T03/T04 · 19 deferred → P7-T02.
- **Other areas:**
  - **TRACK:** 01 and 11 T01a · 10 T03.
  - **SEQ:** 21 T03/T04.
  - **LEAD:** 04 (opportunity part) T01a · 19 T01b.
  - **UI:** 04 T03/T04 · 07 T03/T04.
- **E2E mapping:** #12 `crm.spec.ts` T02 · #13 `crm-revenue.spec.ts` T02 · #14 `packages/core/test/e2e/analytics.test.ts` T03.
- **Global Constraints:** warm-up and placement exclusion and D34 reuse T03 · D21 extension and the ingest savepoint T01a · scopes and ADMIN routes T01a.

## Phase gate

- Full `npm test`, lint, typecheck, Playwright and CI (`check`, `compose-smoke`, `imap-real`) green.
- An opus whole-branch review, plus `ponytail-audit` by a fresh reviewer.
- Tick the PS items in PRODUCT_SPEC.
- Update PROGRESS, HANDOFF, REVIEW_LOG and DECISIONS (D40–D42).
- Fast-forward `main` and push.

## Revision 2 — changes from review (`docs/plans/phase-6-review.md`; binding on the owning tasks, overrides the text above where they differ)

The text above has already been updated for every row. Where the two differ, the row wins.

| # | Owner | Resolution |
|---|---|---|
| C1 | T01a | **Accepted (controller ruling).**<br>- The CRM step in `applyInbound` runs only for a fresh reply, after the REPLY `recordEvent` and its twin check.<br>- It runs inside `inSavepoint(tx, "crm_hook", …)`. A savepoint is smaller than a post-commit transaction and stays atomic: a crash between commit and a second transaction would silently lose the deal, because a re-sync finds the message already stored.<br>- Retryable codes (P2034, 40P01, 40001) re-throw, so the whole ingest retries. Any other error rolls back to the savepoint, audits `crm.hook_failed {leadId, code}` and lets ingest commit.<br>- Inserts use `ON CONFLICT DO NOTHING`. The stage is read `FOR KEY SHARE`, and a missing stage means skip.<br>- Value is clamped to 0..1e12 (else 0); lead and campaign `plValue` inputs get `.max(1e12)`.<br>- One test per trigger (`crm step never blocks ingest` 1–5): plValue 1e13, concurrent stage delete, concurrent POST, forced exception trigger, losing twin. |
| I1 | T01a | **Accepted.** Stage edits lock `FOR NO KEY UPDATE`; `deleteStage` moves the row-locked deals, then deletes; 23503 → 409 `stage_not_empty`; a PATCH to a deleted stage → 404. D21 sentence added. Test `stage locks`. |
| I2 | T01a | **Accepted.** Every stage change locks the Opportunity `FOR UPDATE` and then computes from/to; a same-stage move is a no-op. Test `stage moves are serialized`. |
| I3 | T01a | **Accepted** (the smallest fix). `kind` change on a stage holding deals → 409 `stage_not_empty`; a cross-kind `moveTo` → 400 `move_kind_mismatch`. Tests in `stage rules`. The T02 settings disable both. |
| I4 | T01a | **Accepted.** Target rules: with a campaign, that campaign's deal; otherwise the most recently updated deal; create only when there is none. A WON/LOST deal moves only to a WON/LOST-mapped code. `null` and unmapped codes do nothing. Tests `status targets the right deal`, `status never un-wins`. |
| I5 | T03 | **Accepted.** `rateBase` per row. The none, campaign and ESP views use contacted; the step, variant, account and day views use the group's unique leads sent (or its sends with `replyBase=sent`). The fixture asserts S1A 0.5 and S2A 1.0. |
| I6 | T03 | **Accepted.** Contacted = leads whose all-time first ACCEPTED per `(lead, campaign)` falls in the range; no step join. Test `step 1 deleted` with a later step-2 send gives contacted 0. |
| I7 | T01a, T03 | **Accepted.** CRM Events copy the opportunity's attribution; the MEETING dedupe key is `meeting:<leadId>:<campaignId ?? "none">`. The fixture asserts S2A meetings 1. |
| I8 | T01a, T03 | **Accepted.** The ingest twin test uses code 1 (one OPPORTUNITY); MEETING dedupe is tested with two concurrent `updateLead {2}`. The fixture adds C2 (an out-of-range L1 send and a cross-campaign L2 send), two targeted complaints plus one untargeted, and a targeted BOUNCE_SOFT, and asserts `newLeadsContacted` 3 and `complaints` 1. The unit "warm-up and placement" test is dropped; the real-pipeline e2e test is the check (see M17). |
| M1 | T01a | **Accepted.** Seed only when the workspace has zero stages; called once per request, outside bulk loops. |
| M2 | T01a | **Accepted.** `onInterestChange` takes a batch and loads the stages once; `lastSends` is one `DISTINCT ON` query. A bulk test with 200 leads. |
| M3 | T01a, T01b | **Accepted.** Every referenced id is checked against the workspace (Global Constraints). Tests in `stage rules` and the API tests. |
| M4 | T01a | **Accepted.** Ingest passes `scheduledMessageId: sm?.id`, and the matched send's attribution wins. Test `reply creates opportunity`. |
| M5 | T03 | **Accepted.** The account key is `COALESCE(sm."accountId", e."accountId")`. The fixture asserts that L3's reply, received by X, counts for Y. |
| M6 | T03 | **Accepted.** SQL range bounds; 22023 → 400; the DST test places events at 00:30 and 23:30 local. |
| M7 | T03, T04 | **Accepted.** Pipeline value = the current open pipeline, labelled "current". Conversion is labelled "by current stage". Every rate tooltip shows numerator and denominator. Stage history through the AuditLog is not used for conversion (YAGNI until asked). |
| M8 | T03 | **Accepted.** Rate numerators count only campaign events; test in `filters by campaign fields`. |
| M9 | T01a | **Accepted.** D40 says that GDPR erasure removes deals and their revenue; `opportunity.*` audit meta holds ids and amounts only. Asserted in `interest creates and moves`. |
| M10 | T01a, T01b | **Accepted.** `opportunity.*` audit meta carries `leadId`; the feed selects by it, with a `shortcut:` note on the missing meta index. Test: a deleted deal's history stays in the lead feed. |
| M11 | T01a | **Accepted.** The manual paths record `INTEREST_CHANGED {source:"manual"}`; D40 records that `to > 0` / `to < 0` are positive_reply / negative_reply. |
| M12 | T01a, T02 | **Accepted** (the refusal variant). A currency change returns 409 `currency_in_use` while any deal has a non-zero value or cash; the T02 setting is disabled with the reason. |
| M13 | T01a | **Partly pushed back.** There is no lead-merge UI (merge is API-only, `api/v1/leads/merge`), so T02 has nothing to change. The 409 body carries `{error: "opportunity_conflict", campaignId}` so a client can render "Both leads have a deal in {campaign}". The clash check runs after the Lead locks (T01a). |
| M14 | T03 | **Accepted.** Remaining = min(Σ account remaining, dailyCap − workspace usage); test with cap 40. |
| M15 | T03, T04 | **Accepted.** `dashboardSummary`, `exportActivityCsv` and their routes and tests move to T03 (opus), so T04 is UI only. T03 keeps its dependency on T01b because `dashboardSummary` reads `Task`; the order is sequential anyway. |
| M16 | all | **Superseded by the controller ruling:** strictly sequential T01a → T01b → T02 → T03 → T04, with no parallel implementers. `TASKS.json` deps follow the chain. |
| M17 | T03 | **Accepted, with one correction to the finding.** Warm-up sends never touch usage rows (D36), so the old "> 3" already reflected placement alone. The exact assertion is still better and is adopted: `Σ AccountDailyUsage.sent` is 3 + 1 placement seed. |
