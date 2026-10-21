# Architecture decisions

Format: date · decision · why · consequences.

## 2026-10-19 · D1 · PostgreSQL-only job queue (pg-boss + row claiming), no Redis/BullMQ

Spec allows "Redis and BullMQ or an equivalent reliable architecture".
- The send queue must live in Postgres anyway (scheduled messages are shown in the UI and must survive
  restarts). Claiming a due row and reserving quota in one transaction makes double-send and
  over-quota impossible across parallel workers; a second store (Redis) could diverge after downtime.
- One fewer stateful service to run, secure, back up and restore on the VPS and the laptop.
- pg-boss gives cron, retries with exponential backoff, singleton jobs, and dead-letter on Postgres.
Consequence: throughput ceiling is far above cold-email volumes (thousands/day per workspace).

## 2026-10-19 · D2 · npm workspaces; Next.js route handlers are the backend API

pnpm is not installed on the dev machine; npm workspaces are built in. A separate API server would duplicate
auth and validation; route handlers under `apps/web/app/api` with a shared service layer are enough.
Long-running work never runs in the web process; it lives in `apps/worker`.

## 2026-10-19 · D3 · Tests run against real Postgres via `embedded-postgres`

The primary dev machine has no Docker and no WSL. `embedded-postgres` downloads real Postgres binaries
per platform, so tests exercise real SQL (SKIP LOCKED, constraints) everywhere. CI additionally builds
and smoke-tests the Docker Compose stack.

## 2026-10-19 · D4 · Freshness gate + sticky sender instead of a boot gate
A laptop that sleeps never "boots", so gating on worker start is unsafe. A send is claimable only when its account
(and, for company-stop campaigns, every campaign account) synced within `SYNC_MAX_STALENESS_SEC`. Follow-ups always
use the step-1 account so its sync covers the lead's replies and threading stays intact.

## 2026-10-19 · D5 · Unknown send outcomes are held, not resent
"Not found in Sent" is not proof of non-delivery (SMTP append gap, index lag). After a 15-minute re-search the
message becomes HELD for a human decision. Duplicate cold emails are worse than one delayed email.

## 2026-10-19 · D6 · Attachments stored in Postgres (bytea, ≤ 25 MB)
Keeps backup/restore and local→VPS migration to a single `pg_dump`.

## 2026-10-19 · D7 · Provider caps clamped to 50 % for calendar-day accounting
Providers enforce rolling 24 h windows; usage rows are per calendar day. Clamping the effective limit to half the
provider cap makes two adjacent days unable to exceed the rolling cap. Cold-email limits (≈30/day) sit far below it.

## 2026-10-19 · D8 · Password hashing: better-auth default (scrypt)
PS-SEC-03 names argon2id; scrypt is an equally recommended memory-hard KDF (OWASP) and avoids a native dependency
that complicates Windows dev and the Docker image. Revisit only if a compliance requirement names argon2id.

## 2026-10-19 · D9 · TypeScript 5.9.3 (not 7.x)
typescript-eslint 8.72 (latest) supports `typescript <6.1.0`. 5.9.3 is the newest version satisfying both it and the
"latest 5.x" fallback in the plan. Revisit when typescript-eslint supports 7.x. ESLint 10 and Vitest 5 work.

## 2026-10-19 · D10 · Plain `fetch` for Gmail, Graph and the OAuth token endpoints
No `googleapis`, `google-auth-library` or `@azure/msal-node`. Reasons: msal keeps refresh tokens in its own cache, which clashes with our encrypted per-account store and cross-process refresh lease; the libraries retry internally, which hides the 429/5xx/timeout distinctions the send pipeline depends on (ambiguous vs transient vs rate-limited); and every call goes through one injected `fetch`, so contract tests run on fixtures. Cost: we write about a dozen REST calls and the token exchange ourselves.

## 2026-10-19 · D11 · IMAP/SMTP test servers
In-process `hoodiecrow-imap` (pure JS, scriptable) plus `smtp-server` (nodemailer's) for fast local runs on Windows; hoodiecrow 3.x is young (six releases in two days), so a Linux-only CI job runs the same contract suite against a real `greenmail/standalone` container and is required for the phase gate. Fallback if hoodiecrow does not run: an `ImapClientLike` double. Cursor-expiry tests recreate the Sent folder (INBOX cannot be deleted in IMAP).

## 2026-10-19 · D12 · Gmail scopes: `gmail.send` + `gmail.modify`
Not `gmail.readonly`. Spam rescue and mark-read (PS-WARM-08) need modify; adding a scope later forces every account to reconnect. Both are restricted-class, so a self-hosted single owner pays nothing extra. Deviates from the PROVIDER_COMPLIANCE "modify only if required" line, which is updated.

## 2026-10-19 · D13 · Token refresh by DB lease, not a lock held over HTTP
Refresh claims a lease on the account row (`refreshLeaseId/Until`, 20 s) in a short transaction, calls the token endpoint (15 s timeout) with no transaction open, then commits the new credentials if it still holds the lease. Avoids holding a pooled connection during HTTP and losing a rotated Microsoft refresh token when a transaction aborts. A refresh response without a refresh token keeps the stored one; token-server 5xx is transient, never an auth failure.
Note (P2-T02a, deviates from the brief): when the conditional write matches nothing and the stored token is still the stale one, refresh goes back to the lease/wait step (same 25 s bound) instead of returning stale creds.

## 2026-10-19 · D14 · Fake provider state is file-backed
`FAKE_MAIL_DIR` JSON files (atomic writes under a lock file), so the web server, worker and Playwright share one fake mailbox. Enabled only with `MAIL_PROVIDER_FAKE=1`, refused when `MODE=vps`.

## 2026-10-19 · D15 · User-supplied mail hosts are SSRF-guarded and TLS-only
In `MODE=vps`, IMAP/SMTP hosts resolving to loopback, private, link-local, CGNAT or ULA ranges are refused unless `ALLOW_PRIVATE_MAIL_HOSTS=1`; checked on every connect in web and worker; connect to the checked IP with SNI; AUTH only after TLS, plaintext only to loopback in local mode. The helper is reused by P7-T02 webhooks.

## 2026-10-20 · D16 · No campaign sending before P4 sync exists
Nothing in Phase 3 writes `lastSyncCompletedAt`, so the claim's freshness gate keeps real campaigns from sending until P4-T05 ships. The explainer reports `sync_pending`. There is no stub: one that marked accounts fresh without reading their inboxes would send follow-ups to people who already replied. Tests set freshness with a test-only `markFresh` helper.

## 2026-10-20 · D17 · Real-provider campaign sending gated on a recorded live check
How the gate works:
- `ProviderVerification` (one install-level row per provider) is written only by `scripts/live-verify.ts`, when every step passes and `findSent` returns our exact Message-ID. A failing run deletes the row.
- The claim SQL only selects accounts whose provider is in `sendableProviders()`. That returns every provider with `MAIL_PROVIDER_FAKE=1` (which `MODE=vps` refuses), and otherwise only the verified ones. There is no override.

Limits:
- One verified host or tenant enables that whole provider kind, including relays that may rewrite Message-ID.
- Duplicates stay impossible, because an unfound ambiguous send ends HELD.
- P4 reply matching must therefore fall back to the lead address plus the thread.

## 2026-10-20 · D18 · Permanent send errors carry a scope (phase-2 gate I-8)
`PermanentSendError` gets an additive `scope: "recipient" | "account" | "unknown"`, default `unknown`. It is decided by the enhanced status code and the reply text. Policy, blocklist and spam rejections are never `recipient`, even on RCPT TO.

How each scope is handled:
- **Recipient:** FAILED, the lead STOPPED BOUNCED, and a HARD_BOUNCE suppression.
- **Account:** release, the row back to SCHEDULED, and the account PAUSED via `recordProviderError`; the lead is untouched.
- **Unknown:** FAILED, the lead PAUSED SEND_FAILED, and the account PAUSED after 3 in a row (`consecutivePermanentErrors`, reset on SENT and on resume).

The `MailProvider` interface is unchanged.

## 2026-10-20 · D19 · Spec items overridden by Global Constraints
These are not built, or are forced, because a Global Constraint outranks the spec item:
- PS-SEQ-10 "ignore account limits" is not built: it would exceed per-account allowances.
- PS-CAMP-25's List-Unsubscribe toggle accepts only `true`: every campaign email must carry the header.
- PS-CAMP-04 "Account Suspended" is shown as ACCOUNTS_UNHEALTHY, whose producer is P5-T02.

## 2026-10-20 · D20 · Removing suppressions (P3-T03)
- `GDPR_ERASURE` and `COMPLAINT` suppressions are never removable, single or bulk, API or UI. An attempt returns 409 `suppression_protected`. An erasure row holds only a hash, so removing it could only let the erased person be re-imported.
- `UNSUBSCRIBE` is removable one at a time by an ADMIN, and only with `resubscribeAttestation` (a non-empty reason plus `recipientConsent: true`). The audit row holds the hash and the attestation.
- `HARD_BOUNCE` is removable one at a time by an ADMIN with `confirm`. `NOT_INTERESTED` and `MANUAL` need ADMIN only.
- Bulk delete and "clear" touch `MANUAL` entries only, and audit a capped list of hashes plus the true count.

## 2026-10-21 · D21 · Send-state lock order (amends phase-3 I4)
Every transaction that touches send state locks `ScheduledMessage` → `CampaignLead` → `AccountDailyUsage` → `CampaignDailyUsage` → `WorkspaceDailyUsage` → `EmailAccount` → `Lead`/`Suppression`. The original I4 put `CampaignLead` after `EmailAccount`. The claim must re-check the CampaignLead under its lock before it reserves, and the planner locks CampaignLead before it writes `CampaignDailyUsage.newLeads`. Any transaction taking usage rows before CampaignLead would therefore deadlock against the planner, so the claim, the sender and the planner must all use this one order. The planner keeps its exception for new or revivable `ScheduledMessage` rows only, because no claim can hold those.

## 2026-10-21 · D22 · Step-1 deletion and leaving a subsequence (deviations from the P3-T10b brief)
- **Deleting main step 1 moves its waiting leads instead of stopping them.** The brief routes `deleteStep` through `skipStep`, which stops a lead on main step 1 (STOPPED MANUAL) because no sticky sender exists yet. Applied to a deletion, that would stop every queued lead of the campaign and end sending silently. `skipStep(…, { keepDue: true })` (deleteStep only) therefore moves those leads to the next step, which `settle()` renumbers as the new step 1. They stay QUEUED and are routed by rotation like any new lead. A user cancel of a step-1 row (`skipStep` without `keepDue`) still stops the lead.
- **`removeFromSubsequence` stops the lead.** It does not go through `skipStep`, which would advance the lead to the subsequence's next step, the opposite of "remove". It cancels the lead's open rows and sets it STOPPED MANUAL in one transaction.

## 2026-10-21 · D23 · Sender policies (P3-T11a)
- **Deleted sticky sender.** A follow-up must come from the lead's step-1 mailbox, so it is never re-routed. The planner's housekeeping cancels the lead's SCHEDULED rows and sets the lead PAUSED `SEND_FAILED`. This is reversible: reconnecting the address revives the same account row, and the lead can then be resumed. Step-1 rows have no sticky sender and keep going through the re-route pass.
- **Stale text.** Edit hooks skip rows a claim holds, so the claim re-renders the row under its lock and takes the variant `FOR SHARE`. An edit that commits before the claim is picked up, and a later edit waits for the claim. `List-Unsubscribe` headers are never stored; the sender rebuilds them on every send.
- **LOST releases nothing.** When the row's token changed, whoever changed it (a late accept or recovery) owns the reservation now.
- **Microsoft 365 `5.4.1 … Access denied`** is unknown scope with `countsTowardPause: false`, so it never counts toward the 3-in-a-row pause. SMTP 5.1.7 and 5.1.8 are account scope on MAIL FROM and unknown elsewhere. Any 5.7.x on MAIL FROM, AUTH or DATA is account scope even when the text matches the policy words, as the brief's `relay denied` case requires.
