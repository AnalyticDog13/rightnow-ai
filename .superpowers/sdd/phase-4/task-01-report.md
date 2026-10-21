# P4-T01 report

## Implemented
- Schema + migration `20261022000000_mail_inbox`: enums, Thread, Message, Attachment, Event, SyncRun, `ScheduledMessage(workspaceId, rfcMessageId)` index (I5), ACCEPTED backfill from SENT rows (`acc:<id>`).
- `packages/core/src/mail/{events,match,classify,ingest,inbox}.ts`, exported from core index. `classify` is the stub (types final; `stripQuoted`/`INTEREST_OF` left to T02).
- `matchMessage` per brief + I4 step 0 (optional `ownId`) + optional `at` (anchor for the 90 days, so tests/historical sync are deterministic). A hit without a thread still takes the first thread a later step or `providerThreadId` finds (so a send whose outbound Message is missing does not split a thread).
- `ingestMessage` (direction OUT when from = account address, M15; existing (accountId, rfcMessageId) only updates providerMessageId/folder; older historical message never rewinds lastInbound*/unread; USER-set category kept), `recordOutboundMessage` (builds a RemoteMessage from the SENT row and goes through `ingestMessage`; idempotent; logs, never throws).
- Sender: ACCEPTED event inside `recordSent` (both the normal and late-accept branches); SEND_FAILED event inside `settle` whenever it writes FAILED; `recordOutboundMessage` called at the end of `recordAccepted`, which covers `sendClaimed` and `resolveUncertain` (I4) without touching recovery.ts.
- I11: `gdprDeleteLead` deletes threads (cascade), messages by fromEmail or leadId, nulls Event.leadId; `mergeLeads` re-points Thread/Message/Event.
- Fake `receiveRaw(raw, folder)`.
- `listThreads(db, ws, {take})` minimal; attachments selected without `data`.

## Tests
`npx vitest run packages/core/test/mail-ingest.test.ts packages/core/test/sender.test.ts` -> 2 files, 61 tests pass.
RED: with `src/mail` moved away, mail-ingest.test.ts failed to load ("Test Files 1 failed, no tests": missing ../src/mail/* modules). Expected.
Full: `npm test` 79 files passed, 1 skipped, 973 tests passed; `npm run lint` clean; `npm run typecheck` clean. (Windows EPERM temp-dir teardown noise only.)
Covers every test in the brief plus I4 (Fake SENT sync links the row), step-2 thread join, cross-mailbox thread not joined, historical no-rewind, oversized attachment, gdpr and merge (I11).

## Decisions / notes
- Event `occurredAt` for SEND_FAILED uses `new Date()` (settle has no clock; the 12 call sites were not worth changing).
- `Message` and `Thread` carry no FK to Lead/Campaign (GDPR deletes explicitly); Thread has FKs to Workspace and EmailAccount (cascade), SyncRun to EmailAccount.
- GDPR erasure can leave an empty Thread if another lead's message sat in it (rare); not handled.
- Prettier flags every CRLF working-tree file in this checkout (pre-existing); only new files were formatted.
- D26-D31 not recorded in DECISIONS.md: the brief assigns them to later tasks, none to T01.
