# Phase 3 — Campaign automation: step plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leads, CSV import, lists and suppression, templates, campaigns and sequences, and the send pipeline (plan → claim → send → recover), so that a 3-step campaign runs unattended against the Fake provider and cannot double-send, over-send or send outside its window.

**Architecture:** Domain logic sits in `packages/core/src` (`leads/*`, `campaigns/*`, `template`, `spintax`, `schedule`, `quota`, `dispatch`, `rotation`, `planner`, `sender`, `recovery`, `unsubscribe`, `explain`, `scheduled`). It touches Prisma and providers only through injected `prisma`, `clock` and `providerFor`. The worker has four pg-boss jobs that are plain exported handlers. Web routes use `route()`. The send queue is the `ScheduledMessage` table, claimed one row per transaction with `FOR UPDATE SKIP LOCKED` and single-statement quota reservations on stored usage days.

**Tech Stack:** TypeScript 5.9, Prisma 7.10.1 (raw SQL for the claim), PostgreSQL 18, pg-boss 12.38, zod 4, papaparse 5.7, html-to-text (already in the tree via mailparser; pin it as a direct dependency of core in `docs/STACK.md`), Next.js 16, Vitest + embedded-postgres, Playwright.

**Spec:** `docs/IMPLEMENTATION_PLAN.md` is binding: Global Constraints, the "Send pipeline" section, Reconciliation, and P3-T01..T13. Also `docs/PRODUCT_SPEC.md` (PS-LEAD/CAMP/SEQ/SEND), `docs/PROVIDER_COMPLIANCE.md` ("Rules our code must enforce"), `docs/DECISIONS.md`, `CLAUDE.md`, and `docs/TASKS.json` (carry-forwards).

> Branch `phase-3-campaigns`. Commit and push after every task. Phase 1–2 interfaces are used as they are: `route()`, `startWorker`/`JobDef`, `createTestDb`/`expectIsolated`, `getEnv`, `audit(tx,…)`, `Clock`/`fixedClock`, `MailProvider` (frozen), the provider errors, `createProvider(account,{prisma,clock})`, `recordProviderError`, `dayKey`, `newMessageId`, `sendTestEmail`, `liveVerify`, `FakeProvider`/`getFakeProvider`.

## Global Constraints (from the master plan; every task inherits them)

- Every service read and write takes `workspaceId` and filters by it. Worker jobs may scan across workspaces, but every write is conditional on the state they read (`updateMany … WHERE <old state>`, or `UPDATE … WHERE id AND status AND claimToken`).
- No network call inside a DB transaction. That covers provider `send`/`findSent`, MX lookups and DNS checks.
- **Freshness gate** inside the claim SQL: `a."lastSyncCompletedAt" >= now − SYNC_MAX_STALENESS_SEC` (env, default 300). With `stopForCompanyOnReply`, every assigned, non-deleted account of the campaign must also be fresh. A `NEEDS_ATTENTION` account blocks.
- **Sticky sender:** `CampaignLead.accountId` is set only when step 1 is SENT. Follow-ups use it and wait while it is ineligible. Only step-1 rows of the main sequence are re-routed.
- Never exceed per-account, per-campaign or per-workspace daily allowances. Never send outside a schedule window. Never send the same `(campaignLeadId, stepId)` twice. Effective allowance = min(user limit, re-warm, health, ramp, floor(providerCap/2)). Units reserved = 1 + cc + bcc.
- An unknown outcome is never resent automatically: UNCERTAIN → search Sent → re-search after 15 min → HELD.
- Every campaign email carries `List-Unsubscribe`, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` when an https link exists. Its footer holds a visible unsubscribe link and the workspace physical address. Sending is blocked while the address is empty. Suppression is re-checked in the claim transaction.
- Credentials are written only via `setCredentials`. `AuthError` is narrow, and a user pause wins over it (`recordProviderError`). Fakes run only with `MAIL_PROVIDER_FAKE=1`.
- Advisory locks use `pg_advisory_xact_lock(<ns>, hashtext(id))`. This phase registers its namespaces in the CLAUDE.md list (see Fixed names).
- Every task writes its tests first, then runs `npm test`, `npm run lint` and `npm run typecheck`, all green, before committing.

## Decisions taken by this plan (record as D16–D18 in `docs/DECISIONS.md` in P3-T09)

- **D16 · No sending before P4 sync exists (freshness).** No production code in Phase 3 writes `lastSyncCompletedAt`, so the claim's freshness gate keeps every real campaign from sending until P4-T05 ships. The explainer reports `sync_pending`. There is no stub. A stub that marked accounts fresh without reading their inboxes would feed stop-on-reply nothing and send follow-ups to people who already replied, which is exactly what the gate prevents. Tests set freshness directly with `markFresh(prisma, accountIds, at)` in `packages/core/test/campaign-fixture.ts`. Worker-process tests write `lastSyncCompletedAt = now()` at seed time and finish within 300 s.
- **D17 · Real-provider campaign sending is gated on a recorded live check.** A new install-level table `ProviderVerification` (one row per `AccountProvider`) is written only by `scripts/live-verify.ts`, and only when every step passes. The `findSent` step must return our exact `Message-ID`. A failing run deletes the row for that provider. `sendableProviders()` returns all three providers when `MAIL_PROVIDER_FAKE=1` (which `MODE=vps` refuses), and otherwise only the providers that have a row. The claim SQL filters `a.provider = ANY($sendable)`. There is no env override. If the checks never run, real accounts are never claimed, and the explainer and launch say `provider_not_verified` and link to `docs/ops/LIVE_VERIFICATION.md`. All P3-T11 code and tests run against the Fake now. The table is install-level like `WorkerBoot`, because provider behaviour does not depend on the workspace. Known limit: one verified SMTP host enables SMTP generally. That is acceptable because ambiguous generic-SMTP sends always end HELD, never resent.
- **D18 · I-8 recipient vs account failures.** `PermanentSendError` gains an additive field `scope: "recipient" | "account" | "unknown"` (constructor `opts.scope`, default `"unknown"`). The `MailProvider` interface is unchanged. Handling:
  - **Recipient scope:** the lead is STOPPED with reason BOUNCED, a `HARD_BOUNCE` suppression is added, and account health is not touched (the P2-T07 ruling).
  - **Account and unknown scope:** `recordProviderError` runs. Only the recipient scope suppresses.

## Fixed names (every later task and phase relies on these)

| Thing | Value |
|---|---|
| Enums | `VerificationStatus NOT_VERIFIED\|VERIFIED\|PENDING\|PENDING_JOB\|INVALID\|RISKY\|CATCH_ALL\|JOB_CHANGE`; `EspType GOOGLE\|MICROSOFT\|ZOHO\|YAHOO\|YANDEX\|OTHER\|NOT_FOUND\|IN_QUEUE`; `EnrichmentStatus ENRICHED\|PENDING\|NOT_AVAILABLE\|ERROR`; `SuppressionKind EMAIL\|DOMAIN`; `SuppressionReason UNSUBSCRIBE\|HARD_BOUNCE\|COMPLAINT\|MANUAL\|NOT_INTERESTED\|GDPR_ERASURE`; `ImportStatus PENDING\|RUNNING\|DONE\|FAILED`; `CampaignStatus DRAFT\|ACTIVE\|PAUSED\|COMPLETED\|ARCHIVED\|ACCOUNTS_UNHEALTHY\|BOUNCE_PROTECT`; `DelayUnit MINUTES\|HOURS\|DAYS`; `CampaignLeadState QUEUED\|ACTIVE\|PAUSED\|COMPLETED\|STOPPED`; `StopReason REPLIED\|AUTO_REPLIED\|COMPANY_REPLIED\|UNSUBSCRIBED\|BOUNCED\|SUPPRESSED\|SKIPPED\|MANUAL\|SEND_FAILED`; `MessageStatus SCHEDULED\|SENDING\|SENT\|FAILED\|CANCELLED\|UNCERTAIN\|HELD` |
| `Workspace` + (T05) | `timezone String @default("UTC")`, `physicalAddress String?`, `dailyCap Int?` (null = no workspace cap), `perCompanyDailyLimit Int?`, `disableOpenTracking Boolean @default(false)`, `firstEmailTextOnly Boolean @default(false)` |
| `Lead` (T01) | `id, workspaceId, email (lowercased), firstName?, lastName?, companyName?, companyDomain?, jobTitle?, website?, industry?, phone?, personalization?, customFields Json @default("{}") (string\|number\|boolean\|null values), tags String[], labels String[], interestStatus Int? (1,2,3,4,0,-1,-2,-3,-4; null = Lead), verificationStatus @default(NOT_VERIFIED), espType @default(IN_QUEUE), esg String?, enrichmentStatus?, plValue Decimal?, ownerId String?, source String?, lawfulBasis String?, country String?, importJobId String?, emailsSent Int 0, opens Int 0, clicks Int 0, replies Int 0, lastContactedAt?, lastOpenAt?, lastReplyAt?, lastClickAt?, lastInterestChangeAt?, lastTouchAt?, lastSenderAccountId String?, lastEngagement Json? ({open\|reply\|click: {stepId, variantId, at}}, filled by P4), mergedIntoId String?, createdAt, updatedAt, deletedAt?`. Partial unique `(workspaceId, email) WHERE deletedAt IS NULL` (raw SQL). `companyDomain` = email domain, except that `FREE_MAIL_DOMAINS` (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, msn.com, yahoo.com, icloud.com, me.com, aol.com, proton.me, protonmail.com, gmx.com, gmx.de, web.de, yandex.ru, mail.ru, zoho.com) gives `null`. A null domain never matches a company rule. |
| Other lead tables (T01) | `LeadLabel(id, workspaceId, name, color, positive Boolean, aiDescription?, @@unique[workspaceId,name])`; `LeadList(id, workspaceId, name, createdAt, @@unique[workspaceId,name])`; `LeadListMember(listId, leadId, @@id)`; `Suppression(id, workspaceId, kind, value String? (null after GDPR erasure), valueHash String (sha256 hex of lowercased email or domain), reason, source String?, createdAt, @@unique[workspaceId,kind,valueHash])`; `ImportJob(id, workspaceId, createdById, status @default(PENDING), fileName, data Bytes? (cleared when DONE/FAILED), mapping Json, options Json, confirmedAuthorized Boolean, source, lawfulBasis, total Int 0, imported Int 0, attached Int 0, skipped Json @default("{}"), progress Int 0, error String?, createdAt, finishedAt?)` |
| Campaign tables (T05/T06) | `Campaign(id, workspaceId, name, status @default(DRAFT), evergreen false, dailyLimit Int?, maxNewLeadsPerDay Int?, perCompanyDailyLimit Int?, minGapSec Int @default(540), randomGapSec Int @default(300), stopOnReply true, stopOnAutoReply false, stopForCompanyOnReply false, trackOpens false, trackClicks false, textOnly false, firstEmailTextOnly false, prioritizeNewLeads false, matchProvider false, espRoutingRules Json @default("[]"), accountTags String[], allowRisky false, bounceProtect true, unsubscribeHeader true, cc String[], bcc String[], startAt?, endAt?, ownerId?, plValue Decimal?, tags String[], abAutoOptimize false, abWinnerMetric String?, launchedAt?, createdAt, updatedAt, deletedAt?)`; `CampaignSchedule(id, campaignId, name, timezone, days Int (Sun=bit0), from "HH:mm", to "HH:mm" or "24:00")`; `CampaignAccount(campaignId, accountId, @@id)`; `Subsequence(id, campaignId, name, trigger Json, preDelayMinutes Int 0, dailyLimit Int?, active true, activatedAt?, createdAt)`; `SequenceStep(id, campaignId, subsequenceId?, order Int, delayValue Int, delayUnit @default(DAYS), deletedAt?)`; `StepVariant(id, stepId, label "A".."Z", subject, body, weight Int 1, active true, assigned Int 0)`; `CampaignLead(id, workspaceId, campaignId, leadId, subsequenceId?, state @default(QUEUED), stopReason?, currentStepId?, nextDueAt?, accountId?, threadRef?, enrolledAt, completedAt?, @@unique[campaignId,leadId])` |
| Send tables (T09) | `CampaignDailyUsage(campaignId, day date, sent 0, reserved 0, newLeads 0, @@id)`; `ScheduledMessage(id, workspaceId, campaignId, campaignLeadId, stepId, variantId, accountId, dueAt, status @default(SCHEDULED), attempts Int 0, idempotencyKey @unique (= "${campaignLeadId}:${stepId}"), claimToken?, claimedAt?, claimBootId?, usageDay date?, wsUsageDay date?, campUsageDay date?, reservedUnits Int 0, rfcMessageId?, providerMessageId?, providerThreadId?, sentAt?, error?, renderedSubject, renderedBody (html, or text when text-only), renderedText, uncertainAt?, searchCount Int 0, lastSearchAt?, createdAt, updatedAt, @@index[status,dueAt], @@index[campaignLeadId], @@index[accountId,status])`; `ProviderVerification(provider AccountProvider @id, passedAt, accountId, report Json)`. Lead, CampaignLead and ScheduledMessage cascade on lead hard delete. `stepId` is `onDelete: Restrict` (steps are soft-deleted). |
| Env (core `envSchema`) | `SEND_LEASE_SEC` int, default 600, must be ≥ 120 unless `MAIL_PROVIDER_FAKE=1`; `OLD_ENCRYPTION_KEY` optional (verifies old unsubscribe links after key rotation). Fixed constants in core: provider send timeout 60 s, stale claim 120 s, re-search 15 min, backoff `60 s · 2^(attempts−1)`, max 5 attempts. |
| Jobs (`apps/worker/src/jobs/`) | `campaign-plan` cron `* * * * *` → `planDue`; `campaign-dispatch` cron `* * * * *` → `dispatchTick` (loops ≤ 50 s); `send-recovery` cron `*/5 * * * *` → `recoverExpired` then `resolveUncertain`; `lead-import` (no cron, payload `{importJobId}`) → `runImport`. Options: the three cron queues `{ policy: "stately", retryLimit: 0 }`, `lead-import` `{ retryLimit: 2, retryDelay: 30, retryBackoff: true }`. `startWorker` sends one `campaign-plan`, `campaign-dispatch` and `send-recovery` job right after registration (recovery on boot). `JobDeps` gains `bootId: string`. |
| Advisory lock namespaces | 726003 = planner, per campaign id (`planDue`'s per-campaign transaction); 726004 = enrollment, per workspace id (cross-campaign conflict check). Added to CLAUDE.md by T05. |
| Audit actions | `lead.create, lead.update, lead.delete, lead.gdpr_delete, lead.merge, lead.bulk, lead.import, list.*, blocklist.add, blocklist.remove, campaign.create, campaign.update, campaign.launch, campaign.pause, campaign.resume, campaign.archive, campaign.delete, campaign.duplicate, campaign.import, campaign.dns_override, message.release, message.cancel, message.retry, settings.update`. The meta never holds an email address of an erased lead. |
| API scopes | `leads:read\|create\|update\|delete`, `campaigns:read\|create\|update\|delete`, `blocklist:read\|write`. Roles: reads VIEWER; writes MEMBER; GDPR delete, blocklist delete-all and workspace settings ADMIN. |

Core signatures (exact; later tasks call these):

```ts
// schedule.ts (T07)
export type Window = { timezone: string; days: number; from: string; to: string };
export function isInWindow(windows: Window[], at: Date): boolean;
export function nextWindowStart(windows: Window[], at: Date): Date;          // returns `at` when inside; throws if no day bit is set
export function addDelay(from: Date, value: number, unit: DelayUnit, timezone: string): Date;
export function startOfNextDay(timezone: string, at: Date): Date;           // UTC instant of the next local midnight
export function isValidTimeZone(tz: string): boolean;
export { dayKey } from "./accounts/daykey";                                   // (timezone, at) => "YYYY-MM-DD"
// template.ts / spintax.ts (T04)
export type RenderContext = { lead: Record<string, string | number | boolean | null>; sender: { firstName: string; lastName: string; email: string }; unsubscribeLink?: string };
export function render(template: string, ctx: RenderContext, opts: { seed: string; html: boolean }): string;
export type TemplateIssue = { code: "unknown_variable" | "unmatched_braces" | "missing_random_keyword" | "empty_fallback" | "unclosed_if" | "bad_if"; message: string; index: number; variable?: string };
export function validateTemplate(template: string, known: ReadonlySet<string>): TemplateIssue[];
export function templateVariables(template: string): string[];
export function pick(seed: string, index: number, n: number): number;        // spintax.ts: sha256(seed + ":" + index) mod n
// unsubscribe.ts (T05 mode, T08 rest)
export type UnsubPayload = { w: string; l: string; c: string };              // workspaceId, leadId, campaignId
export function unsubscribeMode(appUrl: string): "https" | "mailto";
export function signUnsubscribe(p: UnsubPayload, key: Buffer): string;      // base64url(JSON) + "." + base64url(HMAC-SHA256)
export function verifyUnsubscribe(token: string, keys: Buffer[]): UnsubPayload | null;
export function unsubscribeKeys(env: { ENCRYPTION_KEY: string; OLD_ENCRYPTION_KEY?: string }): Buffer[]; // HKDF-SHA256(info "rightnow-unsubscribe-v1")
// quota.ts (T09; T13 adds the ramp term)
export function effectiveAllowance(a: Pick<EmailAccount, "dailyLimit" | "providerCap" | "slowRamp" | "rampStartVolume" | "rampIncrementPerDay" | "rampStartedAt" | "createdAt" | "timezone">, now: Date, ctx?: { rewarmAllowance?: number | null; healthThrottle?: number | null }): number;
export type UsageRef = { accountId: string; campaignId: string; workspaceId: string; usageDay: string; campUsageDay: string; wsUsageDay: string; reservedUnits: number };
export function commitUsage(tx: Tx, r: UsageRef): Promise<void>;            // reserved −= u, sent += u on the stored days
export function releaseUsage(tx: Tx, r: UsageRef): Promise<void>;           // reserved = GREATEST(reserved − u, 0)
export function creditSent(tx: Tx, r: UsageRef): Promise<void>;             // sent += u only (late accept after release)
// dispatch.ts (T09)
export type ClaimOpts = { limit: number; bootId: string; stalenessSec: number; sendableProviders: AccountProvider[]; random?: () => number };
export type Claimed = UsageRef & { id: string; campaignLeadId: string; stepId: string; claimToken: string; claimedAt: Date; rfcMessageId: string };
export function claimDue(db: PrismaClient, clock: Clock, o: ClaimOpts): Promise<Claimed[]>;
export function sendableProviders(prisma: PrismaClient, env: { MAIL_PROVIDER_FAKE?: "1" }): Promise<AccountProvider[]>;
export function withTxRetry<T>(f: () => Promise<T>, tries?: number): Promise<T>; // retries 40P01 / 40001, default 3
// rotation.ts / planner.ts (T10)
export type EspRule = { action: "send" | "do_not_send"; recipientEsp: "all" | "google" | "outlook" | "other"; senderEsp: "all" | "google" | "outlook" | "other" };
export function pickAccount(tx: Tx, p: { campaign: Campaign; leadEsp: EspType; now: Date; stalenessSec: number; sendableProviders: AccountProvider[] }): Promise<EmailAccount | null>;
export type RenderEnv = { appUrl: string; unsubscribeKeys: Buffer[] };
export function planDue(db: PrismaClient, clock: Clock, o: { stalenessSec: number; sendableProviders: AccountProvider[]; env: RenderEnv; batch?: number }): Promise<{ planned: number; revived: number; rerouted: number; skipped: number; completed: number }>;
export function advanceLead(tx: Tx, clock: Clock, p: { campaignLeadId: string; stepId: string; sentAt: Date }): Promise<void>; // no-op unless currentStepId === stepId
export function renderForLead(p: { campaign; step; variant; lead; account; workspace; env: RenderEnv }): { subject: string; html: string | null; text: string };
// sender.ts / recovery.ts (T11a/T11b)
export type SendOutcome = "SENT" | "RETRY" | "UNCERTAIN" | "FAILED" | "AUTH" | "STALE" | "RELEASED" | "LOST";
export type SenderDeps = { providerFor: (a: EmailAccount) => MailProvider; env: RenderEnv };
export function sendClaimed(db: PrismaClient, clock: Clock, deps: SenderDeps, c: Claimed): Promise<SendOutcome>;
export function dispatchTick(db: PrismaClient, clock: Clock, deps: SenderDeps & Omit<ClaimOpts, "limit"> & { maxMs?: number; concurrency?: number }): Promise<Record<SendOutcome, number>>;
export function recoverExpired(db: PrismaClient, clock: Clock, leaseSec?: number): Promise<number>;
export function resolveUncertain(db: PrismaClient, clock: Clock, deps: Pick<SenderDeps, "providerFor">): Promise<{ sent: number; held: number; searched: number; errors: number }>;
```

## Review Focus (riskiest inputs no acceptance test covers; each has a test in its owning task)

1. **Free-mail domains treated as companies.** Example: a `gmail.com` lead replies with `stopForCompanyOnReply` on, or a per-company cap is set. Expected: free-mail leads have `companyDomain null`, so every other Gmail lead is unaffected. Tests in T01 and T10.
2. **State changes between claim and send.** The user pauses the campaign, the lead unsubscribes or is GDPR-erased, or the account is unassigned while a row is SENDING. Expected: the sender re-checks right before the provider call. Nothing is sent, the reservation is released, and a suppressed row is CANCELLED. Test in T11a.
3. **Editing an active campaign.** Example: the user fixes a typo in step 2, or deletes step 2, while rows are planned. Expected: SCHEDULED rows are re-rendered and the stored text is what goes out. A deleted step's SCHEDULED rows are cancelled and their leads move to the next step. Deletion is refused while any of its rows are SENDING, UNCERTAIN or HELD. Test in T10.
4. **Link scanners prefetching unsubscribe URLs**, a forged token, or the link of an erased lead. Expected: GET never unsubscribes, POST is idempotent, a tampered token gives 400, and an erased lead gives 200 "unsubscribed". Test in T08.
5. **Lead data that contains template syntax or HTML.** Examples: `firstName = "{{RANDOM | a | b}}"` or `"<img src=x onerror=…>"`. Expected: inserted literally, never evaluated, HTML-escaped in HTML bodies. Test in T04.

The master Review Focus #1 (P3-T11b) and #3 (P3-T09) are named tests in those tasks. Master Review Focus #4 (CSV) is in P3-T02.

## Task order, splits and parallelism

The order is T01 → T02 → T03 → T05 → T06 → T08 → T09 → T10 → T11a → T11b → T12 → T13. T04 and T07 are pure modules with no schema and disjoint files, so they can run alongside T01–T03, with at most 2 implementers at a time. Changes from the master list, each with its reason:

- **P3-T11 → T11a (sender) + T11b (recovery, HELD API, worker wiring, process-level E2E).** The two together exceed one subagent's context, and a reviewer can reject recovery while approving the send path. Both run on opus.
- **The "why not sending" explainer moves from P3-T05 to P3-T10.** It needs `isInWindow` (T07), `effectiveAllowance` and the freshness and provider gates (T09), and `pickAccount` (T10).
- **Campaign duplicate and JSON export/import move from P3-T05 to P3-T06,** because they copy steps, and steps are created in T06.
- **The lead contact timeline (PS-LEAD-19) moves to P3-T13.** Its sources, enrollments (T06) and sends (T11), exist only late in the phase, and T13 is the lightest task.

`docs/TASKS.json` needs P3-T11 replaced by P3-T11a (deps P3-T10, opus) and P3-T11b (deps P3-T11a, opus). P3-T12 then depends on P3-T11b, and P3-T04/T07 get the parallel note.

---

## P3-T01 Leads service and API

Model: sonnet. **Owns:** PS-LEAD-01, 03, 06 (field), 08 (fields; P4 fills open/reply/click), 16, 17 (assign round-robin, delete, interest status, tags; T03 completes it), 18 (except the campaign and status filters, which T06 adds), 24; PS-LEAD-04 (P3 part: the interest change is stored, stamped and audited; subsequence entry is in T10).
Files: `packages/db/prisma/schema.prisma` and migration `leads` (Lead, LeadLabel, LeadList, LeadListMember, Suppression, ImportJob, the enums above, the partial unique index); `packages/core/src/leads/{service,suppression,domain}.ts`; `apps/web/app/api/v1/leads/**`, `apps/web/app/api/v1/lead-labels/**`; tests `packages/core/test/leads.test.ts`, `apps/web/test/leads-api.test.ts`.
Signatures (all take `prisma`, then `workspaceId`): `createLead(…, actorId, input)`; `updateLead(…, id, patch)` (zod `.strict()`; `interestStatus` sets `lastInterestChangeAt`); `listLeads(…, q: LeadQuery)` (filters `q, tag, label, interestStatus, verificationStatus, ownerId, listId, openedNoReply, lastContactedFrom/To, custom {key, contains}`; cursor by id; `take` ≤ 100, default 50); `softDeleteLead`; `gdprDeleteLead(prisma, clock, ws, id, actorId)`; `mergeLeads(prisma, clock, ws, { keepId, mergeId }, actorId)`; `bulkLeads(…, { ids (≤ 1000), action: "assign_round_robin"|"set_owner"|"set_interest"|"add_tags"|"remove_tags"|"delete", value? })`.
Suppression helpers: `suppress(tx, ws, entries: { kind, value }[], reason, source): Promise<number>` (upserts only; T06 extends it to stop CampaignLeads, T09 to cancel SCHEDULED rows); `isSuppressed(tx, ws, email): Promise<boolean>`; `hashValue(v: string): string`; `companyDomainOf(email): string | null`.

Rules: `gdprDeleteLead` runs in one transaction: (1) lock the lead's ScheduledMessage rows `FOR UPDATE` (a no-op until T09) and answer 409 `send_in_progress` if any are SENDING or UNCERTAIN; (2) upsert an EMAIL suppression with reason `GDPR_ERASURE` unless one exists; (3) set `value = null` on every suppression with that hash; (4) hard-delete the lead (cascades); (5) audit with `{ hash }` only.

`mergeLeads`: the kept lead's non-empty fields win and its blanks are filled from the merged lead; `customFields` shallow-merge (keep wins); `tags`, `labels` and list memberships are unioned; counters are summed; the merged lead is soft-deleted with `mergedIntoId`. 409 if either lead has a SENDING or UNCERTAIN row. CampaignLead moves are added by T06.

Steps:
- [ ] Write the failing tests in `leads.test.ts` (createTestDb, fixedClock, and each call also checked with a foreign workspace → not found):
  - email is stored lowercased; creating `A@X.test` after `a@x.test` → 409 `lead_exists`; allowed after a soft delete.
  - `companyDomainOf("jo@acme.test") === "acme.test"` and `companyDomainOf("jo@gmail.com") === null` (Review Focus 1); creation fills `companyDomain` when it is not given.
  - `updateLead({interestStatus: 1})` → `lastInterestChangeAt = now`, audit `lead.update`; `interestStatus: 7` → 400; `customFields: {a: {}}` → 400 (only scalars allowed).
  - filters: 3 leads with `opens 2, replies 0` / `opens 2, replies 1` / `opens 0` → `openedNoReply` returns the first only; `custom {key:"city", contains:"ber"}` matches `Berlin`; pagination over 120 leads with `take 50` gives 50/50/20 with no repeats.
  - `bulkLeads assign_round_robin` with users `[u1,u2]` over 5 leads ordered by id → `u1,u2,u1,u2,u1`; 1001 ids → 400.
  - merge: keep `{firstName:"A", phone:null, tags:["x"], opens:1}`, merge `{firstName:"B", phone:"1", tags:["y"], opens:2}` → `{firstName:"A", phone:"1", tags:["x","y"], opens:3}`; the merged lead has `deletedAt` and `mergedIntoId` set; audit `lead.merge`.
  - GDPR: after `gdprDeleteLead`, `SELECT` over Lead, Suppression.value and AuditLog.meta finds no row containing the address. A suppression with `valueHash = sha256("jo@acme.test")` and reason `GDPR_ERASURE` exists. A later `createLead` with that email still succeeds, and `isSuppressed` → true.
- [ ] Run `npx vitest run packages/core/test/leads.test.ts` → FAIL (module missing).
- [ ] Implement the schema, migration and services. Add the `leads/*` exports to `packages/core/src/index.ts`.
- [ ] Route tests in `leads-api.test.ts`: a `leads:read` key can GET but gets 403 on POST; VIEWER PATCH → 403; MEMBER `POST /leads/[id]/gdpr-delete` → 403 and ADMIN → 200; unknown body key → 400; another workspace's lead → 404. Routes: `GET,POST /api/v1/leads`, `GET,PATCH,DELETE /api/v1/leads/[id]`, `POST /api/v1/leads/{merge,bulk}`, `POST /api/v1/leads/[id]/gdpr-delete`, `GET,POST /api/v1/lead-labels`, `PATCH,DELETE /api/v1/lead-labels/[id]`.
- [ ] Run tests, lint and typecheck → PASS. Commit `feat(leads): lead model, service, API, merge, GDPR delete`.

## P3-T02 CSV import/export and ESP detection

Model: sonnet. **Owns:** PS-LEAD-05 (field and import; the send rule is in T10), 07, 10, 11, 12, 13, 15; master Review Focus #4.
Files: `packages/core/src/leads/{csv,import,export,esp,validate,disposable}.ts`; `apps/worker/src/jobs/lead-import.ts` (registered in `jobs/index.ts`); `apps/web/app/api/v1/imports/**`, `apps/web/app/api/v1/leads/export/route.ts`; tests `packages/core/test/{csv,import,esp}.test.ts`.
Signatures:
- `parseCsv(buf: Buffer): { headers: string[]; rows: string[][]; delimiter: string }`: papaparse; BOM stripped; `delimitersToGuess [",",";","\t","|"]`
- `autoMap(headers: string[]): (LeadField | \`custom:${string}\` | null)[]`: case-insensitive, ignoring spaces, `_` and `-`. Aliases: `email|emailaddress|e-mail`, `firstname|first`, `lastname|last|surname`, `company|companyname`, `title|jobtitle|position`, `website|url|domain→website`, `phone|phonenumber`. An unmapped header becomes `custom:<header>`.
- `previewImport(prisma, ws, buf, mapping?)`: returns `{ mapping, sample: first 5 rows, counts: { rows, missingEmail, invalidEmail, duplicateInFile, existsInWorkspace } }`
- `createImport(prisma, ws, actorId, p: { fileName; data: Buffer; mapping; options: { listId?; campaignId?; skipIfInWorkspace = true; skipIfInList = false; skipIfInCampaign = false }; confirmedAuthorized: boolean; source?; lawfulBasis: "legitimate_interest"|"consent"|"contract"|"other" })`: returns `{ importJobId }` and enqueues `lead-import`
- `runImport(prisma, clock, deps: { resolveMx?: typeof dns.promises.resolveMx }, importJobId)`
- `detectEsp(domain, resolveMx): Promise<{ esp: EspType; esg: string | null }>`
- `exportLeadsCsv(prisma, ws, q: LeadQuery): AsyncIterable<string>`

Rules:
- `confirmedAuthorized` false → 400. The file must be ≤ 50 MB and ≤ 100,000 rows, otherwise 413.
- `runImport` claims the job with `updateMany({where:{id, status:"PENDING"}, data:{status:"RUNNING"}})`. Zero rows → return. It inserts in batches of 500, then clears `data`.
- Skip reasons, with exact keys: `missing_email, invalid_email, disposable, duplicate_in_file, exists_in_workspace, exists_in_list, exists_in_campaign, blocklisted`. With `skipIfInWorkspace=false`, an existing lead is attached to the target list or campaign (counted in `attached`) and its fields are never overwritten.
- `source` defaults to `csv:<fileName>`.
- ESP detection runs after the inserts, outside any transaction: one lookup per unique domain, ≤ 8 in flight, 5 s timeout. MX host patterns: `google.com|googlemail.com` → GOOGLE; `outlook.com` (incl. `protection.outlook.com`) → MICROSOFT; `zoho.` → ZOHO; `yahoodns.net` → YAHOO; `yandex.` → YANDEX; gateways set the ESG with ESP OTHER: `pphosted.com` Proofpoint, `mimecast.com` Mimecast, `barracudanetworks.com` Barracuda, `iphmx.com` Cisco. `ENOTFOUND`/`ENODATA` → `NOT_FOUND` + `verificationStatus INVALID`; any other DNS error → `NOT_FOUND`, verification unchanged.
- `disposable.ts` is a built-in list of at least 50 domains (`// shortcut: static list, swap for a maintained package if misses show up`).
- Export cells starting with `= + - @ \t \r` get a `'` prefix (CSV injection).

Steps:
- [ ] Write the failing tests:
  - `csv.test.ts`: a UTF-8 BOM file with `;` delimiter → `delimiter ";"`, first header `email` (no BOM char); tab-separated and quoted cells containing `;` parse correctly; `autoMap(["E-mail","First Name","COMPANY","Shoe Size"])` → `["email","firstName","companyName","custom:Shoe Size"]`.
  - `import.test.ts` (Review Focus master #4): workspace has lead `existing@x.test` and blocklist entries `blocked@x.test` and domain `spam.test`. The CSV (BOM, `;`) has 10 rows: `a@x.test`, `ALICE@x.test`, `alice@x.test`, `b@`, ``, `existing@x.test`, `blocked@x.test`, `c@spam.test`, `d@mailinator.com`, `e@y.test`. Expected: `total 10`, `imported 3` (`a@x.test`, `alice@x.test`, `e@y.test`), `skipped {duplicate_in_file:1, invalid_email:1, missing_email:1, exists_in_workspace:1, blocklisted:2, disposable:1}`; the stored email is `alice@x.test`. The same file with `skipIfInWorkspace:false` and `listId` → `attached 1` and `existing@x.test` is in the list with its fields unchanged. `confirmedAuthorized:false` → 400. Running `runImport` twice on one job imports nothing the second time. Imported leads have `source "csv:leads.csv"`, the given `lawfulBasis`, and `importJobId`.
  - `esp.test.ts` (injected resolver): `aspmx.l.google.com` → GOOGLE; `acme-test.mail.protection.outlook.com` → MICROSOFT; `mx1.acme.pphosted.com` → `{esp:"OTHER", esg:"Proofpoint"}`; ENOTFOUND → NOT_FOUND and lead INVALID; a timeout leaves `verificationStatus` unchanged; 20 leads on 2 domains → 2 resolver calls.
  - export: a lead with `firstName "=HYPERLINK(1)"` exports as `'=HYPERLINK(1)`; custom field columns are the union across leads.
- [ ] Run the tests → FAIL. Implement. Run them → PASS.
- [ ] Route tests: `POST /api/v1/imports` (multipart `file`, JSON `options`) → 202 `{importJobId}`; `GET /api/v1/imports/[id]` → `{status, progress, imported, attached, skipped}`; a 51 MB body → 413; `POST /api/v1/imports/preview` returns the counts. Job test: calling `leadImportJob.handler([{data:{importJobId}}], deps)` completes the job.
- [ ] Commit `feat(leads): CSV import/export, validation, ESP detection`.

## P3-T03 Lists, blocklist/suppression, and the Leads UI

Model: sonnet. **Owns:** PS-LEAD-09, 17 (move, add to blocklist, export selected), 20, 21, 25 (filter, reasons, remove; re-verify → P5-T08); E2E #3.
Files: `packages/core/src/leads/{lists,blocklist}.ts`; `apps/web/app/api/v1/{lead-lists,blocklist}/**`; `apps/web/app/(app)/leads/{page.tsx,leads-table.tsx,lead-drawer.tsx,import-wizard.tsx,bulk-bar.tsx}`, `apps/web/app/(app)/leads/lists/page.tsx`, `apps/web/app/(app)/blocklist/page.tsx`; tests `packages/core/test/lists.test.ts`, `apps/web/e2e/leads-import.spec.ts`.
Signatures:
- `createList/renameList/deleteList(…)`: deleting a list keeps its leads
- `addToList(…, listId, leadIds)`, `removeFromList`, `moveLeads(…, { leadIds, fromListId, toListId })`
- `listStats(…, listId): Record<VerificationStatus, number>`
- `addBlocklist(prisma, ws, actorId, values: string[] (≤ 1000)): { added; duplicates; invalid }`: a value containing `@` is EMAIL, otherwise DOMAIN; lowercased; goes through `suppress(…, "MANUAL", "blocklist")`
- `removeBlocklist(…, id)`, `clearBlocklist(…, confirm: "DELETE ALL")` (ADMIN)
- `exportBlocklistCsv`, `importBlocklistCsv(buf)`

Steps:
- [ ] Write the failing tests:
  - `lists.test.ts`: `moveLeads` → the lead is in the target list only; `listStats` counts 2 VERIFIED and 1 INVALID; deleting a list leaves 3 leads.
  - blocklist: `addBlocklist(["Bad@X.test","spam.test","nope"])` → `{added:2, invalid:1}` with kinds EMAIL and DOMAIN and `value` lowercased; adding again → `duplicates 2`; the row of a GDPR-erased address lists `value null` and stays undeletable by value but deletable by id; `clearBlocklist` without the confirm string → 400; export → CSV `value,kind,reason,createdAt`.
- [ ] Implement, including the routes: `/api/v1/lead-lists` (+ `/[id]`, `/[id]/leads` POST/DELETE, `/[id]/move`, `/[id]/stats`) and `/api/v1/blocklist` (GET paginated, POST, `/[id]` DELETE, `/bulk-delete`, `/clear`, `/export`, `/import`).
- [ ] Leads UI: the table shows email, name, company, interest badge, verification and ESP. Filters cover all of T01's. Bulk bar: assign round-robin, set interest, tags, add to list, move, add to blocklist, delete, export selected. The drawer edits fields and custom fields. The "Bounced" quick filter shows leads with a `HARD_BOUNCE` suppression, with the reason and a "Remove" action. The import wizard steps are upload → map (auto-mapped, editable selects) → options (target list, dedupe toggles, source, lawful basis, the "I am authorized to email these contacts" checkbox, required) → preview counts → run with a progress poll → result counts per reason.
- [ ] Playwright `leads-import.spec.ts` (E2E #3): upload a fixture CSV (BOM, `;`, 6 rows incl. 1 invalid and 1 in-file duplicate). The mapping shows `Email → email`, Run stays disabled until the checkbox is ticked, the result shows `Imported 4`, `Invalid email 1`, `Duplicate in file 1`, and the table lists 4 rows. Keyboard: the table rows are focusable and the wizard steps have headings.
- [ ] Commit `feat(leads): lists, blocklist, leads UI and import wizard`.

## P3-T04 Template engine and spintax (parallel-safe)

Model: sonnet. **Owns:** PS-SEQ-12, 13 (variables; the columns come from T01), 14, 15, 16, 17, 18, 19 (the `{{unsubscribeLink}}` variable; the footer is in T08), 20; PS-LEAD-26.
Files: `packages/core/src/{template,spintax}.ts`; test `packages/core/test/template.test.ts`. No DB.
Grammar:
- `{{ name }}` is a variable. Known names: `email firstName lastName companyName companyDomain jobTitle website industry phone personalization sendingAccountFirstName sendingAccountLastName sendingAccountEmail unsubscribeLink`, plus custom field keys. Names are case-sensitive.
- `{{a | b | literal}}` is a fallback chain. Each part is tried in order: a known variable name is a variable, anything else is a literal (trimmed). The first non-empty value wins.
- `{{RANDOM | x | y}}` picks one option with `pick(seed, occurrenceIndex, n)`. Options may contain `{{var}}`, nested to any depth, and the chosen option is rendered after picking.
- `{% if name %}…{% else %}…{% endif %}`, `{% if name == "v" %}` and `{% if name != "v" %}` compare case-sensitively, nest, and treat an empty or null value as false.
- Values are inserted as text and never re-parsed. When `html:true`, values are escaped (`& < > " '`). A missing value with no fallback renders `""`. An unknown variable at render time throws `TemplateError` (launch validation prevents it). Seed = `${leadId}:${stepId}:${variantId}`.

Steps:
- [ ] Write the failing tests in `template.test.ts`:
  - `render("Hi {{firstName | there}}", {lead:{firstName:""}})` → `"Hi there"`; `{{firstName | lastName | for you}}` with only lastName `"Li"` → `"Li"`; with neither → `"for you"`.
  - `render("{{RANDOM | Hi {{firstName}} | Hello}}", lead "Ann", seed "l1:s1:v1")` gives the same result on 100 calls, and is one of `Hi Ann`/`Hello`; over seeds `l0…l999` both options occur 400–600 times.
  - `{% if industry == "SaaS" %}A{% else %}B{% endif %}` → `A` for `SaaS`, `B` for `saas`; a nested if works.
  - sender variables resolve from `ctx.sender`; `{{unsubscribeLink}}` resolves from `ctx.unsubscribeLink`.
  - Review Focus 5: `firstName = "{{RANDOM | a | b}}"` renders literally; `firstName = "<img src=x onerror=alert(1)>"` with `html:true` renders `&lt;img src=x onerror=alert(1)&gt;`, and with `html:false` renders unchanged.
  - `validateTemplate` codes: `{{frstName}}` → `unknown_variable` (variable `frstName`); `{{firstName` → `unmatched_braces`; `{{Hi there | Hello}}` → `missing_random_keyword`; `{{firstName | }}` → `empty_fallback`; `{% if x %}` without endif → `unclosed_if`; `{% if %}` → `bad_if`; a valid template → `[]`. `templateVariables("{{a}} {{RANDOM | {{b}} | c}}")` → `["a","b"]`.
- [ ] Run → FAIL. Implement `render`/`validateTemplate`/`templateVariables` with a small recursive-descent parser (no liquidjs dependency). Run → PASS.
- [ ] Commit `feat(core): template engine with fallbacks, seeded spintax, if-blocks`.

## P3-T05 Campaign service and API

Model: sonnet. **Owns:** PS-CAMP-01 (without duplicate), 03, 04 (enum and display; producers → P5-T02), 05 (flag), 07, 09, 10, 11, 12, 13, 15, 16, 17, 18, 19 (flag), 20 (flag), 21 (flags and workspace overrides), 22, 23 (flag), 24 (rules stored), 25, 26, 28, 29, 33; PS-ACC-21 (campaign-side `accountTags`), PS-ACC-22.
Files: migration `campaigns` (Workspace columns, Campaign, CampaignSchedule, CampaignAccount, enums); `packages/core/src/campaigns/{service,schema,launch}.ts`; `packages/core/src/unsubscribe.ts` (only `unsubscribeMode`); `apps/web/app/api/v1/campaigns/**`, `apps/web/app/api/v1/accounts/[id]/campaigns/route.ts`; CLAUDE.md (namespaces 726003/726004); tests `packages/core/test/campaigns.test.ts`, `apps/web/test/campaigns-api.test.ts`.
Signatures:
- `createCampaign(prisma, ws, actorId, input)`, `updateCampaign(…, id, patch)`: zod `.strict()` over every Campaign option. `minGapSec` 0..86400, `randomGapSec` 0..86400, `cc`/`bcc` emails with combined length ≤ 10, `dailyLimit`/`maxNewLeadsPerDay`/`perCompanyDailyLimit` null or ≥ 1, `espRoutingRules: EspRule[]` ≤ 20, `unsubscribeHeader` accepts only `true` (400 `unsubscribe_header_required`, because the Global Constraint overrides PS-CAMP-25's toggle). A patch while ACTIVE is allowed.
- `setSchedules(…, id, schedules: { name; timezone; days; from; to }[] (1..10))`: preset helpers `PRESETS.anyTime = {days:127, from:"00:00", to:"24:00"}`, `PRESETS.officeHours = {days:62, from:"09:00", to:"17:00"}`, default timezone = workspace timezone. `from === to` → 400, and an invalid IANA zone → 400. `startDate`/`endDate` (YYYY-MM-DD) are stored as `startAt` = local 00:00 of startDate and `endAt` = local 00:00 of the day after endDate, in the first schedule's zone.
- `setCampaignAccounts(…, id, accountIds)`: foreign or deleted ids → 400.
- `listAccountCampaigns(prisma, ws, accountId)`: `[{id, name, status}]`.
- `launchCampaign(prisma, clock, deps: { dnsGate?: (domains: string[]) => Promise<{ domain: string; level: "ok"|"warn"|"block"; reason: string }[]>; appUrl: string; sendable: AccountProvider[] }, ws, id, actorId, opts?: { overrideDnsWarnings?: boolean })`: returns `{ status; warnings: LaunchIssue[] }` or 422 `{ issues: LaunchIssue[] }`.
- `pauseCampaign`, `resumeCampaign`, `archiveCampaign`, `deleteCampaign`: soft delete; sets ARCHIVED, `deletedAt`, and cancels SCHEDULED/HELD rows once T09 exists, extended there.
- `displayCampaignStatus(c, hasActiveSubsequence): "Draft"|"Active"|"Paused"|"Completed"|"Running Subsequences"|"Accounts Unhealthy"|"Bounce Protect"|"Archived"`.
- `unsubscribeMode(appUrl)`: `"https"` only for the https protocol and a host that is not `localhost`, `*.local`, `*.localhost`, an IP literal in a private, loopback or link-local range, or `host.docker.internal`; otherwise `"mailto"`.

Launch issues: blocking `no_accounts, no_leads, no_steps, missing_subject (step 1 only), missing_body, template_error {stepId, variantId, issues}, no_schedule, no_physical_address, tracking_domain_unverified, dns_block, dns_warn (blocks unless overrideDnsWarnings, which writes audit campaign.dns_override)`; warnings `unsubscribe_mailto_only, gap_below_5_min, missing_variable {variable, count}, no_matching_esp, provider_not_verified`. Steps, leads and variants come from T06; until T06, `no_steps`/`no_leads` are always raised (the T06 tests cover the success path). Launch sets `status ACTIVE` and `launchedAt ??= now`; it is idempotent on ACTIVE.

Steps:
- [ ] Write the failing tests in `campaigns.test.ts`:
  - defaults: `minGapSec 540`, `randomGapSec 300`, `stopOnReply true`, `unsubscribeHeader true`, `prioritizeNewLeads false`; `unsubscribeHeader:false` → 400; `cc` of 11 → 400; `minGapSec 240` launches with warning `gap_below_5_min`.
  - schedules: office-hours preset stored as `days 62`; `from "09:00", to "09:00"` → 400; timezone `"Mars/Phobos"` → 400; `startDate "2026-11-02"` in `Europe/Berlin` → `startAt 2026-11-01T23:00Z`.
  - launch on an empty campaign → 422 listing `no_accounts, no_leads, no_steps, no_schedule, no_physical_address`; `dnsGate` returning `warn` → `dns_warn` blocks, and with `overrideDnsWarnings` launch passes plus an audit `campaign.dns_override`; `appUrl "http://localhost:3000"` → warning `unsubscribe_mailto_only`; `"https://mail.example.com"` → no warning; `"https://192.168.1.5"` → mailto.
  - `listAccountCampaigns` returns 2 campaigns for an account assigned to both; a foreign account → 404. `accountTags ["warm"]` is stored (rotation honors it in T10).
  - `displayCampaignStatus`: COMPLETED with an active subsequence → `Running Subsequences`.
- [ ] Implement. Route tests: `campaigns:read` key GET → 200 and POST → 403; VIEWER launch → 403; foreign campaign → 404. Routes: `GET,POST /campaigns`, `GET,PATCH,DELETE /campaigns/[id]`, `POST /campaigns/[id]/{launch,pause,resume,archive}`, `PUT /campaigns/[id]/{schedules,accounts}`, `GET /accounts/[id]/campaigns`.
- [ ] Add 726003 and 726004 to the CLAUDE.md namespace list. Commit `feat(campaigns): campaign service, schedules, launch validation`.

## P3-T06 Sequences, subsequences, enrollment, duplicate/export/import

Model: sonnet. **Owns:** PS-SEQ-01, 02, 04, 09 (model, CRUD, stored triggers), 10 (inherit; custom lower `dailyLimit`), 11 (manual move/remove), 22; PS-CAMP-01 (duplicate), 02, 08, 35, 36; PS-LEAD-02, 23; PS-LEAD-18 (campaign and status filters).
Files: migration `sequences` (SequenceStep, StepVariant, Subsequence, CampaignLead); `packages/core/src/campaigns/{sequence,enroll,portable}.ts`; `leads/service.ts` (filters), `leads/suppression.ts` (stop CampaignLeads); routes under `apps/web/app/api/v1/campaigns/[id]/{steps,subsequences,leads}/**`, `/campaigns/[id]/{duplicate,export}`, `/campaigns/import`; test `packages/core/test/sequence.test.ts`.
Signatures:
- `addStep(…, campaignId, { subsequenceId?, delayValue, delayUnit })` and `updateStep`. Main-sequence step 1 is forced to `delayValue 0`. The cumulative delay must stay ≤ 366 days, otherwise 400.
- `deleteStep`: soft delete when the step has SENT rows, otherwise hard delete. Rows are handled in T10.
- `reorderSteps`.
- `addVariant(…, stepId, { subject, body, weight? })`: labels A..Z in order; the 27th → 400. `updateVariant`, `deleteVariant`: the last active one → 400.
- `createSubsequence(…, { name, trigger: { kind: "LEAD_STATUS"; interest: number[] } | { kind: "ACTIVITY"; activity: "completed_no_reply" | "opened" | "clicked" } | { kind: "REPLY_KEYWORD"; phrases: string[] }, preDelayMinutes, dailyLimit? })`, `setSubsequenceActive`: activation stamps `activatedAt`.
- `moveToSubsequence(…, campaignLeadId, subsequenceId)`, `removeFromSubsequence`.
- `enrollLeads(prisma, clock, ws, campaignId, p: { leadIds?: string[]; listId?: string; filter?: LeadQuery; allowDuplicates?: boolean }): { enrolled; skipped: { in_other_active_campaign; already_in_campaign; suppressed; deleted } }`. Batches of 1000, each in a transaction holding `pg_advisory_xact_lock(726004, hashtext(workspaceId))`. A conflict is a CampaignLead in another campaign whose status is ACTIVE or PAUSED and whose state is QUEUED, ACTIVE or PAUSED. New rows are `QUEUED`.
- `removeCampaignLead(…, id)`: STOPPED MANUAL, SCHEDULED rows → CANCELLED.
- `pauseCampaignLead`, `resumeCampaignLead`.
- `campaignLeadStatus(cl): "Active"|"Paused"|"Completed"|"Bounced"|"Unsubscribed"|"Skipped"`: QUEUED/ACTIVE → Active; PAUSED → Paused; COMPLETED or STOPPED with REPLIED, AUTO_REPLIED, COMPANY_REPLIED or MANUAL → Completed; BOUNCED → Bounced; UNSUBSCRIBED → Unsubscribed; SUPPRESSED, SKIPPED or SEND_FAILED → Skipped.
- `duplicateCampaign(…, id)`: a DRAFT copy of settings, schedules, steps, variants and subsequences, without leads or accounts.
- `exportCampaign(…, id)`: `{version:1, campaign, schedules, steps:[{order, delayValue, delayUnit, variants:[{label, subject, body, weight, active}]}], subsequences}`, with no ids, leads or accounts.
- `importCampaign(…, json)`: zod-validated, creates a DRAFT.

`suppress()` now also STOPs (SUPPRESSED) the matching CampaignLeads in QUEUED, ACTIVE or PAUSED state, matching EMAIL on the lead email and DOMAIN on the email domain.

Steps:
- [ ] Write the failing tests in `sequence.test.ts`:
  - step 1 delay forced to 0; steps `[0 d, 200 d, 167 d]` → 400 (367 days); 26 variants ok and the 27th → 400.
  - enrollment: a lead in an ACTIVE campaign A → skipped `in_other_active_campaign` in B; with `allowDuplicates` → enrolled; a suppressed lead → `suppressed`; enrolling twice → `already_in_campaign`; `Promise.all` of two `enrollLeads` for the same lead into B and C → exactly one CampaignLead (lock 726004).
  - `campaignLeadStatus` covers every row of the table above.
  - export, then import → a DRAFT whose step/variant structure deep-equals the export; duplicate → a DRAFT named `"<name> (copy)"` with 0 CampaignLeads.
  - `addBlocklist(["acme.test"])` → the ACTIVE CampaignLead of `jo@acme.test` becomes STOPPED SUPPRESSED.
  - `listLeads({campaignId, status:"Bounced"})` filter works.
  - launch success path (T05 + T06): accounts, a list of 2 leads, 1 step with subject and body, a schedule and an address → `status ACTIVE`, 2 QUEUED CampaignLeads.
- [ ] Implement, run the tests → PASS, and commit `feat(campaigns): sequences, variants, subsequences, enrollment, export/import`.

## P3-T07 Schedule math (parallel-safe)

Model: sonnet. **Owns:** PS-SEQ-03 (delay arithmetic; alignment in T10), PS-SEND-02 (window part).
Files: `packages/core/src/schedule.ts`; test `packages/core/test/schedule.test.ts`. No DB.
Rules:
- A window belongs to the local day it opens on. When `to < from` it runs overnight into the next day, and `to "24:00"` means local midnight.
- `days` uses bit `d` for `getDay()` in the window's zone.
- `addDelay`: MINUTES and HOURS are absolute. DAYS keeps the local wall-clock time N calendar days later in `timezone`. A local time that does not exist (spring-forward gap) moves forward by the gap. An ambiguous time (fall-back) takes the earlier offset.
- Multiple windows are OR-ed.

Steps:
- [ ] Write the failing tests in `schedule.test.ts`:
  - Mon–Fri 09:00–17:00 `America/New_York`: Mon 2026-10-19T13:00Z (09:00 EDT) in; Mon 21:00Z (17:00) out; Sat out; `nextWindowStart(Sat 2026-10-24T12:00Z)` = `2026-10-26T13:00Z`.
  - overnight Mon-only 22:00–06:00 UTC: Mon 23:00 in, Tue 05:59 in, Tue 06:00 out, Tue 23:00 out.
  - DST: `addDelay(2026-03-07T12:00Z /*07:00 EST*/, 1, "DAYS", "America/New_York")` = `2026-03-08T11:00Z` (07:00 EDT, 23 h later); `addDelay(2026-03-08T06:30Z /*01:30 EST*/, 1, "HOURS")` = `07:30Z`; a 02:30 local DAYS target on 2026-03-08 → 03:30 EDT; `Europe/London` 2026-10-25 fall-back `nextWindowStart` for a 01:00–02:00 window returns the first 01:00 (00:00Z).
  - `startOfNextDay("Pacific/Auckland", 2026-03-01T12:00Z)` = `2026-03-02T11:00Z`; `isValidTimeZone("EST5EDT")` true and `("Mars/Phobos")` false; `days 0` → `nextWindowStart` throws.
- [ ] Implement using `Intl.DateTimeFormat` offsets only (no new dependency). Run → PASS. Commit `feat(core): schedule windows, DST-safe delays`.

## P3-T08 Unsubscribe

Model: sonnet. **Owns:** PS-SEQ-19 (footer); PS-CAMP-25; compliance rules "List-Unsubscribe", "footer + physical address", "unsubscribe → suppression immediately"; PS-SEND-14 (unsubscribe headers).
Files: `packages/core/src/unsubscribe.ts`; `apps/web/app/u/[token]/route.ts` (GET page and POST, `route({auth:"public"})`); `apps/web/app/api/v1/settings/workspace/route.ts` (`GET`, `PATCH {timezone, physicalAddress}`, ADMIN; T13 extends it); settings page section; `docs/ops/KEY_ROTATION.md` (OLD_ENCRYPTION_KEY note); core env; test `packages/core/test/unsubscribe.test.ts`, `apps/web/test/unsubscribe-route.test.ts`.
Signatures (in addition to Fixed names):
- `unsubscribeLead(prisma, clock, p: UnsubPayload, source: "one_click" | "page"): Promise<"done" | "already">`: one transaction. `suppress(EMAIL, UNSUBSCRIBE, source)`, every CampaignLead of the lead in QUEUED, ACTIVE or PAUSED → STOPPED UNSUBSCRIBED, SCHEDULED rows → CANCELLED (once T09 exists). An erased or missing lead → `"already"`.
- `suppressMailtoUnsubscribe(prisma, clock, p: { workspaceId; fromEmail })`: the hook P4-T02/T03 calls for an "unsubscribe" reply.
- `unsubscribeUrl(env: RenderEnv, p: UnsubPayload, accountEmail: string): string`: https mode → `${appUrl}/u/${token}`, mailto mode → `mailto:${accountEmail}?subject=unsubscribe`.
- `listUnsubscribeHeaders(env, p, accountEmail): Record<string,string>`: https mode → `{"List-Unsubscribe": "<https://…/u/T>, <mailto:acct?subject=unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}`; mailto mode → `{"List-Unsubscribe": "<mailto:acct?subject=unsubscribe>"}`, with no Post header (RFC 8058 needs https).
- `withComplianceFooter(body: { html: string | null; text: string }, p: { unsubscribeUrl; physicalAddress; hasLinkVariable: boolean }): { html; text }`: appends the HTML `<p style="font-size:12px;color:#666">{address escaped}<br><a href="{url}">Unsubscribe</a></p>` and the text `\n\n--\n{address}\nUnsubscribe: {url}`. The link is omitted when the body already used `{{unsubscribeLink}}`. The address is always added.

Page copy: GET → "Unsubscribe from emails sent to {masked email, e.g. j***@acme.test}?" with a button that POSTs, and "You are unsubscribed." if already done. POST (either `List-Unsubscribe=One-Click` form body or the button) → 200 "You have been unsubscribed." Invalid token → 400 "This unsubscribe link is invalid." No auth, no cookie, no origin check.

Steps:
- [ ] Write the failing tests:
  - `unsubscribe.test.ts`: sign/verify round-trip; flipping one character of the payload or the MAC → `null`; a token signed with a key derived from the old key verifies when `OLD_ENCRYPTION_KEY` is set and not otherwise; `unsubscribeLead` twice → `"done"` then `"already"`, one Suppression row, all 2 CampaignLeads of the lead STOPPED UNSUBSCRIBED; header values exactly as in the signatures; the footer text and HTML exactly as in the signatures; an address containing `<b>` is escaped.
  - `unsubscribe-route.test.ts` (Review Focus 4): GET with a valid token → 200 HTML with a form and **no Suppression row**; POST with `List-Unsubscribe=One-Click` → 200 and one row with `source "one_click"`; a second POST → 200 with still one row; a tampered token → 400; a token for a GDPR-erased lead → 200 "You have been unsubscribed."; no session needed.
  - settings: MEMBER PATCH → 403; ADMIN sets `physicalAddress`, audit `settings.update`; `timezone "Bad/Zone"` → 400.
- [ ] Implement, run → PASS, and commit `feat(compliance): signed unsubscribe, one-click endpoint, footer, physical address`.

## P3-T09 Quota and dispatcher claim

Model: **opus** (master plan). **Owns:** PS-SEND-02 (account cap, gap, campaign cap), 04, 05, 06, 07 (unique key), 16; PS-ACC-27 (the claim excludes paused accounts at once); compliance "suppression re-checked at claim", "Cc/Bcc count toward quota"; master Review Focus #3; E2E #6; D16, D17, D18 recorded in `docs/DECISIONS.md`.
Files: migration `send_queue` (CampaignDailyUsage, ScheduledMessage, ProviderVerification, MessageStatus); `packages/core/src/{quota,dispatch}.ts`; `campaigns/service.ts` (delete cancels rows); `leads/suppression.ts` and `unsubscribe.ts` (cancel SCHEDULED rows); `packages/core/test/campaign-fixture.ts` (`seedCampaign(prisma, opts) → {ws, campaign, accounts, leads, rows}`, `markFresh`, `planRow(…)`, which inserts SCHEDULED rows directly so T09 does not depend on the planner); tests `packages/core/test/dispatch.test.ts`, `packages/core/test/e2e/quota.test.ts`; `apps/worker/src/boss.ts` (`JobDeps.bootId`).

Claim, one message per transaction, inside `withTxRetry`:

```sql
SELECT sm.id, sm."campaignId", sm."campaignLeadId", sm."stepId", sm."accountId", sm."workspaceId"
FROM "ScheduledMessage" sm
JOIN "CampaignLead" cl ON cl.id = sm."campaignLeadId"
JOIN "Campaign" c ON c.id = sm."campaignId"
JOIN "EmailAccount" a ON a.id = sm."accountId"
JOIN "Workspace" w ON w.id = sm."workspaceId"
WHERE sm.status = 'SCHEDULED' AND sm."dueAt" <= $now
  AND cl.state = 'ACTIVE' AND c.status = 'ACTIVE' AND c."deletedAt" IS NULL
  AND (c."startAt" IS NULL OR c."startAt" <= $now) AND (c."endAt" IS NULL OR c."endAt" > $now)
  AND a."deletedAt" IS NULL AND a.lifecycle IN ('ACTIVE','REWARMING') AND a.provider = ANY($sendable)
  AND a."lastSyncCompletedAt" >= $now - make_interval(secs => $staleness)
  AND a."nextSendAt" <= $now AND coalesce(btrim(w."physicalAddress"), '') <> ''
  AND EXISTS (SELECT 1 FROM "CampaignAccount" ca WHERE ca."campaignId" = c.id AND ca."accountId" = a.id)
  AND (NOT c."stopForCompanyOnReply" OR NOT EXISTS (
        SELECT 1 FROM "CampaignAccount" ca2 JOIN "EmailAccount" a2 ON a2.id = ca2."accountId"
        WHERE ca2."campaignId" = c.id AND a2."deletedAt" IS NULL
          AND (a2.lifecycle = 'NEEDS_ATTENTION' OR a2."lastSyncCompletedAt" IS NULL
               OR a2."lastSyncCompletedAt" < $now - make_interval(secs => $staleness))))
ORDER BY sm."dueAt", sm.id
FOR UPDATE OF sm SKIP LOCKED LIMIT 1
```

Then, in the same transaction:
1. **Suppression and lead re-check.** If the lead is soft-deleted, `INVALID`, or `isSuppressed` (EMAIL hash or DOMAIN hash), set the row CANCELLED with `error 'suppressed'`, and set the CampaignLead STOPPED SUPPRESSED (`WHERE state='ACTIVE'`). Commit.
2. **Window.** If `!isInWindow(schedules, now)`, set `dueAt = nextWindowStart(schedules, now)` and commit.
3. **Days and units.** `usageDay = dayKey(a.timezone, now)`, `campUsageDay = wsUsageDay = dayKey(w.timezone, now)`, `units = 1 + cc.length + bcc.length`. Allowances: account `effectiveAllowance(a, now)`, campaign `c.dailyLimit ?? 2147483647`, workspace `w.dailyCap ?? 2147483647`.
4. **Reserve under `SAVEPOINT reserve`,** one statement per table (shown for the account; campaign and workspace are identical on their keys):

```sql
INSERT INTO "AccountDailyUsage" ("accountId", day, sent, reserved)
SELECT $acct, $day::date, 0, $u WHERE $u <= $allow
ON CONFLICT ("accountId", day) DO UPDATE SET reserved = "AccountDailyUsage".reserved + $u
WHERE "AccountDailyUsage".sent + "AccountDailyUsage".reserved + $u <= $allow
RETURNING 1
```

   Then `UPDATE "EmailAccount" SET "nextSendAt" = $now + make_interval(secs => $gap) WHERE id = $acct AND "nextSendAt" <= $now RETURNING 1`, with `gap = max(a.minGapSec, c.minGapSec) + floor(random() * (max(a.randomGapSec, c.randomGapSec) + 1))`.
5. **Any zero-row result** → `ROLLBACK TO SAVEPOINT reserve`. The status stays SCHEDULED. For a full account, set `dueAt = nextWindowStart(schedules, startOfNextDay(a.timezone, now))`. For a full campaign or workspace, do the same with `w.timezone`. For a lost gap race, set `dueAt = (SELECT "nextSendAt")`.
6. **Otherwise** set `status='SENDING'`, `claimToken = randomUUID()`, `claimedAt = now`, `claimBootId`, the three usage days, `reservedUnits = units`, and `rfcMessageId = COALESCE("rfcMessageId", newMessageId(account domain))`, all `WHERE id AND status='SCHEDULED'`.

`claimDue` repeats this up to `limit` times and stops at the first empty SELECT. `commitUsage`, `releaseUsage` and `creditSent` update all three stored-day rows by key.

Steps:
- [ ] Write the failing tests in `dispatch.test.ts` (the fixture has two accounts A, B, `dailyLimit 5`, gaps 0, fresh, workspace with an address, schedule anyTime UTC, Fake sendable):
  - `parallel claim: 2 dispatchers × 2 accounts, no deadlock, no over-quota`: 20 due rows (10 per account), two separate `createPrisma` clients each looping `claimDue({limit:1})` until empty, run with `Promise.all` → no rejection; 10 claimed in total, 5 per account; `AccountDailyUsage.reserved` is 5 and 5; every `id` appears exactly once across both result lists; every claimed row has a distinct `claimToken`.
  - `account at 49/50, two workers → exactly one more` (master Review Focus #3): `dailyLimit 50` (`providerCap 100`), usage `sent 49`, 2 due rows, two clients claiming concurrently → 1 SENDING and 1 SCHEDULED, whose `dueAt` = next day's window start; usage `sent 49, reserved 1`.
  - `claim at 23:59:59, completes at 00:00:01, credited to the claim day` (master Review Focus #3): clock `2026-10-20T23:59:59Z` with account tz UTC → `usageDay "2026-10-20"`; `clock.advance(2000)`, `commitUsage(row)` → the 2026-10-20 row has `sent 1, reserved 0`, and no 2026-10-21 row exists. In `Pacific/Auckland` the same instant uses `"2026-10-21"` for the account while `campUsageDay` stays `"2026-10-20"` (workspace UTC).
  - `campaign cap`: `dailyLimit 3`, 5 due rows across A/B → 3 claimed; 2 SCHEDULED with `dueAt = 2026-10-21T00:00Z` (anyTime window, next workspace day).
  - `workspace cap`: `dailyCap 2` across two campaigns → 2 claimed.
  - `reservation rollback`: the campaign is full but A has room → A's usage row is byte-equal to before (`reserved` unchanged, no new row) and `A.nextSendAt` unchanged.
  - `first claim of the day with allowance 0`: `dailyLimit 0` → nothing claimed, no `AccountDailyUsage` row created. `units > allowance`: `cc 1, bcc 1` (units 3) with `dailyLimit 2` → nothing claimed, no row. `cc/bcc count`: `cc 1, bcc 1`, limit 5 → `reservedUnits 3`, `reserved 3`.
  - `paused campaign / past endAt → not claimed`: status PAUSED → `[]` with the row unchanged; `endAt = now − 1 s` → `[]`; `startAt` in the future → `[]`.
  - `overdue row at 03:00 → not sent until window opens`: schedule 09:00–17:00 `Europe/Berlin`, row `dueAt` yesterday 10:00, now 03:00 local → `[]`, the row's `dueAt` becomes today 09:00 local; at 09:00 it is claimed.
  - `freshness gate`: `lastSyncCompletedAt = now − 301 s` → `[]`; `now − 299 s` → claimed; `null` → `[]`. Company stop with the campaign's second account B stale → A's row not claimed; B soft-deleted → claimed; B unassigned → claimed; B fresh but `NEEDS_ATTENTION` → not claimed.
  - `sticky gate`: a step-2 row on A with A `PAUSED` and B eligible → `[]`, with `accountId` still A (PS-ACC-27).
  - `suppression re-check`: after the row is planned, `addBlocklist(["acme.test"])` (a DOMAIN entry) → `[]`, the row is `CANCELLED` with `error "suppressed"`, the CampaignLead is STOPPED SUPPRESSED, and there is no usage row; the same holds for an EMAIL entry.
  - `provider gate` (D17): `sendableProviders` without the Fake flag and with no rows → `[]` and the claim returns nothing for a GMAIL account; after inserting `ProviderVerification{provider:"GMAIL"}` it is claimed. `physical address empty → not claimed`.
  - `gap`: A `minGapSec 0`, campaign `540/300`, `random = () => 0.5` → `nextSendAt = now + 540 + 150 s`; a second row on A in the same `claimDue({limit:5})` is not claimed.
  - `effectiveAllowance`: `dailyLimit 30, providerCap 40` → 20; `ctx {healthThrottle: 7}` → 7; `{rewarmAllowance: 4}` → 4. `withTxRetry` retries a function that first throws `{code:"40P01"}` and returns its second result; a third consecutive failure rethrows.
- [ ] Write `e2e/quota.test.ts` (E2E #6): 3 simulated days, 40 due rows, A `dailyLimit 10`, office hours. Each simulated minute runs `markFresh`, `claimDue`, `commitUsage`. Expect exactly 10 SENT-committed per day and per account, none claimed outside 09:00–17:00, and day 4 claims the remaining 10.
- [ ] Run → FAIL. Implement the migration (incl. `ProviderVerification`), `quota.ts`, `dispatch.ts`, the fixture and `JobDeps.bootId` (`startWorker` passes it). Run → PASS.
- [ ] Record D16–D18 in `docs/DECISIONS.md`. Commit `feat(send): quota reservation and dispatcher claim`.

## P3-T10 Planner, rotation, advancement, subsequence entry, completion, explainer

Model: sonnet. **Owns:** PS-SEND-02 (new-lead, per-company, prioritize), 03; PS-SEQ-03 (window alignment), 05, 07 (manual, status, blocklist stop), 09 (LEAD_STATUS and completed_no_reply entry), 11 (automatic entry); PS-CAMP-05 (completion), 23, 24, 34 (explainer core); PS-LEAD-04 (subsequence side), 05 (INVALID/RISKY rule); PS-ACC-21 (rotation honors tags), PS-ACC-27 (re-route); Review Focus 1, 3; E2E #7.
Files: `packages/core/src/{rotation,planner,explain}.ts`; `campaigns/sequence.ts` (edit hooks); `leads/service.ts` (interest change → subsequence entry); `apps/worker/src/jobs/campaign-plan.ts`; route `GET /api/v1/campaigns/[id]/status`; tests `packages/core/test/{planner,rotation,explain}.test.ts`, `packages/core/test/e2e/rotation.test.ts`.

**Planner.** Per ACTIVE campaign, only while `isInWindow`, in a transaction holding `pg_advisory_xact_lock(726003, hashtext(campaignId))`, `batch` default 500:
1. **Select candidates.** CampaignLeads with state `QUEUED` (new) or `ACTIVE` and `nextDueAt <= now`, with no ScheduledMessage for `(id, currentStepId)` in SCHEDULED, SENDING, UNCERTAIN or HELD. Order: when `prioritizeNewLeads`, QUEUED first; otherwise follow-ups first. Then `nextDueAt` and `id`.
2. **Lead checks.** Lead deleted, suppressed, `INVALID`, or `RISKY`/`CATCH_ALL` without `allowRisky` → STOPPED (`SUPPRESSED` or `SKIPPED`).
3. **New leads.** Stop once `CampaignDailyUsage.newLeads` for today's workspace day reaches `maxNewLeadsPerDay`. Per company, with campaign and workspace scopes: skip a lead when step-1 rows created today for leads with the same non-null `companyDomain` reach the limit. Step 1 goes through `pickAccount`. With no account, the lead stays QUEUED. Otherwise the lead becomes ACTIVE with `currentStepId = step 1` and `newLeads += 1`.
4. **Follow-ups.** `accountId = cl.accountId`. Subsequence steps use the sticky account too, and the subsequence's `dailyLimit` caps today's subsequence rows.
5. **Choose the variant.** The active variant with the smallest `assigned / weight`, tie broken by label, then `assigned += 1`.
6. **Render** with `renderForLead`. Subject: step N>1 with an empty subject → `"Re: " + the rendered step-1 subject` (PS-SEQ-06). Body: `html = null` when `textOnly`, `firstEmailTextOnly && order 1`, or `workspace.firstEmailTextOnly && order 1`; text comes from html-to-text; the footer comes from T08.
7. **Upsert:**

```sql
INSERT INTO "ScheduledMessage" (id, "idempotencyKey", …, status, "dueAt") VALUES (…, 'SCHEDULED', $now)
ON CONFLICT ("idempotencyKey") DO UPDATE SET status = 'SCHEDULED', "dueAt" = EXCLUDED."dueAt", "accountId" = EXCLUDED."accountId",
  "variantId" = EXCLUDED."variantId", "renderedSubject" = EXCLUDED."renderedSubject", "renderedBody" = EXCLUDED."renderedBody",
  "renderedText" = EXCLUDED."renderedText", error = NULL, "claimToken" = NULL, "uncertainAt" = NULL, "searchCount" = 0
WHERE "ScheduledMessage".status = 'CANCELLED'
RETURNING id, (xmax <> 0) AS revived
```

   A CANCELLED row is revived only because the lead is ACTIVE again with that step due (re-planning is intended). Rows that are SENT, SENDING, UNCERTAIN, HELD or FAILED are never touched.
8. **Re-route pass.** SCHEDULED rows of main-sequence step order 1 whose account is no longer eligible get a new account from `pickAccount` and a re-render, `WHERE id AND status='SCHEDULED' AND "accountId" = old`.
9. **Completion pass.** A non-evergreen campaign with no CampaignLead in QUEUED, ACTIVE or PAUSED and no open rows → COMPLETED.

`advanceLead` (called by the sender and the resolver in the same transaction as SENT):
- **Next step exists:** `currentStepId = next`, `nextDueAt = nextWindowStart(schedules, addDelay(sentAt, delayValue, delayUnit, schedules[0].timezone))`.
- **No next step:** `COMPLETED`, `completedAt`. Then, if an active subsequence has the trigger `ACTIVITY completed_no_reply`, the lead enters it: `subsequenceId`, `state ACTIVE`, `currentStepId = its first step`, `nextDueAt = now + preDelayMinutes`.

A `LEAD_STATUS` trigger enters the same way when `updateLead` sets an `interestStatus` listed in an active subsequence's trigger, for CampaignLeads enrolled before `activatedAt` too. Only changes after `activatedAt` count.

**`pickAccount`.** Eligible accounts are the assigned, non-deleted ones that are ACTIVE or REWARMING, fresh, sendable, carry ≥ 1 of `campaign.accountTags` (empty = any), pass `routeAllowed`, and have `remaining = effectiveAllowance − sent − reserved − (SCHEDULED rows due before the next local midnight) > 0`.
- **ESP routing:** any matching `do_not_send` rule excludes the account. When `send` rules exist, at least one must match.
- **`matchProvider`:** prefer accounts whose ESP equals the lead's (GMAIL ↔ GOOGLE, MICROSOFT ↔ MICROSOFT); fall back to the rest.
- **Tie-break:** least `sent + reserved + scheduled` today, then oldest `lastSentAt` (nulls first), then `id`.

**Editing (Review Focus 3).** `updateVariant`/`updateStep` re-render every SCHEDULED row of that variant or step (`WHERE status='SCHEDULED'`). `deleteStep` answers 409 while any of its rows are SENDING, UNCERTAIN or HELD. Otherwise its SCHEDULED rows → CANCELLED, and its CampaignLeads move to the next step (`nextDueAt` kept) or COMPLETED.

**Explainer.** `whyNotSending(prisma, clock, ws, campaignId, o: { stalenessSec; sendable })` returns `{ sending: boolean; nextWindowAt?: Date; reasons: { code: "draft"|"paused"|"completed"|"not_started"|"ended"|"outside_window"|"no_accounts"|"accounts_unavailable"|"sync_pending"|"provider_not_verified"|"no_physical_address"|"account_quota_reached"|"campaign_quota_reached"|"workspace_quota_reached"|"no_eligible_leads"; accountIds?: string[] }[] }`.

Steps:
- [ ] Write the failing tests:
  - `rotation.test.ts`: `even rotation` (3 fresh accounts, 30 QUEUED leads, `maxNewLeadsPerDay null`, one `planDue` → step-1 rows per account 10/10/10); `matchProvider` (lead GOOGLE, accounts GMAIL+SMTP → GMAIL); `do_not_send {recipientEsp:"google", senderEsp:"outlook"}` excludes the MICROSOFT account for a GOOGLE lead; `accountTags ["warm"]` → only the tagged account; a stale account is never picked.
  - `planner.test.ts`:
    - `sticky follow-ups`: step 1 SENT from A (`cl.accountId = A`), B emptier → the step-2 row is on A.
    - `step-1 re-route on ineligible account`: a SCHEDULED step-1 row on A, A set `PAUSED` (PS-ACC-27) → next `planDue` gives `accountId B`, and `renderedBody` contains B's `{{sendingAccountFirstName}}`; a SCHEDULED step-2 row on A stays on A.
    - `revive-not-duplicate re-plan`: a CANCELLED row for (cl, step 2), with the lead resumed (`state ACTIVE`, due) → after `planDue` 1 row with the same `id`, `status SCHEDULED`, `revived 1`; rows that are SENT, SENDING, UNCERTAIN or HELD for the current step → `planDue` leaves `status`/`updatedAt` unchanged and inserts nothing.
    - `maxNewLeadsPerDay 5` with 20 QUEUED → 5 planned and `newLeads 5`; the next local day 5 more.
    - Review Focus 1: per-company limit 2 with 5 leads at `acme.test` → 2 planned; 5 leads at `gmail.com` → 5 planned.
    - `prioritizeNewLeads`: `batch 3` with 3 due follow-ups and 3 QUEUED → false plans the follow-ups, true plans the new leads.
    - an INVALID lead → STOPPED SKIPPED; RISKY → SKIPPED unless `allowRisky`.
    - variant balancing: weights A1, B1 over 10 leads → 5/5; adding C after that → the next 4 leads all get C.
    - `advanceLead`: step 2 `delay 2 DAYS`, office hours `Europe/Berlin`, sentAt Fri 16:00 local → `nextDueAt` Mon 09:00 local; the last step → COMPLETED, and with an active `completed_no_reply` subsequence (`preDelayMinutes 60`) → `subsequenceId` set, `nextDueAt = now + 60 min`; `advanceLead` with a stale `stepId` changes nothing.
    - LEAD_STATUS: subsequence on `interest [1]` activated at T; `updateLead(interestStatus 1)` at T+1 → enters.
    - completion: a non-evergreen campaign whose leads are all COMPLETED or STOPPED → `COMPLETED`; evergreen stays ACTIVE.
    - Review Focus 3: `updateVariant(subject "Fixed")` → the SCHEDULED row's `renderedSubject` is "Fixed" and a SENT row is unchanged; `deleteStep(step 2)` with a HELD row → 409, with only SCHEDULED rows → the rows are CANCELLED and the leads at step 2 move to step 3.
    - the stored render equals `renderForLead` output and contains the footer address.
  - `explain.test.ts`: one test per code. For example, stale account → `sync_pending` with `accountIds [A]`; no `ProviderVerification` → `provider_not_verified`; outside the window → `outside_window` with `nextWindowAt`; a DRAFT campaign → `draft` only.
  - `e2e/rotation.test.ts` (E2E #7): 3 accounts, 60 leads, 3 simulated days of plan, claim and commit → per-account sends differ by ≤ 1 each day; pausing account B on day 2 → B's queued step-1 rows move to A and C, and its follow-ups wait.
- [ ] Implement. `campaign-plan` job handler: `planDue(prisma, clock, {stalenessSec: env.SYNC_MAX_STALENESS_SEC, sendableProviders: await sendableProviders(prisma, env), env})`; test by direct call.
- [ ] Commit `feat(send): planner, rotation, sequence advancement, explainer`.

## P3-T11a Sender

Model: **opus** (master plan). **Owns:** PS-SEND-09, 10 (states; SENT is shown as "Accepted by provider", never "delivered"), 14 (headers), 15 (provider side done in P2, verified here); PS-SEQ-06; carry-forwards from TASKS.json: `ProviderError.providerMessageId` persisted for the `findSent` hint, and **I-8** (D18); Review Focus 2.
Files: `packages/core/src/sender.ts`; `packages/providers/src/errors.ts` (`PermanentSendError` `scope`); the scope mapping in `imap-smtp/map-error.ts`, `gmail/http.ts`, `graph/http.ts` and `fake/provider.ts`; `apps/worker/src/jobs/campaign-dispatch.ts`; tests `packages/core/test/sender.test.ts`, `packages/providers/test/errors-scope.test.ts`.

Scope mapping: **SMTP** a 5xx on `RCPT TO` or enhanced `5.1.x`/`5.2.1`/`5.2.2` → recipient, `5.7.x` on `MAIL FROM`/`AUTH` → account, else unknown; **Graph** `ErrorInvalidRecipients` → recipient, `ErrorSendAsDenied` → account; **all providers** `from_mismatch` → account; **Gmail** otherwise unknown; **Fake** `permanent_rejected` → recipient, `smtp_5xx` → unknown.

`sendClaimed`, step by step:
1. **Stale-claim check.** If `now − claimedAt > 120 s`, run `releaseUsage` and set `status SCHEDULED` (`WHERE id AND "claimToken" AND status='SENDING'`), then return `STALE`.
2. **Pre-call re-check (Review Focus 2).** One read must show: the row still SENDING with this token, the campaign ACTIVE, the CampaignLead ACTIVE, the lead not deleted, `!isSuppressed`, and the account assigned, not deleted, and ACTIVE or REWARMING.
   - Suppressed → CANCELLED, lead STOPPED SUPPRESSED, release.
   - Anything else failing → release and SCHEDULED, then return `RELEASED`.
   - Row gone or token changed → `LOST`.
3. **Build the `OutboundMime`:**
   - `from {account.email, fromName}`, `to [lead email]`, `cc`, `bcc`, `replyTo`
   - `subject = renderedSubject`, `html = renderedBody` unless text-only, `text = renderedText`
   - `messageId = rfcMessageId`
   - `inReplyTo` = the last SENT `rfcMessageId` of this CampaignLead, `references` = all of them in `sentAt` order
   - `threadId = cl.threadRef`
   - `headers = listUnsubscribeHeaders(…)`
   - Then call `provider.send(mime, { signal: AbortSignal.timeout(60_000) })` outside any transaction.
4. **Accepted.** One transaction. `UPDATE … SET status='SENT', "sentAt"=now, "providerMessageId", "providerThreadId" WHERE id AND "claimToken"=$t AND status='SENDING'`. When 1 row: `commitUsage`; lead `emailsSent += 1`, `lastContactedAt`, `lastTouchAt`, `lastSenderAccountId`; account `lastSentAt`, `lastCampaignActivityAt`; on step 1, `cl.accountId ??= account` and `threadRef ??= providerThreadId`; `advanceLead`. When 0 rows, go to **late accept** (`SELECT … FOR UPDATE` by id):

| Current row | Action |
|---|---|
| UNCERTAIN | → SENT, `commitUsage` (reservation still held), advance |
| HELD or CANCELLED (reservation already released) | → SENT, `creditSent` (sent += units, `reserved` untouched), advance |
| SENT | no change |
| SCHEDULED (a released HELD row waiting to be resent) | → SENT, `creditSent`, advance (this removes the pending re-send) |
| SENDING under another claimToken (re-claimed) | → SENT, `commitUsage` on the row's current stored days (the new claim's reservation), advance. The other sender's pre-call check then finds a changed token and returns `LOST`. |

5. **`RateLimitedError(s)`.** `releaseUsage`, SCHEDULED, `attempts += 1`, `dueAt = now + max(s, 60·2^(attempts−1))`, and `EmailAccount.nextSendAt = GREATEST("nextSendAt", now + s)`.
6. **`TransientBeforeSendError`.** The same without the account push. At `attempts = 5` → FAILED `max_attempts` with a release.
7. **`AmbiguousSendError`, or any non-`ProviderError` throw.** UNCERTAIN, `uncertainAt = now`, reservation kept.
8. **`PermanentSendError`.** FAILED, release, then by D18 scope:
   - recipient → lead STOPPED BOUNCED and `suppress(EMAIL, HARD_BOUNCE, "send")`
   - account or unknown → `recordProviderError`, CampaignLead PAUSED with `stopReason SEND_FAILED`
9. **`AuthError`.** `recordProviderError` (NEEDS_ATTENTION unless the user paused the account), release, SCHEDULED, `attempts` unchanged.
10. **Every error path** stores `err.providerMessageId` on the row when present, and every write is conditional on `id + claimToken + status='SENDING'`.

`dispatchTick` loops until nothing is claimable or `maxMs` (50 000) has passed. Each round is `claimDue({limit: concurrency})`, then the claimed rows are sent in parallel, at most `concurrency` (default 4) at a time.

Steps:
- [ ] Write the failing tests in `sender.test.ts` (Fake provider, fixture from T09, `RenderEnv appUrl "https://app.example.com"`):
  - accepted: row SENT with `providerMessageId`; usage `sent 1, reserved 0` on `usageDay`; lead `emailsSent 1`; `cl.accountId = A`; `cl.currentStepId = step 2`; the Fake raw has our Message-ID, `List-Unsubscribe: <https://app.example.com/u/…>, <mailto:a@…?subject=unsubscribe>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, the footer address, and `Cc` (no `Bcc`); with `appUrl "http://localhost:3000"` there is no Post header and only the mailto.
  - follow-up: step 2 with an empty subject → `Subject: Re: <step-1 subject>`, `In-Reply-To` = step 1's Message-ID, `References` = [step 1], same From, and the Gmail-style `threadId` passed when `threadRef` is set.
  - `429 pushes account`: `failNext("rate_limit")` with `Retry-After 120` → SCHEDULED, `attempts 1`, `dueAt = now + 120 s`, `A.nextSendAt = now + 120 s`, `reserved 0`.
  - transient: `connect_refused` → `dueAt = now + 60 s`; after the 5th → FAILED `max_attempts`, `reserved 0`.
  - `ambiguous timeout and API 5xx → UNCERTAIN`: `timeout_after_write` and `api_5xx` → UNCERTAIN, `reserved` still 1, `uncertainAt = now`; a thrown `AmbiguousSendError` carrying `providerMessageId "d-1"` → the row's `providerMessageId "d-1"`.
  - I-8: `permanent_rejected` → FAILED, lead STOPPED BOUNCED, Suppression `HARD_BOUNCE`, `A.errorCount24h 0`. `PermanentSendError("from_mismatch", undefined, {scope:"account"})` → `errorCount24h 1`, `lastError.kind "SENDING"`, CampaignLead PAUSED `SEND_FAILED`, no suppression. Unknown scope → health counted, no suppression.
  - `AuthError` → account `NEEDS_ATTENTION`, row SCHEDULED, `reserved 0`; a user-PAUSED account stays PAUSED.
  - `stale claim (>2 min) not sent`: `clock.advance(121_000)` between claim and `sendClaimed` → `STALE`, the Fake `sentRaw()` is empty, SCHEDULED, `reserved 0`.
  - Review Focus 2, one case each between claim and send: campaign paused → `RELEASED`; lead unsubscribed (`unsubscribeLead`) → CANCELLED; account removed from the campaign → `RELEASED`; in each case `sentRaw()` is empty and `reserved 0`.
  - `late accept on HELD row credits sent once`: claim (reserved 1); before the conditional update the test sets the row HELD and calls `releaseUsage` (reserved 0); the send completes → SENT, usage `sent 1, reserved 0`; repeating the late-accept handler → still `sent 1`. A test per table row: UNCERTAIN → `sent 1, reserved 0`; SCHEDULED → SENT with `sent 1`; re-claimed under token T2 → SENT and T2's sender returns `LOST` with `sentRaw()` length 1; SENT → unchanged.
  - `dispatchTick` with 3 accounts and 6 due rows, concurrency 2 → 6 SENT, no account gap violated (`nextSendAt` checks).
- [ ] `errors-scope.test.ts`: `mapSmtpError({responseCode:550, command:"RCPT TO", response:"550 5.1.1 user unknown"})` → `scope "recipient"`; `{responseCode:554, response:"554 5.7.1 relay denied", command:"MAIL FROM"}` → `"account"`; `{responseCode:552}` → `"unknown"`; Graph 400 `ErrorInvalidRecipients` → recipient; `new PermanentSendError("x").scope === "unknown"`.
- [ ] Implement. `campaign-dispatch` handler: `dispatchTick(prisma, clock, {bootId, providerFor: a => createProvider(a,{prisma,clock}), env, stalenessSec, sendableProviders: await sendableProviders(prisma, env)})`. Commit `feat(send): sender with error classification, late-accept rules, I-8`.

## P3-T11b Recovery, HELD API, worker wiring, process-level E2E

Model: **opus** (master plan). **Owns:** PS-SEND-01 (pg-boss queues per D1), 07 (uncertain reconciliation), 08, 13, 17 (failure counters and the dead-letter list API; UI in T12; alerting hook → P7-T01); master Review Focus #1; E2E #5, #15, #16 (worker part); D17 recording in `scripts/live-verify.ts`.
Files: `packages/core/src/{recovery,scheduled}.ts`; `apps/worker/src/jobs/send-recovery.ts`; `apps/worker/src/{boss.ts,index.ts}` (boot sends); `packages/providers/src/fake/provider.ts` (`FAKE_SEND_HANG_MS`: after persisting the sent copy, wait N ms before resolving; Fake only); `scripts/live-verify.ts` and `docs/ops/LIVE_VERIFICATION.md` (record and gate section); routes `GET /api/v1/scheduled-messages` (`status, campaignId, accountId, cursor`), `POST /api/v1/scheduled-messages/[id]/{release,cancel,retry}`; tests `packages/core/test/recovery.test.ts`, `packages/core/test/e2e/multistep.test.ts`, `apps/worker/test/{restart,browser-closed,crash}.test.ts`, `apps/web/test/scheduled-api.test.ts`.

Algorithms:
- **`recoverExpired`:** `UPDATE "ScheduledMessage" SET status='UNCERTAIN', "uncertainAt"=$now WHERE status='SENDING' AND "claimedAt" < $now - make_interval(secs => $lease) RETURNING id`. The lease alone decides.
- **`resolveUncertain`:**
  - Take up to 50 rows with `status='UNCERTAIN' AND ("lastSearchAt" IS NULL OR "lastSearchAt" <= $now - interval '15 minutes')`.
  - Call `provider.findSent(rfcMessageId, { providerMessageId })` outside any transaction.
  - **Throws:** row unchanged, `errors += 1`.
  - **Found:** `UPDATE … SET status='SENT', "sentAt"=found.date, "providerMessageId"=found.providerMessageId, "providerThreadId" WHERE id AND status='UNCERTAIN'` + `commitUsage` + `advanceLead` + the sticky and lead counters (same helper as the sender).
  - **Not found, `searchCount = 0`:** `searchCount=1, lastSearchAt=now` (`WHERE … AND "searchCount"=0`).
  - **Not found, `searchCount ≥ 1`:** `HELD` + `releaseUsage` (`WHERE … status='UNCERTAIN'`). Then, for a MICROSOFT account with a `providerMessageId`, a best-effort `deleteDraft` if the provider has it (it deletes only `isDraft`).
- **`releaseHeld(prisma, clock, ws, id, actorId, { confirm: true })`:** HELD → SCHEDULED, `dueAt = now`, the same `rfcMessageId` kept, audit `message.release`. Not HELD → 409; no `confirm` → 400 ("may send a duplicate").
- **`cancelScheduled`:** SCHEDULED or HELD → CANCELLED, audit.
- **`retryFailed`:** FAILED → SCHEDULED, `attempts 0`, CampaignLead → ACTIVE (`WHERE state='PAUSED' AND stopReason='SEND_FAILED'`).
- **`listScheduled`:** cursor pagination with `renderedSubject`, lead email, account email, `status`, `dueAt`, `error`.
- **live-verify:** new `recordVerification(prisma, provider: AccountProvider, accountId: string, steps: { step: string; ok: boolean; detail?: string }[]): Promise<"recorded" | "removed">` in `packages/core/src/accounts/live-verify.ts`, called by the script: when every step is `ok`, `upsert ProviderVerification {provider, passedAt, accountId, report}`; any failure deletes that provider's row. The script prints `RECORDED <provider> as verified for campaign sending` or `REMOVED …`.

Steps:
- [ ] Write the failing tests in `recovery.test.ts`:
  - **`uncertain send never auto-resent`** (master Review Focus #1):
    - Claim one row; call the Fake's `send` with the row's MIME directly (the provider accepted); write nothing to the DB (the worker died).
    - At `+9m59s`, `recoverExpired` → 0 and the row is still SENDING. At `+10m01s` → 1 and the row is UNCERTAIN.
    - `resolveUncertain` → SENT, `sentAt` set, usage `sent 1, reserved 0`, `cl.accountId` set, the lead advanced.
    - Across all of this, `dispatchTick` ran 3 times and the Fake `sentRaw()` length is 1.
  - **Not-found path:**
    - First resolve → UNCERTAIN, `searchCount 1`.
    - `+14m` → `findSent` is not called again (call count unchanged).
    - `+15m` → HELD, `reserved 0`.
    - 3 more `dispatchTick`s → `sentRaw()` length 0.
  - `findSent` throws `TransientBeforeSendError` → `searchCount 0`, still UNCERTAIN.
  - The Graph hint: `findSent` receives `{providerMessageId:"d-1"}`.
  - `releaseHeld` → the next tick sends with the same `rfcMessageId`, and a late accept of the original then follows the table (covered in T11a).
  - `cancelScheduled` on HELD → CANCELLED.
  - `retryFailed` → SCHEDULED and the lead ACTIVE.
- [ ] `scheduled-api.test.ts`: VIEWER release → 403; MEMBER release without `confirm` → 400; release of a SENT row → 409; foreign → 404; an audit row per action; the list filters `status=HELD`.
- [ ] `e2e/multistep.test.ts` (E2E #5, Fake provider, simulated days):
  - Setup: 3 steps with delays 0 d / 2 d / 3 d, office hours `Europe/Berlin`, 4 leads, 2 accounts.
  - Loop over simulated minutes with `markFresh`, `planDue`, `dispatchTick`, `recoverExpired`, `resolveUncertain`.
  - Each lead gets exactly 3 messages, all from its step-1 account.
  - Step 2 `sentAt − step 1 sentAt ≥ 2 d` and step 3 `− step 2 ≥ 3 d`.
  - Every `sentAt` falls inside Mon–Fri 09:00–17:00 local.
  - Steps 2 and 3 carry `In-Reply-To` = step 1's Message-ID.
  - The usage `sent` sum equals the 12 SENT rows; every CampaignLead is COMPLETED and the campaign is COMPLETED.
- [ ] `apps/worker/test/crash.test.ts` (**handler crash in a live worker → recovered after lease**): `startWorker` in-process with a `fixedClock`, `SEND_LEASE_SEC=600` and a `providerFor` whose `send` records to the Fake and then throws `new Error("db gone")` once (a non-ProviderError, which goes UNCERTAIN), plus a variant where the handler process stays alive but the post-send DB update is skipped (row left SENDING). After `clock.advance(601_000)` and `boss.send("send-recovery")`, the row reaches SENT, with `sentRaw()` length 1.
- [ ] `apps/worker/test/restart.test.ts` (E2E #15):
  - Spawn the worker (`node --import tsx apps/worker/src/index.ts`) on the test DB with `MAIL_PROVIDER_FAKE=1`, a temporary `FAKE_MAIL_DIR`, `FAKE_SEND_HANG_MS=30000` and `SEND_LEASE_SEC` at 5 (allowed with the Fake).
  - Wait until the Fake mailbox has 1 sent copy, then `kill("SIGKILL")`. The row is SENDING.
  - Restart without the hang. Within 60 s the row is SENT (via UNCERTAIN → found), Fake sent count 1, usage `sent 1, reserved 0`.
- [ ] `apps/worker/test/browser-closed.test.ts` (E2E #16, worker part): no web server is started. The campaign is seeded through core services and `startWorker` runs with the default jobs; 2 leads are SENT within 90 s (boot-time plan and dispatch jobs).
- [ ] `live-verify.test.ts` (extend P2's): all-PASS against an injected provider stub run through `recordVerification(prisma, "GMAIL", accountId, steps)` → row present; a FAIL → row removed. The script still refuses the Fake (exit 2).
- [ ] Implement. `send-recovery` handler: `recoverExpired(prisma, clock, env.SEND_LEASE_SEC)` then `resolveUncertain`. Update `LIVE_VERIFICATION.md` §1: "A full PASS records the provider as verified; campaign sending for that provider stays off until then (D17)."
- [ ] Commit `feat(send): recovery, HELD release/cancel API, worker wiring, restart E2E`.

## P3-T12 Campaign builder UI and Scheduled emails view

Model: sonnet. **Owns:** PS-CAMP-06, 32 (preview with a real lead; step test-send), 34 (UI); PS-SEND-17 (dead-letter view UI); PS-UI-06 (campaign badges); E2E #4.
Files: `apps/web/app/(app)/campaigns/{page.tsx,campaigns-table.tsx}`, `apps/web/app/(app)/campaigns/[id]/{page.tsx,leads-tab.tsx,sequences-tab.tsx,schedule-tab.tsx,options-tab.tsx,accounts-tab.tsx,subsequences-tab.tsx,preview-panel.tsx,status-banner.tsx}`, `apps/web/app/(app)/scheduled/page.tsx`; `packages/core/src/campaigns/preview.ts`; `packages/core/src/accounts/test-send.ts` (optional `content: { subject; html?; text }`); routes `POST /api/v1/campaigns/[id]/preview` (`{stepId, variantId, leadId}` → `{subject, html, text, issues}`), `POST /api/v1/campaigns/[id]/test-send` (ADMIN, `confirmAuthorized`); `apps/web/e2e/campaign-create.spec.ts`.
Signatures:
- `previewMessage(prisma, ws, { campaignId, stepId, variantId, leadId, accountId? }, env): { subject; html; text; issues: TemplateIssue[] }`: uses `renderForLead`; the first assigned account when none is given.
- `sendTestEmail(…, p & { content? })`: keeps the 5/10 min limit and `X-RightNow-Test`.

UI:
- **List:** name, status badge (`displayCampaignStatus`), progress `completed / total leads`, sent today, actions.
- **Builder tabs:** Leads (enroll from a list or filter, the status column via `campaignLeadStatus`), Sequences (steps with delay and unit, variants A–Z with toggles, the variable picker, inline `validateTemplate` errors), Subsequences (shown only when `launchedAt` is set, PS-CAMP-03), Schedule (presets plus custom days, times and zone), Options (every T05 option; "Unsubscribe header" shown checked and disabled with the reason), Accounts (assign, tags).
- **Preview panel:** pick a lead, rendered subject and body with the footer, "Send test".
- **Status banner** from `GET /campaigns/[id]/status`, one sentence per reason code.
- **Scheduled emails page:** tabs Scheduled / Held / Failed / Outcome unknown; Held rows have Release (a confirm dialog: "This email may already have been delivered. Releasing can send it a second time.") and Cancel; Failed rows have Retry.

Steps:
- [ ] Core tests: `previewMessage` for a lead with `firstName "Ann"` and `{{firstName | there}}` → `Hi Ann`, with the footer containing the address; an unknown variable → `issues[0].code "unknown_variable"` and no throw. `test-send` with `content` → the Fake raw has the rendered subject and `X-RightNow-Test: 1`, and no usage row.
- [ ] Playwright `campaign-create.spec.ts` (E2E #4, Fake):
  1. Seed an account and a list of 3 leads.
  2. Create the campaign, enroll the list (shows 3 Active), and add step 1 plus step 2 with 2 variants (`{{firstName}}`).
  3. Apply the office-hours preset and assign the account. Preview shows the lead's first name.
  4. Launch with no address → the error "Add your physical address" is visible.
  5. Set the address in settings and launch again → badge "Active" and the banner "Waiting for mailbox sync" (D16).
  6. On the Scheduled page, a seeded HELD row's Release opens the confirm dialog, and Cancel moves it to Cancelled.
  7. Keyboard: tabs are reachable by arrow keys and the dialog traps focus.
- [ ] Commit `feat(campaigns): builder UI, preview, scheduled emails view`.

## P3-T13 Ramp-up, cap settings, lead timeline

Model: sonnet. **Owns:** PS-SEND-12; PS-ACC-16 (consumption); PS-CAMP-15 (UI recommendation "30 × accounts"), 28 (workspace scope UI); PS-SEND-06 (settings); PS-LEAD-19 (P3 part).
Files: `packages/core/src/quota.ts` (ramp term); `packages/core/src/accounts/serialize.ts` (`remainingToday` uses `effectiveAllowance`); `packages/core/src/leads/timeline.ts`; `apps/web/app/api/v1/settings/workspace/route.ts` (adds `dailyCap`, `perCompanyDailyLimit`, `disableOpenTracking`, `firstEmailTextOnly`); `apps/web/app/api/v1/leads/[id]/timeline/route.ts`; the settings page and lead drawer timeline; account drawer ramp fields; tests `packages/core/test/{ramp,timeline}.test.ts`.
Rules:
- **Ramp term.** When `slowRamp`: `rampStartVolume + rampIncrementPerDay × d`, where `d` = whole local days between `dayKey(tz, rampStartedAt ?? createdAt)` and `dayKey(tz, now)`. `effectiveAllowance` takes the min with the other terms. `updateAccount({slowRamp:true})` sets `rampStartedAt = now` when null.
- **Timeline.** `leadTimeline(prisma, ws, leadId): { at: Date; kind: "imported"|"enrolled"|"sent"|"status_changed"|"merged"|"unsubscribed"|"suppressed"; detail }[]`, newest first. Sources: the ImportJob, CampaignLead `enrolledAt`, SENT ScheduledMessages (step order, variant label, account email), AuditLog `lead.update` with `interestStatus`, `lead.merge`, and Suppression rows. P4 adds opens, clicks and replies; P6 adds notes and tasks.

Steps:
- [ ] Write the failing tests:
  - `ramp.test.ts`: `slowRamp`, start 2, +2/day, `dailyLimit 30`, created 2026-10-20 → allowance 2 on 10-20, 8 on 10-23, 30 on 11-10; with ramp off → 30. The claim on a ramping account with 10 due rows claims 2 on day 0 and 4 on day 1. `toApiAccount.remainingToday` uses the ramp value.
  - settings: `dailyCap 0` → 400; ADMIN `dailyCap 100` → stored and the claim honors it (the T09 workspace-cap test re-run with the API value).
  - `timeline.test.ts`: an imported, enrolled, step-1-SENT lead with an interest change shows 4 entries in order, with the sent entry carrying `{step:1, variant:"A", account:"a@…"}`.
- [ ] Implement, run → PASS. Commit `feat(send): slow ramp, workspace caps, lead timeline`.

## Deferred items (each with owner and reason)

- **PS-LEAD-14** verify-on-import, **PS-LEAD-05** verifier calls, **PS-LEAD-25** re-verify → P5-T08 (`EmailVerifier` interface).
- **PS-LEAD-22** historical conversation import → P4-T05 (needs sync).
- **PS-LEAD-04** opportunity side → P6-T01, automations side → P7-T01.
- **PS-LEAD-08** open, reply and click counters, and **PS-LEAD-19** open, click and reply entries → P4-T03/T04. Notes and tasks → P6-T01.
- **PS-CAMP-04** producers of ACCOUNTS_UNHEALTHY and BOUNCE_PROTECT, **PS-CAMP-27** BounceProtect and **PS-SEND-11** auto-pause → P5-T02 (health). The flags are stored here.
- **PS-CAMP-19** executing the company stop → P4-T03. The flag and the freshness gate are here.
- **PS-CAMP-21** pixel and link rewriting, and **PS-SEND-14** tracking-domain use → P4-T04.
- **PS-CAMP-30/31** A/Z auto-optimize and daily reset → P7-T04.
- **PS-SEQ-07** stops on reply, bounce and unsubscribe reply, **PS-SEQ-08** OOO, and **PS-SEQ-09** REPLY_KEYWORD, opened and clicked triggers → P4-T03 (needs ingest and classification). The triggers are stored here.
- **PS-SEQ-21** and **PS-SEQ-10** (analytics) → P6-T03.
- **PS-SEND-17** alerting hook → P7-T01.
- **PS-SEND-10** `bounced_hard`/`bounced_soft` → P4-T03.
- **Event ACCEPTED** (master sender step) → P4-T04 creates the `Event` store. Until then the SENT ScheduledMessage is the record, and P4-T04 backfills from SENT rows.
- **Not built (deliberate):** **PS-CAMP-14** lead-local-time sending (the spec marks it optional, not parity); **PS-SEQ-10** "ignore account limits" (violates the Global Constraint "never exceed per-account allowances"); **PS-CAMP-25** turning the header off (the Global Constraint requires it, so the field stays and accepts only `true`).

## Models

P3-T09, P3-T11a and P3-T11b run on **opus** (concurrency, quota and freshness core; no duplicates and no lost sends, per the master plan). All other tasks run on sonnet: T01–T08, T10, T12, T13.

## Coverage self-check

- **LEAD:** 01 T01 · 02 T06 · 03 T01 · 04 T01/T10 · 05 T02/T10 · 06 T01 · 07 T02 · 08 T01 · 09 T03 · 10–13 T02 · 15 T02 · 16–17 T01/T03 · 18 T01/T06 · 19 T13 · 20–21 T03 · 23 T06 · 24 T01 · 25 T03 · 26 T04; deferred 14, 22.
- **CAMP:** 01 T05/T06 · 02 T06 · 03 T05/T12 · 04 T05 · 05 T05/T10 · 06 T12 · 07 T05 · 08 T06 · 09–13 T05 · 15 T05/T13 · 16–18 T05/T10 · 19–22 T05 · 23–24 T05/T10 · 25–26 T05 · 28 T05/T10/T13 · 29 T05/T09 · 32 T12 · 33 T05 · 34 T10/T12 · 35–36 T06; deferred 14, 27, 30, 31.
- **SEQ:** 01–02 T06 · 03 T07/T10 · 04 T06 · 05 T10 · 06 T10/T11a · 07 T10 · 09–11 T06/T10 · 12–20 T04/T08 · 22 T06; deferred 08, 21.
- **SEND:** 01 T11b · 02 T07/T09/T10 · 03 T10 · 04–06 T09 · 07 T09/T11b · 08 T11b · 09–10 T11a · 12 T13 · 13 T11b · 14–15 T11a · 16 T09 · 17 T11b/T12; deferred 11.
- **ACC carry-overs:** 16 T13, 21 T05/T10, 22 T05, 27 T09/T10.
- **TASKS.json carry-forwards:** providerMessageId and I-8 are in T11a. The P3-T11 live gate is D17 (T09 table and claim, T11b recording).
- **E2E rows:** #3 T03 · #4 T12 · #5 T11b · #6 T09 · #7 T10 · #15 T11b · #16 T11b (the worker part; the drill is P8-T01).
- **Compliance "Rules our code must enforce" this phase:** List-Unsubscribe (T08/T11a), footer and address (T08/T09), suppression at claim (T09), caps and clamps (P2 + T09), sends inside the window and never while paused (T09), backoff (T11a). "One recipient per message" is replaced by Cc/Bcc counting toward quota (T09).

## Phase gate

Full `npm test`, lint, typecheck, Playwright, and CI (`check`, `compose-smoke`, `imap-real`) green; `ponytail-audit` by a fresh reviewer; tick PS items in PRODUCT_SPEC (partial ones annotated with their later task); update PROGRESS, HANDOFF (D16: nothing sends until P4-T05; D17: run LIVE_VERIFICATION to enable real providers) and REVIEW_LOG; fast-forward `main` and push.
