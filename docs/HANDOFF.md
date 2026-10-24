# Handoff

**Phase:** 7 — Advanced features (in progress, branch `phase-7-advanced`). Phase 6 DONE and merged to `main` (114d0ab).
**Current task:** P7-T07b (2FA, invites/members, audit view, npm audit — sonnet) implemented bf75495, in security review. Done: P7-T01a dff21db, P7-T01b f2c2b25, P7-T02a fd7c69d, P7-T02b f84b83a, P7-T03a 2d5dc42, P7-T03b 520a9ec, P7-T04 7958b48, P7-T05a d0db75d, P7-T05b 31bffd6, P7-T06a c7a6a0e, P7-T06b ced2573, P7-T07a 5c9f564. T07a must rate-limit /api/push/* and POST /webhooks/:id/test. Suggestion approve/reject is session-only (API keys cannot self-approve). T08a: label editor UI needs "AI may choose" (aiSelectable is API-only today). T05b carries R13 AI retryAfterSec sleep; T07b aligns audit page + GET /audit-logs roles (R21). T07a MUST rate-limit POST /webhooks/:id/test. Plan `docs/plans/phase-7.md` + Revision 2 (binding). Order: T02a T02b T03a T03b T04 T05a T05b T06a T06b T07a T07b T09 T08a T08b, sequential (low RAM). `jobs/retention.ts` created minimal by T02a (delivery purge); T03a adds the AutomationRun purge (R13). Ledger `.superpowers/sdd/phase-7/progress.md`.
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md` … `phase-5.md` (+ `phase-4-review.md`, `phase-5-review.md`).
**Tests:** ~1290 vitest + Playwright (auth, accounts*, campaign-create, deliverability, inbox, leads, test-send …) green; CI `check`, `compose-smoke`, `imap-real` green. Parity: 208/316 ticked.

## Next exact action
Phase 6 per IMPLEMENTATION_PLAN "Phase 6 — CRM & analytics" + PRODUCT_SPEC (CRM, analytics) + TASKS.json P6 entries. Check CI after EVERY task commit.
Carry-forwards into P7 (from Phase 6): MEETING double-count after a lead merge (count per lead+campaign or document); split opportunity-drawer.tsx / analytics-client.tsx when next touched; analytics `today` fixed at mount + filter-row layout shift; axe pass on CRM/analytics pages; leadTimeline caps CRM entries at 200 (shortcut, not in DECISIONS); no test pins revenuePerLead against mixed campaign/non-campaign deals; no test for loadVariants stale guard / outside-click close; td title + sr-only duplicate announcement; Lead.mergedIntoId unindexed; currency edit-from-0 race (one-line Workspace key-share lock); CRM-08 producers (P7-T05), ANALYTICS-15 sparkline (P7-T08), LEAD-04 runs synchronously. (From Phase 4 and Phase 5): AI classifier (hook + lease renewal per message), push sync/IMAP IDLE, link-target warnings + rich-text compose, lead conversation export, inbox query-count/perf pass, near-copy cleanup; P5 gate deferrals — placement ignores health cap/re-warm allowance and runs sends inside the HTTP request with no per-account test limit, warm-up keeps full volume on a throttled account, BounceProtect complaint floor counts 24 h vs the 30-day complaint window, status-banner sentence for `leads_verifying`, DNS chip deep link, Recharts sparkline, domain-of-email duplication; PS partials — PS-ACC-24 (CNAME in vitals), PS-SEND-11 (auth failure flags at once, spec says after 5), PS-WARM-08 (warm custom tracking domain), PS-WARM-11 (health formula documented in-app), PS-WARM-18 (SpamAssassin report), PS-REWARM-08 (exit-criteria bounce threshold hard-coded 2 %). Map: `.superpowers/sdd/phase-5/gate-spec-map.md` (deleted with the workspace; partials listed here).
Dev DBs that applied the branch-edited placement migration `20261029000000_placement` before its index was added need `prisma migrate reset` (checksum drift).
Existing dev DBs keep old pg-boss queue settings (recreate the pg-boss schema to pick up the new heartbeats).
Known env issues: Windows vitest worker crash (exit 3221226505) recurs in random files — rerun alone; the dev machine runs low on RAM — run vitest per project with `--maxWorkers=2`; run Playwright from `apps/web`.

## Interfaces available (Phases 1–2)
Phase 1: `route()` (auth/role/scope/params, CSRF), `startWorker`/`JobDef` `{prisma, clock}`, `createPrisma`,
`createTestDb`/`expectIsolated`, `getEnv`, `encrypt/decrypt`/`ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.
Phase 2: `MailProvider` (frozen; `packages/providers/src/types.ts`) + contract suite, `createProvider(account,{prisma,…})`,
`accountCredentialStore`/`setCredentials`, `openAccount`, account service (limits/caps clamp, diagnostics, health),
OAuth sessions (Google, Microsoft), IMAP/SMTP connect/reconnect, `sendTestEmail`, `liveVerify`. Rules: see CLAUDE.md.

## External dependencies (need the user)
- **D16 lifted (P4-T05):** the `mail-sync` job writes the freshness watermark (`lastSyncCompletedAt`), so real campaigns now send
  once their accounts have synced and their provider is live-verified (D17, below).
- **Gates real-provider campaign sends (D17, runtime gate; code is built and tested on the Fake):** run `docs/ops/LIVE_VERIFICATION.md` with real credentials — Google OAuth client, Microsoft Entra app,
  IMAP/SMTP test mailbox. Message-ID preservation (Gmail G4, Graph M2/M3) must pass; `scripts/live-verify.ts` records it.
- Docker Desktop not installed on the dev machine (Compose verified only in CI; `.ps1` scripts syntax-checked, never run).
