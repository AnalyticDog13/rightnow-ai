# rightnow-ai Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task-by-task. Each phase also has a step-level plan in `docs/plans/phase-N.md`, written and independently
> reviewed just before that phase starts; it lists the exact `PS-*` IDs each task owns. Task status: `docs/TASKS.json`.

**Goal:** A self-hosted, MIT-licensed Instantly.ai alternative with real provider sending, inbox sync,
campaigns, warm-up/re-warm-up, CRM and analytics, runnable locally and on a VPS from one codebase.

**Architecture:** Next.js app (UI + REST API route handlers) and a Node worker process share a Prisma/Postgres
database. Postgres is the only stateful service: pg-boss runs periodic and retryable jobs, and the send queue is a
table of `ScheduledMessage` rows claimed with `FOR UPDATE SKIP LOCKED` together with atomic quota reservations.
Provider differences (Gmail API, Microsoft Graph, IMAP/SMTP) sit behind one `MailProvider` interface.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui, Recharts, Prisma 7 + PostgreSQL 18,
pg-boss 12, better-auth (organization plugin), zod 4, Vitest + embedded-postgres, Playwright, Docker Compose, Caddy.
Exact versions: `docs/STACK.md`.

**Spec:** `rightnow_ai_master_prompt.md` (authoritative) and `docs/PRODUCT_SPEC.md` (parity checklist, IDs `PS-*`).
Provider rules: `docs/PROVIDER_COMPLIANCE.md`. Review history: `docs/REVIEW_LOG.md`.

## Global Constraints

- Same codebase for local Docker Compose and VPS mode; no feature exists in only one mode.
- Every DB read/write in services takes `workspaceId` and filters by it.
- Credentials (OAuth tokens, SMTP/IMAP passwords, webhook secrets, AI keys) stored only AES-256-GCM encrypted with `ENCRYPTION_KEY`. Ops docs state that `ENCRYPTION_KEY` must be backed up with the database.
- **Freshness gate (not boot gate):** a message may be claimed only if its sending account has `lastSyncCompletedAt >= now − SYNC_MAX_STALENESS` (default 5 min = 2 × poll interval + margin), and, when the campaign has `stopForCompanyOnReply`, every account of that campaign is fresh. The check is inside the claim SQL. This covers cold boot, laptop wake from sleep (containers frozen, not restarted) and silently failing sync.
- **Sticky sender:** `CampaignLead.accountId` is fixed at step 1; follow-ups always go from it (threading + reply visibility). If that account is not eligible/fresh, the lead waits; only step-1 messages may be re-routed to another account.
- Never exceed per account, per campaign, or per workspace daily allowances; never send outside a schedule window; never send the same `(campaignLeadId, stepId)` twice. Effective account allowance = min(user limit, re-warm allowance, health throttle, ramp, 50 % of provider rolling-24 h cap — the 50 % clamp makes calendar-day accounting safe against rolling windows). Reservation amount = 1 + cc + bcc recipients.
- **Unknown outcome is never resent automatically:** a send whose result is unknown (worker died after request written, timeout after write, lease expired) becomes `UNCERTAIN`; resolution searches the provider's Sent for our `Message-ID`, re-searches after 15 min, and if still not found becomes `HELD` for the user to release or cancel in the Scheduled view.
- All time-dependent code takes an injected clock (`now: () => Date` / `Clock`); worker jobs are plain exported handler functions tested by direct call.
- Every outbound campaign email carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (https link only when `APP_URL` is publicly reachable https; otherwise mailto-only, and an "unsubscribe" reply is treated as an unsubscribe). Unsubscribe, hard bounce, complaint add a workspace suppression immediately (stored with `valueHash` so it survives GDPR deletion). Campaign launch requires the workspace physical address and SPF/DKIM/DMARC pass (or explicit override for DMARC/DKIM warnings with audit).
- Every item in `docs/PROVIDER_COMPLIANCE.md` → "Rules our code must enforce" is a requirement, except "one recipient per message", which is replaced by recipients counting toward quota (PS-CAMP-29 Cc/Bcc). Bounce auto-pause threshold default 3 % (PS-CAMP-27), configurable.
- No fabricated engagement or delivery: "accepted by provider" ≠ "delivered"; estimated/automated opens are flagged `isEstimated`. Warm-up traffic is stored in `WarmupMessage`, never in campaign `Event`s.
- Recipient-facing AI-generated text requires human approval by default.
- Fakes are named `Fake*` and live in `packages/providers/src/fake/` or test code; selectable only with `MAIL_PROVIDER_FAKE=1`.
- Versions per `docs/STACK.md`: Prisma 7.10.1 (CLI pinned, `prisma-client` generator, `@prisma/adapter-pg`, `prisma.config.ts`), pg-boss 12 (`createQueue` before `send/work`), zod 4, Tailwind 4. TypeScript: try 7.x; if Next/ESLint/Prisma break, pin latest 5.x and record in DECISIONS. Compose uses `postgres:18-alpine` to match tests. Prisma pool and pg-boss pool sizes set explicitly via env.
- Provider sync defaults to polling (Gmail `history.list`, Graph delta, IMAP); push is optional (needs public HTTPS).
- First-owner sign-up requires `SETUP_TOKEN` (env) and is race-safe (unique constraint / advisory lock); later users only by invite.
- Every task: tests first, then `npm test`, `npm run lint`, `npm run typecheck` green before commit.
- Git: one branch per phase (`phase-N-<name>`), commit + push after every task, merge to `main` (fast-forward) after the phase gate. `main` stays green.

## Review Focus

1. Worker dies after the provider accepted a send but before the DB update → no duplicate; message ends `SENT` (found) or `HELD` (P3-T11 test `uncertain send never auto-resent`).
2. Laptop asleep 1/7/30 days (no restart) or powered off, replies/bounces/unsubs arrive meanwhile, some in a different mailbox of the same company → no follow-up to repliers, nothing sent before fresh sync, backlog spread under quota, Gmail history expiry → full reconcile, re-warm allowance applies on first send after 30 days (P4-T07 tests).
3. Two workers ticking concurrently, account at 49/50, a claim at 23:59:59 that completes at 00:00:01 → exactly one more send, and usage is credited to the claim day (P3-T09 tests).
4. CSV with BOM, semicolons, duplicate and mixed-case emails, invalid rows → exact imported/skipped counts with reasons (P3-T02).
5. OAuth refresh token revoked while a campaign is active → account `NEEDS_ATTENTION`, its follow-ups wait (not re-routed), step-1 messages re-route, no crash loop; reconnect keeps id and history; P5 re-warm applies if idle past threshold (P2-T04, P5-T06).

---

## Repository layout

```
apps/web/                 Next.js: app/(app)/<section>/ pages, app/api/v1/** REST, app/t|u/** public tracking/unsubscribe, app/api/healthz, app/api/readyz
  lib/                    auth, workspace/role helper, route() wrapper (zod + auth + role + error mapping)
  components/             shadcn/ui + app components
apps/worker/              src/index.ts boots pg-boss and registers jobs; src/jobs/*.ts exported handlers, one per job
packages/db/              prisma/schema.prisma, migrations, src/index.ts (client), src/test-db.ts (embedded-postgres harness)
packages/core/src/        domain logic; I/O only through passed-in prisma/provider/clock:
  crypto env clock audit apikeys template spintax schedule quota dispatch planner rotation sequence sender recovery
  leads/(csv dedupe validate esp) classify threading ingest events stoprules tracking sync rewarm warmup health dns
  analytics crm automations webhooks ai/
packages/providers/src/   types.ts mime.ts gmail/ graph/ imap-smtp/ fake/ contract/ (shared contract test suite)
docker/                   Dockerfile (one image: web | worker | migrate), entrypoint.sh, Caddyfile
docker-compose.yml        postgres, migrate, web, worker (+ caddy under profile "vps")
scripts/                  start/stop/upgrade/backup/restore (.sh + .ps1)
docs/ops/                 LOCAL, VPS, GOOGLE_SETUP, MICROSOFT_SETUP, OFFLINE_RECOVERY, LIVE_VERIFICATION, MIGRATE_TO_VPS
```

## Data model (packages/db/prisma/schema.prisma) — tasks add models as noted

Core (P1): `Workspace` (= better-auth organization; + `timezone`, `physicalAddress`, settings JSON), auth tables, `Member(role OWNER|ADMIN|MEMBER|VIEWER)`, `AuditLog`, `ApiKey(workspaceId, name, prefix, hash, scopes[] e.g. "leads:read","all:all", lastUsedAt, revokedAt)`, `WorkerBoot(startedAt, lastHeartbeatAt, stoppedAt)`.

Accounts (P2): `EmailAccount(workspaceId, provider GMAIL|MICROSOFT|SMTP, email, fromName, replyTo, signature, tags[], credentialsEnc, status CONNECTED|ERROR|DISCONNECTED, lifecycle ACTIVE|INACTIVE|REWARMING|PAUSED|NEEDS_ATTENTION, dailyLimit, minGapSec, randomGapSec, timezone, nextSendAt, lastSentAt, lastCampaignActivityAt, lastError, lastErrorAt, errorCount24h, syncState, syncCursor Json, lastSyncCompletedAt, healthScore, trackingDomain, espType, deletedAt)`; `AccountDailyUsage(accountId, day date, sent, reserved, @@id)`; `WorkspaceDailyUsage(workspaceId, day, sent, reserved)`; `CampaignDailyUsage(campaignId, day, sent, reserved, newLeads)`. Day keys: account timezone for account rows, workspace timezone for workspace and campaign rows, computed with `Intl`.

Leads (P3): `Lead(workspaceId, email (lowercased) unique per workspace, firstName, lastName, companyName, companyDomain, jobTitle, website, industry, phone, personalization, customFields Json, tags[], labels[], status, interestStatus int (spec codes), verificationStatus, espType, plValue, ownerId, source, lawfulBasis, country, counters: emailsSent, opens, clicks, replies, lastContactedAt, deletedAt)`; `LeadList`, `LeadListMember`; `Suppression(workspaceId, kind EMAIL|DOMAIN, value?, valueHash, reason, source)`; `ImportJob(…, confirmedAuthorized bool)`.

Campaigns (P3): `Campaign(workspaceId, name, status DRAFT|ACTIVE|PAUSED|COMPLETED|ARCHIVED|ACCOUNTS_UNHEALTHY|BOUNCE_PROTECT, evergreen, dailyLimit, maxNewLeadsPerDay, perCompanyDailyLimit, minGapSec?, stopOnReply, stopOnAutoReply, stopForCompanyOnReply, trackOpens, trackClicks, textOnly, firstEmailTextOnly, prioritizeNewLeads, matchProvider, espRoutingRules Json, allowRisky, bounceProtect, unsubscribeHeader, cc[], bcc[], startAt, endAt, ownerId, plValue, abAutoOptimize, abWinnerMetric)`; `CampaignSchedule(campaignId, name, timezone, days int bitmask Sun=bit0, from 'HH:mm', to 'HH:mm')`; `CampaignAccount`; `Subsequence(campaignId, name, trigger Json {kind: LEAD_STATUS|ACTIVITY|REPLY_KEYWORD, ...}, preDelayMinutes, active)`; `SequenceStep(campaignId, subsequenceId?, order, delayValue, delayUnit MINUTES|HOURS|DAYS)`; `StepVariant(stepId, label, subject, body, weight, active)`; `CampaignLead(campaignId, leadId, subsequenceId?, state QUEUED|ACTIVE|PAUSED|COMPLETED|STOPPED, stopReason, currentStepId, nextDueAt, accountId (sticky), threadRef, unique[campaignId,leadId])`.

Send queue (P3): `ScheduledMessage(id, workspaceId, campaignId, campaignLeadId, stepId, variantId, accountId, dueAt, status SCHEDULED|SENDING|SENT|FAILED|CANCELLED|UNCERTAIN|HELD, attempts, idempotencyKey unique = campaignLeadId:stepId, claimToken, claimedAt, claimBootId, usageDay, wsUsageDay, campUsageDay, reservedUnits, rfcMessageId, providerMessageId?, providerThreadId?, sentAt, error, renderedSubject, renderedBody)`. Re-planning (OOO resume, unpause) updates the existing row back to SCHEDULED; never inserts a duplicate.

Mail (P2/P4): `Thread(workspaceId, accountId, providerThreadId, subject, leadId, campaignId, lastMessageAt, isRead, category, labels[], reminderAt)`; `Message(workspaceId, accountId, threadId, providerMessageId, rfcMessageId, inReplyTo, references[], direction, from, to[], cc[], subject, text, html, sentAt, isAutoReply, isBounce, bounceType, unique[accountId, rfcMessageId], index[accountId, providerMessageId])`; `Attachment(messageId, filename, contentType, size, data bytea ≤ 25 MB)` (in Postgres → covered by backup); `Note`; `Macro(workspaceId, name, body)`; `InboxView(workspaceId, name, filters Json)`.

Events (P4): `Event(workspaceId, type, occurredAt, leadId, campaignId, accountId, stepId, variantId, messageId, isEstimated, meta, dedupeKey unique)` (types as before). `WarmupMessage` separate (P5).

Deliverability (P5): `DomainCheck(…, spf, dkim, dmarc, mx, dnsbl Json)`; `WarmupSettings(accountId, enabled, dailyTarget, increasePerDay, startVolume, replyRatePct, weekdaysOnly, peerTag, customCurve Json?)`; `WarmupMessage(…)`; `RewarmPlan(accountId, startedAt, startAllowance, incrementPerDay, targetLimit, currentAllowance, state ACTIVE|PAUSED|COMPLETED, criteria Json, previousSettings Json)`; workspace settings: inactivity thresholds, autoRewarm OFF|RECOMMEND|AUTO, workspaceDailyCap, bounceThresholdPct.

CRM (P6): `PipelineStage`, `Opportunity(workspaceId, leadId, campaignId?, stageId, title, value Decimal, cashCollected Decimal, currency, expectedCloseAt, ownerId, closedAt, unique[leadId, campaignId])`, `Task`.

Automation (P7): `AutomationRule`, `Webhook(url, secretEnc, events[], headers Json, enabled, consecutiveFailures, disabledAt)`, `WebhookDelivery(unique[webhookId,eventId])`, `BackgroundJob(workspaceId, kind, status, progress, result)` (202 pattern), `AiSettings`.

## Send pipeline — the critical algorithm

1. **Planner** (`core/planner.ts`, pg-boss cron each minute, singleton): for each ACTIVE campaign inside a schedule
   window, select `CampaignLead`s with `nextDueAt <= now` and no open ScheduledMessage for the current step
   (new leads limited by `maxNewLeadsPerDay`; order per `prioritizeNewLeads`). Step 1: pick account via
   `rotation.pickAccount` (eligible = assigned, lifecycle ACTIVE|REWARMING, fresh, remaining allowance > 0,
   provider/ESP routing rules; tie-break least sent today, then round-robin) and store it on CampaignLead
   (sticky). Follow-ups: the sticky account. Choose variant (weights / auto-optimize). Upsert ScheduledMessage by
   `idempotencyKey` (insert or revive a CANCELLED row only when re-planning is intended; SENT/SENDING/UNCERTAIN/HELD
   rows are never touched). Render subject/body now and store them (preview = what will be sent).
2. **Dispatcher claim** (`core/dispatch.ts claimDue(db, clock, limit)`): one transaction:
   `SELECT sm.* FROM ScheduledMessage sm JOIN CampaignLead cl … JOIN EmailAccount a … WHERE sm.status='SCHEDULED'
   AND sm.dueAt<=now AND cl.state='ACTIVE' AND a.lifecycle IN (…) AND a.lastSyncCompletedAt >= now-staleness
   AND (company-stop freshness) AND a.nextSendAt<=now FOR UPDATE OF sm SKIP LOCKED LIMIT n`. For each row, inside a
   SAVEPOINT: reserve account usage via `INSERT … ON CONFLICT (accountId, day) DO UPDATE SET reserved = reserved + :u
   WHERE sent + reserved + :u <= :allowance RETURNING`, then the same for campaign and workspace, then
   `UPDATE EmailAccount SET nextSendAt = now + gap + rand WHERE id=… AND nextSendAt <= now`. Any zero-row result →
   ROLLBACK TO SAVEPOINT and set `dueAt` = next window start / next day (status stays SCHEDULED). Else set
   `status=SENDING, claimToken=uuid, claimedAt, claimBootId, usageDay/wsUsageDay/campUsageDay, reservedUnits, rfcMessageId`.
   Re-check suppression in the same transaction.
3. **Send** (`core/sender.ts`): build MIME with our `Message-ID`, unsubscribe headers, threading headers;
   provider timeout (60 s) ≪ lease (10 min). Results:
   - accepted → `UPDATE … WHERE id AND claimToken` to SENT; move `reserved→sent` on the stored day rows; Event
     ACCEPTED; advance CampaignLead (`nextDueAt` = sentAt + next step delay, aligned to schedule). If the
     conditional update matches 0 rows (lease lost), still record as SENT by rfcMessageId (never re-send).
   - connect/DNS failure before any bytes written, or 429/`Retry-After` → back to SCHEDULED with backoff (1 m·2^n,
     max 5 attempts), release reservations on stored days; 429 also pushes `EmailAccount.nextSendAt`.
   - timeout/reset after write → UNCERTAIN (keep reservation).
   - permanent error → FAILED, release reservation, increment account error counters (→ automation/health).
   - `AuthError` → account NEEDS_ATTENTION, message back to SCHEDULED, reservation released.
4. **Recovery** (`core/recovery.ts`, on boot + every 5 min): SENDING rows whose lease expired AND whose
   `claimBootId` is stopped or stale (no heartbeat 2 min) → UNCERTAIN. `resolveUncertain`: search Sent by
   rfcMessageId → found: SENT (reservation → sent on stored day). Not found: wait 15 min, search again → still not
   found: HELD (reservation released). HELD rows appear in "Scheduled emails" view with Release / Cancel.
   Graph sends use create-draft + send so the message id is known before sending.

## Reconciliation (P4)
`sync.reconcileAccount(account, clock)`: `listChangesSince(cursor)`; expired → `fullReconcile(since = lastSyncCompletedAt − 2 d)`
over INBOX + SENT. Each message → ingest (dedupe on `(accountId, rfcMessageId)`; providerMessageId secondary), thread
match, classify, events (dedupeKey), stop rules (cancel CampaignLead + open ScheduledMessages; company-level stop),
automations. Sends made outside the app are recorded. On success: cursor + `lastSyncCompletedAt = now`.
Startup additionally runs the inactivity check (P5) before marking accounts fresh, so re-warm limits apply to the first send.

---

## Phases and tasks

Format: ID (model) title — files/produces — acceptance. Step-level detail and per-task PS-ID lists: `docs/plans/phase-N.md`.
Model: `S` sonnet, `H` haiku, `O` opus. State-file and checklist updates: H.

### Phase 1 — Foundation  (step plan: docs/plans/phase-1.md)
- **P1-T01 (S)** Monorepo scaffold, tooling, CI. *Accept:* install/lint/typecheck/test pass on Windows; CI green.
- **P1-T02 (S)** DB package + embedded-postgres test harness. *Accept:* isolated per-file DBs; Workspace round-trip.
- **P1-T03 (S)** Crypto + env + clock. *Accept:* encrypt/decrypt tamper tests; env errors list all vars; `systemClock`/`fixedClock`.
- **P1-T04 (S)** Web shell + better-auth workspaces + `route()` with roles + SETUP_TOKEN first-owner. *Accept:* Vitest route wrapper (401/403/400/200); Playwright sign-up with token → dashboard → sign-out; second owner sign-up blocked; race-safe.
- **P1-T05 (S)** Worker skeleton (pg-boss, WorkerBoot heartbeat, `/healthz`). *Accept:* demo job runs; clean stop.
- **P1-T06 (S)** Docker, Compose, Caddy profile, scripts, ops docs, CI compose smoke incl. backup/restore. *Accept:* CI job green.
- **P1-T07 (S)** Scoped API keys + audit log + `/api/healthz` + `/api/readyz` (DB ok, worker heartbeat, sync-gate summary). *Accept:* scope enforcement tests.

### Phase 2 — Email provider connections
- **P2-T01 (S)** Provider interface, MIME build/parse, Fake provider, contract test suite (incl. "Message-ID preserved and findable in Sent", threading headers, List-Unsubscribe headers, UTF-8). `send()` returns `{ rfcMessageId, providerMessageId?, providerThreadId? }`; errors `RateLimitedError`, `AuthError`, `PermanentSendError`, `TransientBeforeSendError`, `AmbiguousSendError`.
- **P2-T02 (S)** Google OAuth connect (state+PKCE, minimal scopes, OAuth session object with status polling PS-ACC-02, reconnect updates same account), `docs/ops/GOOGLE_SETUP.md` incl. "In production" consent screen.
- **P2-T03 (S)** Gmail provider (send raw + threadId, history.list, 404→expired, query listing, rfc822msgid search, token refresh persistence, error mapping). Contract suite on recorded fixtures via injected fetch.
- **P2-T04 (S)** Account service/API/UI: CRUD, soft delete, pause/resume, limits (clamped), gaps, signature, replyTo, tags, bulk actions, diagnostics, mark-as-fixed, account→campaigns view, AuthError → NEEDS_ATTENTION.
- **P2-T05 (S)** Microsoft Graph connect + provider (draft+send, delta Inbox+SentItems, internetMessageId search), `docs/ops/MICROSOFT_SETUP.md`. (Pulled forward from spec Phase 7 so rotation and sync are provider-agnostic from the start.)
- **P2-T06 (S)** IMAP/SMTP provider (SMTP send; APPEND to Sent when needed; UID/MODSEQ cursor; UIDVALIDITY → expired; header search) + connect form with test.
- **P2-T07 (S)** Test-send + `docs/ops/LIVE_VERIFICATION.md`.

### Phase 3 — Campaign automation
- **P3-T01 (S)** Leads service/API: fields above, custom fields/labels, tags, statuses, bulk edit, merge, round-robin owner assign, filters/pagination, contact history, GDPR delete (suppression hash kept).
- **P3-T02 (S)** CSV import/export (BOM, delimiter sniff, auto/manual mapping, validation, dedupe modes, authorized-import confirmation, source/lawful basis), ESP detection via MX (`leads/esp.ts`), background ImportJob.
- **P3-T03 (S)** Lead lists + blocklist/suppression UI and API (email + domain, import/export) + Leads UI.
- **P3-T04 (S)** Template engine: variables, `{{var | fallback}}`, sender vars, `{{RANDOM | a | b}}` with nested vars, `{% if %}` blocks, validation; seeded determinism.
- **P3-T05 (S)** Campaign service/API: CRUD, duplicate, archive, delete, JSON export/import, evergreen, all options listed in data model, schedules, account assignment, launch validation (accounts, steps, schedule, physical address, DNS gate hook, unsubscribe reachability) + "why not sending" explainer.
- **P3-T06 (S)** Sequences: steps (minute/hour/day delays), variants (≤26), subsequences with triggers and pre-delay; enrollment from lists/filters with cross-campaign conflict check.
- **P3-T07 (S)** Schedule math (`isInWindow`, `nextWindowStart`, `addDelay` with units, DST, overnight windows) + day-key helpers.
- **P3-T08 (S)** Unsubscribe early: signed tokens, `/u/[token]` page + RFC 8058 POST, mailto handling hook, suppression on unsubscribe, physical-address setting, footer injection.
- **P3-T09 (O)** Quota + dispatcher claim exactly as specified above. *Accept:* parallel claim test; midnight crossing; campaign/workspace caps; savepoint rollback; first-of-day usage row; freshness and sticky gates; suppression re-check.
- **P3-T10 (S)** Planner + rotation + sequence advancement + subsequence entry + campaign completion. *Accept:* even rotation; sticky follow-ups; step-1 re-route on ineligible account; revive-not-duplicate re-plan.
- **P3-T11 (O)** Sender + recovery + HELD view API (error classification, lease/claimToken, UNCERTAIN → SENT/HELD). *Accept:* Review Focus #1; 429 pushes account; ambiguous timeout → UNCERTAIN; end-to-end 3-step sequence over simulated days with Fake provider.
- **P3-T12 (S)** Campaign builder UI (list with status/progress; tabs Leads/Sequences/Schedule/Options/Accounts; preview with real lead; Scheduled emails view incl. HELD actions).
- **P3-T13 (S)** Ramp-up + workspace/campaign cap settings feeding `effectiveAllowance`.

### Phase 4 — Incoming mail & tracking
- **P4-T01 (S)** Threading + ingest (dedupe on rfcMessageId; UIDVALIDITY resync no duplicates).
- **P4-T02 (S)** Classification (DSN hard/soft, auto-reply headers + OOO return date, unsubscribe intent, interest rules, uncertain; AI hook) with ≥30-email corpus.
- **P4-T03 (S)** Stop rules (reply, auto-reply option, OOO reschedule via revive, unsubscribe, bounce, company stop, subsequence triggers from replies/status).
- **P4-T04 (S)** Event store + open/click tracking (signed tokens, open-redirect protection, proxy/bot → isEstimated, custom tracking domain).
- **P4-T05 (S)** Sync job (incremental + full + historical import + outside-app sends), sets `lastSyncCompletedAt`.
- **P4-T06 (S)** Inbox API: threads, filters, saved views, search, read/unread, category override, labels, notes, reminders, attach-to-lead, macros, reply/forward (threaded) with attachments.
- **P4-T07 (O)** Freshness gate + downtime simulation tests: cold boot and sleep-without-restart × 1/7/30 days with replies (incl. cross-mailbox company reply), bounces, unsubscribes; history expiry; `docs/ops/OFFLINE_RECOVERY.md` (non-reconstructable events).
- **P4-T08 (S)** Unified inbox UI (sanitized HTML, attachments, compose, lead panel, views, macros).

### Phase 5 — Deliverability, warm-up, re-warm-up
- **P5-T01 (S)** DNS checks (SPF incl. lookup count, DKIM selectors, DMARC, MX, DNSBL) + launch gate wiring.
- **P5-T02 (S)** Health score, automatic slowdown/pause, BounceProtect campaign status, ACCOUNTS_UNHEALTHY.
- **P5-T03 (S)** Warm-up engine (opt-in peer pool, custom curve, reply rate, weekdays-only, peer tag, `WarmupProvider` interface for external services, separate storage, no spam-folder manipulation).
- **P5-T04 (S)** Inbox placement test with opt-in seeds.
- **P5-T05 (S)** Inactivity detection (`computeLifecycle`, thresholds 7/14/30/60, recommend/auto) running in the sync startup path.
- **P5-T06 (S)** Re-warm mode (button, DNS + connectivity recheck, plan, allowance in quota, health-based pause/reduce, completion restores previous settings, history preserved). *Accept:* five spec scenarios.
- **P5-T07 (S)** Deliverability + reactivation dashboards (statuses, idle days, allowance vs target, progress, warnings, schedule labelled "configurable plan").
- **P5-T08 (S)** Verification hooks (`EmailVerifier`, built-in MX check, one HTTP integration template; risky handling per campaign).

### Phase 6 — CRM & analytics
- **P6-T01 (S)** CRM backend (stages, opportunities unique per lead+campaign, value, cashCollected, tasks, reminders, notes, owner, activity, attribution).
- **P6-T02 (S)** CRM UI (accessible Kanban, opportunity drawer, tasks).
- **P6-T03 (S)** Analytics queries (campaign/account/variant/step/segment/date; capacity; revenue per lead; conversion; exact fixtures).
- **P6-T04 (S)** Dashboard + Analytics pages + CSV export.

### Phase 7 — Advanced
- **P7-T01 (S)** Automation rules engine with spec §12 defaults.
- **P7-T02 (S)** Webhooks: HMAC signing, custom headers, SSRF-safe delivery (block private ranges), retries, auto-disable, delivery log UI.
- **P7-T03 (S)** Public API resource completion (accounts, campaigns, leads, lists, emails, analytics, blocklist, webhooks, jobs 202) + OpenAPI from zod + `docs/API.md`.
- **P7-T04 (S)** A/B auto-optimize.
- **P7-T05 (S)** AI module (all §13 features, approval workflow for recipient-facing text).
- **P7-T06 (S)** Push sync (Gmail watch + Pub/Sub JWT verify, Graph subscriptions + clientState), renewal jobs.
- **P7-T07 (S)** Security hardening (rate limits, CSP, 2FA, password hashing per better-auth, data export/deletion, audit view, dependency audit).
- **P7-T08 (S)** UI polish + accessibility (axe in Playwright per section).

### Phase 8 — Final verification
- **P8-T01 (S)** Complete E2E suite per mapping below.
- **P8-T02 (S)** Local→VPS migration test in CI (backup, restore into fresh stack, attachments + encrypted credentials still decrypt).
- **P8-T03 (O)** Final independent review → `docs/FINAL_ASSESSMENT.md`; fix findings; repeat.

## Spec §28 E2E mapping (files under `apps/web/e2e/` unless noted; providers faked, live checks in LIVE_VERIFICATION.md)

| # | Scenario | Test file | Built in |
|---|---|---|---|
| 1 | Google account connection | `accounts-google.spec.ts` (mock OAuth endpoints) | P2-T02 |
| 2 | Authorized test-email sending | `test-send.spec.ts` | P2-T07 |
| 3 | Lead CSV import | `leads-import.spec.ts` | P3-T03 |
| 4 | Campaign creation | `campaign-create.spec.ts` | P3-T12 |
| 5 | Automated multistep sending | `packages/core/test/e2e/multistep.test.ts` | P3-T11 |
| 6 | Quota enforcement | `packages/core/test/e2e/quota.test.ts` | P3-T09 |
| 7 | Account rotation | `packages/core/test/e2e/rotation.test.ts` | P3-T10 |
| 8 | Reply synchronization | `packages/core/test/e2e/reply-sync.test.ts` | P4-T05 |
| 9 | Follow-up cancellation | `packages/core/test/e2e/followup-cancel.test.ts` | P4-T03 |
| 10 | Bounce detection & suppression | `packages/core/test/e2e/bounce.test.ts` | P4-T03 |
| 11 | Inbox threading | `inbox-thread.spec.ts` | P4-T08 |
| 12 | CRM opportunity creation | `crm.spec.ts` | P6-T02 |
| 13 | Revenue recording | `crm-revenue.spec.ts` | P6-T02 |
| 14 | Analytics accuracy | `packages/core/test/e2e/analytics.test.ts` | P6-T03 |
| 15 | Worker restart recovery | `apps/worker/test/restart.test.ts` (kill worker process mid-dispatch, restart, assert no dup) | P3-T11 |
| 16 | Session interruption & resumption | `apps/worker/test/browser-closed.test.ts` (sending proceeds with no web session) + `docs/ops/RESUME_DRILL.md` scripted keep-going drill executed in P8 | P3-T11 / P8-T01 |

## Parity coverage

Each phase step plan lists per task the exact `PS-*` IDs it owns; together they must cover every ID in
`docs/PRODUCT_SPEC.md`. The plan reviewer for that phase checks completeness. Defaults (gaps, limits, warm-up numbers,
status codes, syntax) come from PRODUCT_SPEC. Area ownership: UI P1-T04/feature UIs/P7-T08 · ACC P2 · WARM P5-T03/T04/T07 ·
CAMP P3-T05/T12/T13, P5-T02, P7-T04 · SEQ P3-T04/T06/T10, P4-T03 · SEND P3-T07..T11/T13, P5-T02 · LEAD P3-T01..T03, P5-T08 ·
INBOX P4-T01/T02/T06/T08, P7-T05 · TRACK P4-T04, P6-T03 · CRM P6-T01/T02 · ANALYTICS P6-T03/T04 · AUTO P7-T01..T03 ·
AI P7-T05 · SEC P1-T03/T04/T07, P7-T07 · REWARM P5-T05..T07 · SYNC P4-T05/T07, P7-T06 · DEPLOY P1-T01/T06, P7-T03, P8-T02.

## Phase-end gate (every phase)
Full test suite, lint, typecheck, Playwright, CI green; `ponytail-audit` by a fresh Sonnet reviewer; resolve significant
findings; tick PRODUCT_SPEC items; update PROGRESS/HANDOFF/REVIEW_LOG; merge phase branch to `main`; push.
