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

## 2026-10-20 · P2-T01 provider interface/MIME/Fake/contract · task reviewer (sonnet) · fixes → **Approved**
Pre-review interface fixes (receiver ids, reopen, IPv6 byte parsing); round 1: ::1 loopback, MIME CRLF + reserved headers + Bcc-leak check, zero-assertion guard, SSRF ranges, Fake clearFailures, env empty flags, Retry-After decimals.

## 2026-10-20 · P2-T02a credential store/refresh lease/key rotation · task reviewer (opus) · fixes → **Approved**
Plan defect fixed (lease overrun returned stale token → retry lease). Round 1: reconnect-during-failed-refresh race, toApiAccount allowlist, no writes to soft-deleted accounts.

## 2026-10-20 · P2-T02b Google OAuth connect · task + security reviewer (opus) · fixes → **Approved**
Security pass on state/PKCE/redirects/secrets/polling. Fixed: provider-mismatch reconnect, popup-closed polling, concurrent revive race, Playwright catch-all, provider_unavailable outage code.

## 2026-10-20 · P2-T03 Gmail provider · task reviewer (sonnet) · 2 fix rounds → **Approved**
findSent searches all mail incl. trash (overrode brief: no-duplicate-sends), labelAdded tracked (spam→inbox replies), 403 mapping narrowed so quota/policy 403s never disconnect mailboxes.

## 2026-10-20 · P2-T04 account service/API/UI · task reviewer (sonnet) · 3 fix rounds → **Approved**
Autofix conditional write, explicit :write scope, bulk clamp warnings, diagnostics in tx + audit, most-severe check wins, thrown AuthError/scope_missing → NEEDS_ATTENTION unless user-paused, shared numeric validator.

## 2026-10-20 · P2-T05 Microsoft Graph connect + provider · task reviewer (sonnet) · 1 fix round → **Approved**
Draft id carried on all post-draft errors, cleanup only when definitely unsent (isDraft guard), invalid_client = app-config not mailbox auth (Google too), guest #EXT# UPN rejected, gap clamp tested.

## 2026-10-20 · P2-T06 IMAP/SMTP provider + connect · task reviewer (opus) · 1 fix round → **Approved**
SSRF/TLS/credential handling verified. Fixed: IMAP throttle/outage at LOGIN not AuthError, listMessages paging + SINCE tz loss, shared openAccount (clears provider state), EAUTH codes, workspace-scoped creds, DNS rebind transient, byte-level STARTTLS + password-scrub tests.

## 2026-10-21 · P2-T07 test-send + live verification · task reviewer (sonnet) · 1 fix round → **Approved**
Atomic per-account rate limit (advisory xact lock, send outside tx), live-verify refuses Fake, LIVE_VERIFICATION complete, Retry-After header, recipient errors excluded from health.

## 2026-10-21 · Phase 2 gate · whole-branch review (opus) + ponytail audit · Fix first → **Approved**
0 Critical, 10 Important, 17 Minor. Fixed: user pause wins over auth failure, Google token 4xx parity with Microsoft, credential-read failure non-auth, live-verify Compose mode + real Message-ID comparison, SMTP/IMAP reconnect (PS-ACC-08). Deferred: I-7/I-9 → P4-T05, I-8 → P3-T11. CLAUDE.md updated with phase-2 rules.

### Phase 2 rulings (from the SDD ledger)
- | T04 ↔ T02b/T05/T06 | account service (reconnect keeps id) | T04 depends on T02b; T05/T06 call the same service. Ruling: T04 runs before T05/T06 (order in TASKS.json) — cost if wrong: none. |
- P2-T01: Ruling: receiveSpam returns {rfcMessageId} (no magic id); harness gains reopen() for true fresh-instance resume; assertPublicHost normalizes mapped IPv6 by bytes — interface cheapest to fix now — cost if wrong: minor churn
- P2-T01: Ruling: accept contract suite exported from @rightnow/providers/contract (keeps vitest out of runtime) and per-process failNext
- P2-T01: Ruling: raised minors — contract suite zero-assertion pass, SSRF ranges + DNS error wrap, Fake auth_revoked sticky, env empty-string flag, Retry-After decimals — each bites a later task or security — cost if wrong: small churn
- P2-T01: fix round 1 done 0016267 (CI green). Ruling: List-Unsubscribe* stay settable via headers (brief makes headers their only channel; CRLF guard still applies) — cost if wrong: caller could set a bad unsubscribe header, which P3-T08 owns anyway. Scoped re-review dispatched
- P2-T02a: Ruling: plan defect in D13 step 3 — returning stale creds after lease overrun can flag account AuthError; retry lease acquisition instead — spec "never silently disconnect" outranks plan text — cost if wrong: slightly longer waits under contention
- P2-T02a: Ruling: accept rotate null-skip fix; credential writes must go through setCredentials (carry to P2-T02b/T04/T05/T06); missing-creds throws plain Error; lease-wait timeout → TransientBeforeSendError
- P2-T02a: Ruling: raise M-3 (toApiAccount allowlist) and M-4 (setCredentials skips soft-deleted) — secret-leak/resurrection class — cost if wrong: minor churn
- P2-T02b: Ruling: single opus review = task review + planned opus security review of oauth.ts — avoids two passes — cost if wrong: none
- P2-T02b: Ruling: raised minors — concurrent revive race (integrity), Playwright testMatch silently skipping specs, Google 5xx → retryable — cost if wrong: minor churn
- P2-T02b: fix round 1 done e883ec4 (CI green). Ruling: ratify new OAuth error code provider_unavailable — user-facing distinction outage vs failed sign-in — cost if wrong: one enum value. Ruling: revive loser returns account_exists without retry (retry would find the live row) — accepted.
- P2-T03: Ruling: createProvider takes prisma as required dep (avoid import-time DB connection) — deviation from brief's optional deps — cost if wrong: one signature tweak
- P2-T03: Ruling: override brief — findSent searches all mail incl. spam/trash, confirms SENT label/From — spec no-duplicate-sends outranks plan text — cost if wrong: slightly broader search
- P2-T03: Ruling: raise minor labelsAdded tracking (reply moved SPAM→INBOX otherwise never synced → follow-up to replier) — cost if wrong: extra history types
- P2-T04: fix round 1 done 259994b (CI green). Ruling: user PAUSE wins over auth-failure NEEDS_ATTENTION in diagnostics (error kept in lastError) — brief silent — cost if wrong: paused account's auth issue less prominent until resumed
- P2-T05: Ruling: raised minors — invalid_client on refresh is app-config not mailbox AuthError (would flag every mailbox); guest #EXT# UPN never stored as email; minGapSec PATCH test — cost if wrong: small churn
- P2-T06: Ruling: raised minors — EAUTH non-535 not AuthError; smtpCredentials workspace filter (tenant isolation); DNS rebind at send → transient not permanent; security tests must prove claims — cost if wrong: small churn
- P2-T06: fix round 1 done ..05faa53 (CI green 3 jobs). Ruling: OAuth revive takes display names from fresh connect — reflects current mailbox — cost if wrong: user-edited name overwritten on revive. Scoped re-review dispatched
- P2-T07: Ruling: raised minor — recipient-level failures must not bump account errorCount24h/health — cost if wrong: small churn
- P2-T07: Ruling: test-send failures (outage/rate-limit/ambiguous) don't count toward account health — health driven by real sends + diagnostics — cost if wrong: an outage seen only via test-send isn't reflected in health
- PHASE 2 GATE Ruling: I-6 SMTP/IMAP reconnect built now in the fix wave (PS-ACC-08 requires reconnection) — cost if wrong: small scope addition before merge
- PHASE 2 GATE Ruling: I-7, I-9 → P4-T05; I-8 → P3-T11; I-5 bookkeeping + CLAUDE.md additions by controller

### Phase 2 deferred minors
- P2-T01: minor (deferred): store.ts stale-lock reap racy/untested; limit<=0 & garbage page tokens unvalidated; contract gaps (since case, mid-paging arrival, cursor to reopened instance); FakeOAuthClient loginHint unencoded; Fake timestamps not clock-injected; prettier noise env.ts; weak e2e 11-char assertion
- P2-T01: minor (deferred): Fake lock EPERM retry surfaces genuine permission errors after ~50 s
- P2-T02a: minor (deferred): per-process clock skew for lease (benign); rotate script backs up before stopping web/worker; rerun w/o printed key misleading; .ps1 unclear error when ENCRYPTION_KEY missing; schema tests no RED evidence
- P2-T02b: minor (deferred): fragile isUniqueViolation regex; GOOGLE_SETUP mentions row reconnect action before it exists (P2-T04 adds); revive sets lifecycle ACTIVE (not in brief)
- P2-T03: minor (deferred): ~20 MB page bound not enforced; diagnostics misleading scope_missing on store failure; index.ts export placement; locate ignores duplicate hits; empty page with hasMore:true possible
- P2-T03: minor (deferred): no test for labelsAdded TRASH skip
- P2-T04: minor (deferred): autofix IN_PROGRESS can stick after crash; applyLimits reads cur outside tx; aria-selected on tr invalid; e2e order-dependent; better-auth sign-in rate limit 5/min constrains e2e
- P2-T05: minor (deferred): non-send 4xx → PermanentSendError naming; e2e worker-retry re-sign-in; delta "changed" ignored (move to Deleted Items may not reach removed) → P4-T05 note
- P2-T06: minor (deferred): test-connection no rate limit + returns banner (ADMIN-only) → P7-T07; SSL vs STARTTLS mismatch reported as cert problem
- P2-T07: minor (deferred): live-verify 60 s wall limit/no per-call timeouts; locate/changes SENT check on self-send; S5/G9 impractical on real host; fake route not workspace-scoped (ADMIN-only, flag-gated)
- P2-T07: minor (deferred): setSending(false) not in finally (button can stick on thrown call)

### Phase 2 carry-forwards
- P2-T01: carry-forward to P2-T06: assertPublicHost must block IPv4-compatible ::a.b.c.d (non-::/::1) via embedded-v4 check
- P2-T02a: carry-forward (binding) to P2-T02b/T03/T04/T05/T06 briefs: disconnect, soft delete, reconnect ONLY via setCredentials
- P2-T02a: carry-forward to P2-T02b/T04: connect/reconnect routes must check setCredentials boolean and return an error on false
- P2-T02b: carry-forward to P2-T04/T05: OAuth scope check must branch per provider
- P2-T02b: carry-forward to P2-T07: live verify popup flow with real Google (COOP)
- P2-T02b: carry-forward to P2-T04: Cancel should invalidate server OAuthSession (now UI-only); re-click Connect after Cancel can leave a stale poll loop running
- P2-T03: carry-forward to P2-T07: live-verify Gmail history shape, in:anywhere/in:sent queries, format=minimal labelIds, error envelopes, Message-ID preservation, Bcc in stored sent copy
- P2-T03: carry-forward to P4-T01: Gmail may re-report the same providerMessageId after labelAdded — ingest must dedupe (rfcMessageId/providerMessageId) and update folder
- P2-T03: carry-forward to P4-T05/P5-T02: persistent TransientBeforeSendError on reads (e.g. policy 403) must be attempt-capped and escalated to account health, never retried forever
- P2-T04: carry-forward to P2-T05: Microsoft account create must apply MS365/OUTLOOK_COM minGapSec floor (3 s)
- P2-T05: carry-forward to P2-T07: live-verify Graph shapes (Message-ID + draft id survive into Sent Items, @removed reasons, 403 codes) per P2-T05 report
- P2-T05: carry-forward to P3-T11: sender persists ProviderError.providerMessageId onto ScheduledMessage.providerMessageId (findSent hint for Graph)
- P2-T05: carry-forward to P4-T05: Graph delta "changed" ignored — move to Deleted Items may not reach removed

## 2026-10-21 · Phase 3 step plan review round 1 · independent agent (opus) · **Changes Required**
2 Critical (cancelled HELD row re-planned → double send; claim lacked current-step check → stale main-sequence follow-up after subsequence entry), 12 Important (D18 blocklist-as-hard-bounce, account errors pause leads not account, UNCERTAIN without time cap, planner/claim deadlock, one bad row blocks all workspaces, …), 19 Minor. D16/D17 sound and unbypassable; D18 fits frozen interface. Planner revising.

## 2026-10-21 · Phase 3 step plan review round 2 · same independent agent (opus) · **APPROVED**
0 Critical, 0 Important, 7 Minor (appended to plan as Revision 3). Deviations accepted (rotation-first split; import files documented). D16 sending blocked until P4 sync; D17 ProviderVerification gate; D18 rev 2 scope; D19.

## 2026-10-21 · P3-T01 leads service/API · task reviewer (sonnet) · 1 fix round → **Approved**
Merge row locks, full isolation tests, set-based bulk with 30 s timeout, Suppression→Lead lock order, GDPR in-flight test fails loudly (real-table test owned by P3-T09).

## 2026-10-21 · P3-T02 CSV import/export + ESP · task reviewer (sonnet) · 1 fix round → **Approved**
List dedupe implemented, campaign dedupe 400 until P3-T06, parser errors surfaced, stale-job attempt cap, deadlock batch retry, export formula guard keeps numbers.

## 2026-10-21 · P3-T03 lists/blocklist/Leads UI · task reviewer (sonnet) · 2 fix rounds → **Approved**
D20 (GDPR_ERASURE/COMPLAINT non-removable on every path incl. GDPR reason upgrade; UNSUBSCRIBE removal needs attestation), MANUAL-only bulk clear, persistent bulk messages, Bounced view params, export never truncates.

## 2026-10-21 · Chore: flaky CI e2e · implementer (sonnet), controller-reviewed
Root cause (likely): better-auth 5/min sign-in rate limit across specs. Fix: shared API sign-in session + CI retries 2 + github reporter + trace on failure.

## 2026-10-21 · P3-T04 template engine · task reviewer (sonnet) · 1 fix round → **Approved**
Fallback-brace validation, renderSubject (single-line, no HTML) as the only subject path, independent subject/body seeds, template-injection via lead data impossible (values never re-parsed).

## 2026-10-21 · P3-T05 campaign service/API · task reviewer (sonnet) · 1 fix round → **Approved**
Merged cc/bcc cap, launch checks over usable accounts only, unsubscribe reachability via shared isPrivate, relaunch/resume re-validate. physicalAddress settings owned by P3-T08.

## 2026-10-21 · P3-T07 schedule math · task reviewer (sonnet, with probes) · 1 fix round → **Approved**
DST spring-forward/fall-back, overnight windows, multi-timezone earliest, dayKey at midnight, empty schedules throw; windows wholly inside a DST gap skipped.

## 2026-10-21 · P3-T08 unsubscribe/footer/physical address · task reviewer (sonnet, compliance lens) · 1 fix round → **Approved**
HMAC tokens (constant-time, no enumeration), RFC 8058 one-click POST (no cookies, idempotent, enrollments UNSUBSCRIBED), GET never unsubscribes, footer always carries address, List-Unsubscribe(-Post) per mode, lock order + retry.

## 2026-10-21 · P3-T06 sequences/enrollment/duplicate/export · task reviewer (sonnet) · 3 fix rounds → **Approved**
Claim re-check contract for T09/T10b, active-campaign edit guards, merge/delete stop enrollments, conflict rule covers unhealthy states + launch re-check, merge move honors suppression/conflict, lock order 726004 before Lead rows.

## 2026-10-21 · P3-T09 quota + dispatcher claim · task reviewer (opus, adversarial) · 1 fix round → **Approved**
No double-send, over-quota, outside-window or unretried-deadlock path. Fixed: claimed rows kept on late error, lock order documented as D21 (SM→CL→usage→EA), post-lock eligibility re-check, claim indexes, DB unique (campaignLeadId,stepId), deterministic campaign/workspace cap tests, lock-wait treated as busy.

## 2026-10-21 · P3-T10a rotation/explainer/status · task reviewer (sonnet) · 1 fix round → **Approved**
Shared accountOk + companyGateOk + remainingToday predicates across claim, pickAccount and explainer; constant-query rotation; blocking flag; pickAccount null = not now.

## 2026-10-21 · P3-T10b planner · task reviewer (opus, adversarial) · 1 fix round → **Approved**
C-1 batch starvation fixed (paging, per-constraint exclusion, 1 h durable back-off), single-pass edit re-render, deleteStep locks rows; D22 records the step-1 delete and removeFromSubsequence deviations.

## 2026-10-21 · P3-T11a sender · task reviewer (opus, adversarial) · 1 fix round → **Approved** (sonnet re-review)
No duplicate-send path: provider call outside transactions, every post-send write conditional on claimToken, late accept never resends, reservations committed or released exactly once. Fixed: C advance() could revive a STOPPED last-step lead into a completed_no_reply subsequence (now only QUEUED/ACTIVE/PAUSED advance); I SMTP 5.1.x sender-side rejections (MAIL FROM/AUTH or "sender" text) no longer suppress the lead; `variant!` finding confirmed false positive (claim cancels null/inactive variant as stale), assertion removed and pinned by test. Deferred: SEND_LEASE_SEC floor → P3-T11b; cc-caused rejection → P5; 429 attempt cap kept; hard-delete mid-send reservation stays on that day's usage.

## 2026-10-21 · P3-T11b recovery + HELD API · task reviewer (opus, adversarial) · 1 minor-fix round → **Approved** (sonnet re-review)
No resend path: recovery never resends, every write conditional on state/claimToken, reservations settled exactly once across recover/found/held/release/cancel/late-accept. Rulings: a throwing findSent counts as an attempt, but the 24 h cap holds only after ≥2 attempts ≥15 min apart; pg-boss heartbeat + 15 s monitor/supervise (dead job failed in ~25 s) accepted as minimal. Round 1: HELD release session-only ADMIN (may send a second copy), listScheduled exposes search history, multistep E2E asserts sent-copy count. Deferred: Graph draft cleanup on the cap path; lead-import heartbeat; old dev-DB queue settings.

## 2026-10-21 · P3-T12 campaign builder UI · task reviewer (sonnet) · 1 minor-fix round → **Approved** (sonnet re-review)
Preview uses the sender's own renderForLead (preview = sent), HTML in a sandboxed iframe, test-send and HELD release session-only ADMIN with the "may already have been delivered" confirm, workspace-scoped. Rulings: test-send copies carry dead unsubscribe text (a live token could opt the real lead out); extra Cancelled tab, save-time template errors, no reorder UI accepted. Round 1: readable preview errors, blank follow-up subject previews as the planner's "Re:", /scheduled stale-response guard, "Finished" column.

## 2026-10-21 · P3-T13 ramp, workspace caps, lead timeline · task reviewer (sonnet) → **Approved**
Every allowance consumer (claim, pickAccount, explainer, planner, toApiAccount) goes through effectiveAllowance, so the ramp cannot be bypassed; timeline workspace-scoped. Ruling: re-enabling slow ramp restarts it (rampStartedAt stamped on each off→on), overriding the brief's "only when null", because a mailbox must not jump to full volume after a ramp toggle. Deferred: bulk interest changes write no per-lead audit row, so they are absent from the timeline.

## 2026-10-21 · Phase 3 gate · whole-branch reviewer (opus) + ponytail-audit · 1 fix wave → **Ready with fixes applied**
No critical findings; no duplicate-send, over-send or outside-window path. Fixed: I-1 graceful stop (stop signal before claims, pg-boss stop timeout 90 s, compose grace 100 s); I-2 HELD release clears `uncertainAt` so a later cancel is re-planned; I-3 unassigned sticky mailbox pauses the lead SEND_FAILED and the explainer says so; I-4 COMPLETED campaigns resume; M-1 user-path lock inversions retried; M-2 stale check right before send; M-3 SMTP To refused with Cc accepted is a failure; M-4 test-send refuses suppressed recipients; M-5 preview never shows a live unsubscribe link; M-7 planner sweeps SCHEDULED rows of archived/completed/deleted campaigns; M-8 revival resets attempts; M-9 lead-import heartbeat; audit A1/A2/A6/A8/A9/A11. D25 records the policies. Deferred: M-6 claim re-check of ESP rules/tags → P5; audit planner split, idempotencyKey drop, committedToday caching, bulk-interest cap, recomputeDue loop. Each must-fix has a test verified to fail with its fix reverted.

## 2026-10-21 · Phase 3 gate · opus whole-branch review + ponytail audit + opus scoped re-review → **Approved, merged**
Review: 0 Critical, 4 Important, 9 Minor; no duplicate/over-quota/outside-window path. Fixed in one wave (02facdb, D25): I-1 graceful shutdown (stop claiming on SIGTERM, 90 s stop bound), I-2 released HELD row with dead variant no longer strands the lead, I-3 sticky mailbox unassigned → leads paused + surfaced in explainer (D23), I-4 COMPLETED campaign resumable with launch checks; M-1..M-5, M-7..M-9; audit A1 shared open-state constant, A2 one stop-and-cancel helper, A6 partial-index test, A8 launch fallback removed, unused exports deleted. Deferred: M-6 → P5-T02; planner split, idempotencyKey drop, committedToday caching, bulk-interest cap, recomputeDue loop. Re-review new minors: N-1 Cc multi-copy on To 4xx (blocking for P4-T05), N-2 no bulk resume after re-assign (P5-T02), N-3 resume after end date (P4-T05). Parity 126/316.

## 2026-10-21 · Phase 4 plan · independent opus plan review → **Revise → Revision 2 applied**
1 Critical, 12 Important, 18 Minor (`docs/plans/phase-4-review.md`). C1 multi-run historical/full import kept no cursor and set the watermark from the last run (fix: cursor + startedAt in syncProgress). I1 applyInbound order (stops → subsequence → interest → counters → suppression → event), I2 Cc bounce, I3 tx-level optOutTx + direct SYNC error write, I4 own-Message-ID match for SENT copies, I5 rfcMessageId index, I6 lease renewal + time budget, I7 date guard only for unthreaded mail, I8 non-lead company stop only when threaded, I9 not-interested false positives, I10 opened/clicked triggers, I11 GDPR erase/merge of mail, I12 T07 (f) vs company gate. All 31 folded into the plan as a binding Revision 2 table; TASKS.json models/deps updated.
- P4-T01 (8221d0b): mail schema (Thread/Message/Attachment/Event/SyncRun), ingest + threading (D17 fallback, own-id match), event store with ACCEPTED backfill, GDPR erase/merge of mail. Review: spec ✅, 0 C/I, 8 minor (ledger).
- P4-T04 (1d27c95, bcdb714, fc1664f): signed open pixel + click redirect (open-redirect safe), machine/scanner flags, tracking domains via Caddy on-demand TLS (+ CI caddy validate), ACTIVITY subsequence triggers. Review: 1 Important (Caddy respond order) + 1 new Important (malformed href throw) fixed in 2 rounds; deviation: no TDD RED evidence.
- P4-T02 (d4c1c31, 2fab48b): rule classifier (DSN D27 classes, auto-reply + OOO dates, unsubscribe, interest) with 49-email corpus. Review: 3 Important false-positive findings (unsubscribe, not-interested, localised quotes) fixed in 1 round.
- P4-T03 (87bcd58, 1795246): stop rules (reply/company/OOO/unsubscribe/bounce, keyword+status subsequences, M17 settle of UNCERTAIN/HELD on reply), D26/D27. Opus review: 1 Important (M17 settle before stops inverted D21) + 3 minor behaviour bugs fixed in 1 round. Implementer was interrupted once and relaunched from the saved partial diff.
