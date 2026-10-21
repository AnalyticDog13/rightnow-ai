# Handoff

**Phase:** 3 — Campaign automation (branch `phase-3-campaigns`, from `main` after the Phase 2 merge)
**Current task:** Phase 3 gate: review + audit done, fix wave committed (see REVIEW_LOG); next is fast-forwarding `main`.
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md`, `docs/plans/phase-2.md`.
**Tests:** 522 vitest + 16 Playwright (prod build) green; CI `check`, `compose-smoke`, `imap-real` green.

## Next exact action
Phase 3 gate fixes are in (I-1..I-4, M-1..M-5, M-7..M-9, audit A1/A2/A6/A8/A9/A11; D25). Once CI is green on
`phase-3-campaigns`, fast-forward `main`. Carry into Phase 4 planning: P4-T05 (freshness writer) must land after
reply-stop (P4-T03) and mailto-unsubscribe processing (gate review "ordering constraint"); M-6 (claim re-check of
ESP rules / tags) deferred to P5. Existing dev DBs keep old pg-boss queue settings (recreate the pg-boss schema to
pick up the new heartbeats).

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
