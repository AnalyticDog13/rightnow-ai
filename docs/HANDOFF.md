# Handoff

**Phase:** 2 — Email provider connections (branch `phase-2-providers`, created from `main` after the Phase 1 merge)
**Current task:** P2-T04 account service, API and UI (P2-T03 done 49a0de1).
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Phase 1 step plan: `docs/plans/phase-1.md` (complete).
**Tests:** 54 vitest + 3 Playwright green; CI `check` + `compose-smoke` green on main.

## Next exact action
Write the Phase 2 step plan from IMPLEMENTATION_PLAN Phase 2 + PRODUCT_SPEC ACC items + PROVIDER_COMPLIANCE, dispatch an
independent plan reviewer, then execute P2-T01 (carrying the M1–M4 cleanup listed in its TASKS.json acceptance).

## Interfaces available from Phase 1
`route()` (apps/web/lib/api.ts: auth/role/scope/params, CSRF), `startWorker`/`JobDef` with `{prisma, clock}` deps,
`createPrisma(url,max)`, `createTestDb`/`expectIsolated` (`@rightnow/db/test-db`), `getEnv` + schema extend,
`encrypt/decrypt` + `ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.

## External dependencies (need the user)
- Docker Desktop not installed on dev machine (Compose verified only in CI; `.ps1` scripts syntax-checked, never run).
- Google Cloud OAuth client, Microsoft Entra app, SMTP/IMAP test mailbox credentials — needed only for live
  verification (P2-T07 / LIVE_VERIFICATION.md); provider code is tested with fakes/fixtures until then.
