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

## 2026-10-19 · P1-T05 worker skeleton · task reviewer (sonnet) · Needs fixes → **Approved**
Fixed: idempotent teardown, startup partial-failure cleanup, injected clock + heartbeat/503/startup-failure tests.

## 2026-10-19 · P1-T06 Docker/compose/scripts · task reviewer (sonnet) · Spec ❌ → fixed → **Approved**
Critical restore.ps1 data-loss path fixed; dump validation + safety backup; 0600 backups; non-root image; explicit migrate; CI asserts can fail. .ps1 scripts syntax-checked only (never executed: no Docker on Windows).

## 2026-10-19 · P1-T07 API keys/audit/readyz · task reviewer (sonnet) · **Approved**
Security checks passed (CSPRNG tokens, hash lookup, workspace-scoped revoke/list, fail-closed CSRF). Minors deferred to phase-gate triage.

## 2026-10-19 · Phase 1 gate · whole-branch review (opus) + ponytail audit · Fix first → **Approved**
I1 dev script, I2 org deletion disabled, I3 tx-client audit/apikeys atomic, I4 route params, I5 job deps, I6 createPrisma factory — fixed b595457..47d6aec, scoped re-review clean. I7 → P2-T02. M1–M4 → P2-T01 preliminary cleanup.

### Phase 1 rulings (from the SDD ledger)
- | P1-T02 ↔ P1-T04 | Workspace model vs better-auth organization | T02 creates Workspace; T04 maps better-auth organization modelName→workspace and reconciles fields. Ruling: T04 owns the reconciliation migration — avoids guessing better-auth schema in T02 — cost if wrong: one extra migration. |
- | P1-T03 ↔ P1-T04/T05/T07 | `getEnv()` | T03 defines the env schema; later tasks extend it (SETUP_TOKEN, WORKER_HEALTH_PORT). Ruling: each task adds its vars to env.ts + .env.example. |
- | P1-T04 ↔ P1-T07 | `route()` auth modes | T04 defines `auth: "session-or-apikey"` + `scope`; T07 implements apikey verification. Ruling: T04 ships the option with apikey path returning 401 until T07 — cost if wrong: none. |
- | P1-T06 | entrypoint `migrate` | needs prisma CLI in the image → keep prisma as a dependency of @rightnow/db (not dev). Ruling recorded for T06 dispatch. |
- P1-T02: dispatched (sonnet), BASE 8ef0af3. Ruling: prisma CLI in dependencies of @rightnow/db — Docker migrate needs it — cost if wrong: slightly larger image
- P1-T02: review spec ❌ (expectIsolated missing). Ruling: dotenv-path minor elevated to Important — root .env is the documented location, db:migrate would fail for users — cost if wrong: a few lines of churn.
- P1-T03 pre-dispatch Ruling: rotate-key iterates an exported ENCRYPTED_COLUMNS list (empty now; P2+ tasks append) — no encrypted columns exist yet — cost if wrong: script refactor later.
- P1-T03 pre-dispatch Ruling: getEnv() validates shared vars (DATABASE_URL, ENCRYPTION_KEY, MODE, APP_URL, DB_POOL_MAX, SYNC_MAX_STALENESS_SEC); app-only vars (BETTER_AUTH_SECRET, SETUP_TOKEN, WORKER_HEALTH_PORT) validated by web/worker via exported schema extension — avoids worker requiring web secrets — cost if wrong: minor.
- P1-T03: Ruling: accept tsx devDependency (plan already runs worker with tsx); added to STACK.md
- P1-T04: Ruling: invite-acceptance flow deferred to P7-T07 (single owner at launch per spec) — cost if wrong: invited users cannot join until P7.
- P1-T06 pre-dispatch Ruling: compose-smoke uses /api/healthz after restore (readyz arrives in P1-T07, which then switches the CI check) — plan ordering defect — cost if wrong: none
- P1-T06: Ruling: raised minors to fix round (CI restore check can't fail; ps1 LASTEXITCODE; nested .env in image; .env.example DOMAIN/POSTGRES_PASSWORD) — data-safety/secret-leak class — cost if wrong: a little extra churn
- P1-T06: Ruling: accepted deviations — restore drops/recreates DB (pg_restore --clean fails on pg-boss partitions); plain next start image (worker/migrate need full node_modules)
- PHASE GATE Ruling: single Opus whole-branch review combining SDD final review + ponytail-audit lens — avoids two full-repo passes — cost if wrong: a less specialized simplicity audit
- PHASE GATE Ruling: fix I1–I6 now (I1/I2 block merge; I3–I6 are interfaces Phase 2 builds on — cheaper now); I7 (key rotation vs compose) → P2-T02 — cost if wrong: small rework in P2-T02
- PHASE GATE Ruling: M1–M4 (CSRF APP_URL via getWebEnv, minPasswordLength 12, dead requireWorkspace kind param, unused web devDeps) carried into P2-T01 dispatch as preliminary cleanup — no second fix wave per SDD — cost if wrong: minors live a few more commits

### Phase 1 deferred minors (triaged in PHASE-GATE review)
- P1-T01: minor (deferred): engines node >=22.12 vs CI Node 24 (README too) — align later
- P1-T01: minor (deferred): prettier configured but not enforced in lint/CI
- P1-T01: minor (deferred): README links docs/ops/LOCAL.md before P1-T06 creates it (resolved by P1-T06)
- P1-T02: minor (deferred): prisma client created at import time throws without DATABASE_URL
- P1-T02: minor (deferred): AuditLog onDelete Cascade deletes audit trail with workspace
- P1-T02: minor (deferred): DB_POOL_MAX parseInt accepts "5abc"/negatives
- P1-T03: minor (deferred): lenient base64 in key/payload parsing; missing tag/IV-flip + empty-plaintext tests; rotate-key errors lack model/row; rotate-key outside typecheck; env.test replaces process.env; getEnv validates full schema on default-key crypto; formatting noise
- P1-T04: minor (deferred): /api/setup no rate limit; better-auth rate limit keyed on spoofable XFF, in-memory store (→ P7-T07)
- P1-T04: minor (deferred): viewer rejection tests use bare rejects.toThrow (not FORBIDDEN-specific)
- P1-T05: minor (deferred): pool size hard-coded 5 ignores DB_POOL_MAX; index.ts exports schema from side-effect file; healthz select 1 no timeout
- P1-T05: minor (deferred): no test for createQueue failure path (same catch as EADDRINUSE)
- P1-T06: minor (deferred): backup only mentions ENCRYPTION_KEY in a comment
- P1-T06: minor (deferred): restore.sh $dir resolved before cd (fails closed from scripts/ dir); restore blocked if current DB unreadable
- P1-T07: minor (deferred): lastUsedAt write on every request incl. 403 (throttle); audit not atomic with key create/revoke; no direct scopeAllows unit test; APP_URL host mismatch (127.0.0.1 vs localhost) → 403 on writes, document; sign-in audit lacks IP/UA/failures; readyz no rate limit; key-list select duplicated; 2b3e902 alone fails typecheck

## 2026-10-19 · Phase 2 step plan review round 1 · independent agent (opus) · **Changes Required**
1 Critical (sync paging cursor could lose replies), 12 Important (Graph ImmutableId, refresh-token handling, SSRF/TLS for IMAP-SMTP, interface gaps, Gmail scope decision, Graph revoke, cross-process fake, P2-T02 split + opus), 12 Minor. Full: docs/plans/phase-2-review.md. Planner revising.

## 2026-10-19 · Phase 2 step plan review round 2 · same independent agent (opus) · **APPROVED**
C1 + 12 Important resolved. 3 new Important (lease cleared on disconnect/reconnect, Graph deleteDraft only isDraft, GreenMail CI TLS/folders) appended to plan as Revision 3.
