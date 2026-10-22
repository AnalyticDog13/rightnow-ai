# Handoff

**Phase:** 4 — Incoming mail & tracking (branch `phase-4-inbox`, from `main` after the Phase 3 merge)
**Current task:** Phase 4 gate (all tasks done): opus whole-branch review + ponytail-audit → one fix wave → full tests/e2e/CI → ff main. Ledger `.superpowers/sdd/phase-4/progress.md`.
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md`, `phase-2.md`, `phase-3.md`.
**Tests:** ~946 vitest + 19 Playwright (prod build) green; CI `check`, `compose-smoke`, `imap-real` green.

## Next exact action
Phase 4: execute `docs/plans/phase-4.md` (Revision 2 table at the end overrides the task text) with subagent-driven-development (new ledger `.superpowers/sdd/phase-4/`).
Ordering constraint: P4-T05 (writes `lastSyncCompletedAt`, which enables real campaign sends per D16) lands only AFTER reply-stop (P4-T03), mailto-unsubscribe processing, and the N-1 Cc-retry fix (see TASKS.json P4-T05).
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
