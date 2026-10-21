# Handoff

**Phase:** 3 — Campaign automation (branch `phase-3-campaigns`, from `main` after the Phase 2 merge)
**Current task:** P3-T11b recovery + HELD API (opus). P3-T11a sender done 26c3ade (D23).
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md`, `docs/plans/phase-2.md`.
**Tests:** 522 vitest + 16 Playwright (prod build) green; CI `check`, `compose-smoke`, `imap-real` green.

## Next exact action
Dispatch P3-T11b (opus) from `docs/plans/phase-3.md` + TASKS.json acceptance carry-forwards (lease floor, expired SENDING → UNCERTAIN, boot kick). Then P3-T12, P3-T13, then the Phase 3 gate (opus whole-branch review + ponytail-audit). SDD ledger: `.superpowers/sdd/phase-3/progress.md`.

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
