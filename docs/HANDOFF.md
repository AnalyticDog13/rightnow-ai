# Handoff

**Phase:** 3 — Campaign automation (branch `phase-3-campaigns`, from `main` after the Phase 2 merge)
**Current task:** P3-T06 sequences/subsequences/enrollment/duplicate/export (P3-T05 done 24e8f14).
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md`, `docs/plans/phase-2.md`.
**Tests:** 522 vitest + 16 Playwright (prod build) green; CI `check`, `compose-smoke`, `imap-real` green.

## Next exact action
Write the Phase 3 step plan from IMPLEMENTATION_PLAN Phase 3 (send pipeline section is binding) + PRODUCT_SPEC
LEAD/CAMP/SEQ/SEND items + TASKS.json acceptance carry-forwards, dispatch an independent (opus) plan reviewer, then execute.
P3-T01..P3-T10 and P3-T12/T13 can proceed; **P3-T11 (sender + recovery) is gated** — see below.

## Interfaces available (Phases 1–2)
Phase 1: `route()` (auth/role/scope/params, CSRF), `startWorker`/`JobDef` `{prisma, clock}`, `createPrisma`,
`createTestDb`/`expectIsolated`, `getEnv`, `encrypt/decrypt`/`ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.
Phase 2: `MailProvider` (frozen; `packages/providers/src/types.ts`) + contract suite, `createProvider(account,{prisma,…})`,
`accountCredentialStore`/`setCredentials`, `openAccount`, account service (limits/caps clamp, diagnostics, health),
OAuth sessions (Google, Microsoft), IMAP/SMTP connect/reconnect, `sendTestEmail`, `liveVerify`. Rules: see CLAUDE.md.

## External dependencies (need the user)
- **Gates P3-T11:** run `docs/ops/LIVE_VERIFICATION.md` with real credentials — Google OAuth client, Microsoft Entra app,
  IMAP/SMTP test mailbox. Message-ID preservation (Gmail G4, Graph M2/M3) must pass before the sender is built.
- Docker Desktop not installed on the dev machine (Compose verified only in CI; `.ps1` scripts syntax-checked, never run).
