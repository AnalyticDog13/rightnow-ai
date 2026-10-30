# Handoff

**Phase:** 8 — Final verification DONE and merged to `main`. All phases complete.
**Current task:** none. Project complete per IMPLEMENTATION_PLAN. Open items are the user decisions in docs/RELEASE_CHECK.md (lawyer review, rightnow.ai trademark search, LGPL libvips via sharp) and D17 live provider verification with real credentials (docs/ops/LIVE_VERIFICATION.md), required before real Gmail/Graph/IMAP campaign sending. Accepted residuals: docs/FINAL_ASSESSMENT.md.
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 (approved). Done step plans: `docs/plans/phase-1.md` … `phase-5.md` (+ `phase-4-review.md`, `phase-5-review.md`).
**Tests:** ~1290 vitest + Playwright (auth, accounts*, campaign-create, deliverability, inbox, leads, test-send …) green; CI `check`, `compose-smoke`, `imap-real` green. Parity: 311/316 ticked.

## Next exact action
Phase 8 per IMPLEMENTATION_PLAN "Phase 8" + TASKS.json P8 entries (write docs/plans/phase-8.md first). Check CI after EVERY task commit.
Carry-forwards into P8: the debt list in Current task. Accepted partials: PS-SYNC-01 (no IMAP IDLE, D48), PS-WARM-08/-18 (D51), PS-SEC-15 (no AV hook, D50); PS-CAMP-14 deferred (D19); PS-DEPLOY-11 is P8-T02.
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
