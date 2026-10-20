# Phase 2 — Email provider connections: step plan

> Implements P2-T01..P2-T07 of `docs/IMPLEMENTATION_PLAN.md`. Read its Global Constraints, "Send pipeline" and "Reconciliation" first.
> Rules: `docs/PROVIDER_COMPLIANCE.md`. Versions: `docs/STACK.md`. Use superpowers:test-driven-development per task.
> Branch `phase-2-providers`; commit + push after every task. Models per task: see "Models" (T02a on opus, the rest sonnet). Revision 2 (review `docs/plans/phase-2-review.md`) is mapped at the end.
> Phase 1 interfaces used as-is: `route()`, `startWorker`/`JobDef` (`{prisma, clock}`), `createPrisma`, `createTestDb`/`expectIsolated`, `getEnv`/`envSchema.extend`, `encrypt`/`decrypt`/`ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.

## Fixed names (every later phase relies on these)

| Thing | Value |
|---|---|
| Package | `@rightnow/providers` (`packages/providers`, TS source, no DB or Next dependency). `@rightnow/core` imports it; core owns everything that touches Prisma (`packages/core/src/accounts/*`, `oauth.ts`, `rotate.ts`). |
| Prisma enums | `AccountProvider GMAIL\|MICROSOFT\|SMTP`; `AccountStatus CONNECTED\|ERROR\|DISCONNECTED`; `AccountLifecycle ACTIVE\|INACTIVE\|REWARMING\|PAUSED\|NEEDS_ATTENTION`; `SyncState IDLE\|SYNCING\|FAILED`; `AutofixState NONE\|IN_PROGRESS\|FAILED\|SUCCEEDED`; `CapTier GMAIL_WORKSPACE\|GMAIL_CONSUMER\|MS365\|OUTLOOK_COM\|SMTP`; `OAuthStatus PENDING\|SUCCESS\|ERROR\|EXPIRED`; `CnameStatus UNVERIFIED\|VERIFIED\|FAILED` |
| `EmailAccount` columns | `id, workspaceId, provider, email (lowercased), fromName, firstName, lastName, replyTo?, signature?, tags String[], credentialsEnc String? (null after disconnect), status @default(CONNECTED), lifecycle @default(ACTIVE), pausedUntil?, capTier, providerCap Int, dailyLimit Int @default(30), minGapSec Int @default(0), randomGapSec Int @default(0), timezone @default("UTC"), slowRamp Boolean @default(false), rampStartVolume Int @default(2), rampIncrementPerDay Int @default(2), rampStartedAt?, historyImportDays Int @default(30), nextSendAt @default(now()) (non-null: the P3-T09 claim tests `nextSendAt <= now`), lastSentAt?, lastCampaignActivityAt?, lastError Json? {kind:"CONNECTION"\|"SENDING"\|"SOFT_BOUNCE", code, command?, response?, message}, lastErrorAt?, errorCount24h Int @default(0), autofixState @default(NONE), autofixAt?, refreshLeaseId?, refreshLeaseUntil?, syncState @default(IDLE), syncCursor Json?, lastSyncCompletedAt?, healthScore Int?, trackingDomain?, trackingDomainStatus @default(UNVERIFIED), appendToSent Boolean @default(true), createdAt, deletedAt?`. Partial unique index (raw SQL in migration): `(workspaceId, lower(email)) WHERE deletedAt IS NULL`. |
| Other tables (P2) | `OAuthSession(id = sessionId, workspaceId, createdByUserId, provider, stateHash unique, codeVerifierEnc, reconnectAccountId?, status, errorCode?, accountId?, expiresAt, consumedAt?, createdAt)` (rows older than 1 day are purged by `accountsAutoResume`); `AccountDailyUsage(accountId, day date, sent, reserved, @@id[accountId, day])`; `WorkspaceDailyUsage(workspaceId, day date, sent, reserved, @@id)`. `CampaignDailyUsage` needs `Campaign` and moves to P3-T09. |
| Encrypted columns | `ENCRYPTED_COLUMNS` gains `{EmailAccount, credentialsEnc}` and `{OAuthSession, codeVerifierEnc}` |
| `credentialsEnc` plaintext JSON | OAuth: `{kind:"oauth", accessToken, refreshToken, expiresAt (epoch ms), scope}`. SMTP: `{kind:"smtp", imap:{host,port,secure,username,password}, smtp:{host,port,secure,username,password}}`. Never returned by any API (`toApiAccount()` omits it and `syncCursor`). |
| Env (core `envSchema`, all optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (default `common`), `ALLOW_PRIVATE_MAIL_HOSTS` (`"1"` opt-in, see `assertPublicHost`), `FAKE_MAIL_DIR` (default `<os tmp>/rightnow-fake-mail`), `MAIL_PROVIDER_FAKE` (`"1"`; startup error when `MODE=vps`; when on, `getOAuthClient` returns `FakeOAuthClient` before any `not_configured` check). Redirect URIs: `${APP_URL}/api/v1/oauth/google/callback` and `.../microsoft/callback`. |
| OAuth scopes | Google (D12): `https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify` (modify replaces readonly now: spam rescue and mark-read, PS-WARM-08, would otherwise force every account to reconnect later; same restricted class, free for a self-hosted single owner). Microsoft: `offline_access User.Read Mail.Send Mail.ReadWrite`; granted scopes are normalized (`https://graph.microsoft.com/Mail.Send` becomes `Mail.Send`) before the `scope_missing` check. Both: PKCE S256, `state` = 32 random bytes base64url (only its sha256 is stored), session TTL 10 min. Google adds `access_type=offline&prompt=consent`. |
| OAuth session codes | status `pending\|success\|error\|expired` (API lowercase); `errorCode`: `account_exists, email_mismatch, state_invalid, expired, access_denied, scope_missing, no_refresh_token, exchange_failed, admin_consent_required, server_error`. Provider not configured: HTTP 412 `{error:"not_configured"}`. |
| Routes (all `route()`) | `POST /api/v1/oauth/[provider]/start` (provider `google\|microsoft`; body `{reconnectAccountId?, loginHint?}` → `{sessionId, authUrl, expiresAt}`; ADMIN); `GET /api/v1/oauth/[provider]/callback` (session auth; returns a tiny HTML page that closes the popup); `GET /api/v1/_fake/mailbox/[address]` (mounted only when `MAIL_PROVIDER_FAKE=1`, ADMIN; returns the Fake mailbox JSON); `GET /api/v1/oauth/sessions/[id]` (→ `{status, accountId?, errorCode?}`; terminal result readable once, then 404); `GET,POST /api/v1/accounts` (POST = SMTP create, ADMIN); `POST /api/v1/accounts/test-connection` (ADMIN, nothing saved); `GET,PATCH,DELETE /api/v1/accounts/[id]`; `POST /api/v1/accounts/[id]/{pause,resume,disconnect,mark-fixed,diagnostics,test-send}`; `POST /api/v1/accounts/bulk`. Scopes: `accounts:read\|create\|update\|delete`. Roles: read VIEWER; connect, test-connection, disconnect, delete, test-send ADMIN; the rest MEMBER. |
| Audit actions | `account.connect, account.reconnect, account.update, account.pause, account.resume, account.disconnect, account.delete, account.mark_fixed, account.test_send` (meta never holds secrets) |
| Cap tiers (D7) | `tierFor(provider,email)`: google/googlemail.com → `GMAIL_CONSUMER`, other Google → `GMAIL_WORKSPACE`; outlook.com/hotmail.com/live.com/msn.com → `OUTLOOK_COM`, other Microsoft → `MS365`; SMTP → `SMTP`. |

| CapTier | default `providerCap` | settable max | max `dailyLimit` = floor(providerCap / 2) | `minGapSec` floor |
|---|---|---|---|---|
| GMAIL_WORKSPACE | 1500 | 2000 | 750 | 0 |
| GMAIL_CONSUMER | 400 | 500 | 200 | 0 |
| MS365 | 5000 | 10000 | 2500 | 3 (≤25 msg/min) |
| OUTLOOK_COM | 250 | 300 | 125 | 3 |
| SMTP | 100 | 10000 (sanity) | 50 | 0 |

Values above a limit are clamped and returned in `warnings: {field, clampedTo, reason}[]`, never rejected. `dailyLimit` default 30, never above the tier max. `minGapSec` 0..86400 (PS-ACC-13: 0–1440 min; UI shows minutes).

### Provider interface (`packages/providers/src/types.ts`)

```ts
export type ProviderKind = "GMAIL" | "MICROSOFT" | "SMTP";
export type Addr = { email: string; name?: string };
export type Folder = "INBOX" | "SENT";
export type OutboundMime = {
  from: Addr; to: Addr[]; cc?: Addr[]; bcc?: Addr[]; replyTo?: Addr;
  subject: string; text?: string; html?: string;
  messageId: string;                  // "<local@domain>", ours; every provider must preserve it
  date?: Date; inReplyTo?: string; references?: string[];
  attachments?: { filename: string; contentType: string; content: Buffer }[];  // P4-T06 replies/forwards; transport limits (Graph MIME draft ~4 MB, Gmail raw ~35 MB) are enforced by P4
  headers?: Record<string, string>;   // List-Unsubscribe, List-Unsubscribe-Post, X-RightNow-Test
  threadId?: string;                  // providerThreadId of the thread; Gmail only, ignored elsewhere
};
export type SendResult = { rfcMessageId: string; providerMessageId?: string; providerThreadId?: string };
export type RemoteMessage = {
  providerMessageId: string; providerThreadId?: string; rfcMessageId: string | null; folder: Folder;
  inReplyTo: string | null; references: string[]; from: Addr; to: Addr[]; cc: Addr[]; subject: string; date: Date;
  text: string | null; html: string | null; headers: Record<string, string[]>; // names lowercased
  attachments: { filename: string; contentType: string; size: number; content: Buffer | null; truncated?: boolean }[]; // content null + truncated above 25 MB
};
export type SyncCursor =
  | { kind: "gmail"; historyId: string; pageToken?: string }           // pageToken = resume inside the same startHistoryId
  | { kind: "graph"; inbox: string; sent: string }                       // each is an @odata.deltaLink, or the @odata.nextLink while a page is pending
  | { kind: "imap"; folders: Record<Folder, { uidValidity: string; lastUid: number; uidNext: number; highestModseq?: string }> }
  | { kind: "fake"; epoch: number; seq: number };
/** With hasMore:true, `cursor` resumes strictly after the last message returned: none skipped, none returned twice across calls. Pages are bounded by count (`limit`) and ~20 MB of content. `removed` = providerMessageIds deleted since the cursor (Gmail messageDeleted, Graph @removed; IMAP: always empty, documented unsupported). Drafts and spam are never reported. */
export type Changes = { expired: true } | { expired: false; messages: RemoteMessage[]; removed: string[]; cursor: SyncCursor; hasMore: boolean };
export type Location = { folder: "INBOX" | "SPAM" | "SENT" | "OTHER"; providerMessageId: string };
export type Diagnostics = { ok: boolean; checks: { name: "token" | "scopes" | "api" | "imap_login" | "smtp_auth" | "sent_folder";
  ok: boolean; code?: string; command?: string; response?: string; message?: string }[] };

export interface MailProvider {
  readonly kind: ProviderKind;
  readonly address: string;                                   // lowercased mailbox; send() rejects any other From
  send(mime: OutboundMime, opts?: { signal?: AbortSignal }): Promise<SendResult>;
  findSent(rfcMessageId: string, hint?: { providerMessageId?: string }): Promise<RemoteMessage | null>; // hint = Graph fallback lookup by immutable id
  locate(rfcMessageId: string): Promise<Location | null>;     // where a message landed (P5 placement, spam rescue); Gmail `in:anywhere`, Graph junkemail, IMAP \Junk
  currentCursor(): Promise<SyncCursor>;                       // call BEFORE listMessages in a first sync, then listChangesSince
  listChangesSince(cursor: SyncCursor, opts?: { limit?: number }): Promise<Changes>;   // INBOX + SENT; default limit 200
  listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }): Promise<{ messages: RemoteMessage[]; nextPageToken?: string }>; // limit default 100
  diagnostics(): Promise<Diagnostics>;
  revoke(): Promise<void>;                                    // Gmail: revoke endpoint; Graph and IMAP: no remote call (Graph has no per-token revocation; revokeSignInSessions would sign the user out everywhere)
}
// Push (Gmail watch, Graph subscriptions, P7-T06) is a separate optional `PushSource` interface and is NOT part of MailProvider.
export interface CredentialStore<C> {
  get(): Promise<C>;
  /** Serialized per account across processes by a DB lease (T02a); the token HTTP call runs outside any DB transaction. "Stale is no longer current" = stored.accessToken !== stale.accessToken. */
  refresh(stale: C, doRefresh: (c: C) => Promise<C>): Promise<C>;
}
export interface OAuthClient {
  authUrl(p: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ creds: OAuthCreds; email: string; displayName?: string }>;
  refresh(creds: OAuthCreds): Promise<OAuthCreds>;            // 15 s timeout; keeps the old refreshToken when the response has none (Google); Microsoft also sends `scope`; error mapping per Errors
  revoke(creds: OAuthCreds): Promise<void>;
}
export type OAuthCreds = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };
```

Errors (`packages/providers/src/errors.ts`, all extend `ProviderError extends Error { cause?: unknown }`): `RateLimitedError(retryAfterSec: number)`, `AuthError(reason: "invalid_grant" | "unauthorized" | "scope_revoked" | "bad_credentials")`, `PermanentSendError(code: string, detail?: string)`, `TransientBeforeSendError(detail?: string)`, `AmbiguousSendError(detail?: string)`. `TransientBeforeSendError` is also what 5xx and network failures on non-send calls (sync, `findSent`, diagnostics, token endpoint) map to. Error objects never carry response bodies (they contain tokens) in `message` or `cause`. Rules: 429 (or 503/504 with Retry-After on non-send calls) → `RateLimitedError`; refresh `invalid_grant` (Google, Microsoft), `interaction_required` (Microsoft) or a 401 that survives one refresh → `AuthError`; token-endpoint 5xx, `temporarily_unavailable` and network errors → `TransientBeforeSendError`, never `AuthError`; connect refused / DNS failure / SMTP 4xx / 5xx creating a Graph draft → `TransientBeforeSendError` (429 creating the draft → `RateLimitedError`); API 5xx on the send call, timeout or reset after the request was written → `AmbiguousSendError`; other 4xx / SMTP 5xx / `from_mismatch` → `PermanentSendError`. `parseRetryAfter(header: string | null, now: Date, fallbackSec = 60): number` accepts seconds or HTTP-date, clamps to 1..3600.

Other exports: `buildMime(m: OutboundMime, opts?: { keepBcc?: boolean }): Promise<Buffer>` (nodemailer `MailComposer`), `parseRaw(raw: Buffer, meta: { providerMessageId: string; providerThreadId?: string; folder: Folder }): Promise<RemoteMessage>` (mailparser), `newMessageId(domain: string): string`, `assertPublicHost(host: string, o: { mode: "local" | "vps"; allowPrivate: boolean }): Promise<{ address: string; servername: string; loopback: boolean }>` (rejects loopback, RFC 1918, link-local incl. 169.254.169.254, CGNAT 100.64/10, ULA fc00::/7, `0.0.0.0`/`::` and IPv4-mapped forms; enforced when `mode=="vps" && !allowPrivate`; callers connect to the checked IP with `servername` = hostname; P7-T02 reuses it), `FakeProvider`, `FakeOAuthClient`, `createFixtureFetch(routes): typeof fetch & { calls: Call[] }`, `runProviderContract(harness: ProviderHarness)`. Core: `createProvider(account, deps?: { fetch?: typeof fetch; clock?: Clock }): MailProvider` (returns `FakeProvider` from a registry when `MAIL_PROVIDER_FAKE=1`), `getOAuthClient(provider)`, `accountCredentialStore(prisma, accountId): CredentialStore<OAuthCreds>`, `displayStatus(a)`, `dayKey(timezone: string, at: Date): string` (`YYYY-MM-DD` via `Intl`; P3-T07 reuses it).

## Review Focus (riskiest uncovered inputs, most likely first; each has a test in its owning task)

0. Incremental sync that pages (`hasMore`) must never skip a message: a skipped reply means a follow-up to someone who answered. Contract case `listChangesSince pages without loss` (T01), run by every provider.

1. Token refresh raced by two workers, a Google refresh response without `refresh_token`, or a token-server blip (Microsoft rotates tokens; losing one, or treating a 5xx as revocation, silently disconnects the mailbox) → P2-T02a store tests, P2-T03/T05.
2. Graph 429/503 with `Retry-After` during send and during sync → P2-T05.
3. IMAP server without CONDSTORE/MODSEQ (many shared hosts) → P2-T06 runs the whole contract suite twice, with and without the plugin.
4. A 50k-message mailbox on first sync: provider must page, resume from a token and never hold the mailbox in memory → contract case `listMessages pages and resumes` (P2-T01), exercised by T03/T05/T06 with 1,203 messages.
5. Refresh token revoked between claim and send → no blind retry and no second send request; account becomes NEEDS_ATTENTION; reconnect keeps id and history → P2-T03 and P2-T04.
6. User-supplied IMAP/SMTP host pointing at internal services, or a server offering no TLS → SSRF guard and TLS-required tests (P2-T06).
7. Gmail/Graph rewriting our `Message-ID` (P3-T11's UNCERTAIN→SENT/HELD design depends on it) → live checks in P2-T07 gate P3-T11.

## PS-ACC allocation (all 31, from `docs/PRODUCT_SPEC.md`)

T01: 05 · T02a: 07, PS-SEC-05 · T02b: 01, 02, 06, 08, 10 · T03: completes 01 (send/read) · T04: 09, 11, 12–21, 23–28, 30, 31 · T05: 03 · T06: 04, 29 · T07: none (PS-SEND-18).
Assigned to a later phase (the master map says ACC → P2; each is the part that needs a model that does not exist yet):
- **PS-ACC-22** (account → campaigns view) → P3-T05: needs `Campaign`/`CampaignAccount`. T04 only stores `tags` for PS-ACC-21; the campaign-side tag restriction is P3-T05.
- **PS-ACC-11, warm-up part** (bulk enable/disable warm-up) → P5-T03: needs `WarmupSettings`. All other bulk actions are T04.
- **PS-ACC-24, DNS part** (MX/SPF/DKIM/DMARC presence) → P5-T01 plugs into `runDiagnostics`. T04 owns token, IMAP, SMTP, API and CNAME checks.
- **PS-ACC-27, rescheduling queued jobs** → P3-T09/T10: `ScheduledMessage` does not exist. T04 guarantees `lifecycle=PAUSED` immediately; the claim SQL already excludes it.
- **PS-ACC-31, progress indicator** → P4-T05 (T04 owns the `historyImportDays` setting); **PS-ACC-16 consumption** → P3-T13 (T04 owns the fields and defaults). Status producers `SENDING`/`SOFT_BOUNCE` → P3-T11/P5-T02 (T04 owns the enum, `lastError.kind` and the display mapping).

## P2-T01 Provider interface, MIME, Fake, contract suite (+ Phase 1 cleanup)

Model: sonnet. Owns: PS-ACC-05, PS-SEND-14, PS-SEND-15 (contract), PS-SEND-09 (error taxonomy, `parseRetryAfter`), PS-SEC-10 (From guard), PS-SYNC-01/02/03/04/06 (provider side: cursor type, paging, `removed`, `{expired:true}`, outside-app sends).

Part A, cleanup first, one commit `chore(web): phase 1 cleanup M1-M4`:
- [ ] M1 `apps/web/lib/api.ts` `sameOrigin()` reads `getWebEnv().APP_URL`. Test in `api.test.ts` (calls the web env cache reset first; `getWebEnv` caches): with `APP_URL=https://app.example.com`, POST with `Origin: https://app.example.com` and session → 200; `Origin: https://evil.example` → 403.
- [ ] M2 `apps/web/lib/auth.ts` `emailAndPassword.minPasswordLength: 12`; `auth.spec.ts` uses ≥12-char passwords; add: an 11-char password on sign-up shows an error and creates no user.
- [ ] M3 remove the `kind` parameter of `requireWorkspace()` (only `(app)/layout.tsx` calls it).
- [ ] M4 remove `embedded-postgres` and `pg` from `apps/web/package.json` devDependencies after grepping `apps/web` (`e2e/global-setup.ts` imports `@rightnow/db/global-setup`, so removal should be safe; keep any that are imported, and say why). `npm install && npm test && npm run lint && npm run typecheck && npm run e2e` pass.

Part B:
Files: `packages/providers/{package.json,src/{index,types,errors,mime,retry-after,net}.ts,src/fake/{provider,store,oauth,registry}.ts,src/contract/{suite,harness,fixture-fetch}.ts,test/{mime,errors,net,fake.contract,fake.shared}.test.ts}`; `packages/core/src/env.ts` (vars above + vps guard); `.env.example`; root vitest project. D10–D15 are already recorded in `docs/DECISIONS.md` and the new dependencies in `docs/STACK.md` (nodemailer 10.1.7, mailparser 3.10.0, imapflow 2.5.8; dev: hoodiecrow-imap 3.3.1, smtp-server 3.20.2, `@types/*`).
- [ ] Test `mime.test.ts`: `buildMime` output has exactly our `Message-ID`, CRLF, `In-Reply-To`/`References`, `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` verbatim, no `Bcc:` line by default and one with `keepBcc`, `multipart/alternative` for text+html, one attachment present when `attachments` is given; `parseRaw(buildMime(x))` round-trips subject/body `"Grüße 日本語 🚀"`, a 200-char folded subject and the attachment; an attachment over 25 MB parses to `content null, truncated true`.
- [ ] Test `errors.test.ts`: `parseRetryAfter("7", now)=7`, `("Wed, 21 Oct 2026 07:28:00 GMT", 2026-10-21T07:26:00Z)=120`, `(null)=60`, `("99999")=3600`, `("0")=1`; an error built from a response whose body contains `refresh_token` never has that string in `JSON.stringify(err)`, `err.message` or `String(err.cause)`.
- [ ] Test `net.test.ts` (`assertPublicHost` with an injected resolver): vps mode rejects `127.0.0.1`, `10.0.0.5`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `fd00::1`, `::1`, `0.0.0.0`, `::ffff:10.0.0.5`, and a hostname resolving to any of them (also when only one of several addresses is private); a public address passes and returns it with `servername` = the hostname; `allowPrivate:true` passes; `mode:"local"` passes and reports `loopback:true` for `127.0.0.1`.
- [ ] Test `env.test.ts`: `MAIL_PROVIDER_FAKE=1` with `MODE=vps` throws naming the var; Google/MS vars absent is valid.
- [ ] Implement types/errors/mime/net. `FakeProvider` keeps each mailbox as one JSON file `${FAKE_MAIL_DIR}/<address>.json` (INBOX, SENT, SPAM, drafts, `epoch`, `seq`, raw sent copies), written atomically (temp file + rename) under a `wx` lock file with retry, so the web process, the worker and Playwright share state (I8). Test `fake.shared.test.ts`: two `FakeProvider` instances on one dir: `send` through A, `findSent` through B finds it; 20 concurrent sends split across both instances leave exactly 20 messages. Controls: `receiveInbound`, `receiveSpam`, `saveDraft`, `deleteMessage`, `sendExternal`, `failNext(kind)`, `expireCursors()`, `sentRaw()`; diagnostics fail when the configured host starts with `fail.`. `FakeOAuthClient.authUrl` returns `${redirectUri}?code=fake:${loginHint ?? "fake@example.test"}&state=${state}`; `exchange` derives the email from the code.
- [ ] Contract suite `runProviderContract(h: ProviderHarness)` with `ProviderHarness = { name; supports: Set<FailKind | "removed" | "locate" | "expire">; setup(): Promise<{ provider: MailProvider; scenario: Scenario; close(): Promise<void> }> }`, `Scenario = { receiveInbound(m: { from: Addr; subject: string; text: string; inReplyTo?: string }): Promise<void>; seedInbound(n: number): Promise<void>; receiveSpam(): Promise<void>; saveDraft(): Promise<void>; sendExternal(m: { subject: string; messageId: string }): Promise<void>; deleteMessage(providerMessageId: string): Promise<void>; failNext(k: FailKind): void; expireCursors(): Promise<void>; sentRaw(): Promise<Buffer[]> }`, `FailKind = "rate_limit" | "auth_revoked" | "token_5xx" | "api_5xx" | "smtp_4xx" | "smtp_5xx" | "connect_refused" | "timeout_after_write" | "permanent_rejected"`. `expireCursors()` must change the UIDVALIDITY/epoch of the SENT folder (INBOX cannot be deleted in IMAP, RFC 3501 §6.3.4); any folder's change expires the cursor. Cases (the `it()` titles; unsupported kinds are skipped; the Fake supports all):
  - `send preserves Message-ID and findSent finds it`: send `<c1@rn.test>` → `rfcMessageId === "<c1@rn.test>"`; `findSent` returns the same `rfcMessageId`, `folder "SENT"`, and the `providerMessageId` equal to the one `send()` returned when `send()` returned one; `findSent("<none@rn.test>")` is `null`.
  - `reply carries threading headers`: raw of the reply has `in-reply-to: <c1@rn.test>`, `references: <c1@rn.test>`; with a first-result `providerThreadId` passed as `threadId`, the reply returns the same `providerThreadId`.
  - `campaign headers pass through verbatim`: `List-Unsubscribe: <https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` appear in `sentRaw()[0]`.
  - `UTF-8 survives` (`"Grüße 日本語 🚀"` subject and text read back from `findSent` equal the input) and `attachments are delivered` (a 10 KB attachment in `OutboundMime` is present and byte-equal on `findSent`).
  - `rejects a foreign From`: `PermanentSendError` code `from_mismatch`, `sentRaw()` empty.
  - `error mapping`: `rate_limit` (Retry-After 7) → `RateLimitedError.retryAfterSec === 7`; `auth_revoked` → `AuthError`; `token_5xx` (token endpoint answers 503 during refresh) → `TransientBeforeSendError`, not `AuthError`; `api_5xx` and `timeout_after_write` → `AmbiguousSendError`; `smtp_4xx` and `connect_refused` → `TransientBeforeSendError`; `smtp_5xx` and `permanent_rejected` → `PermanentSendError`. `sentRaw()` is empty in every case except `api_5xx`/`timeout_after_write`.
  - `listChangesSince returns each new message once`: `currentCursor()`, `receiveInbound` ×1 → 1 message (`folder "INBOX"`, `inReplyTo` kept); next call with `changes.cursor` → 0 and `hasMore false`.
  - `listChangesSince pages without loss` (C1): `receiveInbound` ×5, then call with `limit: 2` three times chaining `cursor` → message counts 2/2/1, `hasMore` true/true/false, and 5 unique `providerMessageId`s in total; then a 6th message arrives and one more call returns exactly that message.
  - `own and outside-app sent mail appears as SENT`: after `send` and after `sendExternal({messageId:"<ext@x.test>"})`, changes contain `folder "SENT"` messages with those `rfcMessageId`s (PS-SYNC-04).
  - `drafts and spam are not reported`: after `saveDraft()` and `receiveSpam()`, `listChangesSince` returns 0 messages.
  - `deletions are reported` (needs `removed`): `deleteMessage(id)` → `changes.removed` contains `id`.
  - `locate` (needs `locate`): an inbound message → `{folder:"INBOX"}`, a spam message → `{folder:"SPAM"}`, a sent one → `{folder:"SENT"}`, unknown → `null`.
  - `expired cursor`: after `expireCursors()`, `listChangesSince(old)` equals `{expired: true}`; `currentCursor()` then yields a cursor that returns `expired:false`.
  - `listMessages pages and resumes` (Review Focus 4): `seedInbound(1203)`; `limit 100` → 13 pages, each ≤ 100 messages, 1203 unique ids; a fresh provider resumed from the page-5 `nextPageToken` returns exactly 703.
  - `diagnostics`: healthy → `ok true`; after `auth_revoked` the check named `token` (`imap_login`/`smtp_auth` for SMTP) has `ok false` and a `code`.
  - `revoke resolves` twice without throwing.
- [ ] Run `fake.contract.test.ts` (Fake against the suite, plus `fake.shared.test.ts`) → pass. `createFixtureFetch(routes)` matches `{method, url: string|RegExp, respond(req)|sequence}`, records `calls` (method, url, headers, body, order, in-flight concurrency), and throws on an unmatched request naming the URL.
- [ ] Commit `feat(providers): provider interface, MIME, file-backed fake provider, contract suite`.

## P2-T02a Schema, credential store, key rotation

Model: **opus**. Reason: the cross-process refresh lease and rotating-token loss are the phase's security and concurrency core; a mistake silently disconnects mailboxes. Owns: PS-ACC-07 (encrypted storage, never returned), PS-SEC-05 (rotation, I7).
Files: `packages/db/prisma/schema.prisma` + migration `accounts` (EmailAccount, OAuthSession, usage tables, enums, partial unique index); `packages/core/src/accounts/{credentials,serialize}.ts`; `packages/core/src/rotate.ts`; `scripts/rotate-key.ts`, `scripts/rotate-key.{sh,ps1}`, `docker/entrypoint.sh`; `docs/ops/KEY_ROTATION.md`; CI `compose-smoke`; `ENCRYPTED_COLUMNS` (see Fixed names).
Signatures: `accountCredentialStore(prisma, accountId, deps?: { clock?: Clock; sleep?: (ms: number) => Promise<void> }): CredentialStore<OAuthCreds>`; `rotateColumns(prisma, cols, oldKey: Buffer, newKey: Buffer): Promise<Record<string, number>>` (extracted from the script; one transaction per column; errors name `Model.field` and row id).
Refresh algorithm (no HTTP call inside a DB transaction): (1) short transaction with `SELECT … FOR UPDATE` on the account row: if stored `accessToken !== stale.accessToken` return the stored creds; if `refreshLeaseUntil > now` and another `refreshLeaseId` holds it, commit, wait 250 ms (injected `sleep`), re-read, loop up to 25 s; else set `refreshLeaseId = uuid, refreshLeaseUntil = now + 20 s` and commit. (2) run `doRefresh(stale)` outside any transaction (token timeout 15 s < lease 20 s). (3) `UPDATE … SET credentialsEnc = <encrypted new>, refreshLeaseId = NULL … WHERE id AND refreshLeaseId = mine`; zero rows (lease expired and someone else refreshed) → re-read and return the stored creds. On `doRefresh` throwing, release the lease the same way and rethrow.
- [ ] `credentials.test.ts` with two `createPrisma` clients on one test DB (two workers) and a controllable `doRefresh`:
  - two concurrent `refresh(stale, doRefresh)` → `doRefresh` called once, both return the same creds, DB decrypts to them (rotated refresh token included).
  - while `doRefresh` is pending, `pg_stat_activity` shows no `idle in transaction` session for the test DB (token call is outside the transaction).
  - `doRefresh` throws → creds unchanged, lease cleared, the next caller refreshes normally.
  - worker dies holding the lease: lease row set, never completed; after `clock.advance(21_000)` another caller takes the lease and refreshes once.
  - a refresh response lacking a refresh token must not erase the stored one: `refresh()` persists exactly what `doRefresh` returns (the OAuth clients guarantee retention, tested in T03/T05).
- [ ] Schema tests: partial index (same email different case in one workspace rejects; allowed after soft delete and in another workspace via `expectIsolated`); `nextSendAt` defaults to now.
- [ ] `serialize.test.ts`: `toApiAccount` JSON never contains `credentialsEnc`, `syncCursor`, `refreshLease*` or any token/password.
- [ ] `rotate.test.ts` (carried from Phase 1): seed 3 accounts under key A (one with `credentialsEnc null`) and one `OAuthSession`; A→B → decrypts with B, null stays null, result `{ "EmailAccount.credentialsEnc": 2, "OAuthSession.codeVerifierEnc": 1 }`; rerun → 0 and 0; a row under a third key → throws a message with `EmailAccount.credentialsEnc` and the row id and leaves every other row of the column unchanged.
- [ ] I7: `docker/entrypoint.sh` gains mode `rotate-key` (`cd /app && exec node --import tsx scripts/rotate-key.ts`); `scripts/rotate-key.sh|.ps1` (new key generated if omitted) runs `scripts/backup.*`, `docker compose stop web worker`, `docker compose run --rm --no-deps -e OLD_ENCRYPTION_KEY -e NEW_ENCRYPTION_KEY migrate rotate-key`, then tells the user to set `ENCRYPTION_KEY` in `.env` and start. `KEY_ROTATION.md` documents it. CI `compose-smoke` gains a step asserting exit 0 and the line `EmailAccount.credentialsEnc: re-encrypted 0` (limit: no seeded row in CI; correctness is the DB-loop test above), then restores the old key and checks `/api/readyz`.
- [ ] Commit `feat(accounts): accounts schema, credential store with refresh lease, key rotation`.

## P2-T02b Google OAuth connect

Model: sonnet, followed by a separate opus review pass of `oauth.ts` and `GoogleOAuth` (state, PKCE, atomic claim). Owns: PS-ACC-01 (connect), PS-ACC-02, PS-ACC-06, PS-ACC-08, PS-ACC-10, PS-SEC-07 (connect/reconnect audit).
Files: `packages/providers/src/gmail/oauth.ts` (`GoogleOAuth implements OAuthClient`, fetch-injected); `packages/core/src/{oauth.ts,accounts/factory.ts}`; `apps/web/app/api/v1/oauth/**`; `apps/web/app/(app)/accounts/{page.tsx,connect-menu.tsx}`; `docs/ops/GOOGLE_SETUP.md`; `apps/web/e2e/accounts-google.spec.ts`.
Signatures: `pkce(): { verifier: string; challenge: string }`; `startOAuth(prisma, clock, deps, p: { workspaceId; userId; provider: "google"|"microsoft"; reconnectAccountId?; loginHint? }): Promise<{ sessionId; authUrl; expiresAt }>`; `completeOAuth(prisma, clock, deps, p: { workspaceId; userId; state?: string; code?: string; error?: string }): Promise<{ sessionId; accountId?; errorCode? }>` (user-level failures are recorded on the session, never thrown); `pollSession(prisma, clock, workspaceId, sessionId): Promise<{ status; accountId?; errorCode? } | null>`.
Callback rules: the first step is an atomic claim, `UPDATE "OAuthSession" SET "consumedAt"=now WHERE "stateHash"=$1 AND "consumedAt" IS NULL AND status='PENDING' AND "expiresAt">now RETURNING *`; zero rows → `state_invalid` without touching any session. The same `userId` that started the session must complete it. The session cookie must stay `SameSite=Lax` (the callback is a cross-site top-level redirect; never tighten to Strict; noted in code and GOOGLE_SETUP). The connect menu falls back to a full-page redirect when the popup is blocked. Reconnect sets `lifecycle ACTIVE` only if the current lifecycle is `NEEDS_ATTENTION`, or `PAUSED` with `status DISCONNECTED`; otherwise the lifecycle is kept. Reviving a soft-deleted row (the most recent when several share the email) re-derives `provider`, `capTier`, `providerCap`, clamped `dailyLimit`, and clears `deletedAt`.
- [ ] Tests `packages/core/test/oauth.test.ts` (fixture fetch for the token and Gmail profile endpoints):
  - `pkce`: RFC 7636 vector verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`; fresh verifier length 43..128.
  - `startOAuth`: session `PENDING`, `expiresAt = now + 10 min`, `createdByUserId` set, DB holds `sha256(state)` not the state, `codeVerifierEnc` starts `v1:`; `authUrl` has `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, the two scopes of Fixed names, `redirect_uri=${APP_URL}/api/v1/oauth/google/callback`.
  - success: `provider GMAIL`, lowercased `email`, `capTier` from `tierFor`, `credentialsEnc` decrypts to JSON with the refresh token, a raw `SELECT` over the row contains neither token in plaintext; session `SUCCESS` with `accountId`; audit `account.connect`.
  - failure codes (session `ERROR`, no account): wrong state / replayed state / other workspace / other user → `state_invalid`; `+10m01s` → `expired`; `error=access_denied`; token response without `refresh_token` → `no_refresh_token`; granted scope lacking `gmail.modify` → `scope_missing`; token endpoint 400 → `exchange_failed`. `JSON.stringify` of any thrown error contains no token text.
  - concurrency (atomic claim): `Promise.all` of two `completeOAuth` with the same state → one account, session ends `SUCCESS`; `Promise.all` of two different states for the same new email → exactly one `SUCCESS`, the other `account_exists`, one row.
  - `account_exists`: connecting the same email (any case) twice without `reconnectAccountId` → second session `account_exists`.
  - reconnect (PS-ACC-08): same email → same id, new `credentialsEnc`, `status CONNECTED`, `lastError null`, `errorCount24h 0`, `tags`/`dailyLimit`/`syncCursor` unchanged, audit `account.reconnect`; lifecycle `NEEDS_ATTENTION` → `ACTIVE`; user-`PAUSED` (status CONNECTED) stays `PAUSED`; `PAUSED`+`DISCONNECTED` → `ACTIVE`; different email → `email_mismatch`, account untouched. Revive: a soft-deleted Microsoft SMTP row reconnected via Google ends with `provider GMAIL` and the Gmail `capTier`; with two soft-deleted rows the newest is revived.
  - `pollSession`: pending → `{status:"pending"}`; success returned once then `null` (route: 404); past `expiresAt` → `{status:"expired"}`; other workspace → `null`.
- [ ] Route tests via `route()`: MEMBER → 403 on start; `GOOGLE_CLIENT_ID` unset → 412 `not_configured` (but with `MAIL_PROVIDER_FAKE=1` → 200 using `FakeOAuthClient`); VIEWER may poll; cross-origin POST blocked.
- [ ] Playwright `accounts-google.spec.ts` (E2E #1, `MAIL_PROVIDER_FAKE=1`): "Connect Google" opens a popup that lands on the callback and closes; the list shows `fake@example.test` as Google within 10 s; connecting again shows the `account_exists` message and one row remains; with the popup blocked the full-page fallback also connects.
- [ ] `GOOGLE_SETUP.md` (verify with `grep`): project, Gmail API, consent screen set to **In production** (Testing mode expires refresh tokens after 7 days; the unverified warning is expected for one owner), the two scopes verbatim and why `gmail.modify` (D12), redirect URI, env vars, free Gmail vs Workspace limits (400 vs 1,500), `invalid_grant` troubleshooting.
- [ ] Commit `feat(accounts): Google OAuth connect with OAuth sessions`.

## P2-T03 Gmail provider

Model: sonnet. Owns: completes PS-ACC-01 (send/read), PS-SEND-15 (Gmail), PS-SYNC-01/02 (Gmail).
Files: `packages/providers/src/gmail/{provider,http}.ts`, `packages/providers/src/gmail/fixtures/*.json`, `packages/providers/test/gmail.contract.test.ts`, `gmail.test.ts`; `packages/core/src/accounts/factory.ts` (GMAIL branch).
Signature: `new GmailProvider({ address, store: CredentialStore<OAuthCreds>, oauth: OAuthClient, fetch?: typeof fetch, clock?: Clock })`. Fixtures are hand-written from the official API shapes; P2-T07 checks them against real Gmail.
Authed requests: refresh first when `expiresAt < now + 60 s`; a 401 refreshes once through `store.refresh` and retries once (safe: 401 means not processed); API timeout 60 s, token endpoint 15 s; fetch rejection with `cause.code` in `ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT` → `TransientBeforeSendError`, any other rejection on send → `AmbiguousSendError`. `GoogleOAuth.refresh` keeps the old refresh token when the response has none; `invalid_grant` → `AuthError`; token-endpoint 5xx / `temporarily_unavailable` / network error → `TransientBeforeSendError`.
- [ ] `gmail.contract.test.ts`: `runProviderContract` with a Gmail harness on `createFixtureFetch` (stateful in-memory mailbox behind the routes; supports every kind except `smtp_*`; `removed` and `locate` supported).
- [ ] `gmail.test.ts`:
  - send is `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with Bearer auth and JSON `{raw, threadId?}`; the decoded `raw` contains our `Message-ID`, the `Bcc` header and any attachment; `threadId: "t-1"` in → `body.threadId === "t-1"`.
  - `findSent`: `users.messages.list` with `q = "rfc822msgid:c1@rn.test in:sent"` (angle brackets stripped), then `messages.get?format=raw`. `locate`: `q = "rfc822msgid:… in:anywhere"`, folder from `labelIds` (`SPAM`, `INBOX`, `SENT`, else `OTHER`).
  - paging (C1): `history.list?startHistoryId=H&historyTypes=messageAdded&historyTypes=messageDeleted&maxResults=limit`; when the response has `nextPageToken` the returned cursor is `{historyId: H, pageToken}` with `hasMore true`; on the last page the cursor is `{historyId: <response historyId>}`; a 3-page fixture with `limit 2` returns each message once. Keeps only messages labelled INBOX or SENT; `messageDeleted` ids go to `removed`; a `messageAdded` id whose `messages.get` is 404 is skipped, not fatal; history 404 → `{expired:true}`; `currentCursor` reads `users.getProfile` `historyId`.
  - `listMessages`: `q=after:<epoch>` plus `labelIds`, `maxResults=limit`, bodies fetched with ≤ 8 requests in flight (fixture records max concurrency).
  - send errors: 403 `rateLimitExceeded`/`userRateLimitExceeded` → `RateLimitedError(60)` or the `Retry-After`; `dailyLimitExceeded` → `RateLimitedError(3600)`; 403 `insufficientPermissions` → `AuthError("scope_revoked")`; 400 `invalidArgument` → `PermanentSendError`.
  - refresh: expired access token → token endpoint called once and the store holds the new token; a refresh response without `refresh_token` leaves the stored refresh token unchanged; token endpoint 503 → `TransientBeforeSendError` and the account creds untouched; `invalid_grant` → `AuthError`; two providers sharing one real `accountCredentialStore` sending concurrently call the token endpoint once (Review Focus 1); no thrown error contains token text.
  - Review Focus 5, revoked mid-send: (a) token expired, refresh returns `400 invalid_grant` → `AuthError("invalid_grant")` and the send route was called 0 times; (b) send returns 401, refresh returns `invalid_grant` → `AuthError`, send route called exactly once (never re-posted).
  - `revoke` posts `https://oauth2.googleapis.com/revoke`; a 400 `invalid_token` resolves.
- [ ] Commit `feat(providers): Gmail provider with contract suite on fixtures`.

## P2-T04 Account service, API and UI

Model: sonnet (large; commit per layer: service, API, UI). Owns: PS-ACC-09, 11 (without warm-up), 12, 13, 14, 15, 16 (fields), 17, 18, 19, 20, 21 (tags), 23, 24 (without DNS), 25, 26, 27 (without rescheduling), 28, 30, 31 (setting), PS-SEC-07 (account actions), PS-SEC-14.
Files: `packages/core/src/accounts/{service,caps,status,health,diagnostics,tracking-domain,daykey}.ts`; `apps/worker/src/jobs/{accounts-auto-resume,accounts-autofix}.ts` (+ `jobs/index.ts`); `apps/web/app/api/v1/accounts/**`; `apps/web/app/(app)/accounts/{page.tsx,accounts-table.tsx,account-drawer.tsx,bulk-bar.tsx}`; `apps/web/e2e/accounts.spec.ts`; `docs/ops/LOCAL.md` (limits section).
Notes: `dailyLimit` is non-null (default 30) where PS-ACC-12 says nullable: deliberate, the claim needs a number. `espType` is derived from `provider`/`capTier`, not stored. `errorCount24h` is only incremented here; its 24 h decay belongs to P5-T02. Range bounds (`minGapSec` 0..86400) reject with 400; provider-cap limits clamp with a warning.
Signatures (all take `prisma` first, then `workspaceId`): `listAccounts(…, q: { status?; provider?; tag?; includeDeleted?; cursor?; take? })`; `updateAccount(…, id, patch): Promise<{ account; warnings }>` (zod `.strict()` patch: `fromName, firstName, lastName, replyTo, signature, tags, dailyLimit, minGapSec, randomGapSec, timezone, slowRamp, rampStartVolume, rampIncrementPerDay, historyImportDays, providerCap, appendToSent, trackingDomain, skipCnameCheck`); `pauseAccount(…, id, until?)`; `resumeAccount`; `disconnectAccount(…, id, deps)`; `softDeleteAccount`; `bulkApply(…, { ids (≤200), action: "pause"|"resume"|"set_daily_limit"|"set_gap"|"set_signature"|"add_tags"|"remove_tags"|"delete", value? }): Promise<{ id; ok; error? }[]>`; `runDiagnostics(…, id, deps): Promise<Diagnostics & { dns: null }>`; `markFixed`; `recordProviderError(prisma, clock, accountId, err: unknown)`; `verifyCname(domain: string, expectedTarget: string, resolveCname = dns.promises.resolveCname): Promise<CnameStatus>`; `displayStatus(a)` (nine values: `ACTIVE|PAUSED|TEMP_PAUSED|CONNECTION_ERROR|SOFT_BOUNCE_ERROR|SENDING_ERROR|REWARMING|INACTIVE|NEEDS_ATTENTION`); `toApiAccount(a, usageToday)` adds `sentToday, reservedToday, remainingToday = max(0, dailyLimit − sent − reserved)` using `dayKey(account.timezone, now)`; API `response` strings in diagnostics are truncated to 200 characters.
- [ ] Tests (core, `createTestDb`, fixed clock; every service call also checked against a foreign `workspaceId` → not found, PS-SEC-14):
  - caps: per tier row of the Fixed names table `updateAccount({dailyLimit: 99999})` stores the tier max (750, 200, 2500, 125, 50) with `warnings[0] = {field:"dailyLimit", clampedTo, reason:"provider_cap"}`; `providerCap: 99999` on GMAIL_WORKSPACE stores 2000; a new account's `dailyLimit` is 30 on every tier; `minGapSec 86400` ok, `86401` → 400; MS365 `minGapSec: 0` stored 3 with a warning.
  - `displayStatus` table: every row of PS-ACC-14 (CONNECTED+ACTIVE→ACTIVE; PAUSED with future `pausedUntil` → TEMP_PAUSED, else PAUSED; `lastError.kind` CONNECTION/SOFT_BOUNCE/SENDING → the three error values; REWARMING; INACTIVE; NEEDS_ATTENTION).
  - `toApiAccount`: usage rows `sent 4, reserved 1` with `dailyLimit 30` → `remainingToday 25`; the day key follows the account timezone (`Pacific/Auckland` at 2026-03-01T12:00Z uses 2026-03-02).
  - `recordProviderError(AuthError)` (Review Focus 5): `status ERROR`, `lifecycle NEEDS_ATTENTION`, `lastError {kind:"CONNECTION", code:"invalid_grant"}`, `errorCount24h` +1; a `TransientBeforeSendError` or `RateLimitedError` changes nothing. `resumeAccount` on such an account → 409 "reconnect or mark as fixed first"; the T02b reconnect restores `CONNECTED/ACTIVE` with the same id.
  - pause/resume: `pauseAccount` sets `lifecycle PAUSED` immediately; with `until` sets `pausedUntil`; `accountsAutoResume(prisma, clock)` resumes only once `clock >= until`; a manual pause (no `until`) is never auto-resumed; the same job deletes `OAuthSession` rows older than one day and keeps newer ones.
  - disconnect (PS-ACC-09): `revoke` called once, `credentialsEnc null`, `status DISCONNECTED`, `lifecycle PAUSED`, row and `syncCursor` kept; T02b reconnect with `reconnectAccountId` restores it. `softDeleteAccount`: `deletedAt` set, creds purged, hidden unless `includeDeleted`, usage rows kept.
  - mark-as-fixed: 409 with the diagnostics body while the `token` check fails; passing → `CONNECTED/ACTIVE`, `lastError null`; a user-`PAUSED` account stays `PAUSED`.
  - `accountsAutofix(prisma, clock, providerFor)`: `ERROR` + non-auth `CONNECTION` error + healthy diagnostics → `CONNECTED`, `autofixState SUCCEEDED`; failing → `FAILED`; not retried within 15 min; auth errors never autofixed.
  - `verifyCname("track.acme.test", "app.example.com", resolver)`: `["app.example.com."]` → `VERIFIED`; other target or ENOTFOUND → `FAILED`; `skipCnameCheck: true` as MEMBER → 403, as ADMIN stores `VERIFIED` and writes an audit row.
  - `bulkApply`: foreign id → `{ok:false, error:"not_found"}` and unchanged; 201 ids → 400; `set_signature` and `add_tags` apply to all owned ids; `delete` soft-deletes; one audit row per account per action.
  - `runDiagnostics` returns the provider's checks plus `dns: null`; `lastError` is stored as `{code, command, response, message}` (PS-ACC-15).
- [ ] Route tests: an `accounts:read` key can GET, not PATCH → 403; VIEWER PATCH → 403; unknown body property → 400; another workspace's `GET /accounts/[id]` → 404.
- [ ] Playwright `accounts.spec.ts` (seed 3 accounts through `@rightnow/db`): table shows email, provider, status badge, `4 / 30 / 26`-style sent/limit/remaining, tags; select two rows → bulk Pause → both "Paused"; drawer: signature edit, and limit 999 on an Outlook.com account saves 125 with the warning text visible; rows selectable with Space, drawer closes on Escape, table has an accessible name.
- [ ] Commit `feat(accounts): service, API, UI, status, bulk actions, diagnostics`.

## P2-T05 Microsoft Graph connect + provider

Model: sonnet. Owns: PS-ACC-03.
Files: `packages/providers/src/graph/{oauth,provider}.ts` + `fixtures/*.json`, tests `graph.contract.test.ts`, `graph.test.ts`; factory MICROSOFT branch; `docs/ops/MICROSOFT_SETUP.md`.
`MicrosoftOAuth`: authorize and token both on `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/` (`common`, `organizations`, `consumers` or a tenant id); refresh requests send `scope`; every token response carries a new refresh token that replaces the old one via `store.refresh`; `AADSTS65001` and admin-approval errors → `admin_consent_required`; `interaction_required` and `invalid_grant` → `AuthError`; 5xx/network → `TransientBeforeSendError`. Email = `mail ?? userPrincipalName` from `GET https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName`.
Every Graph request carries `Prefer: IdType="ImmutableId"` so ids survive the move from Drafts to Sent Items.
Send: (1) `POST /me/messages` with `Content-Type: text/plain`, body = base64 of `buildMime(m,{keepBcc:true})` → draft `id`, `conversationId`; (2) `POST /me/messages/{id}/send` → 202. Result `{ rfcMessageId: mime.messageId, providerMessageId: id, providerThreadId: conversationId }`. Step 1: 429 → `RateLimitedError`, 401/403 → `AuthError`, 400 → `PermanentSendError`, 5xx/network → `TransientBeforeSendError`. Step 2: 429 → `RateLimitedError`, 5xx/timeout → `AmbiguousSendError`, other 4xx → `PermanentSendError` plus best-effort `DELETE /me/messages/{id}` of the orphan draft (also exported as `deleteDraft(providerMessageId)` for P3-T11 recovery when a send resolves HELD and not found).
Sync: `GET /me/mailFolders/{inbox|sentitems}/messages/delta?$select=id`; new ids fetched as `GET /me/messages/{id}/$value` (≤ 4 in flight, Graph allows about 4 concurrent requests per mailbox) and parsed with `parseRaw`; `@removed` ids go to `removed`; a page that has an `@odata.nextLink` is returned with that link stored in the cursor field and `hasMore true`, the final page stores the `@odata.deltaLink`; HTTP 410 → `{expired:true}`. `currentCursor()`: delta with `$filter=receivedDateTime ge <now − 5 min>`, following pages to the final deltaLink (duplicates are removed by P4 ingest). `findSent(rfc, hint)`: `GET /me/mailFolders/sentitems/messages?$filter=internetMessageId eq '<…>'`; when that finds nothing and `hint.providerMessageId` is given, `GET /me/messages/{hint.providerMessageId}` and accept it only if `parentFolderId` is the sent folder (fallback if Graph rewrote the Message-ID). `locate` also queries `junkemail`. `listMessages` = `$filter=receivedDateTime ge <since>` with `@odata.nextLink` as page token. `revoke()` makes no HTTP call (Graph has no per-token revocation; `revokeSignInSessions` would sign the user out everywhere); it only returns, and T04 deletes the local credentials.
- [ ] `graph.contract.test.ts`: contract suite on a Graph fixture harness (supports `rate_limit`, `auth_revoked`, `token_5xx`, `api_5xx`, `connect_refused`, `timeout_after_write`, `permanent_rejected`, `removed`, `locate`).
- [ ] `graph.test.ts`: every recorded call has `Prefer: IdType="ImmutableId"`; after send, `findSent` returns the same `providerMessageId` as `send()`; draft create precedes send with matching ids; draft creation 5xx → `TransientBeforeSendError` with the send route never called; draft creation 429 → `RateLimitedError`; send 5xx → `AmbiguousSendError`; send 400 → `PermanentSendError` and the draft is deleted; hint fallback finds the message when `internetMessageId` was rewritten; `revoke()` records zero calls; `$value` fetch concurrency ≤ 4; 3-page delta with `limit 2` returns each message once and stores the nextLink between pages.
- [ ] Review Focus 2: send answered `429` with `Retry-After: 120` → `RateLimitedError.retryAfterSec === 120`; `delta` answered `503` + `Retry-After: 30` → `RateLimitedError(30)`; 429 without the header → 60.
- [ ] Review Focus 1: two concurrent calls with an expired token through a shared real store → token endpoint called once and the stored refresh token is the one from that single response; token endpoint 503 → `TransientBeforeSendError`; `interaction_required` → `AuthError`; granted scope `https://graph.microsoft.com/Mail.Send` + `Mail.ReadWrite` passes while a grant lacking `Mail.ReadWrite` → `scope_missing`; `AADSTS65001` → `admin_consent_required`.
- [ ] `tierFor("MICROSOFT","a@outlook.com") === "OUTLOOK_COM"`; `POST /api/v1/oauth/microsoft/start` returns an `authUrl` on `login.microsoftonline.com/common` with the four scopes; `MS_TENANT=organizations` changes the authority for both authorize and token.
- [ ] `MICROSOFT_SETUP.md`: Entra registration for "any organizational directory and personal accounts", Web redirect URI, secret, delegated permissions `Mail.Send Mail.ReadWrite offline_access User.Read`, admin-consent note, `MS_TENANT` values, how to remove consent (myapps.microsoft.com, account.live.com/consent) because disconnect only deletes local tokens, and the "SMTP AUTH disabled" note pointing to this route.
- [ ] Commit `feat(providers): Microsoft Graph connect and provider`.

## P2-T06 IMAP/SMTP provider + connect form

Model: sonnet. Owns: PS-ACC-04, PS-ACC-29, PS-SEND-15 (SMTP), PS-SYNC-01/02 (IMAP).
Files: `packages/providers/src/imap-smtp/{provider,folders,hints}.ts`, tests `imap.contract.test.ts`, `imap.test.ts`, `imap.real.test.ts`, `harness.ts`; `packages/core/src/accounts/{smtp-connect.ts,factory.ts}`; `apps/web/app/api/v1/accounts/{route.ts,test-connection/route.ts}`; `apps/web/app/(app)/accounts/connect-smtp.tsx`; `apps/web/e2e/accounts-smtp.spec.ts`; CI job `imap-real`.
Design: one IMAP connection per operation (connect, work, logout). Every connect, in web and worker, first calls `assertPublicHost` (mode and `ALLOW_PRIVATE_MAIL_HOSTS` from env, so a DNS rebind after the form check is caught) and connects to the returned IP with `servername` = hostname; certificate verification is never disabled. TLS is required before any login: `secure:true`, or `secure:false` with nodemailer `requireTLS: true` and imapflow `doSTARTTLS: true`; a server that does not offer STARTTLS gets no AUTH. Plaintext is accepted only when the checked address is loopback and `MODE=local` (Proton Bridge style). Diagnostic `response` text is truncated to 200 characters in API output.
Send: nodemailer `sendMail({ raw: buildMime(m), envelope })` (our `Message-ID` untouched); then, if `appendToSent`, IMAP `APPEND` of `buildMime(m,{keepBcc:true})` to Sent with `\Seen`; an APPEND failure after SMTP success is logged and does not fail the send. `appendToSent` defaults false for `smtp.gmail.com` and `smtp.office365.com`, else true. An ambiguous SMTP outcome with `appendToSent` can never be confirmed by `findSent` and ends HELD in P3-T11: expected behaviour, documented in LIVE_VERIFICATION. Sent folder: special-use `\Sent`, else first of `Sent, Sent Items, Sent Mail, INBOX.Sent`, else the `sent_folder` check fails. Cursor per folder `{uidValidity, lastUid, uidNext, highestModseq?}`: UIDVALIDITY change → `{expired:true}`; `STATUS (UIDNEXT)` equal to the stored `uidNext` skips the fetch with or without CONDSTORE; otherwise fetch UIDs `> lastUid`, `lastUid` advancing only to the last UID returned (paging per C1); `highestModseq` is stored when advertised but not required. `removed` is always empty. `locate` uses the `\Junk` folder. SMTP mapping: `EAUTH`/535 → `AuthError("bad_credentials")`, 4xx/connect errors → `TransientBeforeSendError`, 5xx → `PermanentSendError`, socket closed after DATA without reply → `AmbiguousSendError`. `revoke()` is a no-op. `msSmtpHint(host, response): string | null` returns `MS_SMTP_DISABLED_HINT` = `"Microsoft has SMTP AUTH disabled for this mailbox. Enable Authenticated SMTP for the mailbox or use Connect with Microsoft, remove the account, wait about an hour, then reconnect."` when host ends with `office365.com` or `outlook.com` and the response contains `5.7.139` or `SmtpClientAuthentication`.
- [ ] Spike first (cap 30 min; hoodiecrow-imap 3.x is six releases from two days in 2026-10, unproven): start `hoodiecrow-imap` (plugins UIDPLUS, SPECIAL-USE; CONDSTORE toggled) and `smtp-server` on random ports under Node 24 on Windows and Linux. If it fails, record in DECISIONS and use an `ImapClientLike` fixture double for the same cases. Either way CI job `imap-real` (Linux only) runs `imap.real.test.ts`, which executes `runProviderContract` against a real `greenmail/standalone` service container (IMAP+SMTP, no CONDSTORE) via `IMAP_TEST_URL`, with failure-injection kinds unsupported; this is required for the phase gate, so real-protocol coverage never rests on the double.
- [ ] `imap.contract.test.ts`: `runProviderContract` once against the in-process servers with CONDSTORE off (worst case). Harness: SMTP `onData` stores raw and, when `appendToSent` is false, appends to Sent itself via imapflow (hoodiecrow files incoming mail into INBOX only); `onRcptTo` returns 450/550, `onAuth` 535, `onData` destroys the socket for `timeout_after_write`; inbound via imapflow `append`; `expireCursors()` deletes and recreates the Sent folder (new UIDVALIDITY). Skip `api_5xx`, `rate_limit`, `token_5xx`, `removed`.
- [ ] `imap.test.ts` (Review Focus 3, 6): with CONDSTORE on, the stored cursor has `highestModseq`, new mail is still found, and an unchanged mailbox causes no `UID FETCH` (asserted with imapflow's `logger` option on the client); with CONDSTORE off the same assertions hold with no `highestModseq`; a flag-only change (`\Seen`) returns zero messages. `appendToSent:false` → no APPEND issued and `findSent` finds the harness-filed copy; APPEND failure after SMTP success → `send` resolves; Sent discovery by special-use and by the `Sent Items` name; wrong IMAP password → check `imap_login` `ok false`; `msSmtpHint("smtp.office365.com","535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled")` equals the constant, the same text with `smtp.example.com` → `null`; a message without `Message-ID` has `rfcMessageId null`; paging with `limit 2` over 5 messages loses nothing and `lastUid` only advances to the last returned UID.
- [ ] Transport security tests: in vps mode a `10.0.0.5` host is rejected before any socket is opened and accepted with `ALLOW_PRIVATE_MAIL_HOSTS=1`; a hostname that resolves to a public address on `test-connection` and to `127.0.0.1` on the next connect is rejected on the second (re-check at connect); `smtp-server` with `hideSTARTTLS` and `secure:false` receives no AUTH command (`requireTLS` fails the send with `TransientBeforeSendError` or diagnostics `ok false`); `rejectUnauthorized` is never false (assert the options object); diagnostics `response` longer than 200 characters is truncated.
- [ ] Core `smtp-connect.ts`: `connectSmtpAccount(prisma, clock, deps, workspaceId, actorId, input)` with the twelve PS-ACC-04 inputs (`email, firstName, lastName, imap{host,port,secure,username,password}, smtp{host,port,secure,username,password}`, optional `providerCap`) runs `diagnostics()` first; failure → 422 with the checks, nothing saved; duplicate → `account_exists`; encrypted; audit `account.connect`. `POST /accounts/test-connection` runs the same checks without saving. Tests: success saves one row (`capTier SMTP`, `providerCap 100`, password only inside `credentialsEnc`); host `fail.example.test` (Fake) → 422, zero rows; duplicate → `account_exists`; MEMBER → 403.
- [ ] Playwright `accounts-smtp.spec.ts`: validation messages; "Save" disabled until "Test connection" passes; failing host shows the failed check names; after save the row appears and the page HTML never contains the password.
- [ ] Commit `feat(providers): IMAP/SMTP provider, SSRF guard, connect form`.

## P2-T07 Test-send + live verification

Model: sonnet. Owns: PS-SEND-18.
Files: `packages/core/src/accounts/{test-send,live-verify}.ts`; `apps/web/app/api/v1/accounts/[id]/test-send/route.ts`; `apps/web/app/api/v1/_fake/mailbox/[address]/route.ts`; test-send dialog in `account-drawer.tsx`; `scripts/live-verify.ts`; `docs/ops/LIVE_VERIFICATION.md`; `apps/web/e2e/test-send.spec.ts`; `docs/HANDOFF.md`.
Signatures: `sendTestEmail(prisma, clock, deps, p: { workspaceId; actorId; accountId; to: string; confirmAuthorized: boolean }): Promise<{ rfcMessageId; providerMessageId? }>`; `liveVerify(provider: MailProvider, to: string, clock: Clock): Promise<{ step: string; ok: boolean; detail?: string }[]>` with steps `diagnostics, send, findSent, locate, cursor, changes` (waits up to 60 s for the sent copy in `listChangesSince`).
- [ ] Tests (core): `confirmAuthorized:false` → 400, nothing sent; success: the Fake's recorded raw has `X-RightNow-Test: 1`, `From` = account name and address, `Reply-To`, signature appended, fresh `Message-ID`; no usage row created or changed; audit `account.test_send` holds only the recipient domain; 6th send within 10 minutes for one account → 429 (counted from audit rows, fixed clock); `AuthError` → `recordProviderError` applied and 409 `needs_attention`; `AmbiguousSendError` → 502 `{error:"outcome_unknown", rfcMessageId}`, no retry; `RateLimitedError(30)` → 429 with `retryAfterSec 30`; MEMBER → 403; foreign account → 404; `/_fake/mailbox/[address]` returns 404 when `MAIL_PROVIDER_FAKE` is unset.
- [ ] `live-verify.test.ts`: against the Fake every step is `ok`; with `failNext("auth_revoked")` the `send` step is `ok:false` and later steps are skipped.
- [ ] Playwright `test-send.spec.ts` (E2E #2): send disabled until the authorization checkbox is ticked; success toast; the web process (via `/_fake/mailbox/<address>`) shows a message with the test header although the send ran in the same server process or the worker (cross-process Fake).
- [ ] `LIVE_VERIFICATION.md`: per provider prerequisites; the command `npx tsx scripts/live-verify.ts --account <id> --to <your address>` (Compose variant via `docker compose run --rm … migrate`); expected `PASS` lines; manual checks: Message-ID identical in the received message's original headers (Gmail and Graph), List-Unsubscribe visible, reply threads in the recipient client, revoked token turns the account NEEDS_ATTENTION, Google "Testing" 7-day expiry, and that a generic-SMTP ambiguous send always ends HELD (no APPEND happened) as expected. Fixtures are re-checked against real responses and corrected here.
- [ ] `docs/HANDOFF.md` records: the Message-ID checks (Gmail preserves it; Graph preserves it for MIME drafts, or the hint-by-id fallback is confirmed) must pass before P3-T11 starts. They need the user's credentials, so they gate P3-T11, not the Phase 2 merge.
- [ ] Commit `feat(accounts): test-send and live verification guide`.

## Models
- P2-T01 sonnet: once this plan pins the interface, implementation is mechanical; the freeze risk is settled at plan review.
- P2-T02a **opus**: cross-process refresh lease, token-loss and key-rotation correctness.
- P2-T02b sonnet, then an opus review of `oauth.ts` and `GoogleOAuth`.
- P2-T03, T04, T05, T06, T07 sonnet.
`docs/TASKS.json` needs P2-T02 replaced by P2-T02a (deps P1-T07, model opus) and P2-T02b (deps P2-T02a, P2-T01); P2-T03 then depends on P2-T02b.

## Coverage self-check
- PS-ACC-01..31: see "PS-ACC allocation"; deferred parts are listed there with their owning task.
- Phase 1 carry-overs: M1–M4 (T01 Part A), `ENCRYPTED_COLUMNS` + rotate DB-loop test and I7 (T02a).
- Master E2E rows #1 (T02b) and #2 (T07). Master Review Focus #5 is covered by T03/T04 here; P5-T06 finishes it.

## Phase gate
Full `npm test`, lint, typecheck, Playwright, CI incl. `compose-smoke` rotation step and `imap-real` green; `ponytail-audit` by a fresh reviewer; tick PS-ACC items in PRODUCT_SPEC (partial ones annotated with their later task); update PROGRESS/HANDOFF/REVIEW_LOG; fast-forward merge to `main`; push. The live checks in `LIVE_VERIFICATION.md` run when the user has credentials and must pass before P3-T11.

## Revision 2 — changes from review (`docs/plans/phase-2-review.md`)
| Finding | Resolution |
|---|---|
| C1 | `Changes` semantics documented; cursor gets `pageToken`/nextLink/`uidNext`; contract case `listChangesSince pages without loss` (2/2/1, then a new message); Gmail 404-on-get skip test; Review Focus 0 |
| I1 | `attachments` on `OutboundMime`; `locate()`; `Changes.removed`; `content: Buffer\|null` + `truncated`, pages bounded by ~20 MB; PushSource note; `findSent` hint; D12 `gmail.modify` |
| I2 | `Prefer: IdType="ImmutableId"` on all Graph calls, asserted; `findSent` id-equality test |
| I3 | Refresh keeps old refresh token; token 5xx/network/`temporarily_unavailable` → `TransientBeforeSendError`; only `invalid_grant`/`interaction_required` → `AuthError`; 15 s token timeout. Deviation from the review's fix: the token call is not inside the lock transaction at all (DB lease with `refreshLeaseId/Until`, D13), per the coordinator; the review's namespaced advisory lock is not needed |
| I4 | Atomic `UPDATE … RETURNING` claim, `createdByUserId`, concurrent-callback and concurrent-connect tests |
| I5 | Reconnect lifecycle rule and tests; revive re-derives provider/tier/caps |
| I6 | `assertPublicHost` (vps default-deny, `ALLOW_PRIVATE_MAIL_HOSTS`), checked IP + `servername`, re-check on every connect in web and worker, TLS required before AUTH, 200-char truncation, tests (D15) |
| I7 | Graph and IMAP `revoke()` make no remote call; zero-call test; consent-removal docs |
| I8 | File-backed Fake (`FAKE_MAIL_DIR`, lock + atomic rename), `/_fake/mailbox/[address]`, fake OAuth before `not_configured` (D14) |
| I9 | `expireCursors()` on Sent; client-side `logger` for command assertions; harness files into Sent itself; spike + double kept; new Linux `imap-real` job on GreenMail required for the gate (D11) |
| I10 | `findSent(rfc, hint)` with by-id fallback; HANDOFF gate for P3-T11; JSON `internetMessageId` fallback dropped as unproven |
| I11 | `nextSendAt` non-null default now |
| I12 | T02 split into T02a (opus) and T02b (sonnet + opus review); T01 stays sonnet |
| M1 | D10 reasons corrected; MS `scope` on refresh, scope normalization + test, `admin_consent_required`, `MS_TENANT` for both endpoints |
| M2, M3 | `$value` concurrency ≤ 4 test; draft 429 → `RateLimitedError`; orphan draft deleted (`deleteDraft`) |
| M4 | Kept the class name; documented that it also covers non-send transient failures (renaming would churn TASKS/master text) |
| M5 | UIDNEXT skip; contract run once (CONDSTORE off) plus explicit CONDSTORE test |
| M6 | `sendExternal`, drafts/spam-not-reported cases |
| M7 | Purge of `OAuthSession` > 1 day in `accountsAutoResume` with test |
| M8 | Notes in T04: `espType` derived, `dailyLimit` non-null deviation, range-bound vs clamp, `errorCount24h` decay → P5-T02, newest soft-deleted row revived |
| M9 | Documented in T06 and LIVE_VERIFICATION |
| M10 | `SameSite=Lax` note and popup-blocked fallback with E2E |
| M11 | No response bodies in errors; `JSON.stringify` tests in T01/T02b/T03 |
| M12 | Env cache reset in the M1 test; M4 grep note |
No finding was rejected; M4 and the I3 lock mechanism are adjusted as shown.

## Revision 3 — round-2 review findings (binding on the owning tasks)

- **R2-I1 (P2-T02a):** disconnect, soft delete and reconnect clear `refreshLeaseId/refreshLeaseUntil` and bump a credential
  generation; a refresh that finishes after that writes nothing (conditional update on lease id + generation).
  Tests: `refresh finishing after disconnect does not restore tokens`, `refresh finishing after reconnect does not overwrite new grant`.
- **R2-I2 (P2-T05):** Graph recovery `deleteDraft` deletes only when `isDraft === true` (ImmutableId means the draft id is the
  Sent Items id). Test: `deleteDraft never deletes a sent message`.
- **R2-I3 (P2-T06):** GreenMail CI job connects via 127.0.0.1 in local mode (plain ports allowed only when
  `MODE=local` and host is loopback), creates Sent/Junk folders before the suite, pins the image tag.
- Minor round-2 items (OAuth expired vs state_invalid wording, extra SSRF ranges, Fake isolation/stale locks/path
  traversal) are applied by the owning task's implementer; details in `docs/plans/phase-2-review.md` "Round 2".
