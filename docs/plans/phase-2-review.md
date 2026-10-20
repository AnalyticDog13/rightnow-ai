# Phase 2 step plan: independent review

Reviewed: `docs/plans/phase-2.md` (commit 1401ab7, branch `phase-2-providers`), checked against `docs/IMPLEMENTATION_PLAN.md` (Global Constraints, Send pipeline, Reconciliation, P3-T09..T11, P4-T05/T07, P5, P7-T06), `docs/TASKS.json` P2-T01..T07, `docs/PRODUCT_SPEC.md` (PS-ACC-01..31, SYNC, SEND, SEC), `docs/PROVIDER_COMPLIANCE.md`, `docs/STACK.md`, and the Phase 1 code (`apps/web/lib/api.ts`, `apps/web/lib/setup.ts`, `apps/worker/src/boss.ts`, `packages/core/src/{crypto,env}.ts`, `scripts/rotate-key.ts`). Package metadata was checked with `npm view` on 2026-10-19.

Overall the plan is strong. Names are pinned, every behaviour has a test, Review Focus items have owning tests, and the PS-ACC allocation is complete. The gaps are in the frozen interface (incremental-sync paging, Graph ids, a few fields later phases need), in the transport security of user-supplied IMAP/SMTP hosts, and in a handful of OAuth edge cases that cause silent account loss if missed.

## Critical

### C1. Paging semantics of `listChangesSince` are undefined, so replies can be lost silently
**Location:** `types.ts` (`Changes`, `SyncCursor`); P2-T03 `listChangesSince` ("follows `nextPageToken` (`hasMore` true when limit reached)"); P2-T05 delta; the contract suite.
**Problem:** When `hasMore: true`, the returned `cursor` has to resume exactly after the last returned message. `{kind:"gmail"; historyId}` has no slot for a history `pageToken`. The obvious implementation stores the response's top-level `historyId`, which is the mailbox's current id, and that skips every remaining page forever. A skipped reply means P4 never cancels the follow-up, so the app emails someone who already replied, which breaks the product's core guarantee. The Graph cursor comment says "two @odata.deltaLink values", but a partial result must store the `@odata.nextLink`. IMAP has to advance `lastUid` only to the last returned UID. The only contract case uses one message and `limit` 200, so none of this is exercised.
**Fix:** Add to the `Changes` doc comment: "with `hasMore:true`, `cursor` resumes strictly after the last message returned; no message is skipped and none is returned twice across calls." Gmail: use `{kind:"gmail"; historyId; pageToken?}` (or the `id` of the last processed history record). Graph: the fields hold "deltaLink or nextLink". Add the contract case `listChangesSince pages without loss`: receive 5 messages, call with `limit: 2` three times, expecting 2/2/1 messages, `hasMore` true/true/false, and 5 unique `providerMessageId`s. Gmail also needs a test that a `messageAdded` id returning 404 on `messages.get` (deleted since) is skipped, not fatal.

## Important

### I1. Interface freeze: add the fields later phases need now
**Location:** `types.ts`.
- **`OutboundMime.attachments?: { filename; contentType; content: Buffer }[]`.** P4-T06 and PS-INBOX-08 send replies and forwards with attachments through the same `send()`. Note the transport limits: Graph MIME create is about 4 MB without an upload session, and Gmail `raw` JSON about 35 MB. P4 can enforce them, but the field must exist.
- **Folder visibility for P5.** P5-T04 placement and PS-WARM-08 cooperative actions need to know where a message landed. Add `locate(rfcMessageId): Promise<{ folder: "INBOX" | "SPAM" | "SENT" | "OTHER"; providerMessageId } | null>`. Gmail can do this with `rfc822msgid:` plus `in:anywhere`, Graph with `junkemail`, IMAP with the `\Junk` special-use folder. It works with the current read scopes.
- **Scope decision (the expensive part).** PS-WARM-08 "rescue from spam" and "mark read" need `gmail.modify`. Adding a Google scope later forces every connected Gmail account through reconnect. `gmail.modify` is restricted, the same class as `gmail.readonly`, so for a self-hosted single owner it costs nothing extra. Record D12 now: either request `gmail.modify` instead of `gmail.readonly`, or document Gmail spam rescue as "not provided". Microsoft `Mail.ReadWrite` already covers it.
- **`Changes.removed?: string[]`** (providerMessageIds). PS-SYNC-06 lists "manual deletions". Graph delta already returns `@removed`, and Gmail has `historyTypes=messageDeleted`. For IMAP without QRESYNC it is documented as unsupported.
- **Attachment memory.** A `listMessages` page of 100 with large attachments contradicts Review Focus 4 ("never hold the mailbox in memory"). Make `content: Buffer | null` with `truncated: true` above 25 MB (the `Attachment` cap in the data model), and say that pages are bounded by bytes as well as by count.
- **Push (P7-T06).** State explicitly that `users.watch` and Graph subscriptions live in a separate optional `PushSource` interface and are not part of the freeze, so nobody adds them to `MailProvider` later.

### I2. Graph ids change when the draft moves to Sent Items
**Location:** P2-T05 Send and Sync.
**Problem:** Without `Prefer: IdType="ImmutableId"`, a Graph message id changes when the item moves folders. The `providerMessageId` returned by `send()` (the draft id) then never matches the Sent Items copy that delta returns. That breaks P3's stored `providerMessageId`, P4's secondary dedupe, and any lookup by id. Switching later means translating ids already stored.
**Fix:** Send `Prefer: IdType="ImmutableId"` on every Graph request (a fixture-fetch assertion over all recorded calls). Add a test that after send, `findSent` returns the same `providerMessageId` as `send()`. This also gives the Message-ID fallback in I10.

### I3. Token refresh edge cases that disconnect mailboxes silently
**Location:** `OAuthClient.refresh`, `CredentialStore.refresh`, P2-T02 `credentials.test.ts`, P2-T03/T05.
- **Google omits `refresh_token` in refresh responses.** Persisting `refreshToken: undefined` kills every Gmail account at the next refresh. Rule: keep the old refresh token when the response omits one, and replace it when present (Microsoft). Add a test in T03 (refresh fixture without `refresh_token`: the stored refresh token is unchanged) and in T05 (the token is replaced).
- **Error mapping.** Token-endpoint 5xx, network failures and `temporarily_unavailable` must map to a transient error, not `AuthError`, or one Google blip moves accounts to NEEDS_ATTENTION. Only `invalid_grant` (Google and Microsoft) and `interaction_required` (Microsoft) are `AuthError`. Add a test for each.
- **Timeouts.** The refresh HTTP call runs inside the 30 s lock transaction, but the plan's request timeout is 60 s. If the token endpoint answers after Prisma aborts the transaction, a rotated Microsoft refresh token is lost. Set the token-endpoint timeout to 15 s, below the transaction's 30 s.
- **Lock key and staleness.** Use the two-key form `pg_advisory_xact_lock(<namespace const>, hashtext(accountId))` so it cannot collide with `SETUP_LOCK = 726_001` in `apps/web/lib/setup.ts`. Define "stale is no longer current" as `stored.accessToken !== stale.accessToken`.
- **Soundness.** The advisory-lock design is otherwise sound across web and worker processes. It holds one pooled connection per refreshing account, which is acceptable with these timeouts.

### I4. OAuth callback must claim the session atomically
**Location:** P2-T02 `completeOAuth`.
**Problem:** "Replaying a used state" is only tested sequentially. Two concurrent callbacks (browser retry or double load) can both pass a read-then-write check. The second code exchange fails, and that request can overwrite a `SUCCESS` session with `ERROR exchange_failed`, so the UI reports failure for an account that was created.
**Fix:** As the first step, run `UPDATE "OAuthSession" SET "consumedAt"=now WHERE "stateHash"=$1 AND "consumedAt" IS NULL AND status='PENDING' AND "expiresAt">now RETURNING *`, and treat zero rows as `state_invalid` without touching the session. Test: `Promise.all` of two `completeOAuth` calls with the same state gives one account and a session that ends `SUCCESS`. Also map the unique-index violation from two concurrent first connects of the same email to `account_exists` (test with `Promise.all`). Store `createdByUserId` on `OAuthSession` and require the same user at the callback.

### I5. Reconnect overrides user lifecycle choices
**Location:** P2-T02 reconnect test ("`status CONNECTED`, `lifecycle ACTIVE`").
**Problem:** If a user paused an account and its token then broke, reconnecting silently resumes sending. It would also clobber P5's REWARMING and INACTIVE states. The mark-fixed test already keeps a user `PAUSED` account paused, so the two rules conflict.
**Fix:** Reconnect sets `lifecycle ACTIVE` only when the current lifecycle is NEEDS_ATTENTION, or when it is PAUSED because of a disconnect (`status DISCONNECTED`). Otherwise it keeps the lifecycle. Add both cases to the test. A revive of a soft-deleted row must re-derive `provider`, `capTier` and the clamped `providerCap`/`dailyLimit`. This matters for the PS-ACC-29 path: remove a Microsoft SMTP account, then use "Connect with Microsoft".

### I6. SSRF and plaintext credentials for user-supplied IMAP/SMTP hosts
**Location:** P2-T06 `smtp-connect.ts`, `test-connection`, the provider transport options.
**Problem:** Being ADMIN-only is not enough in VPS mode. Any invited ADMIN can probe `postgres:5432`, the worker health port, the Docker host and 169.254.169.254. Diagnostics return the server `response` verbatim, which enables port scanning with banner grabbing. The worker repeats the connection on every sync, and DNS can be rebound after the form check. Separately, `secure:false` with opportunistic STARTTLS lets nodemailer and imapflow send the password in clear text when a server (or a MITM stripping STARTTLS) does not offer TLS.
**Fix:**
- Add `assertPublicHost(host)`, used by every IMAP/SMTP connect in web and worker. It resolves the host once and rejects if any address is loopback, RFC 1918, link-local (including 169.254.169.254), CGNAT 100.64/10, ULA fc00::/7, `0.0.0.0`/`::`, or IPv4-mapped forms of those. It is enforced by default in `MODE=vps` and opt-out via `ALLOW_PRIVATE_MAIL_HOSTS=1`. In `MODE=local` it is allowed by default, because Proton Bridge on 127.0.0.1 and LAN relays are legitimate.
- Connect to the checked IP and set `servername` (SNI and certificate check) to the hostname. Truncate `response` in API output to 200 characters. P7-T02 reuses the same helper.
- Set SMTP `requireTLS: true` when `secure:false`, set imapflow `doSTARTTLS: true`, and never set `rejectUnauthorized:false`. Plaintext AUTH is allowed only to loopback hosts in local mode.
- Tests: a `10.0.0.5` host is rejected in vps mode and allowed with the opt-in. A server without STARTTLS gets no AUTH sent (smtp-server with `hideSTARTTLS`).

### I7. `revoke()` is unspecified for Microsoft and IMAP, and the obvious Graph call is destructive
**Location:** P2-T05 and P2-T06.
**Problem:** Graph has no per-token revocation. The only "revoke" endpoint, `POST /me/revokeSignInSessions`, signs the user out of every app and device.
**Fix:** Graph `revoke()` makes no HTTP call and only deletes the local credentials. `MICROSOFT_SETUP.md` explains how to remove consent at myapps.microsoft.com or account.live.com/consent. IMAP `revoke()` is a no-op. Test: the Graph `revoke()` fixture records zero calls.

### I8. The Fake provider's in-memory registry cannot serve cross-process E2E
**Location:** P2-T01 `fake/registry.ts`, P2-T07 `test-send.spec.ts` ("the Fake's recorded message has the test header"), and later the P3/P4 E2E runs where the worker sends and the web app reads.
**Problem:** Playwright, `next dev` and the worker are separate processes, so an in-memory registry cannot be shared between them.
**Fix:** Persist Fake mailboxes in `FAKE_MAIL_DIR` (one JSON file per address, written atomically), or in a test-only table. Add `GET /api/v1/_fake/mailbox/[address]`, mounted only when `MAIL_PROVIDER_FAKE=1`. Also state that `getOAuthClient` returns `FakeOAuthClient` before the 412 `not_configured` check when the fake is on, or E2E #1 gets a 412.

### I9. The IMAP harness relies on things hoodiecrow will not do
**Location:** P2-T06 Spike, `imap.contract.test.ts`, `imap.test.ts`.
- **Expiring cursors.** `expireCursors()` "deletes and recreates INBOX", but RFC 3501 §6.3.4 forbids deleting INBOX, and hoodiecrow is strict by design. Either restart the server with a storage object that gives INBOX a new `uidvalidity` (or use XTOYBIRD), or run the UIDVALIDITY case on the Sent folder.
- **Command log.** The hoodiecrow README documents no command log. Assert "no `UID FETCH`" through imapflow's `logger` option on the client side.
- **Auto-filing.** hoodiecrow's own SMTP files mail into INBOX, not Sent. For `appendToSent:false`, the harness's `smtp-server` `onData` must append to Sent itself.
- **Maturity.** hoodiecrow-imap 3.x appeared after ten dormant years as six releases in two days (3.0.0 on 2026-10-06 to 3.3.1 on 2026-10-07). It is pure JS and declares `node >=20`, so Windows and Node 24 should work, but it is unproven. Keep the 30-minute spike and the `ImapClientLike` fallback. Add one CI-only Linux job that runs the IMAP contract suite against a real Dovecot or GreenMail service container, so the fallback double is not the only real-protocol coverage.

### I10. The Message-ID assumptions behind P3-T11 are not gated
**Location:** P2-T07 and the Phase gate ("not a gate for merge").
**Problem:** The whole UNCERTAIN to SENT/HELD design (P3-T11, opus) assumes Gmail and Graph keep our `Message-ID` and that `findSent` can find it. If Graph rewrites it for MIME drafts, every ambiguous Graph send ends HELD, and P4 ingests our own sends as outside-app mail.
**Fix:** Record in HANDOFF that the LIVE_VERIFICATION Message-ID checks must pass before P3-T11 starts. Make the fallback concrete: with I2's immutable ids, the Graph `findSent` falls back to `GET /me/messages/{providerMessageId}` (`parentFolderId` = sentitems). Widen the signature to `findSent(rfcMessageId, hint?: { providerMessageId?: string })`. Do not rely on "switch to JSON with `internetMessageId`" unless the live check proves Graph accepts that property on create.

### I11. A null `nextSendAt` means a new account is never claimed
**Location:** Fixed names, `EmailAccount.nextSendAt?`.
**Problem:** The master claim SQL uses `a.nextSendAt<=now`, which is never true for NULL.
**Fix:** Use `nextSendAt DateTime @default(now())` (non-null), or write `COALESCE` into the P3-T09 note now.

### I12. P2-T02 is oversized, and opus belongs there rather than on T01
**Location:** P2-T02, "Models".
**Problem:** T02 bundles the full accounts schema and migration, the Google OAuth flow, sessions, routes, the connect UI, the cross-process credential lock, `rotateColumns`, the I7 Compose rotation scripts plus a CI step, Playwright, and docs. That is the security- and concurrency-heaviest task in the phase.
**Fix:** Split it into T02a (schema, migration, `ENCRYPTED_COLUMNS`, credential store with the lock test, `rotateColumns`, I7 and the CI step) and T02b (Google OAuth flow, routes, connect UI, E2E #1, GOOGLE_SETUP). Run T02a on opus, or keep sonnet and require an opus review of `credentials.ts` and `oauth.ts`. P2-T01 does not need opus: once C1/I1 are applied, the interface is fully dictated by this plan and its implementation is mechanical. The freeze risk is settled at plan review, not at implementation.

## Minor

- **M1 (D10 wording).** Plain `fetch` is sound and keeps error classification and fixture injection simple. The stated rationale is partly wrong, though: gaxios (google-auth-library) accepts a `fetchImplementation`, and msal-node accepts a custom `INetworkModule`. Give the real reasons: msal hides refresh tokens behind its cache, which clashes with our encrypted store and cross-process lock, and the libraries' retries hide 429/5xx. Microsoft specifics to add to T05:
  - Send `scope` on refresh requests.
  - Normalize granted scopes (`https://graph.microsoft.com/Mail.Send` becomes `Mail.Send`) before `scope_missing`, and add a Microsoft `scope_missing` test.
  - Map `AADSTS65001` and the admin-approval errors to a new `errorCode` `admin_consent_required`.
  - Use the same `MS_TENANT` authority for authorize and token, including `organizations` and `consumers`.
- **M2.** Graph allows about 4 concurrent requests per mailbox (429 `MailboxConcurrency`). Cap in-flight `$value` fetches at 4, and test it the way the Gmail ≤ 8 cap is tested.
- **M3.** Graph step 1 (draft create) answering 429 should map to `RateLimitedError`, not `TransientBeforeSendError`. Add a test. Delete the orphan draft (by immutable id) when a send ends Permanent, or when recovery resolves it as HELD and not found.
- **M4.** The taxonomy has no class for 5xx or network failures on non-send calls (sync, `findSent`, diagnostics). Say they map to `TransientBeforeSendError`, or rename it `TransientError` now, before P3 and P4 import it.
- **M5.** For IMAP, `STATUS (UIDNEXT)` skips an unchanged mailbox with or without CONDSTORE, which removes the branch that Review Focus 3 worries about. Keep `highestModseq?` reserved. The suite can then run once, plus the explicit no-CONDSTORE test.
- **M6.** Contract additions:
  - `scenario.sendExternal()`: mail sent outside the app shows up as SENT with its `rfcMessageId` (PS-SYNC-04). Only own sends are tested today.
  - Drafts and spam are not reported by `listChangesSince`.
- **M7.** Expired `OAuthSession` rows keep encrypted verifiers forever. Purge rows older than one day in an existing cron (for example `accountsAutoResume`).
- **M8.** Data-model notes:
  - The master plan's `EmailAccount.espType` is missing. Either derive it from provider/capTier or add it, and say which.
  - PS-ACC-12 says `dailyLimit` is nullable, but the plan makes it non-null with default 30. Record the deviation.
  - "`minGapSec 86401` → 400" conflicts with "never rejected". Say that the rejection is a range bound and the clamp applies to provider caps.
  - Name the owner that decays `errorCount24h`.
  - When several soft-deleted rows share an email, revive the most recent.
- **M9.** A generic SMTP `AmbiguousSendError` is never followed by an APPEND, so `findSent` can never confirm it and it always ends HELD. Note this in LIVE_VERIFICATION and in the P3-T11 notes, since it is expected behaviour, not a bug.
- **M10.** The OAuth callback relies on the session cookie being `SameSite=Lax` for the top-level redirect back from Google or Microsoft. Note that it must never be tightened to Strict. The connect menu should fall back to a full-page redirect when the popup is blocked.
- **M11.** Errors raised from token-endpoint responses must not carry the response body (it contains tokens) in `cause`, because `route()` logs unhandled errors. Add one test that stringifies the error.
- **M12.** The M1 test must call the web env cache reset (`getWebEnv` caches). M4: `apps/web/e2e/global-setup.ts` imports `@rightnow/db/global-setup`, not `embedded-postgres` directly, so the removal looks safe after the grep.

## Checks requested

1. **Interface freeze.** Sufficient for P3 send and UNCERTAIN resolution once C1, I2 and I10 are applied. P4 needs C1 and `removed`; P5 needs `locate` and the scope decision; P4-T06 needs attachments; P7 push is fine as a separate interface (I1).
2. **PS-ACC coverage.** All 31 IDs are allocated. The deferrals (22 to P3-T05, the warm-up part of 11 to P5-T03, the DNS part of 24 to P5-T01, rescheduling in 27 to P3, progress in 31 to P4-T05, consumption of 16 to P3-T13) are correct and justified by models that do not exist yet. SEC-07, SEC-10, SEC-14 and SEND-14/15/18 are owned.
3. **OAuth.** State hashing, S256 PKCE, the encrypted verifier, the 10-minute TTL, workspace binding and reconnect-by-id are correct. Gaps: atomic consume (I4), refresh-token retention, transient vs auth errors and timeouts (I3), reconnect lifecycle (I5). The advisory-lock design is sound across processes.
4. **D10.** Sound (M1), with the I3 refresh rules and the Microsoft authority and scope details.
5. **hoodiecrow.** Immature 3.x with an incorrect harness assumption; keep the spike and the fallback, and add a real-server CI job (I9).
6. **SSRF.** ADMIN-only is not enough. Block private ranges by default in vps mode, with an opt-in, and require TLS (I6).
7. **Review Focus.** Items 1 to 5 have tests in their owning tasks. Add C1 paging, I6 SSRF/TLS and I10 Message-ID preservation as risks.
8. **Tasks and models.** Split T02 and put opus there; T01 stays sonnet (I12). The ordering T01 → T07 is fine.
9. **Proportion.** Detail is appropriate overall. Over-specified: the double CONDSTORE suite (M5). Under-specified: IMAP/SMTP transport security, refresh semantics and cursor paging.

VERDICT: Changes Required

---

## Round 2 (plan rev 2, commit a23b645)

Re-checked `docs/plans/phase-2.md` rev 2, D10–D15 in `docs/DECISIONS.md`, `docs/STACK.md`, `docs/PROVIDER_COMPLIANCE.md` and the P2 entries in `docs/TASKS.json` (T02a/T02b split present).

### Round 1 findings

| Finding | Status |
|---|---|
| C1 | **Resolved.** The `Changes` contract is documented, the Gmail `pageToken`, Graph nextLink and IMAP `lastUid` rules are stated, and every provider runs the contract case (2/2/1, then a new message) plus its own 3-page test. Gmail 404-on-get is skipped. |
| I1 | **Resolved.** `attachments`, `locate`, `removed`, `truncated` and the `PushSource` note are in; D12 picks `gmail.modify`. |
| I2 | **Resolved.** ImmutableId is set on every call and asserted, and the id-equality test is in. |
| I3 | **Resolved, with a better mechanism than I proposed.** The D13 lease keeps the HTTP call out of every transaction and the `pg_stat_activity` test proves it. That is stronger than my advisory-lock-plus-timeout fix. Refresh-token retention and transient-vs-auth mapping are tested. One new gap is listed as R2-I1. |
| I4 | **Resolved.** Atomic claim, `createdByUserId` and both concurrency tests are in. Two wording details are in R2-M1. |
| I5 | **Resolved.** |
| I6 | **Resolved.** The resolved IP is checked on every connect in web and worker, the connection is pinned to that IP with `servername`, and there is a rebind test (public on test-connection, 127.0.0.1 on the next connect). TLS is required before AUTH. Range gaps are in R2-M2. |
| I7 | **Resolved.** |
| I8 | **Resolved.** Test-isolation and robustness details are in R2-M3. |
| I9 | **Resolved.** The GreenMail job has setup gaps (R2-I3). |
| I10 | **Resolved.** The hint-by-id fallback is in, and HANDOFF gates P3-T11. The new `deleteDraft` export has a hazard (R2-I2). |
| I11, I12 | **Resolved.** |
| M1–M12 | **Resolved.** Keeping the `TransientBeforeSendError` name (M4) is fine on the merits: the documented meaning is clear and renaming would only churn text. |

### New Important (each is small; apply in the owning task)

**R2-I1. Credential writes outside the store do not clear the refresh lease, so an in-flight refresh can resurrect or overwrite credentials.** Location: T02a refresh algorithm step (3), T02b reconnect, T04 disconnect and soft delete.
- **Problem:** Step (3) writes when `refreshLeaseId = mine`. If a user disconnects or soft-deletes the account while a refresh is in flight, `credentialsEnc` is set to null and then step (3) writes fresh tokens back. Purged credentials return, which breaks PS-ACC-09 and PS-ACC-28. The same race lets a reconnect's new grant be overwritten by tokens from the old grant.
- **Fix:** Every `credentialsEnc` write outside the store (reconnect, disconnect, soft delete, rotation) also sets `refreshLeaseId = NULL, refreshLeaseUntil = NULL`. Step (3) additionally requires `credentialsEnc IS NOT NULL AND "deletedAt" IS NULL`.
- **Test (T02a):** `doRefresh` pending; disconnect the account; release `doRefresh`; `credentialsEnc` stays null. The same pattern for reconnect: the new credentials survive.

**R2-I2. `deleteDraft` can delete the real sent message.** Location: T05 Send ("also exported as `deleteDraft(providerMessageId)` for P3-T11 recovery when a send resolves HELD and not found").
- **Problem:** With immutable ids, the draft id is also the id of the Sent Items copy. If Graph accepted the send late, after `findSent` missed it, recovery deletes the user's sent mail.
- **Fix:** `deleteDraft` first runs `GET /me/messages/{id}?$select=isDraft,parentFolderId` and deletes only when `isDraft === true`. Otherwise it returns `"sent"`, which recovery should treat as SENT. The step-2 4xx path may keep deleting directly, because 4xx means not sent.
- **Test:** a message moved to sentitems is not deleted, and the call reports it as sent.

**R2-I3. The GreenMail gate job fails as written.** Location: T06 spike/`imap-real`, D11.
- **Problem:** `greenmail/standalone` has no TLS on its plain ports and a self-signed certificate on its TLS ports. Rev 2 forbids plaintext AUTH except to loopback in `MODE=local`, and never disables certificate checks. A container job addressing the service as `greenmail` resolves to a private IP, and in vps mode it is refused outright. GreenMail also creates no Sent or Junk folders by default, so the `sent_folder` check, `findSent` and `locate` fail.
- **Fix:** Run the job on the runner, not in a container. Connect to `127.0.0.1` on the plain ports with `MODE=local` (loopback plaintext is allowed by design), or use the TLS ports with GreenMail's certificate in `NODE_EXTRA_CA_CERTS`. Have the harness `CREATE` `Sent` and `Junk` (and `Drafts`) before the suite. Pin an exact image tag. The spike should also confirm that recreating Sent on GreenMail yields a new UIDVALIDITY.

### New Minor

- **R2-M1 (T02b claim).** The atomic `UPDATE` must include `"workspaceId"=$ws AND "createdByUserId"=$user` in its WHERE clause, so a wrong user's callback does not consume the real user's session. The plan's `expiresAt>now` in the claim yields zero rows for an expired state, but the test expects `expired`. On zero rows, look up the session by `stateHash`: if it is PENDING and past `expiresAt`, set it EXPIRED and return `expired`; otherwise return `state_invalid`.
- **R2-M2 (`assertPublicHost`).** The block list misses `fe80::/10`, `64:ff9b::/96` (NAT64), `2002::/16` (6to4, check the embedded IPv4), multicast `224.0.0.0/4` and `ff00::/8`, reserved `240.0.0.0/4`, `198.18.0.0/15` and `192.0.0.0/24`. It is simpler to accept only public unicast and reject everything else. Add these to `net.test.ts`.
- **R2-M3 (file-backed Fake).**
  - A crashed process leaves the `wx` lock behind. Break locks older than 10 s.
  - The default `FAKE_MAIL_DIR` in os tmp is shared across runs and across parallel Vitest workers. Harnesses should use `mkdtemp`, and Playwright global-setup should set a fresh dir, or a stale message from a previous run can make `test-send.spec.ts` pass falsely.
  - The `[address]` route parameter becomes a file name. Validate it with `z.email()` and encode it (for example `encodeURIComponent`) to rule out path traversal.
- **R2-M4 (paging bounds).** Gmail and Graph can only resume at page granularity, so the "~20 MB" bound must be enforced by lowering the requested page size, never by stopping inside a page. Graph needs `Prefer: odata.maxpagesize=<limit>` combined with the ImmutableId preference (one `Prefer` header with both values). Adjust the "every call has Prefer: IdType" assertion to allow both.
- **R2-M5 (lease).**
  - When the 25 s wait budget runs out, throw `TransientBeforeSendError`.
  - Optional hardening: step (3) could also accept the write when the stored ciphertext is byte-identical to the one read in step (1). That keeps a rotated Microsoft token even after a lease expiry such as a laptop sleeping mid-refresh.
- **R2-M6 (Compose local mode).** A mail bridge on the host (Proton Bridge) is reached from containers via `host.docker.internal`, which is not loopback. It therefore needs TLS with the bridge certificate. Document `NODE_EXTRA_CA_CERTS` in LOCAL.md.
- **R2-M7.** The "Models" section says T02a depends on P1-T07, but TASKS.json says P2-T01. TASKS is fine (T02a needs nothing from T01, but the order is harmless); align the plan text.

### Round 2 assessment

No Critical findings. Each of the three new Important findings is a sentence of spec plus one test, applied inside its owning task (T02a, T05, T06), so they do not need another plan round. The interface freeze is now sufficient for P3-T09..T11, P4-T05/T07, P5 placement/spam rescue and P7 push.

VERDICT: Approved
