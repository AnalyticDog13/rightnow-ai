# rightnow-ai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task-by-task. Each phase also has a step-level plan in `docs/plans/phase-N.md`, written and reviewed
> just before that phase starts. Task status lives in `docs/TASKS.json`.

**Goal:** A self-hosted, MIT-licensed Instantly.ai alternative with real provider sending, inbox sync,
campaigns, warm-up/re-warm-up, CRM and analytics, runnable locally and on a VPS from one codebase.

**Architecture:** Next.js app (UI + REST API route handlers) and a Node worker process share a Prisma/Postgres
database. Postgres is the only stateful service: pg-boss runs periodic and retryable jobs, and the send queue is a
table of `ScheduledMessage` rows claimed with `FOR UPDATE SKIP LOCKED` together with an atomic quota reservation.
Provider differences (Gmail API, Microsoft Graph, IMAP/SMTP) sit behind one `MailProvider` interface.

**Tech Stack:** TypeScript, Next.js (App Router), React, Tailwind, shadcn/ui, Recharts, Prisma + PostgreSQL,
pg-boss, better-auth (organization plugin), zod, Vitest + embedded-postgres, Playwright, Docker Compose,
Caddy. Exact versions: `docs/STACK.md`.

**Spec:** `rightnow_ai_master_prompt.md` (authoritative) and `docs/PRODUCT_SPEC.md` (parity checklist, IDs `PS-*`).
Provider rules: `docs/PROVIDER_COMPLIANCE.md`.

## Global Constraints

- Same codebase for local Docker Compose and VPS mode; no feature exists in only one mode.
- Every DB read/write in services takes `workspaceId` and filters by it.
- Credentials (OAuth refresh/access tokens, SMTP/IMAP passwords) are stored only AES-256-GCM encrypted with `ENCRYPTION_KEY` (32-byte base64 env).
- A mailbox never sends until its post-startup reconciliation has completed (`EmailAccount.syncState = READY` and `syncReadyAt >= worker boot time`).
- Never send more than the effective daily allowance per account (min of user limit, re-warm allowance, health throttle, provider cap) or the workspace daily cap; never send outside a campaign schedule window; never send the same `(campaignLeadId, stepId)` twice.
- A send whose outcome is unknown (worker died mid-send) becomes `UNCERTAIN` and is resolved by searching the provider's Sent mail for our `Message-ID`; it is never blindly retried.
- Every outbound campaign email carries `List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; unsubscribe and hard bounce add a workspace suppression immediately.
- No fabricated engagement or delivery: "accepted by provider" ≠ "delivered"; estimated/automated opens are flagged `isEstimated`.
- Recipient-facing AI-generated text requires human approval by default.
- Mocks are explicitly named `Fake*`/`mock*` and live in test code or `packages/providers/src/fake/`; never selectable in production unless `MAIL_PROVIDER_FAKE=1`.
- Every item in `docs/PROVIDER_COMPLIANCE.md` → "Rules our code must enforce" is a requirement (provider cap defaults + hard clamps, physical address required before campaign sends, auto-pause thresholds, minimal scopes, `invalid_grant` → NEEDS_ATTENTION). Cc/Bcc recipients count toward quota.
- Versions per `docs/STACK.md`: Prisma 7.10.1 (CLI pinned, not the 8 RC; `prisma-client` generator, `@prisma/adapter-pg`, `prisma.config.ts`), better-auth with `organization()` plugin = workspaces, pg-boss 12 (`createQueue` before `send/work`), zod 4, Tailwind 4. TypeScript: try 7.x; if Next/ESLint/Prisma break, pin latest 5.x and record in DECISIONS.
- Provider sync defaults to polling (Gmail `history.list`, Graph delta, IMAP); push is optional (needs public HTTPS).
- Every task: tests first, `npm test`, `npm run lint`, `npm run typecheck` green before commit.

## Review Focus

1. Worker crash between provider-accepted send and DB update → restart must not duplicate the email (P3-T09 test `uncertain send found in Sent is marked SENT`).
2. Laptop asleep 1/7/30 days with replies arriving meanwhile → on startup follow-ups to repliers are cancelled before any send, backlog is spread under quota, Gmail history expiry falls back to full reconcile (P4-T06 tests `downtime 1d/7d/30d`).
3. Two workers ticking concurrently with one account at 49/50 → exactly one more send (P3-T08 test `parallel dispatchers respect quota`).
4. CSV with BOM, semicolons, duplicate emails, mixed-case emails, invalid rows → imported counts and skipped reasons are exact (P3-T02 tests).
5. OAuth refresh token revoked/expired while campaign active → account goes `NEEDS_ATTENTION`, its scheduled messages re-route or wait, no crash loop; reconnect keeps history (P2-T04, P5-T06 tests).

---

## Repository layout

```
apps/web/                 Next.js app: app/(app)/<section>/ pages, app/api/v1/** REST routes, app/t|u/** public tracking/unsubscribe
  lib/                    auth, session→workspace helper, api handler wrapper (zod + error mapping)
  components/             shadcn/ui + app components
apps/worker/              src/index.ts boots pg-boss, registers jobs; src/jobs/*.ts one file per job
packages/db/              prisma/schema.prisma, migrations, src/index.ts (client), src/test-db.ts (embedded-postgres helper)
packages/core/src/        pure domain logic, no I/O except via passed-in prisma/provider:
  crypto.ts template.ts spintax.ts schedule.ts quota.ts dispatch.ts sequence.ts rotation.ts
  leads/ (csv.ts dedupe.ts validate.ts) classify.ts threading.ts events.ts automations.ts webhooks.ts
  rewarm.ts warmup.ts health.ts dns.ts analytics.ts crm.ts sync.ts ai/
packages/providers/src/   types.ts gmail/ graph/ imap-smtp/ fake/ mime.ts
docker/                   Dockerfile (multi-stage, one image, two commands), Caddyfile
docker-compose.yml        postgres, web, worker (+ caddy in profile "vps")
scripts/                  backup.sh restore.sh (+ .ps1 equivalents), migrate-to-vps.md
docs/                     see CLAUDE.md docs index; docs/ops/*.md user guides
```

## Data model (packages/db/prisma/schema.prisma) — introduced incrementally by the tasks noted

Core (P1): `Workspace`, auth tables (User, Session, Account, Verification, Organization/Member per auth lib), `AuditLog(workspaceId, actorId, action, target, meta, at)`, `ApiKey(workspaceId, name, hash, prefix, lastUsedAt)`.

Accounts (P2): `EmailAccount(id, workspaceId, provider GMAIL|MICROSOFT|SMTP, email, fromName, signature, tags[], credentialsEnc, status CONNECTED|ERROR|DISCONNECTED, lifecycle ACTIVE|INACTIVE|REWARMING|PAUSED|NEEDS_ATTENTION, dailyLimit, minGapSec, randomGapSec, timezone, nextSendAt, lastSentAt, lastCampaignActivityAt, lastError, lastErrorAt, syncState PENDING|RUNNING|READY|FAILED, syncCursor Json, syncReadyAt, lastSyncedAt, healthScore, trackingDomain)`; `AccountDailyUsage(accountId, day, sent, reserved, @@id[accountId,day])`; `WorkspaceDailyUsage(workspaceId, day, sent, reserved)`.

Leads (P3): `Lead(workspaceId, email citext-like lowercased unique per workspace, firstName, lastName, companyName, jobTitle, website, industry, phone, customFields Json, tags[], status, interestStatus, verificationStatus, ownerId)`; `LeadList`, `LeadListMember`; `Suppression(workspaceId, kind EMAIL|DOMAIN, value, reason, source, createdAt, unique[workspaceId,kind,value])`; `ImportJob`.

Campaigns (P3): `Campaign(workspaceId, name, status DRAFT|ACTIVE|PAUSED|COMPLETED|ARCHIVED, dailyLimit, maxNewLeadsPerDay, stopOnReply, stopOnAutoReply, stopForCompanyOnReply, trackOpens, trackClicks, textOnly, prioritizeNewLeads, matchProvider, unsubscribeHeader, cc[], bcc[], startAt, endAt, ownerId, abAutoOptimize)`; `CampaignSchedule(campaignId, name, timezone, days int bitmask, from 'HH:mm', to 'HH:mm')`; `CampaignAccount(campaignId, accountId)`; `SequenceStep(campaignId, order, delayDays, parentStepId?, branch ALWAYS|IF_NO_REPLY|IF_REPLY_INTERESTED|IF_REPLY_NOT_INTERESTED)`; `StepVariant(stepId, label, subject, body, weight, active)`; `CampaignLead(campaignId, leadId, state QUEUED|ACTIVE|PAUSED|COMPLETED|STOPPED, stopReason, currentStepId, nextDueAt, accountId, unique[campaignId,leadId])`.

Send queue (P3): `ScheduledMessage(id, workspaceId, campaignLeadId, stepId, variantId, accountId, dueAt, status SCHEDULED|SENDING|SENT|FAILED|CANCELLED|UNCERTAIN|DEFERRED, attempts, idempotencyKey unique = campaignLeadId:stepId, rfcMessageId, providerMessageId, providerThreadId, claimedAt, sentAt, error)`.

Mail (P2/P4): `Thread(workspaceId, accountId, providerThreadId, subject, leadId, campaignId, lastMessageAt, isRead, category, reminderAt, unique[accountId,providerThreadId])`; `Message(workspaceId, accountId, threadId, providerMessageId, rfcMessageId, inReplyTo, references[], direction IN|OUT, from, to[], cc[], subject, text, html, sentAt, isAutoReply, isBounce, bounceType, unique[accountId,providerMessageId])`; `Attachment(messageId, filename, contentType, size, storageKey)`; `Note(workspaceId, leadId?, threadId?, opportunityId?, body, authorId)`.

Events (P4): `Event(workspaceId, type, occurredAt, leadId, campaignId, accountId, stepId, variantId, messageId, isEstimated, meta Json, dedupeKey unique)`. Types: SCHEDULED, SEND_ATTEMPT, ACCEPTED, SEND_FAILED, BOUNCE_HARD, BOUNCE_SOFT, UNSUBSCRIBE, REPLY, REPLY_POSITIVE, REPLY_NEGATIVE, OPEN, CLICK, MEETING, OPPORTUNITY, DEAL_WON, DEAL_LOST, WARMUP_SENT, WARMUP_RECEIVED, ACCOUNT_PAUSED.

Deliverability (P5): `DomainCheck(workspaceId, domain, spf, dkim, dmarc, mx Json, status, checkedAt)`; `WarmupSettings(accountId, enabled, dailyTarget, increasePerDay, startVolume, replyRatePct, weekdaysOnly, peerTag)`; `RewarmPlan(accountId, startedAt, startAllowance, incrementPerDay, targetLimit, currentAllowance, state ACTIVE|PAUSED|COMPLETED, criteria Json)`; `WorkspaceSettings(workspaceId, inactivityThresholdDays, autoRewarm OFF|RECOMMEND|AUTO, workspaceDailyCap, bounceThresholdPct, physicalAddress, ...)`.

CRM (P6): `PipelineStage(workspaceId, name, order, kind OPEN|WON|LOST)`; `Opportunity(workspaceId, leadId, campaignId?, stageId, title, value Decimal, currency, expectedCloseAt, ownerId, closedAt)`; `Task(workspaceId, title, dueAt, doneAt, leadId?, opportunityId?, assigneeId)`; `Activity` = `Event` rows (no separate table).

Automation (P7): `AutomationRule(workspaceId, name, trigger, conditions Json, actions Json, enabled)`; `Webhook(workspaceId, url, secretEnc, events[], enabled)`; `WebhookDelivery(webhookId, eventId, status, attempts, lastError, unique[webhookId,eventId])`; `AiSettings(workspaceId, provider, apiKeyEnc, model, features Json)`.

## Send pipeline (P3-T07..T10) — the critical algorithm

1. **Planner** (pg-boss cron every minute, singleton): for each ACTIVE campaign currently inside a schedule window,
   pick `CampaignLead`s with `nextDueAt <= now` and no open ScheduledMessage (new leads limited by
   `maxNewLeadsPerDay`, ordering per `prioritizeNewLeads`), choose an account via rotation
   (`rotation.pickAccount`: eligible = assigned, lifecycle not PAUSED/NEEDS_ATTENTION, syncState READY,
   remaining allowance > 0, provider match if enabled; tie-break least sent today, then round-robin), choose
   variant (weighted / auto-optimized), insert `ScheduledMessage(status SCHEDULED, dueAt = max(now, account.nextSendAt))`.
   Unique `idempotencyKey` makes double-planning a no-op.
2. **Dispatcher** (pg-boss cron every 30 s + loop until empty, any number of workers): in one transaction
   `SELECT … WHERE status='SCHEDULED' AND dueAt<=now FOR UPDATE SKIP LOCKED LIMIT 20`; for each, conditional
   updates: `AccountDailyUsage.reserved+1 WHERE sent+reserved < allowance`, same for workspace, and
   `EmailAccount.nextSendAt = now + minGap + rand(0..randomGap) WHERE nextSendAt <= now`; if any fails → set
   `DEFERRED`/new dueAt and continue; else `status=SENDING, claimedAt=now, rfcMessageId=<generated>`. Commit.
   Re-check suppression + CampaignLead state immediately before calling the provider.
3. **Send**: render (template + spintax seeded by idempotencyKey so retries render identically), build MIME with
   our `Message-ID`, unsubscribe headers, threading headers for follow-ups; `provider.send`. Success →
   `SENT`, `sent+1, reserved-1`, Event ACCEPTED, advance CampaignLead (`nextDueAt = sentAt + next.delayDays`
   aligned to schedule). Retryable provider error (429/5xx/network before request was accepted) → back to
   SCHEDULED with exponential backoff (1m·2^n, max 5), release reservation. Permanent error → FAILED, account
   error counters, automation `SEND_FAILURE_THRESHOLD`.
4. **Recovery** (worker boot + every 5 min): `SENDING` rows with `claimedAt < now-5m` → `UNCERTAIN`;
   `resolveUncertain` searches provider Sent for `rfcMessageId`: found → SENT (count usage), not found → SCHEDULED.
5. **Startup gate**: worker boot sets all accounts `syncState=PENDING`; `sync-account` jobs reconcile; planner and
   dispatcher ignore accounts not READY since boot. Overdue messages from downtime are just "due"; quota and
   min-gap spread them; no catch-up beyond today's allowance.

## Reconciliation (P4-T05/T06)
`sync.reconcileAccount(account)`: provider `listChangesSince(cursor)` (Gmail history.list, Graph delta, IMAP
UIDNEXT/MODSEQ); on cursor expired → `fullReconcile(since = lastSyncedAt - 2d)` listing INBOX+SENT by date.
Each message → upsert Message (dedupe on providerMessageId), thread match (`In-Reply-To`/`References` vs our
`rfcMessageId`s, provider thread id fallback), classify (bounce DSN / auto-reply headers / unsubscribe / human
reply), emit Events with dedupeKey, apply stop rules (cancel CampaignLead + open ScheduledMessages), run
automations. Then set cursor, `syncState=READY`. Also detects sends made outside the app from Sent (e.g. manual
replies) and records them.

---

## Phases and tasks

Each task: ID · title · files · produces · acceptance tests. Step-level detail lives in `docs/plans/phase-N.md`.
Model: `S`=sonnet, `H`=haiku, `O`=opus.

### Phase 1 — Foundation

- **P1-T01 (S) Monorepo scaffold & tooling.** Root `package.json` (workspaces, scripts dev/test/lint/typecheck/e2e/db:*), `tsconfig.base.json`, ESLint flat config, Prettier, `LICENSE` (MIT), `README.md`, `.env.example`, Vitest workspace config, GitHub Actions `ci.yml` (install, lint, typecheck, test). *Accept:* `npm install && npm run lint && npm run typecheck && npm test` pass on Windows; CI green.
- **P1-T02 (S) Database package + test harness.** `packages/db`: Prisma schema (Workspace, AuditLog, ApiKey + auth tables), first migration, client export, `src/test-db.ts` (`startTestDb(): Promise<{url, prisma, stop}>` using embedded-postgres, migrate deploy, per-file schema isolation). *Accept:* test creates Workspace and reads it back; works on Windows.
- **P1-T03 (S) Core crypto + env.** `packages/core/src/crypto.ts` `encrypt(plain:string):string`, `decrypt(enc:string):string` (AES-256-GCM, `v1:` prefix, key from `ENCRYPTION_KEY`); `packages/core/src/env.ts` zod-validated env. *Accept:* round-trip, tamper → throws, wrong key → throws, missing key → clear error.
- **P1-T04 (S) Web app shell + auth.** `apps/web` Next.js + Tailwind + shadcn; auth (sign-up first owner creates workspace, sign-in, sign-out, session), `lib/workspace.ts` `requireWorkspace(): Promise<{userId, workspaceId}>`, `lib/api.ts` `route(schema, handler)` wrapper (zod, auth, error → JSON), sidebar with the 10 sections (placeholders labelled "coming in phase N" only until filled), responsive layout, dark mode. *Accept:* Vitest for `route` wrapper (401, 400, 200); Playwright: sign up → land on Dashboard → sign out.
- **P1-T05 (S) Worker skeleton.** `apps/worker/src/index.ts`: env, pg-boss start, job registry, graceful SIGTERM, `boot` record (`WorkerBoot` row with startedAt used by the startup gate), health endpoint `:8081/healthz`. *Accept:* test boots worker against test DB, a demo job runs, shutdown clean.
- **P1-T06 (S) Docker & deploy baseline.** `docker/Dockerfile` (multi-stage, standalone Next output, one image; cmd `web` or `worker` or `migrate`), `docker-compose.yml` (postgres:17 with volume + healthcheck, migrate one-shot, web, worker, restart: unless-stopped; caddy under profile `vps`), `docker/Caddyfile`, `scripts/{start,stop,upgrade,backup,restore}.{sh,ps1}`, `docs/ops/LOCAL.md`, `docs/ops/VPS.md`. CI job builds image and runs compose up + `/api/health`. *Accept:* CI compose smoke test green.
- **P1-T07 (S) API keys + audit log.** `/api/v1` bearer API keys (hashed, prefix shown once), audit helper `audit(ctx, action, target, meta)`, Settings → API Keys page. *Accept:* key auth works, revoked key 401, audit rows written.

### Phase 2 — Email provider connections

- **P2-T01 (O) Provider interface + fake.** `packages/providers/src/types.ts`: `MailProvider { send(msg: OutboundMime): Promise<{providerMessageId, providerThreadId?}>; findSentByMessageId(rfcId): Promise<RemoteMessage|null>; listChangesSince(cursor): Promise<{messages: RemoteMessage[], cursor} | {expired: true}>; listMessagesSince(date, folders): AsyncIterable<RemoteMessage>; getMessage(id); markRead(id, read); verify(): Promise<Diagnostics> }`, error classes `RateLimitedError(retryAfter)`, `AuthError`, `PermanentSendError`, `TransientError`. `fake/` in-memory provider with controllable failures. `mime.ts` `buildMime(opts): {raw, messageId}` (nodemailer MailComposer) and `parseMime(raw): RemoteMessage` (mailparser). *Accept:* MIME tests (headers incl. List-Unsubscribe*, In-Reply-To/References, UTF-8 subjects), fake provider contract test suite reusable by real providers.
- **P2-T02 (S) Google OAuth connect.** `/api/v1/accounts/google/start|callback` (state+PKCE, least-privilege scopes per PROVIDER_COMPLIANCE.md, offline access, prompt=consent), store encrypted tokens, multiple mailboxes, Workspace + consumer, `docs/ops/GOOGLE_SETUP.md`. *Accept:* callback handler test with mocked token endpoint; state mismatch rejected; reconnect same email updates credentials not duplicates.
- **P2-T03 (S) Gmail provider.** `packages/providers/src/gmail/` send (users.messages.send raw, threadId for follow-ups), history.list changes, 404 → expired, list by query `after:`, rfc822msgid search, token refresh with persistence callback, error mapping (429/403 rateLimitExceeded → RateLimitedError, invalid_grant → AuthError). *Accept:* contract suite against recorded HTTP fixtures (msw/nock-free: inject fetch).
- **P2-T04 (S) Account management service + API + UI.** CRUD, pause/resume, limits, gaps, signature, tags, bulk actions (pause/resume/set limits/tag/delete), diagnostics (`verify()` + DNS later), revoke/disconnect, reconnect flow keeps id/history, AuthError → `NEEDS_ATTENTION`. Email Accounts page: table with status, sent today/limit, health, warm-up, re-warm button placeholder wired in P5. *Accept:* service tests (tenant isolation, reconnect keeps id), Playwright list/edit.
- **P2-T05 (S) Microsoft Graph connect + provider.** MSAL auth code flow, `graph/` send (sendMail with internetMessageHeaders / MIME), delta on Inbox+SentItems, search by internetMessageId, `docs/ops/MICROSOFT_SETUP.md`. *Accept:* contract suite with fixtures. (Moved earlier than spec Phase 7 because offline sync and rotation must be provider-agnostic from the start; spec order is a default, not a constraint.)
- **P2-T06 (S) IMAP/SMTP provider.** `imap-smtp/` nodemailer SMTP send + IMAP APPEND to Sent when server doesn't auto-save, imapflow UID/MODSEQ cursor per folder, UIDVALIDITY change → expired, search HEADER Message-ID; connect form with test-connection. *Accept:* contract suite against a local in-process IMAP/SMTP test server or fixtures.
- **P2-T07 (S) Test-send.** "Send test email" from an account (UI + API), event logged, real-integration checklist `docs/ops/LIVE_VERIFICATION.md`. *Accept:* fake-provider test; live check documented, executed when credentials exist.

### Phase 3 — Campaign automation

- **P3-T01 (S) Leads schema + service + API.** CRUD, custom fields, tags, statuses, bulk edit, filters/search (server-side pagination), contact history (events + messages), GDPR delete (cascade + suppression keep hashed). *Accept:* service tests incl. tenant isolation, delete removes PII.
- **P3-T02 (S) CSV import/export.** `core/leads/csv.ts` parse (papaparse, BOM, delimiter sniff), `autoMap(headers)`, manual mapping, `validateEmail` (syntax + optional MX), dedupe modes (skip if in workspace / list / campaign; update existing), suppression filtering, ImportJob progress via worker for large files; export filtered leads to CSV. *Accept:* fixtures in Review Focus #4 with exact counts.
- **P3-T03 (S) Lead lists, suppression/blocklist UI.** Lists CRUD, add/remove, blocklist (email + domain), import/export blocklist. *Accept:* suppressed lead cannot be enrolled.
- **P3-T04 (S) Template engine + spintax.** `core/template.ts` `render(tpl, ctx, seed): {text, missing[]}`: `{{var}}`, `{{var|fallback}}` per PRODUCT_SPEC syntax, custom fields, sender vars; `core/spintax.ts` `{{RANDOM | a | b}}` (nested, seeded); `validateTemplate` lists unknown vars. *Accept:* table tests incl. missing var with/without fallback, nested spintax, deterministic seed.
- **P3-T05 (S) Campaign + sequence service/API.** CRUD, duplicate, archive, delete, steps (unlimited), delays, variants, branching conditions, schedules (multiple, tz, days, window), options (all `PS-CAMP-*`), account assignment, lead enrollment from lists/filters with cross-campaign conflict check, launch/pause/resume validation (has accounts, steps, schedule). *Accept:* service tests for each validation, duplicate deep-copies steps/variants but not leads.
- **P3-T06 (S) Campaign builder UI.** Campaigns list (status, progress, metrics), builder tabs Leads / Sequences (step editor, variants, preview with real lead), Schedule, Options, Accounts; preview modal. *Accept:* Playwright create→launch flow.
- **P3-T07 (S) Schedule math.** `core/schedule.ts` `isInWindow(schedules, at)`, `nextWindowStart(schedules, after)`, `addBusinessDelay(from, days, schedules)`; DST-safe via `Intl`. *Accept:* DST transition, weekend skip, overnight window tests.
- **P3-T08 (O) Quota + dispatcher.** `core/quota.ts` `effectiveAllowance(account, day, settings, rewarm, health)`, `core/dispatch.ts` `claimDue(prisma, now, limit)` as designed above. *Accept:* parallel-dispatcher test (Review Focus #3), workspace cap, min gap, DEFERRED rescheduling into next window.
- **P3-T09 (S) Planner, rotation, sender job, recovery.** `core/rotation.ts`, `core/sequence.ts` (next step, branching), worker jobs `plan-sends`, `dispatch-sends`, `recover-sends`; retries/backoff, UNCERTAIN resolution, CampaignLead advancement, campaign completion. *Accept:* end-to-end with fake provider: 3-step sequence over simulated days; uncertain send test (Review Focus #1); rotation spreads evenly; account error → re-route.
- **P3-T10 (S) Ramp-up + workspace caps settings UI.** Settings → Sending (workspace cap, default gaps), per-campaign daily limit, gradual ramp (`rampStart`, `rampIncrement`) feeding `effectiveAllowance`. *Accept:* allowance tests.

### Phase 4 — Incoming mail & tracking

- **P4-T01 (S) Threading + ingest.** `core/threading.ts` `matchThread(msg, lookup)`, `core/ingest.ts` `ingestMessage(prisma, account, remote)` upsert + dedupe + lead association. *Accept:* reply via In-Reply-To, via References only, via provider thread id, duplicate ingest no-op.
- **P4-T02 (S) Classification.** `core/classify.ts` deterministic: DSN/bounce (hard vs soft by status code), auto-reply (`Auto-Submitted`, `X-Autoreply`, OOO phrases, return date extraction), unsubscribe intent, then interested/not/meeting/neutral keyword rules → `uncertain`; optional AI hook. *Accept:* fixture corpus of ≥30 real-shaped emails.
- **P4-T03 (S) Stop rules + suppression.** On reply/OOO/unsub/bounce: stop or reschedule per campaign options (OOO → resume after return date), stopForCompanyOnReply, cancel ScheduledMessages, suppress, update lead status. *Accept:* each rule test.
- **P4-T04 (S) Event store + tracking routes.** `core/events.ts` `recordEvent` with dedupeKey; `/t/o/[token]` pixel, `/t/c/[token]` redirect (signed tokens, allowlisted target), `/u/[token]` unsubscribe page + RFC 8058 POST; proxy/bot detection → `isEstimated`; custom tracking domain support. *Accept:* duplicate notifications produce one event; tampered token 400; one-click POST suppresses.
- **P4-T05 (S) Sync job (incremental + full).** worker `sync-account` (every 2 min per account + Gmail push/Graph webhook optional trigger), historical import (configurable days), outside-app sends recorded. *Accept:* fake provider: incremental, expired cursor → full, no duplicates.
- **P4-T06 (O) Startup gate + downtime simulation.** boot → PENDING, gate in planner/dispatcher, tests simulating 1/7/30 days downtime (clock injection) with replies, bounces, unsubscribes during the gap. *Accept:* Review Focus #2; no ScheduledMessage dispatched before READY; documented non-reconstructable events in `docs/ops/OFFLINE_RECOVERY.md`.
- **P4-T07 (S) Unified inbox UI + API.** Thread list (all accounts, filters: account, campaign, category, unread, search), thread view (sanitized HTML via DOMPurify-equivalent server sanitizer, attachments download), compose reply/forward from the receiving account (threaded), notes, read/unread, category override, reminders (job notifies + shows in inbox), lead side panel. *Accept:* Playwright reply flow with fake provider; XSS fixture rendered safe.

### Phase 5 — Deliverability, warm-up, re-warm-up

- **P5-T01 (S) DNS checks.** `core/dns.ts` SPF (parse, include lookup count ≤10), DKIM (common selectors + user-provided), DMARC policy, MX; injected resolver. UI in Warm-Up & Deliverability. *Accept:* fixture resolver tests.
- **P5-T02 (S) Health score + automatic slowdown/pause.** `core/health.ts` from bounce rate, provider errors, complaint/unsub rates, DNS; thresholds pause account or reduce allowance; events + automation triggers. *Accept:* threshold tests.
- **P5-T03 (S) Warm-up engine (honest).** Opt-in peer pool of the workspace's own accounts (+ `WarmupProvider` interface for external legitimate services, disabled by default), daily schedule with ramp, reply-rate, weekdays-only, peer tag header, separate from campaign metrics, inbox-placement recording (where landed) without moving mail out of spam. *Accept:* schedule tests; warm-up never counted in campaign analytics.
- **P5-T04 (S) Inbox placement test.** Send test to opt-in seed accounts, report inbox/spam/missing per provider. *Accept:* fake-provider test.
- **P5-T05 (S) Inactivity detection.** `core/rewarm.ts` `computeLifecycle(account, stats, settings)`; nightly + on-boot job; thresholds 7/14/30/60 configurable; flags + recommendation; auto mode creates RewarmPlan before next campaign send. *Accept:* 30-day and 60-day inactive tests.
- **P5-T06 (S) Re-warm mode.** "Re-Warm Account" button: recheck DNS + connectivity, create plan (conservative start, daily increment, target = previous normal limit), `effectiveAllowance` uses it, health deterioration pauses/reduces, completion restores limits; preserves history. *Accept:* the five spec scenarios (30d, 60d, OAuth expired then reconnect, bounce threshold exceeded, returns to normal).
- **P5-T07 (S) Deliverability & reactivation dashboards.** Per-account status (Active/Inactive/Re-Warming/Paused/Needs Attention), days idle, allowance vs target, progress, indicators, warnings, estimated schedule labelled as plan. *Accept:* Playwright view.
- **P5-T08 (S) Verification hooks.** `EmailVerifier` interface + none/MX-only built-in + one HTTP integration template (disabled until configured). *Accept:* import marks statuses; risky handling per campaign option.

### Phase 6 — CRM & analytics

- **P6-T01 (S) CRM backend.** Stages (defaults per spec, customizable), opportunities, tasks, reminders, notes, owner, activity history from Events, revenue attribution to campaign. *Accept:* service tests.
- **P6-T02 (S) CRM UI.** Kanban drag-drop (accessible), opportunity drawer, tasks list. *Accept:* Playwright move card → event + analytics update.
- **P6-T03 (S) Analytics queries.** `core/analytics.ts` aggregates from Event table by campaign/account/variant/step/segment/date with rates; account usage & remaining capacity; revenue per lead; conversion. *Accept:* fixture events → exact numbers (spec E2E #14).
- **P6-T04 (S) Dashboards + exports.** Dashboard home + Analytics page (Recharts), filters, CSV export, campaign analytics tab, A/B results. *Accept:* Playwright filter + export.

### Phase 7 — Advanced

- **P7-T01 (S) Automation rules engine.** Triggers (event types, quota reached, failure threshold, deal won), conditions, actions (stop sequence, create opportunity, suppress, pause account, add tag, move stage, send webhook, notify); defaults from spec section 12 seeded. *Accept:* each default rule test.
- **P7-T02 (S) Webhooks + public API completion.** Signed (HMAC-SHA256, timestamp) deliveries with retry/backoff and delivery log; API v2-like resources documented in `docs/API.md` (OpenAPI generated from zod). *Accept:* signature verify test, retry test.
- **P7-T03 (S) A/B auto-optimize.** Variant stats, auto-pick winner after min sample by reply rate. *Accept:* deterministic test.
- **P7-T04 (S) AI module.** `core/ai/` provider-agnostic interface (Anthropic default, optional), features: draft, personalize, follow-up suggestion, reply classification, summary, lead scoring, CRM recommendation, campaign analysis; recipient-facing output stored as draft requiring approval. *Accept:* fake AI tests; disabled when no key.
- **P7-T05 (S) Push sync.** Gmail watch + Pub/Sub push endpoint and Graph subscriptions (when publicly reachable, VPS), fall back to polling. *Accept:* notification triggers sync job, dedupe.
- **P7-T06 (S) Compliance & security hardening.** Rate limiting on auth/API, CSP headers, physical address footer setting, data deletion, audit view, dependency audit, session settings. *Accept:* security test list.
- **P7-T07 (S) UI polish pass.** Empty states, loading, errors, accessibility (web-design-guidelines review). *Accept:* axe checks in Playwright on each section.

### Phase 8 — Final verification

- **P8-T01 (S) E2E suite completion.** The 16 spec E2E scenarios, each mapped to a test file (mocks for providers). *Accept:* all green.
- **P8-T02 (S) Local→VPS migration test.** Backup on "local" compose, restore into fresh stack in CI. *Accept:* CI job green.
- **P8-T03 (O) Final independent review.** Fresh Opus reviewer against spec + parity checklist; fix findings; `docs/FINAL_ASSESSMENT.md` (parity table, known limitations, verification report).

## Parity coverage map

Every `PS-*` item in `docs/PRODUCT_SPEC.md` is owned by a task. An implementer reads all items of their area,
implements the ones their task owns, and the phase gate ticks them (`[x]`) in PRODUCT_SPEC.md.
Defaults (gaps, limits, warm-up numbers, status codes, spintax/fallback syntax) come from PRODUCT_SPEC, not from memory.

| Area | Owning tasks |
|---|---|
| UI | P1-T04 (nav, shell), each feature's UI task, P7-T07 (polish, a11y), P6-T04 (dashboard widgets) |
| ACC | P2-T02..T07, P5-T07 (status dashboards) |
| WARM | P5-T03, P5-T04, P5-T07 |
| CAMP | P3-T05, P3-T06, P3-T10, P7-T03 |
| SEQ | P3-T04, P3-T05, P3-T09 (branching/subsequences), P4-T03 (OOO reschedule) |
| SEND | P3-T07..T10, P5-T02 |
| LEAD | P3-T01..T03, P5-T08 |
| INBOX | P4-T01, P4-T02, P4-T07, P7-T04 (AI reply) |
| TRACK | P4-T04, P6-T03 |
| CRM | P6-T01, P6-T02 |
| ANALYTICS | P6-T03, P6-T04 |
| AUTO | P7-T01, P7-T02 |
| AI | P7-T04 |
| SEC | P1-T03, P1-T04, P1-T07, P7-T06 |
| REWARM | P5-T05, P5-T06, P5-T07 |
| SYNC | P4-T05, P4-T06, P7-T05 |
| DEPLOY | P1-T01, P1-T06, P8-T02, P7-T02 (API/OpenAPI) |

PS-DEPLOY-02's Redis+BullMQ default is superseded by DECISIONS D1 (spec permits an equivalent).

## Phase-end gate (every phase)
Full test suite, lint, typecheck, `ponytail-audit` (fresh Sonnet reviewer), resolve significant findings, update
PRODUCT_SPEC checklist ticks, PROGRESS, HANDOFF, push.
