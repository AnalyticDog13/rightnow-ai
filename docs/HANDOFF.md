# Handoff

**Phase:** 1 — Foundation (branch `phase-1-foundation`)
**Current task:** P1-T03 crypto + env + clock (P1-T02 done b56a5b0)
**Plan:** `docs/IMPLEMENTATION_PLAN.md` rev 3 — APPROVED (REVIEW_LOG round 3). Phase step plan: `docs/plans/phase-1.md`.
**Tests:** smoke test green; CI green on phase-1-foundation

## Next exact action
Implement the first `todo` task in `docs/TASKS.json` per `docs/plans/phase-1.md` on branch `phase-1-foundation`,
then independent review → commit → push → update this file.

## External dependencies (need the user)
- Docker Desktop not installed on dev machine (blocks local Compose verification only; CI covers builds).
- Google Cloud OAuth client, Microsoft Entra app, SMTP/IMAP test mailbox credentials — needed only for live
  integration verification (P2-T07 / LIVE_VERIFICATION.md); all provider code is tested with fakes until then.
