# Handoff

**Phase:** 1 — Foundation (branch `phase-1-foundation`)
**Current task:** P1-T01 monorepo scaffold (see `docs/TASKS.json` for live status)
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 — APPROVED (REVIEW_LOG round 3). Phase step plan: `docs/plans/phase-1.md`.
**Tests:** none yet

## Next exact action
Implement the first `todo` task in `docs/TASKS.json` per `docs/plans/phase-1.md` on branch `phase-1-foundation`,
then independent review → commit → push → update this file.

## External dependencies (need the user)
- Docker Desktop not installed on dev machine (blocks local Compose verification only; CI covers builds).
- Google Cloud OAuth client, Microsoft Entra app, SMTP/IMAP test mailbox credentials — needed only for live
  integration verification (P2-T07 / LIVE_VERIFICATION.md); all provider code is tested with fakes until then.
