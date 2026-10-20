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

## 2026-10-19 · D14 · Fake provider state is file-backed
`FAKE_MAIL_DIR` JSON files (atomic writes under a lock file), so the web server, worker and Playwright share one fake mailbox. Enabled only with `MAIL_PROVIDER_FAKE=1`, refused when `MODE=vps`.

## 2026-10-19 · D15 · User-supplied mail hosts are SSRF-guarded and TLS-only
In `MODE=vps`, IMAP/SMTP hosts resolving to loopback, private, link-local, CGNAT or ULA ranges are refused unless `ALLOW_PRIVATE_MAIL_HOSTS=1`; checked on every connect in web and worker; connect to the checked IP with SNI; AUTH only after TLS, plaintext only to loopback in local mode. The helper is reused by P7-T02 webhooks.
