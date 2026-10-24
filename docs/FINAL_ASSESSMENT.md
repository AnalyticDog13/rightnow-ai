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
