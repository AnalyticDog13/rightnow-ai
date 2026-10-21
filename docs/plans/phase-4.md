# Phase 4 — Incoming mail & tracking: step plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every connected mailbox is read on a schedule. Replies, auto-replies, bounces and unsubscribe replies are threaded, classified and applied to campaigns (stop, OOO reschedule, suppress) before the account counts as fresh. Opens and clicks are tracked through signed links. A unified inbox lets the user read, triage and answer from the original mailbox.

**Architecture:** New domain modules in `packages/core/src/mail/` (`ingest`, `match`, `classify`, `quoted`, `stoprules`, `events`, `tracking`, `sync`, `reply`, `inbox`). They touch Prisma, providers and the clock only through injected `prisma`, `clock` and `providerFor`. One new worker job (`mail-sync`) runs `syncDue`. The sync writes `lastSyncCompletedAt = syncStartedAt` only after every message read in that run has been ingested and its stop rules have been committed. That is what the Phase 3 claim's freshness gate reads (D16), so campaign sending switches on with this phase. Web routes use `route()`. The inbox UI sits under `apps/web/app/(app)/inbox/`.

**Tech Stack:** TypeScript 5.9, Prisma 7.10.1, PostgreSQL 18, pg-boss 12, zod 4, mailparser 3.10 (already in providers), html-to-text 10 (already in core), Next.js 16, Vitest + embedded-postgres, Playwright. No new runtime dependency.

**Spec:** `docs/IMPLEMENTATION_PLAN.md` is binding (Global Constraints, "Send pipeline", "Reconciliation (P4)", P4-T01..T08). Also `docs/PRODUCT_SPEC.md` (PS-INBOX, PS-TRACK, PS-SYNC and the Phase 3 items deferred to P4), `docs/PROVIDER_COMPLIANCE.md`, `docs/DECISIONS.md` (D16, D17, D18), `CLAUDE.md`, and the carry-forwards in `docs/TASKS.json`.

> Branch `phase-4-inbox`. Commit and push after every task. Phase 1–3 interfaces are used as they are: `route()`, `startWorker`/`JobDef`, `createTestDb`, `Clock`/`fixedClock`, `MailProvider` (frozen), the provider errors, `createProvider`, `recordProviderError`, `dayKey`, `newMessageId`, `suppress`/`isSuppressed`/`hashValue`, `stopOpenCampaignLeads`, `stopLead`, `cancelRows`, `editHooks`, `applyInterestChange` (leads/service.ts), `enterSubsequence`, `leadStatusTrigger`, `unsubscribeLead`, `suppressMailtoUnsubscribe`, `unsubscribeMode`, `unsubscribeKeys`, `render`, `markFresh`/`seedCampaign` (test fixture), `getFakeProvider`.

## Global Constraints (from the master plan; every task inherits them)

- Every service read and write takes `workspaceId` and filters by it. Worker jobs may scan across workspaces, but every write is conditional on the state they read.
- No network call inside a DB transaction (provider `listChangesSince`/`listMessages`/`send`, AI classifier).
- **Freshness watermark:** `lastSyncCompletedAt` is set to the run's `syncStartedAt`, never its end, and only when the run reached the provider's current state (`hasMore false`) with every message ingested and its stop rules committed. It never moves backwards.
- **Lock order (D21)** is unchanged: `ScheduledMessage` → `CampaignLead` → usage rows → `EmailAccount` → `Lead`/`Suppression`. Stop rules cancel rows with `cancelRows` (SKIP LOCKED) and then update the CampaignLead. A row a claim holds is skipped, and the sender's existing pre-send check (`sender.ts`, CampaignLead `STOPPED`) refuses it. `Thread`, `Message`, `Event` and `SyncRun` are leaf tables: insert-only or single-row updates after the send-state rows.
- An unknown send outcome is never resent. A manual reply whose send is ambiguous is reported to the user and never retried.
- Unsubscribe, hard bounce and complaint add a workspace suppression at once. Opens are always `isEstimated`. "Accepted by provider" is never called "delivered".
- Inbox read/unread and delete are local only and never change the provider mailbox (PS-INBOX-14).
- Fakes only with `MAIL_PROVIDER_FAKE=1`. Credentials only via `setCredentials`.
- Every task writes its tests first, then runs `npm test`, `npm run lint` and `npm run typecheck`, all green, before committing.

## Decisions taken by this plan (record as D26–D31 in `docs/DECISIONS.md` in the task that implements them)

- **D26 · A reply stops the lead wherever that campaign says so.** A genuine reply from an address that is a Lead stops every open CampaignLead of that lead in campaigns with `stopOnReply`, whichever mailbox received it and whether or not it threads. Its Event is attributed to one campaign (PS-INBOX-04). With `stopForCompanyOnReply`, a reply from any address whose company domain (non-free-mail) equals the lead's also stops the other leads of that domain in that campaign (`COMPANY_REPLIED`), even when the replying address is not a lead. Stop rules only apply to messages dated at or after the CampaignLead's `enrolledAt`.
- **D27 · Bounce classes.** HARD = enhanced status `5.1.*` or `5.2.1`, or any `5.x.x` whose text matches `/user unknown|no such user|does not exist|address rejected|invalid recipient|mailbox unavailable|recipient not found/i` and not `/spam|policy|block|reputation|blacklist|denylist|dmarc|spf|dkim/i`. SOFT = `4.x.x` or `5.2.2`. Everything else, including `5.7.*`, is UNKNOWN. Only HARD suppresses the address and stops the lead (`BOUNCED`). SOFT and UNKNOWN record an Event (input for P5 health).
- **D28 · Tracking only on a reachable https base.** The pixel and click links use `https://<trackingDomain>` when the account's `trackingDomainStatus` is `VERIFIED`, otherwise `APP_URL` when `unsubscribeMode(APP_URL) === "https"`, otherwise nothing is rewritten. The stored `renderedBody` stays untracked; the sender adds tracking at send time. Every open is `isEstimated`. An open within 10 s of `sentAt` or from a known proxy/scanner user agent is stored with `meta.machine = true` and never counts toward lead `opens`.
- **D29 · Manual replies and quota.** A reply or forward from the inbox is not blocked by the user's daily limit, but it is refused (409 `provider_cap`) when the account's `sent + reserved` today is already ≥ `floor(providerCap / 2)`. It adds 1 + cc + bcc to `AccountDailyUsage.sent` for today, so campaign sends shrink to match. Replying to a suppressed address is refused (409 `recipient_suppressed`).
- **D30 · Safe rendering without a sanitizer library.** Message HTML is shown in an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc>` (no scripts, no forms, no same-origin) whose document starts with `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:">` and `<base target="_blank">`. "Show images" swaps `img-src` to `data: cid: https:` for that message only. A plain-text toggle shows `text`. Link-target warnings are deferred to P7-T08.
- **D31 · Not stored as events:** `scheduled` and `send_attempt` (the `ScheduledMessage` row is their record). Meeting, opportunity and deal events are added by P6-T01. IMAP IDLE is not built; polling every `SYNC_POLL_SEC` (default 120) is the fallback the spec allows, and push sync is P7-T06.

## Fixed names (every later task and phase relies on these)

| Thing | Value |
|---|---|
| Enums (T01) | `MessageDirection IN\|OUT`; `MessageKind REPLY\|AUTO_REPLY\|BOUNCE\|UNSUBSCRIBE\|OUTBOUND\|OTHER`; `ReplyCategory INTERESTED\|MEETING_REQUESTED\|NOT_INTERESTED\|WRONG_PERSON\|NEUTRAL\|OUT_OF_OFFICE\|UNSUBSCRIBE\|AUTOMATED\|UNCERTAIN`; `BounceType HARD\|SOFT\|UNKNOWN`; `EventType ACCEPTED\|SEND_FAILED\|BOUNCE_HARD\|BOUNCE_SOFT\|BOUNCE_UNKNOWN\|UNSUBSCRIBE\|REPLY\|AUTO_REPLY\|OPEN\|CLICK\|INTEREST_CHANGED`; `SyncMode INCREMENTAL\|FULL\|HISTORICAL` |
| `Thread` (T01) | `id, workspaceId, accountId, providerThreadId?, subject, leadId?, campaignId?, campaignLeadId?, lastMessageAt, lastInboundAt?, lastInboundKind MessageKind?, isRead Boolean @default(true), category ReplyCategory?, categorySource String? ("RULE"\|"AI"\|"USER"), reminderAt?, hasAttachment Boolean false, deletedAt?, createdAt`; `@@index[workspaceId,lastMessageAt]`, `@@index[accountId,providerThreadId]`, `@@index[workspaceId,leadId]`, `@@index[workspaceId,reminderAt]` |
| `Message` (T01) | `id, workspaceId, accountId, threadId, providerMessageId?, rfcMessageId, synthetic Boolean false, inReplyTo?, references String[], direction, folder String ("INBOX"\|"SENT"), fromEmail (lowercased), fromName?, to String[], cc String[], subject, text?, html?, sentAt, kind MessageKind, category ReplyCategory?, bounceType BounceType?, bounceRecipient?, oooUntil?, scheduledMessageId?, outsideApp Boolean false, leadId?, campaignId?, remoteDeletedAt?, createdAt`; `@@unique[accountId,rfcMessageId]`, `@@index[accountId,providerMessageId]`, `@@index[threadId,sentAt]`, `@@index[workspaceId,rfcMessageId]`, `@@index[workspaceId,fromEmail]` |
| Other mail tables (T01) | `Attachment(id, messageId (cascade), filename, contentType, size Int, data Bytes?, truncated Boolean false)`; `Event(id, workspaceId, type EventType, occurredAt, leadId?, campaignId?, accountId?, stepId?, variantId?, scheduledMessageId?, messageId?, isEstimated Boolean false, meta Json @default("{}"), dedupeKey String @unique, createdAt; @@index[workspaceId,type,occurredAt], @@index[campaignId,type], @@index[leadId,occurredAt])`; `SyncRun(id, accountId (cascade), mode SyncMode, startedAt, finishedAt?, fetched Int 0, error String?; @@index[accountId,startedAt])`, newest 50 per account kept |
| Inbox tables (T06) | `Note(id, workspaceId, threadId?, leadId?, authorId, body, createdAt)` (CHECK one of threadId/leadId); `Macro(id, workspaceId, name, body, @@unique[workspaceId,name])`; `InboxView(id, workspaceId, name, filters Json, createdAt, @@unique[workspaceId,name])` |
| `EmailAccount` + (T05) | `syncLeaseId String?`, `syncLeaseUntil DateTime?`, `lastSyncAttemptAt DateTime?`, `syncErrors Int @default(0)`, `syncProgress Json?` (`{mode, fetched, since}` during HISTORICAL/FULL; null when idle) |
| Event dedupe keys | `acc:${scheduledMessageId}` · `fail:${scheduledMessageId}` · `${type}:${workspaceId}:${rfcMessageId}` for REPLY/AUTO_REPLY/UNSUBSCRIBE(reply)/BOUNCE_* · `unsub:${workspaceId}:${leadId}:${campaignId}` (link) · `open:${scheduledMessageId}:${floor(ms/60000)}` · `click:${scheduledMessageId}:${linkIndex}:${floor(ms/60000)}` · `interest:${leadId}:${ms}` |
| Env (core `envSchema`, T05) | `SYNC_POLL_SEC` int default 120, must be < `SYNC_MAX_STALENESS_SEC` (refine). Constants: sync lease 10 min, ≤ 10 pages per account per run, 4 accounts in parallel (`mapLimit`), escalation after 5 consecutive failed runs, backoff `min(SYNC_POLL_SEC · 2^(syncErrors−1), 1800)` s, full-reconcile window `since = min(lastSyncCompletedAt − 2 d, now − 30 d)`, first-sync window `now − historyImportDays`, AI classifier timeout 10 s |
| Jobs | `mail-sync` cron `* * * * *` → `syncDue`, `{ policy: "stately", retryLimit: 0 }`, sent once on boot like the Phase 3 jobs |
| Advisory locks | none new (the sync uses the `syncLeaseId` row lease, because a lease must outlive network calls) |
| Routes | `apps/web/app/t/o/[token]/route.ts`, `apps/web/app/t/c/[token]/route.ts`, `apps/web/app/api/tracking-domain/check/route.ts` (all public); `apps/web/app/api/v1/inbox/**` (T06) |
| Audit actions | `inbox.reply`, `inbox.forward`, `inbox.category_override`, `inbox.attach_lead`, `inbox.delete`, `inbox.bulk`, `macro.*`, `inbox_view.*` |
| API scopes | `inbox:read` (VIEWER), `inbox:write` (MEMBER; reply/forward included, API keys allowed) |

Core signatures (exact; later tasks call these):

```ts
// mail/ingest.ts (T01)
export type IngestResult = { created: boolean; messageId: string; threadId: string; match: Match };
export function syntheticMessageId(m: Pick<RemoteMessage, "from" | "date" | "subject" | "text">): string; // "<sha256hex(from|iso date|subject|text[0..512])@rightnow.synthetic>"
export function ingestMessage(tx: Tx, acct: Pick<EmailAccount, "id" | "workspaceId" | "email">, m: RemoteMessage, c: Classification, o: { historical: boolean }): Promise<IngestResult>;
// existing (accountId, rfcMessageId) → update providerMessageId/folder only, created:false (Gmail labelAdded re-report, UIDVALIDITY resync)
export function recordOutboundMessage(db: Db, scheduledMessageId: string): Promise<void>; // after the sender's result tx; idempotent; errors logged, never thrown
// mail/match.ts (T01)
export type Match = { leadId: string | null; campaignId: string | null; campaignLeadId: string | null; scheduledMessageId: string | null; threadId: string | null };
export function matchMessage(tx: Tx, ws: string, accountId: string, m: { inReplyTo: string | null; references: string[]; providerThreadId?: string; counterpart: string; subject: string; direction: "IN" | "OUT" }): Promise<Match>;
export function normalizeSubject(s: string): string; // strips repeated Re:/Fw:/Fwd:/AW:/WG:/SV:/Antw: prefixes, trims, lowercases
// mail/classify.ts, mail/quoted.ts (T02)
export type ClassifyInput = Pick<RemoteMessage, "from" | "subject" | "text" | "html" | "headers" | "attachments">;
export type Classification =
  | { kind: "BOUNCE"; bounceType: "HARD" | "SOFT" | "UNKNOWN"; status: string | null; recipient: string | null; originalMessageId: string | null; reason: string }
  | { kind: "AUTO_REPLY"; category: "OUT_OF_OFFICE" | "AUTOMATED"; oooUntil: Date | null }
  | { kind: "UNSUBSCRIBE" }
  | { kind: "REPLY"; category: ReplyCategory; source: "RULE" | "AI" }
  | { kind: "OUTBOUND" };
export function classify(m: ClassifyInput, o: { now: Date; direction: "IN" | "OUT" }): Classification;
export type AiClassifier = (m: ClassifyInput, signal: AbortSignal) => Promise<ReplyCategory | null>; // P7-T05 implements; called only for REPLY/UNCERTAIN, outside any tx
export function stripQuoted(text: string): string; // drops lines from the first "On … wrote:" / "-----Original Message-----" / "From: … Sent:" block and every ">" line
export const INTEREST_OF: Partial<Record<ReplyCategory, number>>; // INTERESTED 1, MEETING_REQUESTED 1, OUT_OF_OFFICE 0, NOT_INTERESTED -1, WRONG_PERSON -2
// mail/stoprules.ts (T03)
export function applyInbound(tx: Tx, clock: Clock, p: { workspaceId: string; message: Message; classification: Classification; match: Match }): Promise<void>;
// mail/events.ts (T01; T04 adds tracking callers)
export type EventInput = Omit<Prisma.EventUncheckedCreateInput, "id" | "createdAt">;
export function recordEvent(tx: Tx, e: EventInput): Promise<boolean>; // INSERT … ON CONFLICT ("dedupeKey") DO NOTHING; true when inserted. Counters move only when true.
// mail/tracking.ts (T04)
export type TrackPayload = { m: string; u?: string; i?: number }; // scheduledMessageId, click url, link index
export function trackingKeys(env: { ENCRYPTION_KEY: string; OLD_ENCRYPTION_KEY?: string }): Buffer[]; // HKDF-SHA256 info "rightnow-tracking-v1"
export function signTrack(p: TrackPayload, key: Buffer): string; // same token format as signUnsubscribe
export function verifyTrack(token: string, keys: Buffer[]): TrackPayload | null;
export function trackingBase(acct: Pick<EmailAccount, "trackingDomain" | "trackingDomainStatus">, appUrl: string): string | null; // D28
export function withTracking(html: string, o: { base: string; scheduledMessageId: string; opens: boolean; clicks: boolean; key: Buffer; skipUrls: string[] }): string;
export function recordOpen(prisma: Db, clock: Clock, p: TrackPayload, ua: string | null): Promise<void>;
export function recordClick(prisma: Db, clock: Clock, p: TrackPayload, ua: string | null): Promise<void>;
// mail/sync.ts (T05)
export type SyncDeps = { providerFor: (a: EmailAccount) => Promise<MailProvider>; aiClassify?: AiClassifier; env: { SYNC_POLL_SEC: number } };
export function reconcileAccount(prisma: Db, clock: Clock, accountId: string, deps: SyncDeps): Promise<"caught_up" | "more" | "failed" | "skipped">;
export function syncDue(prisma: Db, clock: Clock, deps: SyncDeps): Promise<{ synced: number; failed: number }>;
// mail/reply.ts, mail/inbox.ts (T06)
export function sendReply(prisma: Db, clock: Clock, deps: { providerFor: SyncDeps["providerFor"] }, ws: string, actor: Actor, input: ReplyInput): Promise<{ messageId: string }>;
export const threadFilterSchema: z.ZodType<ThreadFilter>; // reused by saved views
```

## Review Focus (riskiest inputs no acceptance test covers; each has a test in its owning task)

1. A lead replies from a second address or a colleague replies to a different mailbox of the same workspace while the original thread is unknown to that mailbox → the lead (or company) still stops (T03 `cross-mailbox reply stops lead`, T07 scenario).
2. The same reply lands in two mailboxes (lead Cc'd both), or a provider re-reports a message after a label change or UIDVALIDITY reset → one Event, one `replies` increment, two Message rows at most (one per mailbox), no duplicate thread (T01, T03 `double ingest counts once`).
3. An OOO with a return date that is in the past, unparseable, or a year away → past/unparseable: follow-ups continue unchanged; > 90 days away: clamped to 90 days (T02 date cases, T03 `ooo clamp`).
4. A hostile HTML email (script, `onerror`, remote tracking image, `<form>`, `javascript:` link, CSS `url()`) → nothing executes, nothing remote loads until "Show images", no form posts (T08 `rendering is inert` Playwright test).
5. A click URL that is `javascript:`, a relative path, or a token signed with a different key → 400, no redirect, nothing recorded (T04).

## Task order, splits and parallelism

T01 → (T02 ∥ T04) → T03 → T05 → (T06 ∥ T07) → T08. T02 (pure classifier + corpus) and T04 (tracking, sender rewrite) touch disjoint files; T02 needs only the Classification type, which T01 creates as a stub file that T02 fills. T06 (web API) and T07 (core e2e tests + doc) are disjoint. T05 lands only after T03 (reply/unsubscribe/bounce stops) and fixes N-1 and N-3 before it writes freshness.

---

## P4-T01 Mail schema, ingest, threading, events store

Model: sonnet. **Owns:** PS-INBOX-01 (threading), PS-INBOX-04 (campaign attribution), PS-SYNC-05, PS-SYNC-04 (matching our sends), PS-TRACK-01 (store), PS-TRACK-02, PS-TRACK-12; carry-forward "Gmail re-reports after labelAdded"; D17 matching fallback.
Files: `packages/db/prisma/schema.prisma` + migration (models in Fixed names; the migration also backfills `ACCEPTED` events from SENT `ScheduledMessage` rows with `dedupeKey 'acc:'||id`); `packages/core/src/mail/{ingest,match,events}.ts`; `packages/core/src/mail/classify.ts` (types and a `classify` stub returning `{kind:"REPLY",category:"UNCERTAIN",source:"RULE"}` for IN and `OUTBOUND` for OUT; T02 replaces the body); `packages/core/src/sender.ts` (call `recordOutboundMessage` after the accepted result tx; write the `ACCEPTED` event inside it, `SEND_FAILED` inside the FAILED settle); `packages/providers/src/fake/provider.ts` (`receiveRaw(raw: Buffer, folder?: "INBOX" | "SENT"): Promise<{ rfcMessageId: string | null }>`); tests `packages/core/test/mail-ingest.test.ts`.

Matching order in `matchMessage` (first hit wins): (1) `inReplyTo`, then `references` newest first, against `ScheduledMessage.rfcMessageId` (status SENT, UNCERTAIN or HELD) in the workspace → its lead, campaign, CampaignLead, and the thread of its outbound Message if one exists; (2) the same ids against `Message.rfcMessageId` in the workspace → that message's thread, lead, campaign; (3) `providerThreadId` on the same account → that thread; (4) D17 fallback: the counterpart address (from for IN, first to for OUT) is a live Lead with a SENT ScheduledMessage from this account in the last 90 days whose `normalizeSubject(renderedSubject)` equals `normalizeSubject(subject)` → the newest such. Lead without a thread match: counterpart address → live Lead in the workspace; campaign → the lead's CampaignLead with the latest `ScheduledMessage.sentAt` (PS-INBOX-04). A thread match on a different account is never joined (threads are per mailbox); the lead/campaign still carry over.

Ingest rules: `rfcMessageId ?? syntheticMessageId(m)` (`synthetic true`); `kind` from the Classification; IN → `thread.isRead = historical`, `lastInboundAt`, `lastInboundKind`, `category`, and `deletedAt = null` (a new message revives a locally deleted thread); OUT matching a ScheduledMessage → `scheduledMessageId`, `outsideApp false`; OUT matching none → `outsideApp true`, `Lead.lastContactedAt` raised. Attachments are stored with `data` (≤ 25 MB, else `data null, truncated true`). `hasAttachment` is set on the thread. Every Prisma read of `Attachment` outside the download route uses `select` without `data`.

- [ ] Write the failing tests (`mail-ingest.test.ts`):
  - `reply threads to the campaign send`: seed a SENT step-1 row with `rfcMessageId <a@x>`, ingest an IN message with `In-Reply-To: <a@x>` → one Thread with `leadId`, `campaignId`, `campaignLeadId` of that row; `match.scheduledMessageId` = the row.
  - `reply without In-Reply-To falls back to lead + subject` (D17): `Re: RE: Quick question` vs rendered `Quick question` → matched; a different subject → lead set, `scheduledMessageId null`, new thread.
  - `same message twice is one row`: ingest twice with providerMessageId `p1` then `p2` (labelAdded / UIDVALIDITY) → one Message, `providerMessageId p2`, second result `created false`.
  - `missing Message-ID gets a stable synthetic id`: two ingests of the same headerless message → one row, `synthetic true`, id ends `@rightnow.synthetic>`.
  - `outside-app send is recorded`: OUT message with no matching row → `outsideApp true`; lead `lastContactedAt` updated.
  - `deleted thread revives on new inbound`.
  - `attachment data is never listed`: 3 MB attachment; `prisma.thread.findMany` via the exported list helper used by T06 returns attachment metadata without `data` (assert the key is absent).
  - `recordEvent dedupes`: same key twice → `true` then `false`, one row.
  - `accepted send writes ACCEPTED event and outbound Message` (sender test addition): after `sendClaimed` on the Fake, one `ACCEPTED` event and one OUT Message linked to the row; calling `recordOutboundMessage` again changes nothing.
  - migration backfill: a SENT row seeded before the migration gets one `ACCEPTED` event (test via the SQL run on the test DB).
- [ ] Run → FAIL. Implement. Run `npx vitest run packages/core/test/mail-ingest.test.ts packages/core/test/sender.test.ts` → PASS, then the full checks.
- [ ] Commit `feat(inbox): mail schema, ingest, threading, event store`.

## P4-T02 Classification with a ≥30-email corpus (parallel with T04)

Model: sonnet. **Owns:** PS-INBOX-17, PS-INBOX-19 (rule side), PS-INBOX-20 (rule classifier + AI hook), PS-TRACK-08.
Files: `packages/core/src/mail/{classify,quoted}.ts`; corpus `packages/core/test/fixtures/mail/*.eml` (≥ 30 files) + `expected.json` (`{ file: Classification-shaped expectation }`); test `packages/core/test/classify.test.ts`.

Rules, in order: (1) BOUNCE when `content-type` is `multipart/report; report-type=delivery-status`, or the sender local part is `mailer-daemon`/`postmaster` with a DSN-like body. Status from the `message/delivery-status` part (`Status:`), else the first `\b[45]\.\d{1,3}\.\d{1,3}\b` in the text, else SMTP basic code `5\d\d`/`4\d\d` mapped to 5.0.0/4.0.0. `recipient` from `Final-Recipient`/`Original-Recipient`, else the first address in the text. `originalMessageId` from the `text/rfc822-headers` or `message/rfc822` part. Class per D27. (2) AUTO_REPLY when `auto-submitted` is present and not `no`, or `x-autoreply`, `x-autorespond`, `x-auto-response-suppress: All|OOF`, `precedence: auto_reply|bulk|junk`, or the subject matches `/^(out of (the )?office|automatic reply|auto(matic)?[- ]?reply|autoreply|abwesenheit|absence|fuera de la oficina|r[ée]ponse automatique)/i`. OUT_OF_OFFICE when the subject or stripped text says out of office/on leave/vacation/away, else AUTOMATED. `oooUntil` from `until|back on|return(ing)? on|back|zurück am|de retour le` followed by an ISO date, `D Month [YYYY]`, `Month D[, YYYY]`, `D.M.YYYY` or `M/D/YYYY` (only when the day > 12 makes it unambiguous, else null); a year-less date resolves to the next occurrence after `now`; a past date → null. (3) UNSUBSCRIBE when the subject is exactly `unsubscribe` (our mailto) or the first 5 non-empty lines of `stripQuoted(text)` match `/\b(unsubscribe|remove me|take me off|opt[ -]?out|stop (emailing|contacting)|do not (contact|email))\b/i`. (4) REPLY with a category from `stripQuoted(text)`: NOT_INTERESTED `/not interested|no thanks|no thank you|not a (good )?fit|not for us|we('re| are) (all )?set|pass on this/i` → WRONG_PERSON `/wrong person|not the right (person|contact)|no longer (with|at|works)|left the company/i` → MEETING_REQUESTED `/(book|schedule|set up|arrange) (a )?(call|meeting|time|demo)|calendly\.com|let'?s (talk|chat|meet)|free (on|next)|what time works/i` → INTERESTED `/\binterested\b|sounds (good|great)|tell me more|send (me )?(more )?(info|details)|pricing|how much/i` → else UNCERTAIN. NEUTRAL is set only by the user or AI. OUT direction → `OUTBOUND`.

- [ ] Write the corpus and the failing test: ≥ 30 `.eml` files covering Gmail, Microsoft 365, Exchange on-prem, Postfix and Yahoo DSNs (hard 5.1.1, 5.2.1, soft 4.2.2/5.2.2, policy 5.7.1 → UNKNOWN, "550 user unknown" without enhanced code → HARD), OOO in English, German, French and Spanish with and without dates (including a year-less `back on 3 January` read on 2026-12-20 → 2027-01-03, a past date → null, `05/06/2026` → null), `Auto-Submitted: auto-generated` ticket confirmations → AUTOMATED, an unsubscribe reply, an unsubscribe word only inside quoted text → not UNSUBSCRIBE, `not interested` (must not be INTERESTED), meeting, interested, wrong person, and a plain question → UNCERTAIN. `classify.test.ts` parses each with mailparser (`simpleParser` → the `RemoteMessage` shape via the existing providers helper) and asserts `expected.json` exactly. Plus `stripQuoted` unit cases for Gmail, Outlook and `>` quoting.
- [ ] Run → FAIL. Implement. Run `npx vitest run packages/core/test/classify.test.ts` → PASS, then the full checks.
- [ ] Commit `feat(inbox): rule classifier for bounces, auto-replies, unsubscribes and interest`.

## P4-T03 Stop rules

Model: **opus** (runs against the claim; lock order). **Owns:** PS-INBOX-18, PS-SEQ-07, PS-SEQ-08, PS-SEQ-09 (REPLY_KEYWORD and LEAD_STATUS from replies), PS-CAMP-19 (execution), PS-TRACK-09 (reply side + Event for link unsubscribes), PS-SEND-10, PS-LEAD-08 (replies counter), PS-SYNC-06, PS-SYNC-08; D26, D27.
Files: `packages/core/src/mail/stoprules.ts`; `packages/core/src/unsubscribe.ts` (`unsubscribeLead` and `suppressMailtoUnsubscribe` record the UNSUBSCRIBE event); `packages/core/src/leads/timeline.ts` (reply, bounce, unsubscribe entries from Event); `docs/DECISIONS.md` (D26, D27); tests `packages/core/test/stoprules.test.ts`, `packages/core/test/e2e/followup-cancel.test.ts`, `packages/core/test/e2e/bounce.test.ts`.

`applyInbound` (inside the ingest transaction, only when `created` and direction IN; lock order respected — rows via `cancelRows` first, then CampaignLeads, then Lead/Suppression):
- **REPLY / UNSUBSCRIBE / AUTO_REPLY event:** `recordEvent` with the type and dedupe key; when inserted and a lead matched: `replies += 1` (REPLY only), `lastReplyAt`, `lastEngagement.reply = {stepId, variantId, at}`.
- **REPLY:** for every open CampaignLead of the lead whose campaign has `stopOnReply` and `enrolledAt <= message.sentAt` → cancel its rows, `STOPPED REPLIED`. Company stop (D26) for those campaigns with `stopForCompanyOnReply`, domain = `companyDomain` of the lead or, for a non-lead sender, the sender's domain unless it is in `FREE_MAIL_DOMAINS` → other open CampaignLeads with that `Lead.companyDomain` → `COMPANY_REPLIED`. Interest: when `lead.interestStatus` is null and `INTEREST_OF[category]` is defined → `applyInterestChange` (which already fires LEAD_STATUS subsequence triggers) + `INTEREST_CHANGED` event. Then REPLY_KEYWORD subsequences of the matched campaign whose keyword occurs (case-insensitive, word boundary) in `stripQuoted(text)` → `enterSubsequence` (only when the CampaignLead was not just stopped, i.e. `stopOnReply` is off).
- **AUTO_REPLY:** `stopOnAutoReply` → `STOPPED AUTO_REPLIED`. Else, with `oooUntil` (clamped to now + 90 d) → open ScheduledMessage rows of that CampaignLead in SCHEDULED get `dueAt = max(dueAt, oooUntil)` and the CampaignLead `nextDueAt = max(nextDueAt, oooUntil)` (the claim re-aligns to the window); no date → nothing changes.
- **UNSUBSCRIBE:** `suppressMailtoUnsubscribe` for the sender address (lead or not).
- **BOUNCE:** target = `originalMessageId` → ScheduledMessage, else `recipient` → the newest SENT row from this account to that address within 14 days. HARD → `suppress(EMAIL, HARD_BOUNCE, "dsn")`, its CampaignLead `STOPPED BOUNCED` (set before `suppress`, per the hooks.ts contract), Event `BOUNCE_HARD`; SOFT/UNKNOWN → Event only. A bounce with no target → Event without lead (still visible in Others).
- Messages dated before the CampaignLead's `enrolledAt` never stop it (historical import).

- [ ] Write the failing tests (`stoprules.test.ts`; each seeds a 3-step campaign with `seedCampaign`/`markFresh` and ingests via `ingestMessage` + `applyInbound`):
  - `reply cancels pending follow-ups`: SCHEDULED step-2 row → CANCELLED, CampaignLead `STOPPED REPLIED`, one REPLY event, `lead.replies = 1`.
  - `cross-mailbox reply stops lead` (Review Focus 1): lead contacted from account A replies as a new message (no In-Reply-To) to account B → stopped.
  - `company stop`: `stopForCompanyOnReply` on; `ann@acme.test` replies → `bob@acme.test` `COMPANY_REPLIED`; `carl@gmail.com` replying never stops `dina@gmail.com`; a non-lead `ceo@acme.test` reply stops both acme leads.
  - `stopOnReply off keeps sending, keyword subsequence fires`: trigger `{kind:"REPLY_KEYWORD", keyword:"pricing"}` → lead enters the subsequence.
  - `interest set only when empty`: INTERESTED reply → `interestStatus 1` and LEAD_STATUS trigger fires; a lead already at -2 stays -2.
  - `ooo reschedules` and `ooo clamp` (Review Focus 3): `oooUntil` +10 d → row `dueAt` = that date, CampaignLead not stopped; +400 d → +90 d; `stopOnAutoReply` → `AUTO_REPLIED`.
  - `unsubscribe reply suppresses`: Suppression `UNSUBSCRIBE`, all campaigns `STOPPED UNSUBSCRIBED`, UNSUBSCRIBE event.
  - `hard bounce suppresses; soft does not`; `bounce via Final-Recipient only` finds the lead; `5.7.1 policy` → no suppression.
  - `double ingest counts once` (Review Focus 2): the same reply ingested in two mailboxes → 2 Messages, 1 REPLY event, `replies 1`.
  - `historical reply before enrolment does not stop`.
  - `stop races the claim`: claim the step-2 row (`claimDue`) then apply a reply → the row is skipped by `cancelRows`, CampaignLead STOPPED, and `sendClaimed` on that row sends nothing (outcome CANCELLED by the pre-send check, reservation released).
  - E2E rows #9 `followup-cancel.test.ts` and #10 `bounce.test.ts`: Fake mailbox → `receiveRaw` → ingest → assert as above end to end through `dispatchTick` (no follow-up leaves the Fake's SENT).
- [ ] Run → FAIL. Implement. Run the three files → PASS, then the full checks.
- [ ] Commit `feat(inbox): stop rules for replies, auto-replies, unsubscribes and bounces`.

## P4-T04 Open and click tracking (parallel with T02)

Model: sonnet. **Owns:** PS-TRACK-03, PS-TRACK-04, PS-TRACK-05, PS-TRACK-06 (HTTPS via Caddy on-demand TLS), PS-TRACK-07, PS-CAMP-21, PS-SEND-14 (tracking domain), PS-LEAD-08 (opens/clicks), PS-LEAD-19 (open/click entries); D28.
Files: `packages/core/src/mail/tracking.ts`; `packages/core/src/sender.ts` (apply `withTracking` where the footer is built, when `campaign.trackOpens`/`trackClicks`, not `textOnly`, not step 1 with `firstEmailTextOnly`, workspace `disableOpenTracking` false for opens, and `trackingBase` non-null; `skipUrls` = the unsubscribe URL); `apps/web/app/t/o/[token]/route.ts`, `apps/web/app/t/c/[token]/route.ts`, `apps/web/app/api/tracking-domain/check/route.ts`; `docker/Caddyfile` (`on_demand_tls { ask http://web:3000/api/tracking-domain/check }` and a catch-all `https://` site with `tls { on_demand }` proxying `/t/*` and `/u/*` only); `docs/ops/VPS.md` (tracking CNAME section); `packages/core/src/leads/timeline.ts` (open/click entries); tests `packages/core/test/tracking.test.ts`, `apps/web/test/tracking-route.test.ts`.

Behaviour: pixel `<img src="{base}/t/o/{token}" width="1" height="1" alt="" style="display:none">` appended before `</body>` (or at the end). Clicks: every `<a href="http(s)://…">` except `skipUrls` and `mailto:` becomes `{base}/t/c/{token}` with `{m, u, i}`. Open route: always 200 `image/gif` (43-byte transparent GIF), `Cache-Control: no-store`; a valid token records OPEN `isEstimated true`; machine when UA matches `/GoogleImageProxy|YahooMailProxy|Microsoft Office|ms-office|bot|crawler|scanner|barracuda|mimecast|proofpoint/i` or within 10 s of `sentAt`; not machine → `opens += 1`, `lastOpenAt`, `lastEngagement.open`. Click route: valid token whose `u` parses as an absolute `http:`/`https:` URL → record CLICK (scanner flag same rule, `meta.scanner`), not scanner → `clicks += 1`, then 302 to `u`; anything else → 400 "This link is invalid." and nothing recorded. `check` route: 200 when a non-deleted account has `trackingDomain = ?domain` and status `VERIFIED`, else 404.

- [ ] Write the failing tests:
  - `tracking.test.ts`: sign/verify round-trip, tamper → null, old key verifies with `OLD_ENCRYPTION_KEY`; `withTracking` rewrites two links, keeps the unsubscribe link and a `mailto:`; `trackingBase` cases (verified domain, https APP_URL, http localhost → null); sender: campaign `trackOpens` + `trackClicks` → the Fake's SENT raw contains `/t/o/` and `/t/c/`, `renderedBody` in the DB is unchanged; `textOnly` or `firstEmailTextOnly` step 1 or `disableOpenTracking` → no pixel; `recordOpen` twice in one minute → 1 event; at `sentAt + 5 s` → `meta.machine true`, `lead.opens 0`.
  - `tracking-route.test.ts` (Review Focus 5): pixel with garbage token → 200 GIF, no event; click to `javascript:alert(1)` signed → 400; relative URL → 400; other-key token → 400; valid → 302 `Location` exactly `u`; `check` → 200/404.
- [ ] Run → FAIL. Implement. Run both files → PASS, then the full checks.
- [ ] Commit `feat(tracking): signed open pixel and click redirect, tracking domains`.

## P4-T05 Sync job (switches campaign sending on)

Model: **opus** (writes the freshness watermark). **Owns:** PS-SYNC-01 (polling for all three providers), PS-SYNC-02, PS-SYNC-03, PS-SYNC-04, PS-SYNC-07 (via the freshness gate + progress), PS-SYNC-13, PS-ACC-31 (progress), PS-LEAD-22, PS-INBOX-20 (AI hook wiring); carry-forwards: P2-T03 transient read errors capped and escalated, P2-T05 Graph `@removed` reason `changed`, phase-2 I-7 (one stale-page-token signal: every provider returns `{expired:true}` for an invalid/expired cursor or page token, never a thrown error) and I-9 (Gmail and Graph pages stop at ~20 MB of message content, like IMAP), gate N-1, gate N-3.
Files: `packages/core/src/mail/sync.ts`; `apps/worker/src/jobs/mail-sync.ts` + `jobs/index.ts`; core env (`SYNC_POLL_SEC`); `packages/providers/src/{gmail,graph}/*` (I-7, I-9, `@removed`); `packages/providers/src/imap-smtp/provider.ts` + `packages/core/src/sender.ts` (N-1); `packages/core/src/campaigns/launch.ts` (N-3); `packages/core/src/accounts/serialize.ts` (`sync: { state, lastCompletedAt, lagSec, errors, progress, lastError }`); account drawer sync section in `apps/web/app/(app)/accounts/`; tests `packages/core/test/sync.test.ts`, `packages/core/test/e2e/reply-sync.test.ts`, provider unit tests next to the existing ones.

Do these two first (blocking before freshness is written):
- **N-1:** in `smtpSession`, when the lead (To) is in `rejectedErrors` and at least one other recipient was accepted, throw `PermanentSendError("lead_rejected_partial", { scope })` (scope `recipient` only for a 5.1.x/5.2.1 code on the lead, else `unknown`) and never `TransientBeforeSendError`. The sender, on a `PermanentSendError` whose reason is `lead_rejected_partial`, settles FAILED as for its scope but commits usage (`commitUsage`) instead of releasing it, because the Cc/Bcc copies left the account.
- **N-3:** `activate()` refuses to resume a COMPLETED campaign whose `endAt <= now` with `CampaignError(409, "campaign_ended", "This campaign's end date has passed. Change the end date to resume it.")`.

`reconcileAccount` algorithm:
1. Lease: `UPDATE "EmailAccount" SET "syncLeaseId"=$id, "syncLeaseUntil"=now+10 min, "lastSyncAttemptAt"=now WHERE id AND deletedAt IS NULL AND credentialsEnc IS NOT NULL AND (syncLeaseUntil IS NULL OR < now)` → 0 rows = `skipped`. Every later write is conditional on `syncLeaseId = $id`. `syncStartedAt = clock.now()`.
2. No `syncCursor` (first sync): `cursor = provider.currentCursor()` first, then HISTORICAL import: `listMessages({since: now − historyImportDays, folder})` for INBOX then SENT, pages persisted in `syncProgress.pageToken`, ingested with `historical: true`, then the cursor saved. Expired cursor: FULL reconcile with `since = min(lastSyncCompletedAt − 2 d, now − 30 d)` the same way (cursor from `currentCursor()` taken before listing). Otherwise INCREMENTAL: `listChangesSince(cursor)` up to 10 pages.
3. Per page (outside any tx): for each message `classify` (and `aiClassify` with a 10 s abort when the result is REPLY/UNCERTAIN; failures ignored); then one transaction per message: `ingestMessage` + `applyInbound` (inside `withTxRetry`). `removed` ids → `Message.remoteDeletedAt`. Then save the new cursor (lease-conditional). A message whose ingest throws is logged and the run fails without advancing the cursor past it (retried next run; never skipped silently).
4. Caught up (`hasMore false` and no pending history/full pages) → `lastSyncCompletedAt = GREATEST(COALESCE(lastSyncCompletedAt, syncStartedAt), syncStartedAt)`, `syncErrors 0`, `syncProgress null`, `syncState IDLE`, lease cleared, `SyncRun` row finished. More pages left → `more` (next tick continues; freshness unchanged).
5. Failure: `AuthError` → `recordProviderError` (NEEDS_ATTENTION unless paused). Other errors → `syncErrors += 1`, `SyncRun.error` (code only, no bodies); at 5 → `recordProviderError` with `lastError.kind "SYNC"` (status ERROR; sending already blocked by staleness). Lease cleared.

`syncDue`: accounts not deleted, with credentials, `lifecycle != NEEDS_ATTENTION`, and `lastSyncAttemptAt` older than the poll interval (or the backoff when `syncErrors > 0`), 4 at a time.

- [ ] Write the failing tests:
  - N-1: SMTP provider test (fake SMTP server already used in imap-smtp tests) with To refused 450 and Cc accepted → `PermanentSendError` `lead_rejected_partial`; sender test → FAILED, `AccountDailyUsage.sent` += units, no retry row.
  - N-3: resume a COMPLETED campaign with past `endAt` → 409 `campaign_ended`.
  - `sync.test.ts`: first sync imports `historyImportDays` of INBOX and SENT and sets `lastSyncCompletedAt = syncStartedAt` (clock advanced during the run; assert the start value); `the watermark waits for stop rules`: a reply in page 2 of 2 with `limit 1` → after the first run `more` and `lastSyncCompletedAt` unchanged, after the second the lead is STOPPED and the watermark set; `expired cursor → full reconcile with no duplicates` (`expireCursors()` then sync → Message count unchanged, cursor renewed); `outside-app send recorded`; `transient errors escalate after 5` (Fake `failNext` on reads) and `backoff`; `AuthError → NEEDS_ATTENTION`; `two workers, one lease` (two concurrent `reconcileAccount` → one `skipped`); `watermark never moves backwards`; `ingest failure blocks freshness` (a message that throws → run `failed`, cursor and watermark unchanged).
  - Providers: Gmail and Graph page stops at ~20 MB (`hasMore true`); invalid page token → `{expired:true}`; Graph `@removed {reason:"changed"}` → in `removed`.
  - E2E row #8 `reply-sync.test.ts`: worker-level `syncDue` + `dispatchTick` on the Fake: step 1 sent, reply received, next `syncDue`, step 2 never sent; an unrelated lead's step 2 is sent.
- [ ] Run → FAIL. Implement. Run the files → PASS, then the full checks. Update `docs/HANDOFF.md`: D16 lifted — real campaigns now send once accounts sync and their provider is live-verified (D17).
- [ ] Commit `feat(sync): incremental, full and historical mailbox sync; freshness watermark`.

## P4-T06 Inbox API

Model: sonnet. **Owns:** PS-INBOX-02, -03, -05, -06 (recent searches client-side, T08), -07, -08 (API), -09, -10, -11, -12 (API side: category, reminder; lead edits reuse lead routes), -14, -15 (thread delete), -16, -19 (manual correction + feedback log), -22, -23, -24 (lead's scheduled rows); D29.
Files: `packages/core/src/mail/{inbox,reply}.ts`; schema + migration (`Note`, `Macro`, `InboxView`); routes under `apps/web/app/api/v1/inbox/`: `threads/route.ts` (GET list), `threads/[id]/route.ts` (GET, PATCH `{isRead?, category?, reminderAt?}`, DELETE local), `threads/[id]/read-all/route.ts` (POST), `threads/[id]/attach-lead/route.ts` (POST `{leadId}`), `threads/[id]/reply/route.ts` (POST multipart `{mode:"reply"|"reply_all"|"forward", to?, cc?, html, attachments[]}`), `threads/bulk/route.ts` (POST `{ids|filter, action:"read"|"unread"|"delete"|"set_interest"|"blocklist", interestStatus?}`), `unread-count/route.ts` (GET `{primary, others, total, remindersDue}`), `attachments/[id]/route.ts` (GET, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`), `notes/route.ts` + `notes/[id]/route.ts`, `macros/route.ts` + `macros/[id]/route.ts` + `macros/[id]/render/route.ts` (POST `{threadId}` → `{text, html}` via `render()` with the thread's lead), `views/route.ts` + `views/[id]/route.ts`; tests `packages/core/test/inbox.test.ts`, `packages/core/test/reply.test.ts`, `apps/web/test/inbox-api.test.ts`.

`ThreadFilter` (zod, also the saved-view payload): `view: "primary"|"others"|"unread"|"reminders"|"sent"|"all"` (default primary; primary = `leadId` not null and `lastInboundAt` not null and `lastInboundKind != BOUNCE`; others = inbound threads with no lead or a deleted lead (PS-INBOX-16) or a bounce; sent = threads with an OUT message), `accountId?`, `campaignId?`, `interestStatus?`, `leadLabel?`, `category?`, `q?` (ILIKE over subject, fromEmail and text of the thread's messages; `shortcut: ILIKE scan, switch to a tsvector index when a workspace passes ~100k messages`), `from?`, `to?`, `subject?`, `after?`, `before?`, `hasAttachment?`, `direction?: "received"|"sent"`, `cursor?` (`lastMessageAt|id`), `limit` ≤ 100 default 50. Deleted threads never listed.

`sendReply`: load thread, account (must be live and `status CONNECTED`, else 409 `account_unavailable`), recipients (reply → last inbound sender; reply_all → plus its to/cc minus our address; forward → `to` required), D29 checks, attachments total ≤ 20 MB (Microsoft: ≤ 3 MB, 413 `attachments_too_large_for_provider`); forward adds the original attachments. MIME: `newMessageId(account domain)`, `inReplyTo` = last message's rfc id, `references` = its references + it, `threadId` = `providerThreadId`, subject `Re: `/`Fwd: ` unless already prefixed. `provider.send` outside any tx. Accepted → one tx: OUT Message + Attachments, thread `lastMessageAt`, usage `sent += units`, audit. `AmbiguousSendError` → 502 `send_uncertain` "The reply may have been sent. Check the mailbox's Sent folder before trying again." (nothing stored; sync imports it if it went out). `AuthError` → `recordProviderError`, 409 `account_needs_attention`. Other errors → 502 with the provider error code only.

Attach lead: sets `thread.leadId`, the thread's IN messages' `leadId`, then runs `applyInbound` for the newest IN message with the new match (a forwarded reply stops the lead; D26). Category override: PATCH `category` → `categorySource "USER"`, audit `inbox.category_override {from, to, previousSource}` (the feedback log).

- [ ] Write the failing tests:
  - `inbox.test.ts`: each view returns exactly the seeded threads; filters combine (account + campaign + hasAttachment + date); `q` matches body text; cursor paging returns no duplicates across pages; unread count; `read-all`; local delete hides the thread and the lead stays in its campaign; reply from a deleted lead lands in Others; attach-lead moves the thread to Primary and stops the lead's follow-ups; bulk `blocklist` suppresses the senders.
  - `reply.test.ts` (Fake): reply → sent once with correct `In-Reply-To`/`References`, OUT Message in the thread, `AccountDailyUsage.sent +1`; reply_all excludes our own address; forward includes the original attachment; at `floor(providerCap/2)` → 409 `provider_cap`; suppressed recipient → 409; Fake `failNext("ambiguous")` → 502 `send_uncertain`, no Message row; Microsoft account with 4 MB attachment → 413.
  - `inbox-api.test.ts`: VIEWER can GET and gets 403 on PATCH/reply; API key with `inbox:read` only → 403 on reply; workspace isolation on every route (`expectIsolated`); attachment download headers; thread GET never contains attachment `data`; macro render fills `{{firstName}}`.
- [ ] Run → FAIL. Implement. Run the files → PASS, then the full checks.
- [ ] Commit `feat(inbox): threads, views, search, notes, macros, reply and forward API`.

## P4-T07 Downtime simulations and offline-recovery doc

Model: **opus**. **Owns:** PS-SYNC-09, PS-SYNC-10 (re-assert with sync on), PS-SYNC-11, PS-SYNC-12; master Review Focus 2.
Files: `packages/core/test/e2e/downtime.test.ts`; `docs/ops/OFFLINE_RECOVERY.md`; fixes in the owning module for anything the tests find.

Scenario (one parametrised suite, `days ∈ {1, 7, 30}` × `mode ∈ {"cold_boot", "sleep"}`): two Fake accounts A and B assigned to one 3-step campaign (`stopOnReply`, `stopForCompanyOnReply`, daily limit 10, window 09:00–17:00 UTC, gap 600 s), 8 leads with step 1 sent before the downtime. During the downtime (clock jumped; `cold_boot` also creates a fresh `bootId` and runs `recoverExpired`, `sleep` does not) the Fake mailboxes receive: lead 1 replies to A; lead 2 (same company as lead 3, both contacted from B) replies to **A** as a new message; lead 4 hard-bounces (DSN to its sender); lead 5 sends an "unsubscribe" reply; lead 6's Gmail-style cursor expires on B (`expireCursors`) before its reply arrives; leads 7 and 8 do nothing. One SENDING row is left mid-flight before the downtime (lease expires during it).
Assertions after wake: (a) the first `dispatchTick` before any `syncDue` sends nothing (stale); (b) after `syncDue` completes, leads 1–6 have no further sends ever and the right stop reasons (REPLIED, REPLIED, COMPANY_REPLIED, BOUNCED, UNSUBSCRIBED, REPLIED); (c) leads 7 and 8 get step 2, only inside the window, ≥ 600 s apart per account, ≤ 10 per account-day, spread over days when over quota (never a burst); (d) the mid-flight row is resolved via `findSent` (SENT if the Fake has it, else HELD) and never resent; (e) every `(campaignLeadId, stepId)` appears at most once in each Fake's SENT; (f) an account whose sync keeps failing never sends, and the other one does. 30 days notes: re-warm allowance arrives with P5-T06 (extends this suite).
`OFFLINE_RECOVERY.md`: what is reconstructed after downtime (replies, auto-replies, DSN bounces, mailto unsubscribes, sends made elsewhere, deletions where the provider reports them) and what is not (opens and clicks while the tracking endpoint was unreachable, one-click unsubscribe POSTs and link-page visits while the web app was down, push notifications, Graph/Gmail data older than their history windows beyond the full-reconcile window), plus what the operator sees (sync progress, HELD rows).

- [ ] Write the suite → run → note failures; fix root causes in the owning modules (with a unit test each); run → PASS, then the full checks.
- [ ] Commit `test(sync): 1/7/30-day downtime simulations; offline recovery doc`.

## P4-T08 Unified inbox UI

Model: sonnet. **Owns:** PS-INBOX-01..16, -19, -21..-24 (UI side), PS-SYNC-13 (shown in T05 drawer), E2E row #11; D30.
Files: `apps/web/app/(app)/inbox/` (`page.tsx` server shell; client components: `ThreadList`, `ThreadView`, `MessageFrame` (D30), `Composer` (textarea → HTML paragraphs and autolinks, same as the campaign builder's body field; attachments input; macro picker), `LeadPanel` (lead fields, campaign, step/variant that started the thread, OOO resume date from the newest AUTO_REPLY's `oooUntil`, next scheduled row via the existing scheduled API, notes), `Sidebar` (views with unread badges, accounts, campaigns, interest statuses, saved views), `BulkBar`); nav badge from `unread-count` (polled every 60 s); thread header actions: interest status (lead PATCH), category override, reminder, move to subsequence/other campaign (existing routes), delete conversation, delete lead / blocklist dialog with the PS-INBOX-15 options (existing lead delete + blocklist domain routes); recent searches in `localStorage` (try/catch); e2e `apps/web/e2e/inbox-thread.spec.ts`.

- [ ] Write the failing Playwright test `inbox-thread.spec.ts` (MAIL_PROVIDER_FAKE): seed a campaign send and a Fake reply, run one sync via the dev route the e2e helpers already use (or seed via the API), then: the thread appears in Primary with the unread badge; opening it marks it read and shows both messages in order with the lead panel (step 1, variant A); reply with an attachment → the Fake's SENT shows it threaded (`In-Reply-To`) and the thread shows three messages; `rendering is inert` (Review Focus 4): a seeded hostile HTML message runs no script (`window.__pwned` stays undefined in the frame), triggers no request to the remote image host until "Show images" is clicked; a note added is visible after reload; bulk mark unread works; a reminder puts the thread in "Reminders".
- [ ] Run → FAIL. Implement. Run `E2E_PROD=1 npm run e2e -- inbox-thread` (Windows) → PASS, then the full checks.
- [ ] Commit `feat(inbox): unified inbox UI`.

---

## Deferred items (each with owner and reason)

- **PS-INBOX-20** AI classifier and thumbs feedback, **PS-INBOX-19** AI labels → P7-T05 (the `AiClassifier` hook and the user-override audit log are built here).
- **PS-INBOX-21** link-target warnings, rich-text compose formatting → P7-T08 (UI polish; D30).
- **PS-INBOX-14** optional two-way read-state sync → not planned (spec: "later").
- **PS-SYNC-01** push (Gmail watch, Graph subscriptions) and IMAP IDLE, **PS-TRACK-13** → P7-T06 (D31).
- **PS-TRACK-10** reports, **PS-TRACK-11** meeting/opportunity/deal events → P6-T01/T03.
- Soft/unknown bounce effect on account health, complaint feedback loops → P5-T02 (events are stored here).
- Inactivity derived in `reconcileAccount` (`computeLifecycle`) → P5-T05 hooks into `reconcileAccount` after step 4.

## Models

T03, T05, T07 on **opus** (stop rules against the claim, the freshness watermark, downtime correctness). T01, T02, T04, T06, T08 on sonnet. Every task gets an independent sonnet reviewer; T05 and T07 get an opus reviewer.

## Coverage self-check

- **INBOX:** 01 T01/T08 · 02–03 T06/T08 · 04 T01 · 05 T06 · 06–07 T06/T08 · 08 T06/T08 · 09–12 T06/T08 · 13 T08 · 14–16 T06/T08 · 17 T02 · 18 T03 · 19 T02/T06 · 20 T02/T05 (hook) · 21 T08 · 22–24 T06/T08.
- **TRACK:** 01–02 T01 · 03–07 T04 · 08 T02 · 09 T03 (+ P3-T08 link) · 12 T01; deferred 10, 11, 13.
- **SYNC:** 01–04 T05 · 05 T01 · 06 T03 · 07 T05 (freshness gate replaces the boot gate, master plan) · 08 T03 · 09–12 T07 · 13 T05.
- **From Phase 3:** PS-LEAD-08 T03/T04 · PS-LEAD-19 T03/T04 · PS-LEAD-22 T05 · PS-CAMP-19 T03 · PS-CAMP-21 T04 · PS-SEQ-07/08/09 T03 · PS-SEND-10 T03 · PS-SEND-14 tracking domain T04 · Event ACCEPTED + backfill T01 · PS-ACC-31 progress T05.
- **TASKS.json carry-forwards:** labelAdded dedupe T01 · transient read errors T05 · Graph `changed` T05 · I-7, I-9 T05 · N-1, N-3 T05 (first steps).
- **E2E rows:** #8 T05 · #9 T03 · #10 T03 · #11 T08.

## Phase gate

Full `npm test`, lint, typecheck, Playwright, and CI (`check`, `compose-smoke`, `imap-real`) green; `ponytail-audit` by a fresh reviewer; tick PS items in PRODUCT_SPEC; update PROGRESS, HANDOFF (D16 lifted; D17 still gates real providers), REVIEW_LOG and DECISIONS (D26–D31); fast-forward `main` and push.

## Revision 2 — changes from review (`docs/plans/phase-4-review.md`; binding on the owning tasks, overrides the text above where they differ)

| # | Owner | Change |
|---|---|---|
| C1 | T05 | `syncProgress = { mode, folder, pageToken, since, cursor, startedAt, fetched }`. Branch order: `syncProgress` non-null → resume it (whatever `syncCursor` says); else no `syncCursor` → HISTORICAL; else incremental (expired → FULL). Run 1 of a HISTORICAL/FULL import stores `cursor = currentCursor()` and `startedAt = syncStartedAt`. On completion `syncCursor = syncProgress.cursor`, `lastSyncCompletedAt = GREATEST(old, syncProgress.startedAt)`, `syncProgress null`; the next incremental run brings it current. Tests: HISTORICAL across 2 runs with a reply delivered between them → ingested by the following incremental run; watermark after the import = run 1's start. Same for FULL after `expireCursors()`. |
| I1 | T03 | `applyInbound` order (record in D26): (1) `cancelRows`, then CampaignLead stops (`stopOnReply`, company); (2) subsequence entry for the matched campaign: first active REPLY_KEYWORD trigger whose `phrases` match `stripQuoted(text)`, else first LEAD_STATUS trigger for the new interest → `enterSubsequence` (allowed from STOPPED REPLIED); (3) when `Lead.interestStatus` is null set it and `lastInterestChangeAt` directly; call `applyInterestChange` only for −1, never its 1..4 branch; (4) Lead counters; (5) Suppression; (6) Event. Tests rewritten: with `stopOnReply` on, the lead is STOPPED REPLIED in the main flow and ACTIVE in the keyword subsequence; the interest test asserts `interestStatus` is written and other campaigns are not COMPLETED. |
| I2 | T03 | A bounce stops and suppresses the lead only when `recipient` equals the lead's email, or `recipient` is null and the original had one recipient. Otherwise suppress `recipient` only; event on the lead with `meta.recipient`. Test: campaign `cc`, DSN for the cc → lead ACTIVE, cc address suppressed. |
| I3 | T03, T05 | `unsubscribe.ts` exports `optOutTx(tx, clock, ws, email, leadIds, source)`; `unsubscribeLead` / `suppressMailtoUnsubscribe` wrap it. `applyInbound` calls it with the sender's leads ∪ `match.leadId`. Sync escalation writes `status ERROR`, `lastError {kind:"SYNC", code}`, `lastErrorAt` directly (lease-conditional); `recordProviderError` stays for `AuthError` only; a caught-up run clears a SYNC error back to CONNECTED. |
| I4 | T01 | `matchMessage` step 0 for OUT: own `rfcMessageId` = `ScheduledMessage.rfcMessageId` in the workspace → that row. `recordOutboundMessage` runs after every `recordAccepted` (sender and `resolveUncertain`). Test: delete the OUT Message, sync the Fake's SENT → `scheduledMessageId` set, `outsideApp false`; a step-2 send links to the step-2 row. |
| I5 | T01 | Migration adds `@@index([workspaceId, rfcMessageId])` on `ScheduledMessage`. |
| I6 | T05 | Lease renewed after every page (`… WHERE "syncLeaseId" = $id`; 0 rows → stop as `skipped`). `syncDue(…, o: { maxMs: number; signal?: AbortSignal })` with the same budget as `dispatchTick`; `signal` checked between messages. Job options `{ policy: "stately", retryLimit: 0, heartbeatSeconds: 10 }`, `boot: true`. |
| I7 | T03 | The `enrolledAt` date guard applies only when `match.scheduledMessageId` is null. Test: a threaded reply whose `Date:` is a year old still stops the lead. |
| I8 | T03 | A non-lead sender company-stops only in `match.campaignId` and only when `match.scheduledMessageId` is non-null. Lead senders keep D26. Negative test: an unthreaded mail from `billing@acme.test` stops nobody. |
| I9 | T02, T06 | NOT_INTERESTED uses `we('re| are) all set\b(?!\s+(up|for|to))` and `no,? thanks\b(?!\s+needed)`. When NOT_INTERESTED and MEETING_REQUESTED/INTERESTED both match → UNCERTAIN. Corpus adds "we are set up for Tuesday" and "no thanks needed, send pricing". T06: changing a RULE-sourced NOT_INTERESTED category removes the `NOT_INTERESTED` suppression with source `status` it created. |
| I10 | T04 | `recordOpen` (non-machine) and `recordClick` (non-scanner) enter the first active `ACTIVITY` subsequence (`activity "opened"`/`"clicked"`) of the row's campaign. Lock order: CampaignLead `FOR NO KEY UPDATE` → `enterSubsequence` → Lead counters. One test per trigger. T04 also owns PS-SEQ-09 (opened/clicked). |
| I11 | T01, T06 | `gdprDeleteLead` deletes the lead's Threads (cascading Messages and Attachments), Messages whose `fromEmail` is the lead's address, and nulls `leadId` on Events; `mergeLeads` re-points `leadId` on Thread, Message and Event. T06 extends both to Notes. Tests for both. |
| I12 | T07 | Assertion (f) runs on a second campaign without `stopForCompanyOnReply`; in the company-stop campaign assert that neither account sends while one is stale. |
| M1 | T03 | Ingest tx order is Thread → Message → D21 order (safe: no send-state tx locks Thread/Message). The OOO `dueAt` push selects rows `FOR UPDATE SKIP LOCKED`. |
| M2 | all | The pre-send check *narrows* (does not prevent) the stop/send window; a reply racing the provider call is inherent. |
| M3 | T06 | D29 check: `sent + reserved + units > floor(providerCap / 2)` → 409. D29 states it departs from "never exceed per-account allowances" for the user limit only. Every recipient (to, cc, bcc) is checked against suppression. |
| M4 | T08 | `cid:` images are rewritten server-side to `data:` URIs from stored attachment data (≤ 1 MB each, else dropped); CSP `img-src data:` (+ `https:` after "Show images"); add `<meta name="referrer" content="no-referrer">`. The inert fixture adds `<meta http-equiv=refresh>` and a CSS `@import`. |
| M5 | T04 | `docs/ops/KEY_ROTATION.md`: keep `OLD_ENCRYPTION_KEY` ≥ 90 days, or old tracking and unsubscribe links return 400. |
| M6 | T06 | Attach-lead updates the existing unattributed REPLY event's `leadId`/`campaignId` and bumps the counters when it had no lead. |
| M7 | T05 | `new PermanentSendError("lead_rejected_partial", undefined, { scope, countsTowardPause: false for a 4xx })`. Amend D25 M-3 in DECISIONS. |
| M8 | T03–T05 | REPLY_KEYWORD field is `phrases: string[]`. Use `FailKind` `api_5xx` for the ambiguous reply test. T05 adds a read-side failure queue to `FakeProvider` (`failNextRead(kind)` for `currentCursor`/`listChangesSince`/`listMessages`). Use `companyDomainOf()`. Export `mapLimit` from `@rightnow/providers`. Widen `stopOpenCampaignLeads` reasons and use it (it also stops PAUSED) instead of `stopLead` for reply stops. |
| M9 | T05 | `SyncDeps.maxPages?` (test-only, default 10) for the `more` test. |
| M10 | T05 | Env refine `2 × SYNC_POLL_SEC + 60 ≤ SYNC_MAX_STALENESS_SEC`. An account whose last result was `more` is due on the next tick. |
| M11 | T05 | A `listMessages` page token that fails as invalid restarts that folder's listing from `since` (ingest is idempotent). |
| M12 | T03, T06, T07 | PS-LEAD-22 export of historical conversations → deferred to P7-T03 (lead export API). `ThreadFilter.view` gains `"scheduled"` (UI routes it to the P3 Scheduled view). OOO without a date (and `stopOnAutoReply` off) pushes follow-ups 7 days (compliance rule 63: OOO pauses the sequence); record in D26. `OFFLINE_RECOVERY.md` lists replies filtered to spam as not reported. |
| M13 | T07 | Add ~25 silent leads so quota spreading over days is exercised. |
| M14 | T08 | Add `POST /api/v1/%5Ffake/sync` (Fake only, refused when `MODE=vps`, session-only ADMIN) that calls `syncDue`; the e2e uses it. |
| M15 | T01, T03, T06 | `direction` = OUT when `from` is the account address, else IN, whatever the folder. Primary requires `lead.deletedAt IS NULL`. A HARD bounce with no target suppresses `recipient`. |
| M16 | T06 | `sendReply`'s post-send insert uses the same `(accountId, rfcMessageId)` upsert as `ingestMessage`. |
| M17 | T03 | A reply whose `In-Reply-To` matches an UNCERTAIN or HELD row settles it SENT through `recordAccepted` (proof of delivery, so a later Release cannot double-send). Test. |
| M18 | controller | `docs/TASKS.json`: T03/T05/T07 opus; deps T02,T04→T01; T03→T02; T05→T03,T04; T06,T07→T05; T08→T06. Done with this revision. |
