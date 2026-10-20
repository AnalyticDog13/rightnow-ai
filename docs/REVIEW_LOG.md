# Review log

Newest last. Each entry: date · subject · reviewer (agent/model) · verdict · findings · resolution.

## 2026-10-19 · Plan review round 1 · independent agent (opus, fresh context) · **Changes Required**
Critical: C1 startup gate misses sleep/wake (→ freshness gate in claim SQL); C2 per-account readiness misses
cross-mailbox replies (→ sticky sender, company-stop freshness, re-route step 1 only); C3 UNCERTAIN "not found" resent
(→ re-search after 15 min then HELD; Graph draft+send); C4 quota reservation day/leak (→ stored usage days, upsert
reservation in savepoints, campaign usage rows). Important: ambiguous-error classification, claimToken leases,
re-plan by revive, re-warm before first send, compliance (unsubscribe, physical address) moved into P3, ~40 parity
fields/features added, injected clock, E2E mapping, SETUP_TOKEN + roles + API scopes, rfcMessageId dedupe, attachments
in Postgres, 50 % provider-cap clamp, task splits + Opus for dispatcher/sender. Minor items applied (Cc/Bcc counted,
bounce threshold 3 %, Redis mentions superseded, postgres 18, suppression hash, push auth, phase branches).
Resolution: plan rev 2 + phase-1 rev 2.

## 2026-10-19 · Plan review round 2 · same independent agent (opus) · **Changes Required**
C1–C4 resolved. New Critical C5: claim SQL lacked campaign status/endAt, schedule-window re-check, and first-of-day
allowance guard. Important: recovery on lease alone, late-accept accounting, freshness watermark = sync start,
re-warm derived on the fly (no startup dependency), API 5xx → UNCERTAIN, one-message-per-transaction claims (deadlock).
Minor: sticky on SENT, new-lead/per-company limits in planner, synthetic Message-ID, stale-claim guard, health names,
clock file, argon2 decision (D8), attachment column exclusion. Resolution: plan rev 3.

## 2026-10-19 · Plan review round 3 · same independent agent (opus) · **APPROVED**
C5, I-A..I-D and round-2 minors resolved; no new Critical/Important. Four minor notes applied directly (P5-T05 wording,
late accept after manual release, claimToken on stale-claim release, first-sync window). Plan rev 3 is the approved plan.

## 2026-10-19 · P1-T01 monorepo scaffold · task reviewer (sonnet) · **Approved**
Spec ✅, quality approved. Minors deferred: Node engines vs CI version, Prettier not enforced, README link ahead of P1-T06.

## 2026-10-19 · P1-T02 db package + harness · task reviewer (sonnet) · Spec ❌ → fixed → **Approved**
Missing expectIsolated helper; dotenv read packages/db/.env (elevated to Important); DB_POOL_MAX NaN. All addressed in
b56a5b0 (scoped re-review). Minors deferred: client throws at import without DATABASE_URL, AuditLog cascade on workspace delete.

## 2026-10-19 · P1-T03 crypto/env/clock/key rotation · task reviewer (sonnet) · **Approved**
Crypto verified correct. 7 minors deferred (see ledger); tsx accepted.

## 2026-10-19 · P1-T04 web shell + auth · task reviewer (sonnet) · Needs fix → **Approved**
next build verified. Fixed: org self-creation (allowUserToCreateOrganization=false) + VIEWER invite test. Deferred: invite acceptance → P7-T07; Origin check → P1-T07; setup rate limit → P7-T07.
