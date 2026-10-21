# Handoff

**Phase:** 3 — Campaign automation (branch `phase-3-campaigns`, from `main` after the Phase 2 merge)
**Current task:** Phase 3 gate (all 15 tasks done; P3-T13 8576e78).
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md`, `docs/plans/phase-2.md`.
**Tests:** 522 vitest + 16 Playwright (prod build) green; CI `check`, `compose-smoke`, `imap-real` green.

## Next exact action
Run the Phase 3 gate (opus whole-branch review + ponytail-audit). SDD ledger: `.superpowers/sdd/phase-3/progress.md`.
Gate follow-ups: lead-import queue needs `heartbeatSeconds: 10` (keep 3 h expiry); existing dev DBs keep old pg-boss queue settings (heartbeat added in P3-T11b applies to new queues only).

## Interfaces available (Phases 1–2)
Phase 1: `route()` (auth/role/scope/params, CSRF), `startWorker`/`JobDef` `{prisma, clock}`, `createPrisma`,
`createTestDb`/`expectIsolated`, `getEnv`, `encrypt/decrypt`/`ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.
Phase 2: `MailProvider` (frozen; `packages/providers/src/types.ts`) + contract suite, `createProvider(account,{prisma,…})`,
`accountCredentialStore`/`setCredentials`, `openAccount`, account service (limits/caps clamp, diagnostics, health),
OAuth sessions (Google, Microsoft), IMAP/SMTP connect/reconnect, `sendTestEmail`, `liveVerify`. Rules: see CLAUDE.md.

## External dependencies (need the user)
- **Gates real-provider campaign sends (D17, runtime gate; code is built and tested on the Fake):** run `docs/ops/LIVE_VERIFICATION.md` with real credentials — Google OAuth client, Microsoft Entra app,
  IMAP/SMTP test mailbox. Message-ID preservation (Gmail G4, Graph M2/M3) must pass; `scripts/live-verify.ts` records it.
- Docker Desktop not installed on the dev machine (Compose verified only in CI; `.ps1` scripts syntax-checked, never run).
