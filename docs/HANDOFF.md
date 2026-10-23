# Handoff

**Phase:** 6 — CRM & analytics (next). Phase 5 (deliverability, warm-up, re-warm-up) DONE and merged to `main`.
**Current task:** Phase 6 GATE — gate fix round (opus) running on findings from the opus whole-branch review (PASS WITH FIXES) + ponytail-audit; then scoped re-review, CI, tick PS items, PROGRESS/HANDOFF/REVIEW_LOG/DECISIONS, fast-forward main. Done: P6-T01a 2f2ebbc, P6-T01b 3eaa45c, P6-T02 ff1097a, P6-T03 470161b, P6-T04 ddef453. Ledger `.superpowers/sdd/phase-6/progress.md` (rulings + deferrals).
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md` … `phase-5.md` (+ `phase-4-review.md`, `phase-5-review.md`).
**Tests:** ~1290 vitest + Playwright (auth, accounts*, campaign-create, deliverability, inbox, leads, test-send …) green; CI `check`, `compose-smoke`, `imap-real` green. Parity: 208/316 ticked.

## Next exact action
Phase 6 per IMPLEMENTATION_PLAN "Phase 6 — CRM & analytics" + PRODUCT_SPEC (CRM, analytics) + TASKS.json P6 entries. Check CI after EVERY task commit.
Carry-forwards into P7 (from Phase 4 and Phase 5): AI classifier (hook + lease renewal per message), push sync/IMAP IDLE, link-target warnings + rich-text compose, lead conversation export, inbox query-count/perf pass, near-copy cleanup; P5 gate deferrals — placement ignores health cap/re-warm allowance and runs sends inside the HTTP request with no per-account test limit, warm-up keeps full volume on a throttled account, BounceProtect complaint floor counts 24 h vs the 30-day complaint window, status-banner sentence for `leads_verifying`, DNS chip deep link, Recharts sparkline, domain-of-email duplication; PS partials — PS-ACC-24 (CNAME in vitals), PS-SEND-11 (auth failure flags at once, spec says after 5), PS-WARM-08 (warm custom tracking domain), PS-WARM-11 (health formula documented in-app), PS-WARM-18 (SpamAssassin report), PS-REWARM-08 (exit-criteria bounce threshold hard-coded 2 %). Map: `.superpowers/sdd/phase-5/gate-spec-map.md` (deleted with the workspace; partials listed here).
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
