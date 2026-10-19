# Handoff

**Phase:** 0 — Initialization / planning
**Current task:** P0-T04 independent plan review (Opus reviewer running; if interrupted, re-dispatch the review per IMPLEMENTATION_PLAN)
**Branch / commit:** `main`, see `git log -1`
**Tests:** none yet
**Review status:** plan not yet written

## Next exact action
Write `docs/PRODUCT_SPEC.md` (parity checklist), then `docs/IMPLEMENTATION_PLAN.md`, then dispatch an
independent plan reviewer.

## External dependencies (need the user)
- Docker Desktop not installed on dev machine (blocks local Compose verification only; CI covers builds).
- Google Cloud OAuth client, Microsoft Entra app, SMTP/IMAP test mailbox credentials — needed only for
  live integration verification; all provider code is tested with mocks until then.
