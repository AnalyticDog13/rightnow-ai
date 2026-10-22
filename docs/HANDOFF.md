# Handoff

**Phase:** 5 — Deliverability, warm-up, re-warm-up (branch `phase-5-deliverability`, created from `main` at 7c03dad)
**Current task:** P5-T03 (warm-up). Done: P5-T01 8b65f8b, P5-T02 d48a2da. Ledger `.superpowers/sdd/phase-5/progress.md`.
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md` … `phase-4.md` (+ `phase-4-review.md`).
**Tests:** ~1165 vitest + 20 Playwright green; CI `check`, `compose-smoke` (incl. Caddyfile validate), `imap-real` green.

## Next exact action
Phase 5: create branch `phase-5-deliverability` from `main`, write the step plan `docs/plans/phase-5.md` from IMPLEMENTATION_PLAN Phase 5 + PRODUCT_SPEC (WARM, REWARM, deliverability) + TASKS.json carry-forwards, get an independent opus plan review, then execute with subagent-driven-development (new ledger `.superpowers/sdd/phase-5/`). Check CI after EVERY task commit.
Carry-forwards from Phase 4 into P5: P5-T05 hooks `computeLifecycle` into `reconcileAccount` (after the caught-up write); P5-T06 extends `packages/core/test/e2e/downtime.test.ts` with the 30-day re-warm allowance; P5-T02 consumes SOFT/UNKNOWN bounce events and SYNC errors for health; sync escalation overwriting an earlier SENDING `lastError` (minor). Into P7: AI classifier (hook + lease renewal per message), push sync/IMAP IDLE, link-target warnings + rich-text compose, lead conversation export, inbox query-count/perf pass, near-copy cleanup.
Existing dev DBs keep old pg-boss queue settings (recreate the pg-boss schema to pick up the new heartbeats).
Known env issue: Windows vitest worker crash (exit 3221226505) recurs in random files; vitest 5 already uses forks; rerun affected files alone.

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
