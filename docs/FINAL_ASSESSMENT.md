# Final assessment (P8-T03)

## Round 1 (2026-10-24) · opus final reviewer · base `786bf82` (branch `phase-8-final`)

### Scope and method

The whole system, not a diff: `packages/core`, `packages/providers`, `apps/worker`, `apps/web` (API routes and the
`route()` helper), `scripts/`, `docker/`, `.github/workflows/ci.yml` and `docs/ops/*`, against `CLAUDE.md`,
`docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_PLAN.md` and `docs/DECISIONS.md`. Items already fixed in
`docs/REVIEW_LOG.md` are not re-reported; the Phase 8 debt table's dispositions were not taken as conclusions.

Method: targeted reads of the send path end to end (claim, sender, recovery, planner, unsubscribe, warm-up,
manual reply), the Phase 8 diff (`main..HEAD`), and greps across the tree for each invariant. Three read-only
sonnet sub-audits ran in parallel for breadth: (a) `workspaceId` scoping, API-key scopes and secret exposure over
every route, (b) error taxonomy, outbound hosts, credential write paths and network-in-transaction, (c) parity
ticks and the ops docs against the scripts. Every BLOCKER/SIGNIFICANT claim from a sub-audit was re-read in the code
by this reviewer before it was kept; three of their SIGNIFICANT ratings were downgraded (m1, m4, m7) and one was kept (S2).

Not run: the full suite, Playwright and Docker (low-RAM machine; Docker is not installed). No vitest file was run
for this round: every finding below is established by reading code, and none needs a test to confirm. CI on
`b40d5d7` (last code commit) is green; the run on `786bf82` (docs only) was in progress at review time.

### Invariants, one by one

| Invariant | Verdict | Evidence |
|---|---|---|
| Single send per row; SKIP LOCKED claim, one row per transaction | Holds | `packages/core/src/dispatch.ts:194-197` (`FOR UPDATE OF sm SKIP LOCKED LIMIT 1`), lead re-check under `FOR NO KEY UPDATE` `:201`, whole `eligible` predicate re-run under the lock `:253-256`, conditional `SENDING` write `:335-349` |
| Quota reserved in the claim transaction | Holds | `dispatch.ts:306-331` + `reserve()` `:375-434`: guarded upserts on account / campaign / workspace usage rows (stored usage days) plus the `nextSendAt` gap, all in the claim tx, rolled back to a savepoint when any is full |
| Freshness gate | Holds for campaign sends | `dispatch.ts:81-87` (`lastSyncCompletedAt >= now - stalenessSec`), company gate `:90-95`; watermark is the sync start (`mail/sync.ts:267`). Warm-up and placement are not freshness-gated by design (D36/D37: own peer mailboxes, no follow-up semantics) |
| HELD on an unknown outcome, never resent | Holds | Sender: anything not classified settles `UNCERTAIN`, reserved, never retried (`sender.ts:463-477`); lease expiry → `UNCERTAIN` (`recovery.ts:17-26`); not found twice 15 min apart, or failed searches past 24 h → `HELD` with release (`recovery.ts:29-45, 141-152`); release is ADMIN session-only with `confirm` (`scheduled.ts:31-47`, `apps/web/app/api/v1/scheduled-messages/[id]/release/route.ts:16`). Late accepts settle idempotently (`sender.ts:500-551`) |
| Follow-ups from the step-1 mailbox | Holds | Sticky account set on the first SENT (`sender.ts:585-593`); planner uses `cl.accountId` for every later step (`planner.ts:557-574`); unassigned/deleted sticky sender pauses the lead (`planner.ts:744-784`) |
| No burst of backlog | Holds | Follow-up backlog planned only up to today's remaining allowance (`planner.ts:563-574`); every claim advances `nextSendAt` by the gap (`dispatch.ts:424-432`); E2E `quota.test.ts` ("backlog drains on day 4") |
| Credential write paths | Holds, one documented exception missing from CLAUDE.md | Only `openAccount()` creates `EmailAccount`; no direct `credentialsEnc` / `verifierConfigEnc` / `aiConfigEnc` writes outside `setCredentials()` / `setVerifierSettings()` / `setAiSettings()`, except the lease-guarded refresh write `accounts/credentials.ts:157-164` (correct, see m6) and the offline `rotate.ts` |
| Encryption at rest | Holds | `ENCRYPTED_COLUMNS` covers all six `*Enc` columns; 2FA secrets encrypted by better-auth; push `clientState` stored as sha256 only |
| Secrets never returned by an API | See sub-audit (a) below | |
| `workspaceId` scoping on every query | See sub-audit (a) below | |
| API-key scopes; ADMIN routes session-only | Holds | `apps/web/lib/api.ts:96-108` (session first, key only for `session-or-apikey`, role check after; keys are MEMBER so every `role: "ADMIN"` route refuses them); P7-T03b scope audit test fails on any non-session ADMIN/OWNER handler; CSRF Origin check for cookie writes `api.ts:71-79, 101` |
| Error taxonomy | Holds, with m1/m2 | `providers/src/gmail/http.ts:84-118`, `graph/http.ts`, `imap-smtp/map-error.ts`: 401 → refresh once → `AuthError`; 5xx on send → `AmbiguousSendError`; token-endpoint 5xx / `invalid_client` → transient; errors built from status + reason only, no `cause`, no body |
| Outbound host checks | Holds | Every IMAP/SMTP connect goes through `assertPublicHost` with an IP-pinned connect and `servername`, `rejectUnauthorized` never set; `assertGraphUrl` on every cursor/page token; `Prefer: IdType="ImmutableId"` on every Graph call; webhook / AI / verifier / JWKS through `safeRequest` (`providers/src/http-out.ts`); no raw `fetch`/`createTransport`/`ImapFlow` elsewhere |
| No network call inside a DB transaction | Holds | `$transaction` callbacks in sender, sync, reply, placement, launch, smtp-connect, oauth, account service, import, verify, recovery read: none calls a provider, DNS, `safeRequest` or AI |
| Worker conditional writes; advisory lock namespaces | Holds, with m3 | Settles are `updateMany … WHERE id, claimToken, status` (`sender.ts:133-137`), warm-up claims `WHERE status = 'PLANNED'` (`warmup.ts:359-363`), recovery `WHERE status = 'UNCERTAIN'`; locks 726001 (`apps/web/lib/setup.ts:39`), 726003 (`planner.ts:46, 379`), 726004 (`campaigns/hooks.ts:161-163`); test-send deviates (m3) |
| Unsubscribe always honoured | Holds | Footer always added, link unless `{{unsubscribeLink}}` used, physical address required (`unsubscribe.ts:122-138`); `List-Unsubscribe` (+ RFC 8058 Post for https) rebuilt on every send (`sender.ts:301`); GET only confirms, POST opts out with no session (`apps/web/app/u/[token]/route.ts:37-62`); old links verify while `OLD_ENCRYPTION_KEY` is set (`unsubscribe.ts:40-49`, KEY_ROTATION.md); mailto reply "unsubscribe" classified (`mail/classify.ts:202-256`); claim and pre-send both re-check suppression (`dispatch.ts:242-250`, `sender.ts:214-215`) |
| No fabricated engagement | Holds structurally | `MailProvider` has no mark/move/label/delete method (`providers/src/types.ts:87-104`); warm-up only sends self-identifying plain text (D36, `warmup.ts:217`) |
| Approval before AI text reaches a recipient | Holds | `reviewSuggestion` is the single writer of `AiSuggestion.status` (`ai/suggestions.ts:52-60`); recipient-facing kinds stay `PENDING`; approve/reject is session-only |

### PRODUCT_SPEC parity

311 of 316 `PS-*` items ticked (PS-DEPLOY-11 ticked in P8-T02). About 16 ticked items, weighted to areas ticked at
the Phase 7 gate (AUTO, AI, SEC, SYNC, DEPLOY, INBOX), were read against code: all are backed by code (e.g. PS-AUTO-09
signature headers in `webhooks/deliver.ts`, PS-SEC-10 launch refusal without a physical address
`campaigns/launch.ts:164`, PS-INBOX-21 sandboxed frame, PS-SYNC-02 per-page cursor + `SyncRun`). One wording gap: m9.

Unticked, re-judged:

| Item | Reason | Still acceptable? |
|---|---|---|
| PS-CAMP-14 recipient-timezone sending | Deferred (D19) | Yes: campaign schedules already carry a timezone; per-lead timezone is an extension |
| PS-WARM-08 warm-up custom tracking domain | Partial (D51) | Yes: warm-up mail is plain text and untracked by design (D36) |
| PS-WARM-18 SpamAssassin report | Partial (D51) | Yes: placement + DNSBL checks exist; a content scorer is an external tool |
| PS-SEC-15 antivirus hook | Partial (D50) | Yes for a single-owner self-host: attachments are never rendered inline or executed; note it in the README for multi-user use |
| PS-SYNC-01 IMAP IDLE | Partial (D48) | Yes: 120 s polling inside the 300 s freshness bound; Gmail/Graph push exist |

### Spec §28 E2E mapping (16 rows)

All 16 files exist and test what the row names:

| # | Scenario | Proving test |
|---|---|---|
| 1 | Google account connection | `apps/web/e2e/accounts-google.spec.ts` |
| 2 | Authorized test-email sending | `apps/web/e2e/test-send.spec.ts` |
| 3 | Lead CSV import | `apps/web/e2e/leads-import.spec.ts` |
| 4 | Campaign creation | `apps/web/e2e/campaign-create.spec.ts` |
| 5 | Automated multistep sending | `packages/core/test/e2e/multistep.test.ts` ("3 messages per lead from its step-1 account, delays, windows, threading") |
| 6 | Quota enforcement | `packages/core/test/e2e/quota.test.ts` ("10 per day, only inside 09:00-17:00, backlog drains on day 4") |
| 7 | Account rotation | `packages/core/test/e2e/rotation.test.ts` |
| 8 | Reply synchronization | `packages/core/test/e2e/reply-sync.test.ts` |
| 9 | Follow-up cancellation | `packages/core/test/e2e/followup-cancel.test.ts` |
| 10 | Bounce detection & suppression | `packages/core/test/e2e/bounce.test.ts` |
| 11 | Inbox threading | `apps/web/e2e/inbox-thread.spec.ts` |
| 12 | CRM opportunity creation | `apps/web/e2e/crm.spec.ts` |
| 13 | Revenue recording | `apps/web/e2e/crm-revenue.spec.ts` |
| 14 | Analytics accuracy | `packages/core/test/e2e/analytics.test.ts` |
| 15 | Worker restart recovery | `apps/worker/test/restart.test.ts` (spawns the worker, `SIGKILL` mid-send, restart: "SENT once, never resent") |
| 16 | Session interruption & resumption | `apps/worker/test/browser-closed.test.ts` (worker alone sends with no web server) + `docs/ops/RESUME_DRILL.md`, executed in P8-T01 |

Gap the mapping does not cover: restoring an older backup over live data (S1).

### Ops story

- **Backup**: `scripts/backup.sh|.ps1` → owner-only `pg_dump -Fc`; attachments are `Attachment.data Bytes`, so they
  are in the dump; docs say to keep `ENCRYPTION_KEY` with every dump. VPS cron with 14-day retention.
- **Restore**: validates the dump, writes a `pre-restore-*` safety dump, recreates the database, migrates, starts
  web + worker. Proven in CI (`compose-smoke`) including wrong-key failure. Duplicate-send risk with an older dump: S1.
- **Local → VPS**: checklist in `docs/ops/VPS.md` §3c (stop local first, never restart it), proven in CI (D52).
- **Key rotation**: `scripts/rotate-key.sh|.ps1` backs up, stops web + worker, re-encrypts per column, leaves
  `.env` for the user; `OLD_ENCRYPTION_KEY` keeps old unsubscribe/tracking links valid. Partial-failure guidance: m4.
- **Upgrade**: `backup.sh && upgrade.sh` documented in VPS.md; the script itself does not back up (m7).
- **Offline recovery**: `docs/ops/OFFLINE_RECOVERY.md` matches the freshness gate and `downtime.test.ts`; one stale
  line about push (m8).
- `.sh` / `.ps1` pairs match in behaviour; every env var in `packages/core/src/env.ts` is in `.env.example`.

### Findings

#### BLOCKER

None.

#### SIGNIFICANT

**S1 · Restoring an older backup re-sends every campaign step sent after the dump.**
`scripts/restore.sh:15-18` (and `scripts/restore.ps1`), `docs/ops/VPS.md:42`, `packages/core/src/planner.ts:304-311`,
`packages/core/src/mail/ingest.ts:253-259`.
Scenario: the VPS cron backs up at 03:00. At 15:00 the owner restores that dump (disaster recovery, or because
VPS.md:42 says "Test a restore occasionally: `scripts/restore.sh backups/<file>.dump`" on the live server).
`restore.sh` starts web and worker straight away. Every row that was `SCHEDULED` in the dump but sent between 03:00
and 15:00 is `SCHEDULED` again. Planned rows carry no `rfcMessageId` until they are claimed (`planner.ts:304-311`,
assigned at `dispatch.ts:334`), so when sync imports the real Sent copies they match no `ScheduledMessage`; an
unmatched outbound copy only updates `Lead.lastContactedAt` (`ingest.ts:253-259`). Once the account is fresh, the
claim sends the same step to the same leads a second time (replies in that window are synced first, so repliers are
spared; everyone else gets a duplicate). This is the outcome D5 ranks worst, produced by a documented procedure.
Suggested fix (smallest): in `restore.sh|.ps1`, after `pg_restore` and `migrate`, pause every `ACTIVE` campaign
(one `UPDATE "Campaign" SET status = 'PAUSED' WHERE status = 'ACTIVE' AND "deletedAt" IS NULL`, print the count and
an audit row) before starting web and worker, and say so in the script output and in LOCAL.md / VPS.md; the owner
resumes after checking the Sent folders. Change VPS.md:42 to "test a restore on a separate machine or volume, never
over the live stack". A stronger follow-up, if wanted: have ingest settle an unmatched OUT copy against the lead's
open `SCHEDULED` row for the same account and subject. Add a CI or core test: restore → sync imports a Sent copy →
the step is not sent again (or the campaign is paused).

**S2 · A `leads:create` API key can enroll leads into a live campaign through CSV import.**
`apps/web/app/api/v1/imports/route.ts:19`, `packages/core/src/leads/import.ts:115-122, 299-302`.
Scenario: an integration key is given only `leads:create` (e.g. a form or CRM sync that should add leads). It
POSTs `/api/v1/imports` with `options.campaignId` of an ACTIVE campaign. `createImport` checks only that the
campaign exists in the workspace and is not archived, then `enrollBatch` puts every imported row into it, and the
worker starts mailing them. The direct route for the same effect (`/campaigns/[id]/leads`) requires
`campaigns:update`, and `POST /leads` does not enroll at all, so the import option is the one path that lets a
leads-only key cause outbound mail. Suggested fix: in the import route, when the parsed `options.campaignId` is set,
call `requireScopes(c.scopes, "campaigns:update")` (sessions have no scopes and pass); add an API test (leads:create
key + campaignId → 403; with campaigns:update → 202).

#### Sub-audit (a) result: `workspaceId` scoping and secrets

No cross-workspace path found. Every service reached from a route scopes by `workspaceId` or reads the row scoped
first in the same transaction (CRM, campaigns, sequences, enroll, portable, preview, leads, lists, labels, merge,
GDPR delete, inbox, notes, macros, views, reply, attachments, webhooks, automations, jobs, imports, scheduled
messages, placement, domains, analytics SQL, AI suggestions, blocklist, members, invites, API keys); body ids
(listId, stageId, accountId, ownerId, assigneeId, campaignId, webhookId, subsequenceId) are checked against the
workspace before linking. Public routes (`/t/*`, `/u/*`, push, invite accept, setup) use signed tokens, JWT or
`clientState` hashes and read no other workspace; `_fake` routes 404 in vps. Secrets: `credentialsEnc` leaves only
through the `accounts/serialize.ts` allowlist; verifier/AI configs only as `hasApiKey`; webhook secret only on
create/rotate, custom headers only as names; key hashes never selected; no 2FA secret exposed.

#### MINOR

- **m1 · An error before the request is classified as an ambiguous send.** `packages/providers/src/gmail/http.ts:48-49`,
  `graph/http.ts` (same `call()`), `packages/core/src/sender.ts:463-477`. `store.get()` throws a plain `Error`
  ("no credentials", decrypt or Prisma error, `accounts/credentials.ts:66-76`) before anything is sent; `failed()`
  treats every non-`ProviderError` as "may have gone out", so the row goes `UNCERTAIN` → `HELD` and needs an ADMIN
  release. Safe direction (no duplicate), narrow triggers (a DB error mid-send, or a disconnect in the milliseconds
  after the pre-send check, which already backs off paused/disconnected accounts at `sender.ts:228-236`). Fix: in
  `call()`, wrap the credential/refresh phase so a non-`ProviderError` becomes `TransientBeforeSendError`. (Sub-audit
  rated SIGNIFICANT; downgraded because nothing can be sent twice and the triggers are rare.)
- **m2 · Unknown non-403 4xx on reads become `PermanentSendError`.** `gmail/http.ts:117`, `graph/http.ts:~129`. CLAUDE.md
  says unknown 4xx on reads → transient. Effect is only the error type on a sync failure (reads never reach
  `recordProviderError`'s permanent branch). Fix: throw `TransientBeforeSendError` when `!o.send` (Graph: only for GET,
  the draft POST needs recipient-scoped permanents).
- **m3 · Test-send advisory lock is outside the registered namespace.** `packages/core/src/accounts/test-send.ts:45` uses
  one-argument `pg_advisory_xact_lock(hashtext('test-send:' || id))`; CLAUDE.md registers 726002 as the two-key form.
  A one-key lock shares the bigint keyspace with `SETUP_LOCK` (`apps/web/lib/setup.ts:39`); a collision is ~2^-32 and
  only serialises two requests. Fix: `pg_advisory_xact_lock(726002, hashtext(${a.id}))`.
- **m4 · Partial key rotation guidance.** `packages/core/src/rotate.ts:21-49` commits one transaction per column; if column
  N fails, columns before it are already on the new key while `.env` still has the old one. `docs/ops/KEY_ROTATION.md:20`
  says rerunning is safe but not "do not start the stack until it succeeds". Fix: one sentence in the doc (rerun with
  the same keys, or restore the pre-rotation backup the script made; do not start in between). (Sub-audit rated
  SIGNIFICANT; downgraded: the script stops web + worker, prints the new key first and backs up first.)
- **m5 · Rotation overwrites without a compare.** `rotate.ts:43` updates by id only; run against a live app (the
  "Without Compose" path relies on the operator stopping it), a refresh committed between read and write is lost and
  the account needs a reconnect. Fix: `updateMany({ where: { id, [field]: old } })` and fail on `count === 0`.
- **m6 · CLAUDE.md credential rule omits the refresh write.** `accounts/credentials.ts:157-164` writes `credentialsEnc`
  under the refresh lease (correct: it must not bump `credentialGen`). Fix: name the exception in CLAUDE.md.
- **m7 · `upgrade.sh|.ps1` do not back up themselves.** `scripts/upgrade.sh:2` only says "Back up first"; VPS.md shows
  `backup.sh && upgrade.sh`, LOCAL.md:26 only says it. Migrations are forward-only. Fix: call `backup.sh` at the top
  (as `rotate-key.sh` does).
- **m8 · OFFLINE_RECOVERY.md says there are no push notifications.** `docs/ops/OFFLINE_RECOVERY.md:56`. Gmail watch and Graph subscriptions exist since P7-T06.
  Fix: update the line.
- **m9 · PS-AUTO-03 wording.** `docs/PRODUCT_SPEC.md:342` lists "defer", "update account health", "update revenue
  analytics" as actions; they exist only as built-in behaviours (locked built-in rules in `automations/engine.ts`, e.g. `quota_defer` at :279), not user-selectable
  actions. Fix: annotate the item "built-in only".
- **m10 · VPS cron line can fail on first run.** `docs/ops/VPS.md:39` redirects into `backups/cron.log` before
  `backup.sh` creates `backups/`. Fix: `mkdir -p backups && …` in the cron line.
- **m11 · Restore has no confirmation and no failure hint.** `scripts/restore.sh:15-16` drops the database without a prompt;
  a failed `pg_restore` leaves web + worker stopped on a partial database without pointing at the `pre-restore` dump
  (which the 14-day cron `find -delete` will also eventually delete). Fix: a `--yes` flag (CI passes it), print the
  safety-dump path on failure.
- **m12 · `setVerifierSettings` / `setAiSettings` read the old config outside the write.** `leads/verify.ts:289-330`,
  `ai/settings.ts:78-96`. Two concurrent ADMIN PUTs could keep the old API key with a changed host. Needs two
  simultaneous admin requests. Fix: read under `FOR UPDATE` in the same transaction.

- **m13 · Inbox bulk actions reach suppression and lead state with `inbox:write` only.**
  `apps/web/app/api/v1/inbox/threads/bulk/route.ts:9` → `mail/inbox.ts` `bulkThreads`: `action: "blocklist"` adds
  suppressions and `set_interest` runs `bulkLeads` (suppression at -1, subsequence moves at 1..4). Both effects stop
  mail rather than send it. Fix: `requireScopes` per action (`blocklist:create`, `leads:update`).
- **m14 · Two AI routes return campaign content with `ai:write` only.** `apps/web/app/api/v1/ai/draft/route.ts:10`,
  `ai/campaign-analysis/route.ts:10`; the sibling AI routes were given the read-scope check in the Phase 7 gate (I1).
  Fix: `requireScopes(c.scopes, "campaigns:read")` (and `analytics:read` for analysis).
- **m15 · Activity CSV exports lead emails with `analytics:read` only.** `apps/web/app/api/v1/analytics/activity/route.ts:11`
  (`analytics/export.ts:46`). Fix: require `leads:read`, or drop the lead column for keys without it.
- **m16 · OAuth session poll is not bound to its creator.** `apps/web/app/api/v1/oauth/sessions/[id]/route.ts:7` →
  `oauth.ts:261` filters by workspace only and a poll of a finished session deletes it, so a second ADMIN polling the
  id would make the first admin's connect UI 404 (a GET that mutates). Single-owner today. Fix: filter by the creating
  user.

### Known limits and external blockers

- **D17 live provider verification (release blocker for real-provider sending).** Campaign, warm-up and placement
  sends through Gmail, Microsoft or SMTP stay off until `scripts/live-verify.ts` has passed for that provider with
  the user's own credentials and written a `ProviderVerification` row (`dispatch.ts:66-76`). An agent cannot do
  this. The user must follow `docs/ops/LIVE_VERIFICATION.md` (Google and Microsoft app registration per
  GOOGLE_SETUP.md / MICROSOFT_SETUP.md, then `npx tsx scripts/live-verify.ts --account <id> --to <other address>` per
  provider). Until then the product is release-ready for evaluation with the Fake provider only.
- **No local Docker.** Compose, backup/restore, rotate-key and the migration path are verified only by CI
  (`compose-smoke`); the `.ps1` scripts are syntax-checked, never run.
- Accepted by decision: IMAP IDLE (D48), antivirus hook (D50), SpamAssassin and warm-up tracking domain (D51),
  recipient timezone (D19); warm-up volume is outside usage rows but clamped to 10 % of the provider cap (D36);
  Phase 8 debt-table acceptances (env coupling in `createProvider`, DST shortcut, etc.) were looked at and none
  rises above MINOR.
- Provider acceptable-use: cold outreach via OAuth API apps may need Google/Microsoft verification
  (PRODUCT_SPEC §19 item 11). A legal/terms check is P8-T04.

### Verdict

Counts: 0 BLOCKER, 2 SIGNIFICANT (S1, S2), 16 MINOR (m1-m16).

The send pipeline's core guarantees hold under every path read: one send per row, quota reserved in the claim
transaction, the freshness gate, HELD on unknown outcomes, sticky follow-ups, no backlog burst, unsubscribe always
honoured, no fabricated engagement, AI text only after human approval, and no cross-workspace access. The two
SIGNIFICANT findings are at the edges: an ops procedure (restore of an older dump) that re-sends mail, and one API
option that bypasses the `campaigns:update` scope.

**Not release-ready yet: fix S1 and S2 (Step 2), then re-review (round 2).** After that the product is
release-ready for self-hosted use with the Fake provider and for real sending **only after the user completes D17**
(live verification per provider with real credentials, `docs/ops/LIVE_VERIFICATION.md`), which no agent can do.
MINOR items: fix the trivial ones (m3, m6, m7, m8, m9, m10, m14, m15) with the round, the rest may be accepted with
the reasons above.

## Round 2 (2026-10-24) · opus final reviewer · fixes `a78b8bd`, `d79fb20`

### Method

I read both fix commits, then the code each one depends on: `campaigns/service.ts` `move`/`FROM`, resume in
`campaigns/launch.ts`, `deliverability/health.ts` flips, `docker-compose.yml` restart policies and dependencies,
`scripts/_mode.ps1` `X`, and the Gmail/Graph/IMAP send sequences. I ran
`packages/providers/test/{gmail,graph}.test.ts` (104 passed) and `apps/web/test/{imports-api,inbox-api}.test.ts`
(15 passed) with `--maxWorkers=2`. No Postgres process was left over. CI is green on `47d6c07`. The run on `d79fb20`
was in progress at review time.

### Status of every round-1 finding

| Finding | Status | Verification |
|---|---|---|
| S1 restore re-sends | **Partly fixed, see S1-R** | The automatic duplicate is gone. Both `restore.sh` and `restore.ps1` run `migrate`, then `pause-campaigns`, then `up -d web worker`. `set -e` and `X` abort before `up` if the pause fails, so web and worker stay stopped (fail closed). Web and worker are `restart: unless-stopped`, and `docker compose stop` keeps them stopped across a daemon restart. `migrate` depends only on postgres, so neither `run` starts web or worker. `pauseActiveCampaigns` covers every workspace and both `ACTIVE` and `ACCOUNTS_UNHEALTHY`. The second matters because the health job flips that status back to `ACTIVE` on its own, while it never touches `PAUSED`. `BOUNCE_PROTECT` is left alone, which is correct: it only leaves through a manual resume. The core test covers foreign-workspace, deleted, draft and completed campaigns, the audit row, and idempotence. What remains is S1-R below |
| S2 import enroll scope | Fixed | `imports/route.ts` calls `requireScopes(campaigns:update)` when `options.campaignId` is set. The test is discriminating: a `leads:create` key gets 403 `scope_required:campaigns:update`, and with `campaigns:update` added it gets 202. Before the fix that same request returned 202 |
| m1 pre-request errors | Fixed (Gmail, Graph) | `beforeRequest()` wraps only `store.get()` and `store.refresh()`, and both run before the request they serve. A send failing this way never reached the provider: Gmail send is a single call, and Graph's send step fails before its POST, deletes the draft, and retries. Nothing after a possibly-sent request is wrapped, and a `ProviderError` (e.g. `AuthError` from the token endpoint) passes through unchanged. Both tests are discriminating (a plain `Error` used to propagate, and they assert 0 fetch calls). IMAP/SMTP `credentials()` is not wrapped: n2 |
| m2 | Accepted | Controller: the wrong error type only affects reads (sync), never a send or account health |
| m3 | Fixed | `test-send.ts` takes `pg_advisory_xact_lock(726002, hashtext(id))`, matching the registry |
| m4, m5 | Accepted | Controller: rotation runbook edge cases; the script stops web and worker, backs up first, and prints the new key first |
| m6 | Fixed | CLAUDE.md names the refresh write and `rotate.ts` as the only exceptions |
| m7 | Fixed | `upgrade.sh` and `upgrade.ps1` run the backup first and abort if it fails. VPS.md is updated |
| m8, m9 | Fixed | OFFLINE_RECOVERY.md push line; PS-AUTO-03 annotated |
| m10 | Fixed | The VPS cron line now runs `mkdir -p backups` first |
| m11 | Fixed | Prompt with `--yes`/`-Yes` (non-interactive input cancels). The safety-dump path is printed, including on a failed `pg_restore` |
| m12 | Accepted | Controller: needs two concurrent ADMIN PUTs |
| m13 | Fixed | Per-action `requireScopes` (`blocklist:create`, `leads:update`). The test is discriminating (403 with `inbox:write` alone, 200 with all three scopes) |
| m14 | Fixed | `ai/draft` requires `campaigns:read`, and `campaign-analysis` requires `campaigns:read` and `analytics:read`. Both were added to the existing `needs` table, which asserts 403 for each missing scope |
| m15 | Fixed | The activity CSV requires `leads:read`. The test is discriminating: an `analytics:read` key gets 403, and 200 once `leads:read` is added |
| m16 | Accepted | Controller: single owner today |

### New findings

#### SIGNIFICANT

**S1-R · After a restore, resuming the campaigns as the docs say still sends the duplicates.**
`scripts/restore.sh:26-27`, `scripts/restore.ps1`, `docs/ops/LOCAL.md:28`, `docs/ops/VPS.md:42,56`,
`packages/core/src/campaigns/launch.ts:209-216`.

Scenario: the owner restores the 03:00 dump at 15:00. The script prints "Active campaigns were paused: sends after
this dump would otherwise repeat. Resume them after checking the Sent folders." The owner checks Sent and then
clicks Resume. Resume only sets the status back to `ACTIVE`. It never touches `ScheduledMessage`, and nothing else
reconciles them either: the rows sent between 03:00 and 15:00 are still `SCHEDULED` with no `rfcMessageId`, and the
Sent copies that sync imports match nothing (`ingest.ts:253-259`). Every one of those leads therefore gets the
step a second time, exactly as in round 1, just later and after a human click. The wording implies that checking
Sent is enough. Avoiding the duplicate actually requires cancelling each affected row in Scheduled messages by hand,
which no doc says, and the app gives no help finding those rows (could be hundreds after a day of sending).

Suggested fix (preferred, removes the hazard): when sync ingests an outbound copy that matches no send
(`out && !own`) for a lead that has a `SCHEDULED` row on the same account whose `renderedSubject` equals the copy's
subject, settle that row as sent through the existing late-accept path (`creditSent` + `advanceLead`, as for a
HELD row). The freshness gate already guarantees this sync runs before any claim. Add a core test: restore an
older state, sync imports the Sent copy, and the claim sends nothing for that lead.

Minimum alternative (docs only): the script output, LOCAL.md and VPS.md give the exact procedure ("before
resuming, open Scheduled messages for each campaign and cancel the rows of every lead that already has a message
in the Sent folder after <dump time>"), plus the audit meta in n4. This is acceptable only if the controller judges
manual cancellation workable.

#### MINOR

- **n1 · API.md does not list the new handler-level scopes.** The route table shows only the route's own scope
  (`/imports` `leads:create`, `/inbox/threads/bulk` `inbox:write`, `/ai/draft` and `/ai/campaign-analysis`
  `ai:write`, `/analytics/activity` `analytics:read`). The "Some routes also need the scopes of the data they read or
  write" sentence (`docs/API.md:24-27`) already lists the older AI handler checks but not the five new ones.
  `x-also-scopes` is not the right carrier: it means "either scope", and these mean "this one as well", so the
  OpenAPI file should stay as it is. Impact is small, because the 403 body names the missing scope
  (`scope_required:<scope>`). Fix: extend that sentence (`campaigns:update` for an import with `campaignId`,
  `blocklist:create` / `leads:update` for bulk `blocklist` / `set_interest`, `campaigns:read` (+`analytics:read`)
  for draft/analysis, `leads:read` for the activity CSV).
- **n2 · m1 residual on IMAP/SMTP.** `packages/providers/src/imap-smtp/provider.ts:229`: a plain error from
  `this.o.credentials()` (and the `buildMime` line after it) still reaches the sender as unclassified, so the row
  goes `UNCERTAIN` and then `HELD`. This is the safe direction, and the sender pre-builds MIME (`sender.ts:303`), so
  only a DB or decrypt error mid-send triggers it. Fix: wrap both lines in `beforeRequest()`.
- **n3 · The CI restore step asserts an unconditional echo.** `.github/workflows/ci.yml` greps
  `Active campaigns were paused`, which `restore.sh` prints whether or not anything was paused. Only the step's exit
  code proves `pause-campaigns` ran. The behaviour itself is proven by the core test. Fix: grep the script's
  `paused <n> active campaign(s)` line, or query a seeded campaign's status after the restore.
- **n4 · An admin is not told why campaigns are paused.** `pauseActiveCampaigns` audits `campaign.pause` with a null
  actor and no reason, so the UI shows a system pause with no explanation. Fix: audit meta `{ reason: "restore" }`
  (and show it in the campaign's status line), which also makes the S1-R procedure findable later.

### Round 2 verdict

Counts: 1 SIGNIFICANT (S1-R), 4 MINOR (n1-n4), 0 BLOCKER. All other round-1 findings are fixed or accepted with
the controller's reasons. S2 and m13-m15 are closed and tested discriminatingly, and m1 never turns a
possibly-sent request into a transient one.

**Not release-ready yet: fix S1-R, then round 3 (the last one under the 3-round cap).** n1-n4 are trivial and
should ride along. After that, the round-1 verdict stands: ready for self-hosted use with the Fake provider, and for
real sending only after the user completes D17 live verification with real credentials.

## Round 3 (2026-10-24) · opus final reviewer · fix `794ddd4` (D53)

### Method

I read `794ddd4` and the code around it: `dispatch.ts` (claim, `campaignMessageId`), `sender.ts` (`precheck`,
`syncedCopy`, `settleFromCopy`, `acceptTx`, `recordSent`), `planner.ts` (`upsertScheduled`, `reroute`, step-1
`pickAccount`), `mail/sync.ts` (when `lastSyncCompletedAt` moves), `mail/ingest.ts` and `match.ts` (how an unmatched
outbound copy is stored), `providers/src/mime.ts` (`buildMime` and `parseRaw`), the Gmail, Graph and IMAP/SMTP `send`
and `listChangesSince`, the new tests, the restore scripts, CI and the docs. I ran no suites. CI for `794ddd4` was
still running when I wrote this.

### Status of round-2 items

| Item | Verdict | Evidence |
|---|---|---|
| S1-R (a) rows SCHEDULED in the dump, sent afterwards | **Closed** (residual R3-1) | The claim stores `campaignMessageId(cl, step, domainOf(a.email))` (`dispatch.ts:340`), and `precheck` puts exactly that in `mime.messageId` (`sender.ts:366`). Gmail sends that MIME raw, Graph posts it as the draft MIME, and IMAP/SMTP sends it and appends a copy built from the same `m`. All three syncs read the copy back as raw MIME through `parseRaw`, which keeps the bracketed id and its case (contract suite: `send preserves Message-ID`, exact string). Our id is lower-case hex plus a lower-cased domain, so no normalisation gap exists. Incremental sync covers Sent in all three providers (Gmail history `INBOX`/`SENT`, Graph delta on `sentitems`, IMAP `FOLDERS = INBOX, SENT`), and an expired cursor falls back to a FULL import of at least 30 days. `lastSyncCompletedAt` moves only on a caught-up run (`sync.ts`, `out.done`), and the restored value is the dump's, so a mailbox cannot claim until it has re-read everything since the dump. A provider that rewrote the id would fail open: a duplicate, never a skipped step. |
| S1-R (b) steps planned after the dump | **Closed** (residual R3-1) | The re-planned row has the same `(campaignLeadId, stepId)` and therefore the same id. `syncedCopy` checks the domains of every mailbox in the workspace, so a step 1 re-planned onto another mailbox still matches once the real sender has synced, and the real sender becomes sticky (`settleFromCopy`, then `recordSent` keeps `cl.accountId`). |
| n1 API.md scopes | Closed | `docs/API.md:24-30` lists all five handler-level scopes. |
| n2 IMAP credential load | Closed | `beforeRequest` wraps `credentials()` in `send` and in `withImap`, plus `buildMime`. Every one of them runs before any byte reaches SMTP. |
| n3 CI restore check | Closed | CI seeds an `ACTIVE` campaign, greps `paused 1 active campaign(s)` (printed by `scripts/pause-campaigns.ts:7`), and asserts both `status = PAUSED` and the audit `reason = restore`. |
| n4 pause reason | Closed (audit only) | `pauseActiveCampaigns` → `pauseCampaign(..., "restore")` → audit meta `{from, reason}`. The UI status line was not changed, which is acceptable because the audit log shows the reason. |

**Wrongful suppression.** I found none. A match requires a stored `direction: "OUT"` Message in the same workspace
whose id is the hash of this exact `(campaignLeadId, stepId)`:
- Manual replies, warm-up, placement and test-send all use `newMessageId` (random ids).
- A FAILED retry or a HELD release reuses the row and its id, so a copy existing then means the message did go out.
- `upsertScheduled` revives only CANCELLED rows with `uncertainAt IS NULL`.
- `CampaignLead` is `createMany(skipDuplicates)` and there is no reset-to-step feature, so a second legitimate send
  of the same pair cannot exist (the `idempotencyKey` uniqueness already forbade it).
- Workspaces are filtered by `workspaceId`.
- A forged inbound copy would need the hash, and `campaignLeadId` and `stepId` are never exposed to recipients (the
  unsubscribe link carries workspace, lead and campaign; tracking carries the row id).

**Concurrency.** The settle is clean:
- `syncedCopy` is a read outside any transaction, and a copy, once present, stays present.
- `settleFromCopy` is one DB-only transaction, conditional on `id + claimToken + SENDING`, in D21 order (row, then
  CampaignLead), and `acceptTx` re-checks the same token.
- A second settle, recovery taking over the row, or a late accept all see the token or status changed and get `LOST`.
- No other row can carry the same `(cl, step)`, so no real send of it can run at the same time.
- No network call happens inside the transaction.

**Quota (c2).** Accepted. Committing the claim's reservation is the conservative choice after a same-day restore,
and the stated limit holds: one unit too many for a copy from an earlier day, and in the re-routed case the unit,
`lastSentAt` and `lastSenderAccountId` are booked on the claiming mailbox. `lastSenderAccountId` only feeds display
and filters.

**Newly broken by 794ddd4.** Nothing found. The removed `newMessageId` import is unused in `dispatch.ts`. Pre-D53
rows keep their stored random id, and `syncedCopy` adds `m.rfcMessageId` to the set it checks.

### New findings

#### MINOR

- **R3-1 · A step 1 can still repeat when the mailbox that really sent it has not synced since the restore, and the
  restore docs do not say so.** `docs/ops/LOCAL.md:28` and `scripts/restore.sh` / `restore.ps1` (echo) say "Resume
  the campaigns when you are ready", and LOCAL.md adds "a mailbox sends only after a full sync". The code gap is in
  `planner.ts:662-705` (`reroute`), step-1 `pickAccount` in `planner.ts:584`, and `sender.ts:192` (`syncedCopy`).
  Scenario:
  1. Mailbox X sent step 1 to 50 leads after the dump.
  2. After the restore, X's credentials are the dump's, and the user had reconnected X since then, or its IMAP
     password changed. X goes `NEEDS_ATTENTION` and never syncs.
  3. The owner resumes. `reroute` moves X's restored step-1 rows to fresh mailbox Y, and the planner plans the
     unplanned ones on Y.
  4. X's Sent copies were never imported, so `syncedCopy` finds nothing and all 50 leads get step 1 a second time
     from Y.

  D53 lists this case as not covered and says "`docs/ops/LOCAL.md` says what to do then", but LOCAL.md's not-covered
  list leaves it out.

  Fix (docs only, one sentence in LOCAL.md and both restore echoes): "Resume only after every mailbox shows a sync
  completed since the restore (none in Needs attention); otherwise a step 1 it sent after the dump can go out again
  from another mailbox."

  This is MINOR because the pause holds until a human acts, and it needs both a multi-mailbox campaign and a mailbox
  that stays unsynced.

- **R3-2 · Test note, no action needed.** The D53 tests simulate the synced copy with the Message rows that
  `recordOutboundMessage` wrote, not with a provider sync through `parseRaw`. The provider round-trip of the id is
  covered by the contract suite (exact-string `send preserves Message-ID` and Sent-folder sync per provider), and for
  real providers by D17 live verification (G4, M2/M3/M10).

### Round 3 verdict

Counts: 0 BLOCKER, 0 SIGNIFICANT, 2 MINOR (R3-1 a docs sentence, R3-2 informational). S1-R and n1-n4 are closed.

**READY FOR RELEASE** (once CI for `794ddd4` is green), with these accepted residuals:
- R3-1: resume after a restore only when every mailbox has synced since. Ideally add the sentence to LOCAL.md.
- D53's other uncovered cases (copy deleted from Sent, no Sent copy kept, pre-D53 sends) stay documented in
  LOCAL.md.
- The c2 quota approximation.
- n4's UI status line.
- The round-1 condition stands: real-provider sending only after the user records D17 live verification, which also
  proves the Message-ID preservation that D53 depends on.
