# Phase 2 — Email provider connections: step plan

> Implements P2-T01..P2-T07 of `docs/IMPLEMENTATION_PLAN.md`. Read its Global Constraints, "Send pipeline" and "Reconciliation" first.
> Rules: `docs/PROVIDER_COMPLIANCE.md`. Versions: `docs/STACK.md`. Use superpowers:test-driven-development per task.
> Branch `phase-2-providers`; commit + push after every task. All tasks run on sonnet (see "Models").
> Phase 1 interfaces used as-is: `route()`, `startWorker`/`JobDef` (`{prisma, clock}`), `createPrisma`, `createTestDb`/`expectIsolated`, `getEnv`/`envSchema.extend`, `encrypt`/`decrypt`/`ENCRYPTED_COLUMNS`, `audit(tx,…)`, `Clock`.

## Fixed names (every later phase relies on these)

| Thing | Value |
|---|---|
| Package | `@rightnow/providers` (`packages/providers`, TS source, no DB or Next dependency). `@rightnow/core` imports it; core owns everything that touches Prisma (`packages/core/src/accounts/*`, `oauth.ts`, `rotate.ts`). |
| Prisma enums | `AccountProvider GMAIL\|MICROSOFT\|SMTP`; `AccountStatus CONNECTED\|ERROR\|DISCONNECTED`; `AccountLifecycle ACTIVE\|INACTIVE\|REWARMING\|PAUSED\|NEEDS_ATTENTION`; `SyncState IDLE\|SYNCING\|FAILED`; `AutofixState NONE\|IN_PROGRESS\|FAILED\|SUCCEEDED`; `CapTier GMAIL_WORKSPACE\|GMAIL_CONSUMER\|MS365\|OUTLOOK_COM\|SMTP`; `OAuthStatus PENDING\|SUCCESS\|ERROR\|EXPIRED`; `CnameStatus UNVERIFIED\|VERIFIED\|FAILED` |
| `EmailAccount` columns | `id, workspaceId, provider, email (lowercased), fromName, firstName, lastName, replyTo?, signature?, tags String[], credentialsEnc String? (null after disconnect), status @default(CONNECTED), lifecycle @default(ACTIVE), pausedUntil?, capTier, providerCap Int, dailyLimit Int @default(30), minGapSec Int @default(0), randomGapSec Int @default(0), timezone @default("UTC"), slowRamp Boolean @default(false), rampStartVolume Int @default(2), rampIncrementPerDay Int @default(2), rampStartedAt?, historyImportDays Int @default(30), nextSendAt?, lastSentAt?, lastCampaignActivityAt?, lastError Json? {kind:"CONNECTION"\|"SENDING"\|"SOFT_BOUNCE", code, command?, response?, message}, lastErrorAt?, errorCount24h Int @default(0), autofixState @default(NONE), autofixAt?, syncState @default(IDLE), syncCursor Json?, lastSyncCompletedAt?, healthScore Int?, trackingDomain?, trackingDomainStatus @default(UNVERIFIED), appendToSent Boolean @default(true), createdAt, deletedAt?`. Partial unique index (raw SQL in migration): `(workspaceId, lower(email)) WHERE deletedAt IS NULL`. |
| Other tables (P2) | `OAuthSession(id = sessionId, workspaceId, provider, stateHash unique, codeVerifierEnc, reconnectAccountId?, status, errorCode?, accountId?, expiresAt, consumedAt?, createdAt)`; `AccountDailyUsage(accountId, day date, sent, reserved, @@id[accountId, day])`; `WorkspaceDailyUsage(workspaceId, day date, sent, reserved, @@id)`. `CampaignDailyUsage` needs `Campaign` and moves to P3-T09. |
| Encrypted columns | `ENCRYPTED_COLUMNS` gains `{EmailAccount, credentialsEnc}` and `{OAuthSession, codeVerifierEnc}` |
| `credentialsEnc` plaintext JSON | OAuth: `{kind:"oauth", accessToken, refreshToken, expiresAt (epoch ms), scope}`. SMTP: `{kind:"smtp", imap:{host,port,secure,username,password}, smtp:{host,port,secure,username,password}}`. Never returned by any API (`toApiAccount()` omits it and `syncCursor`). |
| Env (core `envSchema`, all optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (default `common`), `MAIL_PROVIDER_FAKE` (`"1"`; startup error when `MODE=vps`). Redirect URIs: `${APP_URL}/api/v1/oauth/google/callback` and `.../microsoft/callback`. |
| OAuth scopes | Google: `https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly`. Microsoft: `offline_access User.Read Mail.Send Mail.ReadWrite`. Both: PKCE S256, `state` = 32 random bytes base64url (only its sha256 is stored), session TTL 10 min. Google adds `access_type=offline&prompt=consent`. |
| OAuth session codes | status `pending\|success\|error\|expired` (API lowercase); `errorCode`: `account_exists, email_mismatch, state_invalid, expired, access_denied, scope_missing, no_refresh_token, exchange_failed, server_error`. Provider not configured: HTTP 412 `{error:"not_configured"}`. |
| Routes (all `route()`) | `POST /api/v1/oauth/[provider]/start` (provider `google\|microsoft`; body `{reconnectAccountId?, loginHint?}` → `{sessionId, authUrl, expiresAt}`; ADMIN); `GET /api/v1/oauth/[provider]/callback` (session auth; returns a tiny HTML page that closes the popup); `GET /api/v1/oauth/sessions/[id]` (→ `{status, accountId?, errorCode?}`; terminal result readable once, then 404); `GET,POST /api/v1/accounts` (POST = SMTP create, ADMIN); `POST /api/v1/accounts/test-connection` (ADMIN, nothing saved); `GET,PATCH,DELETE /api/v1/accounts/[id]`; `POST /api/v1/accounts/[id]/{pause,resume,disconnect,mark-fixed,diagnostics,test-send}`; `POST /api/v1/accounts/bulk`. Scopes: `accounts:read\|create\|update\|delete`. Roles: read VIEWER; connect, test-connection, disconnect, delete, test-send ADMIN; the rest MEMBER. |
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
  headers?: Record<string, string>;   // List-Unsubscribe, List-Unsubscribe-Post, X-RightNow-Test
  threadId?: string;                  // providerThreadId of the thread; Gmail only, ignored elsewhere
};
export type SendResult = { rfcMessageId: string; providerMessageId?: string; providerThreadId?: string };
export type RemoteMessage = {
  providerMessageId: string; providerThreadId?: string; rfcMessageId: string | null; folder: Folder;
  inReplyTo: string | null; references: string[]; from: Addr; to: Addr[]; cc: Addr[]; subject: string; date: Date;
  text: string | null; html: string | null; headers: Record<string, string[]>; // names lowercased
  attachments: { filename: string; contentType: string; size: number; content: Buffer }[];
};
export type SyncCursor =
  | { kind: "gmail"; historyId: string }
  | { kind: "graph"; inbox: string; sent: string }                       // two @odata.deltaLink values
  | { kind: "imap"; folders: Record<Folder, { uidValidity: string; lastUid: number; highestModseq?: string }> }
  | { kind: "fake"; epoch: number; seq: number };
export type Changes = { expired: true } | { expired: false; messages: RemoteMessage[]; cursor: SyncCursor; hasMore: boolean };
export type Diagnostics = { ok: boolean; checks: { name: "token" | "scopes" | "api" | "imap_login" | "smtp_auth" | "sent_folder";
  ok: boolean; code?: string; command?: string; response?: string; message?: string }[] };

export interface MailProvider {
  readonly kind: ProviderKind;
  readonly address: string;                                   // lowercased mailbox; send() rejects any other From
  send(mime: OutboundMime, opts?: { signal?: AbortSignal }): Promise<SendResult>;
  findSent(rfcMessageId: string): Promise<RemoteMessage | null>;
  currentCursor(): Promise<SyncCursor>;                       // call BEFORE listMessages in a first sync, then listChangesSince
  listChangesSince(cursor: SyncCursor, opts?: { limit?: number }): Promise<Changes>;   // INBOX + SENT; default limit 200
  listMessages(q: { since: Date; folder: Folder; pageToken?: string; limit?: number }): Promise<{ messages: RemoteMessage[]; nextPageToken?: string }>; // limit default 100
  diagnostics(): Promise<Diagnostics>;
  revoke(): Promise<void>;                                    // best effort at the provider; never throws on "already invalid"
}
export interface CredentialStore<C> {
  get(): Promise<C>;
  /** Serialized per account across processes: re-reads, returns the newer creds if `stale` is no longer current, else runs `doRefresh`, persists and returns. */
  refresh(stale: C, doRefresh: (c: C) => Promise<C>): Promise<C>;
}
export interface OAuthClient {
  authUrl(p: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ creds: OAuthCreds; email: string; displayName?: string }>;
  refresh(creds: OAuthCreds): Promise<OAuthCreds>;            // invalid_grant → AuthError
  revoke(creds: OAuthCreds): Promise<void>;
}
export type OAuthCreds = { accessToken: string; refreshToken: string; expiresAt: number; scope: string };
```

Errors (`packages/providers/src/errors.ts`, all extend `ProviderError extends Error { cause?: unknown }`): `RateLimitedError(retryAfterSec: number)`, `AuthError(reason: "invalid_grant" | "unauthorized" | "scope_revoked" | "bad_credentials")`, `PermanentSendError(code: string, detail?: string)`, `TransientBeforeSendError(detail?: string)`, `AmbiguousSendError(detail?: string)`. Rules: 429 (or 503/504 with Retry-After on non-send calls) → `RateLimitedError`; refresh `invalid_grant` or a 401 that survives one refresh → `AuthError`; connect refused / DNS failure / SMTP 4xx / failure creating a Graph draft → `TransientBeforeSendError`; API 5xx on the send call, timeout or reset after the request was written → `AmbiguousSendError`; other 4xx / SMTP 5xx / `from_mismatch` → `PermanentSendError`. `parseRetryAfter(header: string | null, now: Date, fallbackSec = 60): number` accepts seconds or HTTP-date, clamps to 1..3600.

Other exports: `buildMime(m: OutboundMime, opts?: { keepBcc?: boolean }): Promise<Buffer>` (nodemailer `MailComposer`), `parseRaw(raw: Buffer, meta: { providerMessageId: string; providerThreadId?: string; folder: Folder }): Promise<RemoteMessage>` (mailparser), `newMessageId(domain: string): string`, `FakeProvider`, `FakeOAuthClient`, `createFixtureFetch(routes): typeof fetch & { calls: Call[] }`, `runProviderContract(harness: ProviderHarness)`. Core: `createProvider(account, deps?: { fetch?: typeof fetch; clock?: Clock }): MailProvider` (returns `FakeProvider` from a registry when `MAIL_PROVIDER_FAKE=1`), `getOAuthClient(provider)`, `accountCredentialStore(prisma, accountId): CredentialStore<OAuthCreds>`, `displayStatus(a)`, `dayKey(timezone: string, at: Date): string` (`YYYY-MM-DD` via `Intl`; P3-T07 reuses it).

## Review Focus (riskiest uncovered inputs, most likely first; each has a test in its owning task)

1. Token refresh raced by two workers (Microsoft rotates refresh tokens; losing the newer one silently disconnects the mailbox) → P2-T02 store test, P2-T03/T05 provider tests.
2. Graph 429/503 with `Retry-After` during send and during sync → P2-T05.
3. IMAP server without CONDSTORE/MODSEQ (many shared hosts) → P2-T06 runs the whole contract suite twice, with and without the plugin.
4. A 50k-message mailbox on first sync: provider must page, resume from a token and never hold the mailbox in memory → contract case `listMessages pages and resumes` (P2-T01), exercised by T03/T05/T06 with 1,203 messages.
5. Refresh token revoked between claim and send → no blind retry and no second send request; account becomes NEEDS_ATTENTION; reconnect keeps id and history → P2-T03 and P2-T04.

## PS-ACC allocation (all 31, from `docs/PRODUCT_SPEC.md`)

T01: 05 · T02: 01, 02, 06, 07, 08, 10 · T03: completes 01 (send/read) · T04: 09, 11, 12–21, 23–28, 30, 31 · T05: 03 · T06: 04, 29 · T07: none (PS-SEND-18).
Assigned to a later phase (the master map says ACC → P2; each is the part that needs a model that does not exist yet):
- **PS-ACC-22** (account → campaigns view) → P3-T05: needs `Campaign`/`CampaignAccount`. T04 only stores `tags` for PS-ACC-21; the campaign-side tag restriction is P3-T05.
- **PS-ACC-11, warm-up part** (bulk enable/disable warm-up) → P5-T03: needs `WarmupSettings`. All other bulk actions are T04.
- **PS-ACC-24, DNS part** (MX/SPF/DKIM/DMARC presence) → P5-T01 plugs into `runDiagnostics`. T04 owns token, IMAP, SMTP, API and CNAME checks.
- **PS-ACC-27, rescheduling queued jobs** → P3-T09/T10: `ScheduledMessage` does not exist. T04 guarantees `lifecycle=PAUSED` immediately; the claim SQL already excludes it.
- **PS-ACC-31, progress indicator** → P4-T05 (T04 owns the `historyImportDays` setting); **PS-ACC-16 consumption** → P3-T13 (T04 owns the fields and defaults). Status producers `SENDING`/`SOFT_BOUNCE` → P3-T11/P5-T02 (T04 owns the enum, `lastError.kind` and the display mapping).

## P2-T01 Provider interface, MIME, Fake, contract suite (+ Phase 1 cleanup)

Model: sonnet. Owns: PS-ACC-05, PS-SEND-14, PS-SEND-15 (contract), PS-SEND-09 (error taxonomy, `parseRetryAfter`), PS-SEC-10 (From guard), PS-SYNC-01/02/03 (provider side: cursor type, `{expired:true}`).

Part A, cleanup first, one commit `chore(web): phase 1 cleanup M1-M4`:
- [ ] M1 `apps/web/lib/api.ts` `sameOrigin()` reads `getWebEnv().APP_URL` (not `process.env`). Test in `api.test.ts`: with env `APP_URL=https://app.example.com`, POST with `Origin: https://app.example.com` and session → 200; `Origin: https://evil.example` → 403.
- [ ] M2 `apps/web/lib/auth.ts` `emailAndPassword.minPasswordLength: 12`; `auth.spec.ts` uses a ≥12-char password everywhere; add: 11-char password on sign-up shows an error and creates no user.
- [ ] M3 remove the `kind` parameter of `requireWorkspace()` (`apps/web/lib/workspace.ts`; only `(app)/layout.tsx` calls it). API paths use `route()`.
- [ ] M4 remove `embedded-postgres` and `pg` from `apps/web/package.json` devDependencies if no file under `apps/web` imports them (grep first; keep and say why if `e2e/global-setup.ts` does). `npm install && npm test && npm run lint && npm run typecheck && npm run e2e` pass.

Part B:
Files: `packages/providers/{package.json,src/{index,types,errors,mime,retry-after}.ts,src/fake/{provider,oauth,registry}.ts,src/contract/{suite,harness,fixture-fetch}.ts,test/{mime,errors,fake.contract}.test.ts}`; `packages/core/src/env.ts` (vars above + vps guard); `.env.example`; root `vitest` project; `docs/DECISIONS.md` D10, D11; `docs/STACK.md`.
- D10: Gmail and Graph use plain `fetch` (injected) and the PKCE helpers in `node:crypto`; `@googleapis/gmail`, `google-auth-library` and `@azure/msal-node` are not used (their HTTP stacks cannot take an injected fetch, hide 429/5xx classification, and msal hides refresh tokens). D11: IMAP/SMTP tests use `hoodiecrow-imap@3.3.1` (pure-JS scriptable IMAP server; CONDSTORE, UIDPLUS, SPECIAL-USE as switchable plugins) and `smtp-server@3.20.2` (nodemailer's own), both in-process, no Docker, no native modules, so they run on Windows and CI. Add runtime deps `nodemailer 10.1.7`, `mailparser 3.10.0`, `imapflow 2.5.8`; dev deps `hoodiecrow-imap`, `smtp-server`, `@types/*`.
- [ ] Test `mime.test.ts`: `buildMime` output has exactly our `Message-ID`, CRLF line endings, `In-Reply-To`/`References` when given, `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` verbatim, no `Bcc:` line by default and one with `keepBcc`, `multipart/alternative` when text+html; `parseRaw(buildMime(x))` round-trips subject/body `"Grüße 日本語 🚀"`, a 200-char subject (folded), and one attachment. `errors.test.ts`: `parseRetryAfter("7", now)=7`, `("Wed, 21 Oct 2026 07:28:00 GMT", 2026-10-21T07:26:00Z)=120`, `(null)=60`, `("99999")=3600`, `("0")=1`.
- [ ] Test `env.test.ts`: `MAIL_PROVIDER_FAKE=1` with `MODE=vps` throws naming the var; Google/MS vars absent is valid.
- [ ] Implement types/errors/mime/`FakeProvider` (in-memory INBOX/SENT, `seq` cursor, controls `receiveInbound`, `failNext(kind)`, `expireCursors()`, `sentRaw()`; diagnostics fail when the configured host starts with `fail.`) and `FakeOAuthClient` (`authUrl` returns `${redirectUri}?code=fake:${loginHint ?? "fake@example.test"}&state=${state}`, `exchange` derives the email from the code).
- [ ] Contract suite `runProviderContract(h: ProviderHarness)` with `ProviderHarness = { name; supports: Set<FailKind>; setup(): Promise<{ provider: MailProvider; scenario: Scenario; close(): Promise<void> }> }`, `Scenario = { receiveInbound(m: { from: Addr; subject: string; text: string; inReplyTo?: string }): Promise<void>; seedInbound(n: number): Promise<void>; failNext(k: FailKind): void; expireCursors(): Promise<void>; sentRaw(): Promise<Buffer[]> }`, `FailKind = "rate_limit" | "auth_revoked" | "api_5xx" | "smtp_4xx" | "smtp_5xx" | "connect_refused" | "timeout_after_write" | "permanent_rejected"`. Cases (names are the `it()` titles; fail kinds not in `supports` are skipped, the Fake supports all):
  - `send preserves Message-ID and findSent finds it`: send `<c1@rn.test>` → `rfcMessageId === "<c1@rn.test>"`; `findSent("<c1@rn.test>")` has the same `rfcMessageId`, `folder "SENT"`; `findSent("<none@rn.test>")` is `null`.
  - `reply carries threading headers`: raw of the reply has `in-reply-to: <c1@rn.test>` and `references: <c1@rn.test>`; when the first result has `providerThreadId`, passing it as `threadId` returns the same `providerThreadId`.
  - `campaign headers pass through verbatim`: `List-Unsubscribe: <https://x.test/u/abc>, <mailto:u@x.test?subject=unsub>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` appear in `sentRaw()[0]`.
  - `UTF-8 survives`: subject/text `"Grüße 日本語 🚀"` read back from `findSent` equal the input.
  - `rejects a foreign From`: `from.email` ≠ `provider.address` → `PermanentSendError` code `from_mismatch`, `sentRaw()` empty.
  - `error mapping`: `rate_limit` (Retry-After 7) → `RateLimitedError.retryAfterSec === 7`; `auth_revoked` → `AuthError`; `api_5xx` and `timeout_after_write` → `AmbiguousSendError`; `smtp_4xx` and `connect_refused` → `TransientBeforeSendError`; `smtp_5xx` and `permanent_rejected` → `PermanentSendError`. In every case `sentRaw()` is empty except `api_5xx`/`timeout_after_write` (outcome unknown, not asserted).
  - `listChangesSince returns each new message once`: `c0 = currentCursor()`; `receiveInbound` ×1; changes has 1 message with `folder "INBOX"` and `inReplyTo`; calling again with `changes.cursor` returns 0 and `hasMore false`.
  - `own and outside-app sent mail appears as SENT`: after `send`, changes contain a message with `folder "SENT"` and the same `rfcMessageId`.
  - `expired cursor`: after `expireCursors()`, `listChangesSince(old)` equals `{expired: true}`; `currentCursor()` then yields a cursor that returns `expired:false`.
  - `listMessages pages and resumes` (Review Focus 4): `seedInbound(1203)`; `limit 100` → 13 pages, every page ≤ 100, union of `providerMessageId` has 1203 entries; a fresh provider instance resumed from the page-5 `nextPageToken` returns exactly 703.
  - `diagnostics`: healthy → `ok true`; after `auth_revoked` the check named `token` (or `imap_login`/`smtp_auth` for SMTP) has `ok false` and a `code`.
  - `revoke resolves`: `await provider.revoke()` does not throw, twice in a row.
- [ ] Run `fake.contract.test.ts` (Fake against the suite) → pass. `createFixtureFetch(routes)` matches `{method, url: string|RegExp, respond(req)|sequence}` and records `calls` (method, url, headers, body, order); an unmatched request throws naming the URL.
- [ ] Commit `feat(providers): provider interface, MIME, fake provider, contract suite`.

## P2-T02 Google OAuth connect, credential store, key rotation

Model: sonnet (read the refresh-lock code hardest in review). Owns: PS-ACC-01 (connect), PS-ACC-02, PS-ACC-06, PS-ACC-07, PS-ACC-08, PS-ACC-10, PS-SEC-05 (rotation incl. I7), PS-SEC-07 (connect/reconnect audit).

Files: `packages/db/prisma/schema.prisma` + migration `accounts` (EmailAccount, OAuthSession, usage tables, enums, partial index); `packages/providers/src/gmail/oauth.ts` (`GoogleOAuth implements OAuthClient`, fetch-injected); `packages/core/src/{oauth.ts,rotate.ts,accounts/{credentials,factory,serialize}.ts}`; `scripts/rotate-key.ts`, `scripts/rotate-key.{sh,ps1}`, `docker/entrypoint.sh`; `apps/web/app/api/v1/oauth/**`; `apps/web/app/(app)/accounts/{page.tsx,connect-menu.tsx}`; `docs/ops/GOOGLE_SETUP.md`, `docs/ops/KEY_ROTATION.md`; `apps/web/e2e/accounts-google.spec.ts`.
Signatures: `pkce(): { verifier: string; challenge: string }`; `startOAuth(prisma, clock, deps, p: { workspaceId; provider: "google"|"microsoft"; reconnectAccountId?; loginHint? }): Promise<{ sessionId; authUrl; expiresAt }>`; `completeOAuth(prisma, clock, deps, p: { workspaceId; actorId; state?: string; code?: string; error?: string }): Promise<{ sessionId; accountId? ; errorCode? }>` (never throws for user-level failures; records them on the session); `pollSession(prisma, clock, workspaceId, sessionId): Promise<{ status; accountId?; errorCode? } | null>`; `rotateColumns(prisma, cols, oldKey: Buffer, newKey: Buffer): Promise<Record<string, number>>` (extracted from the script; one transaction per column; error names `Model.field` and row id).
- [ ] Tests `packages/core/test/oauth.test.ts` (fixture fetch for token + Gmail profile endpoints, `createTestDb`):
  - `pkce`: RFC 7636 vector verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`; fresh verifier length 43..128.
  - `startOAuth`: session `PENDING`, `expiresAt = now + 10 min`, DB holds `sha256(state)` not the state; `authUrl` has `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, the exact two scopes, and `redirect_uri=${APP_URL}/api/v1/oauth/google/callback`; `codeVerifierEnc` starts `v1:`.
  - success: new account `provider GMAIL`, `email` lowercased, `capTier` from `tierFor`, `providerCap` default, `credentialsEnc` decrypts to JSON with the refresh token, and a raw `SELECT` over the row contains neither token in plaintext; session `SUCCESS` with `accountId`; audit row `account.connect`.
  - failures leave the session `ERROR` with the code and create no account: wrong `state` → `state_invalid`; replaying a used state → `state_invalid` (one account only); `+10m01s` → `EXPIRED`/`expired`; callback from another workspace → `state_invalid`; `error=access_denied` → `access_denied`; token response without `refresh_token` → `no_refresh_token`; granted scope lacking `gmail.readonly` → `scope_missing`; token endpoint 400 → `exchange_failed`.
  - `account_exists`: connecting the same email (any case) twice without `reconnectAccountId` → second session `ERROR account_exists`, one row.
  - reconnect (PS-ACC-08): with `reconnectAccountId=A` and the same email → same id, new `credentialsEnc`, `status CONNECTED`, `lifecycle ACTIVE`, `lastError null`, `errorCount24h 0`, while `tags`, `dailyLimit`, `syncCursor` are unchanged and an `account.reconnect` audit row exists; a different email → `email_mismatch`, account untouched. A fresh connect for a soft-deleted email revives that row (same id, `deletedAt null`, settings kept).
  - `pollSession`: pending → `{status:"pending"}`; after success returns `{status:"success", accountId}` once, then `null` (route: 404); past `expiresAt` → `{status:"expired"}`; other workspace → `null`.
  - partial index: same email different case in one workspace rejects; allowed after soft delete and in another workspace (`expectIsolated`).
- [ ] Test `credentials.test.ts` (Review Focus 1): two `createPrisma` clients on one test DB (two workers); `Promise.all` of two `store.refresh(stale, doRefresh)` with a counting `doRefresh` returning a rotated refresh token → `doRefresh` called exactly once, both resolve to the same creds, DB decrypts to the rotated refresh token. `doRefresh` throwing leaves the stored creds unchanged. Implement with `pg_advisory_xact_lock(hashtext(accountId))` inside `prisma.$transaction({ timeout: 30_000 })`.
- [ ] Test `rotate.test.ts` (carried from Phase 1): seed 3 accounts under key A (one with `credentialsEnc null`) and one `OAuthSession`; `rotateColumns` A→B → decrypt with B succeeds, null stays null, result `{ "EmailAccount.credentialsEnc": 2, "OAuthSession.codeVerifierEnc": 1 }`; rerun → 0 and 0; a row encrypted with a third key → throws a message containing `EmailAccount.credentialsEnc` and the row id, and every other row of that column is unchanged.
- [ ] Route tests via `route()`: MEMBER → 403 on start; `GOOGLE_CLIENT_ID` unset → 412 `not_configured`; `GET /oauth/sessions/[id]` as VIEWER OK; cross-origin POST blocked (existing CSRF).
- [ ] I7: `docker/entrypoint.sh` gains mode `rotate-key` (`cd /app && exec node --import tsx scripts/rotate-key.ts`); `scripts/rotate-key.sh|.ps1` (args: new key generated if omitted) does backup via `scripts/backup.*`, `docker compose stop web worker`, `docker compose run --rm --no-deps -e OLD_ENCRYPTION_KEY -e NEW_ENCRYPTION_KEY migrate rotate-key`, prints "now set ENCRYPTION_KEY in .env, then start", never prints keys to logs beyond the new key once. `KEY_ROTATION.md` documents it. CI `compose-smoke` gains a step running it and asserting exit 0 and an output line `EmailAccount.credentialsEnc: re-encrypted 0`, then restores the old `.env` key and checks `/api/readyz`.
- [ ] Playwright `accounts-google.spec.ts` (E2E #1, `MAIL_PROVIDER_FAKE=1`): "Connect Google" opens a popup that lands on the callback and closes; the accounts list shows `fake@example.test` with provider "Google" within 10 s; connecting again shows the message for `account_exists` and the list still has one row.
- [ ] `GOOGLE_SETUP.md` (verify with `grep`): create project, enable Gmail API, consent screen set to **In production** (Testing mode expires refresh tokens after 7 days; unverified warning screen is expected for one owner), the two scopes verbatim, redirect URI, `GOOGLE_CLIENT_ID/SECRET` in `.env`, free Gmail vs Workspace limits (400 vs 1,500), troubleshooting `invalid_grant`.
- [ ] Commit `feat(accounts): Google OAuth connect, OAuth sessions, credential store, key rotation`.

## P2-T03 Gmail provider

Model: sonnet. Owns: completes PS-ACC-01 (send/read), PS-SEND-15 (Gmail), PS-SYNC-01/02 (Gmail).
Files: `packages/providers/src/gmail/{provider.ts,http.ts}`, `packages/providers/src/gmail/fixtures/*.json`, `packages/providers/test/gmail.contract.test.ts`, `gmail.test.ts`; `packages/core/src/accounts/factory.ts` (GMAIL branch).
Signature: `new GmailProvider({ address, store: CredentialStore<OAuthCreds>, oauth: OAuthClient, fetch?: typeof fetch, clock?: Clock })`. Fixtures are hand-written from the official API shapes (no live credentials yet); P2-T07 verifies them against real Gmail.
- Authed requests: refresh first when `expiresAt < now + 60 s`; a 401 refreshes once through `store.refresh` and retries once (safe: 401 means not processed); 60 s timeout; fetch rejection with `cause.code` in `ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT` → `TransientBeforeSendError`, any other rejection on send → `AmbiguousSendError`.
- [ ] `gmail.contract.test.ts`: `runProviderContract` with a Gmail harness built on `createFixtureFetch` (stateful in-memory mailbox behind the routes; `failNext` swaps one response; supports all kinds except `smtp_*`, `connect_refused` = rejected fetch).
- [ ] `gmail.test.ts` assertions:
  - send is `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with `Authorization: Bearer`, JSON `{raw, threadId?}`; decoding `raw` (base64url) gives MIME containing our `Message-ID` and the `Bcc` header (`keepBcc`); `threadId: "t-1"` in → `body.threadId === "t-1"`.
  - `findSent` queries `users.messages.list` with `q = "rfc822msgid:c1@rn.test in:sent"` (angle brackets stripped), then `messages.get?format=raw`.
  - `listChangesSince`: `history.list?startHistoryId=…&historyTypes=messageAdded`; keeps only messages labelled INBOX or SENT; follows `nextPageToken` (`hasMore` true when limit reached); HTTP 404 → `{expired:true}`; `currentCursor` reads `users.getProfile` `historyId`.
  - `listMessages`: `q=after:<epoch>` plus `labelIds`, `maxResults=limit`, fetches bodies with at most 8 requests in flight (fixture records max concurrency ≤ 8).
  - errors: 403 reason `rateLimitExceeded`/`userRateLimitExceeded` → `RateLimitedError(60)` or the `Retry-After` value; `dailyLimitExceeded` → `RateLimitedError(3600)`; 403 `insufficientPermissions` → `AuthError("scope_revoked")`; 400 `invalidArgument` → `PermanentSendError`.
  - refresh persistence: expired access token → token endpoint called once, `store` holds the new token; two providers sharing one real `accountCredentialStore` sending concurrently hit the token endpoint once (Review Focus 1).
  - Review Focus 5, revoked mid-send: (a) access token expired, refresh returns `400 invalid_grant` → `AuthError("invalid_grant")` and the send route was called 0 times; (b) send returns 401, refresh returns `invalid_grant` → `AuthError`, send route called exactly 1 time (never re-posted).
  - `revoke` posts `https://oauth2.googleapis.com/revoke`; a 400 `invalid_token` response resolves.
- [ ] Commit `feat(providers): Gmail provider with contract suite on fixtures`.

## P2-T04 Account service, API and UI

Model: sonnet (large; commit per layer: service, API, UI). Owns: PS-ACC-09, 11 (without warm-up), 12, 13, 14, 15, 16 (fields), 17, 18, 19, 20, 21 (tags), 23, 24 (without DNS), 25, 26, 27 (without rescheduling), 28, 30, 31 (setting), PS-SEC-07 (account actions), PS-SEC-14.
Files: `packages/core/src/accounts/{service,caps,status,health,diagnostics,tracking-domain,daykey}.ts`; `apps/worker/src/jobs/{accounts-auto-resume,accounts-autofix}.ts` (+ `jobs/index.ts`); `apps/web/app/api/v1/accounts/**`; `apps/web/app/(app)/accounts/{page.tsx,accounts-table.tsx,account-drawer.tsx,bulk-bar.tsx}`; `apps/web/e2e/accounts.spec.ts`; `docs/ops/LOCAL.md` (limits section).
Signatures (all take `prisma` first, then `workspaceId`): `listAccounts(…, q: { status?; provider?; tag?; includeDeleted?; cursor?; take? })`; `updateAccount(…, id, patch): Promise<{ account; warnings }>` (zod `.strict()` patch: `fromName, firstName, lastName, replyTo, signature, tags, dailyLimit, minGapSec, randomGapSec, timezone, slowRamp, rampStartVolume, rampIncrementPerDay, historyImportDays, providerCap, appendToSent, trackingDomain, skipCnameCheck`); `pauseAccount(…, id, until?)`; `resumeAccount`; `disconnectAccount(…, id, deps)`; `softDeleteAccount`; `bulkApply(…, { ids (≤200), action: "pause"|"resume"|"set_daily_limit"|"set_gap"|"set_signature"|"add_tags"|"remove_tags"|"delete", value? }): Promise<{ id; ok; error? }[]>`; `runDiagnostics(…, id, deps): Promise<Diagnostics & { dns: null }>`; `markFixed`; `recordProviderError(prisma, clock, accountId, err: unknown)`; `verifyCname(domain: string, expectedTarget: string, resolveCname = dns.promises.resolveCname): Promise<CnameStatus>`; `displayStatus(a): "ACTIVE"|"PAUSED"|"TEMP_PAUSED"|"CONNECTION_ERROR"|"SOFT_BOUNCE_ERROR"|"SENDING_ERROR"|"REWARMING"|"INACTIVE"|"NEEDS_ATTENTION"`; `toApiAccount(a, usageToday)` adds `sentToday, reservedToday, remainingToday = max(0, dailyLimit − sent − reserved)` using `dayKey(account.timezone, now)`.
- [ ] Tests (core, `createTestDb`, fixed clock; each service call also checked with `expectIsolated`/a foreign `workspaceId` → not found, PS-SEC-14):
  - caps: for each tier row of the Fixed names table `updateAccount({dailyLimit: 99999})` stores the tier max (750, 200, 2500, 125, 50) and returns `warnings[0] = {field:"dailyLimit", clampedTo, reason:"provider_cap"}`; `providerCap: 99999` on GMAIL_WORKSPACE stores 2000; a new account's `dailyLimit` is 30 on every tier (30 ≤ every tier max); `minGapSec 86400` ok, `86401` → 400; MS365 `minGapSec: 0` stored 3 with a warning.
  - `displayStatus` table: every row of PS-ACC-14 (CONNECTED+ACTIVE→ACTIVE; PAUSED w/ `pausedUntil` future → TEMP_PAUSED, else PAUSED; ERROR+`kind CONNECTION` → CONNECTION_ERROR; `SOFT_BOUNCE` → SOFT_BOUNCE_ERROR; `SENDING` → SENDING_ERROR; REWARMING; INACTIVE; NEEDS_ATTENTION).
  - `toApiAccount` JSON never contains `credentialsEnc`, `syncCursor`, the string `refreshToken` or an SMTP password (stringify and search); usage rows `sent 4, reserved 1` with `dailyLimit 30` → `remainingToday 25`; the day key follows the account timezone (`Pacific/Auckland` at 2026-03-01T12:00Z uses 2026-03-02).
  - `recordProviderError(AuthError)` (Review Focus 5): `status ERROR`, `lifecycle NEEDS_ATTENTION`, `lastError {kind:"CONNECTION", code:"invalid_grant"}`, `errorCount24h` +1; other error classes change nothing. `resumeAccount` on such an account → 409 "reconnect or mark as fixed first". The Google reconnect from T02 then restores `CONNECTED/ACTIVE` with the same id.
  - pause/resume: `pauseAccount` sets `lifecycle PAUSED` immediately; with `until` sets `pausedUntil`; job `accountsAutoResume(prisma, clock)` resumes it only once `clock >= until`; a manually paused account (no `until`) is never auto-resumed.
  - disconnect (PS-ACC-09): provider `revoke` called once (FakeProvider counter), `credentialsEnc null`, `status DISCONNECTED`, `lifecycle PAUSED`, the row and `syncCursor` kept; connecting again via T02 with `reconnectAccountId` restores it. `softDeleteAccount`: `deletedAt` set, creds purged, hidden from `listAccounts` unless `includeDeleted`, `AccountDailyUsage` rows kept.
  - mark-as-fixed: fails (409, body = diagnostics) while `token` check is not ok; passes → `CONNECTED/ACTIVE`, `lastError null`; a user-`PAUSED` account stays `PAUSED`.
  - autofix job `accountsAutofix(prisma, clock, providerFor)`: `ERROR` + non-auth `CONNECTION` error + healthy diagnostics → `CONNECTED`, `autofixState SUCCEEDED`; failing → `FAILED`; not retried again within 15 min (clock); auth errors are never autofixed.
  - `verifyCname("track.acme.test", "app.example.com", resolver)`: resolver returns `["app.example.com."]` → `VERIFIED`; other target or ENOTFOUND → `FAILED`; `skipCnameCheck: true` as MEMBER → 403, as ADMIN stores `VERIFIED` and writes an audit row.
  - `bulkApply`: foreign-workspace id → `{ok:false, error:"not_found"}` and unchanged; 201 ids → 400; `set_signature` and `add_tags` apply to all owned ids; `delete` soft-deletes; each action writes one audit row per account.
  - `runDiagnostics` returns the provider's checks plus `dns: null` (filled by P5-T01); `lastError` stored in the status-message shape `{code, command, response, message}` (PS-ACC-15).
- [ ] Route tests: scopes (`accounts:read` key can GET, not PATCH → 403), VIEWER on PATCH → 403, unknown body property → 400, `GET /accounts/[id]` of another workspace → 404.
- [ ] Playwright `accounts.spec.ts` (seed 3 accounts through `@rightnow/db`): table shows email, provider, status badge text, `4 / 30 / 26`-style sent/limit/remaining, tags; select two rows → bulk Pause → both show "Paused"; drawer edit signature and limit 999 on a Microsoft account → saved value 125 and the warning text visible; keyboard: rows selectable with Space, drawer closes on Escape, table has an accessible name.
- [ ] Commit `feat(accounts): service, API, UI, status, bulk actions, diagnostics`.

## P2-T05 Microsoft Graph connect + provider

Model: sonnet. Owns: PS-ACC-03 (completes PS-ACC-30 for Microsoft limits already in T04 tables).
Files: `packages/providers/src/graph/{oauth,provider,fixtures/*.json}.ts`, tests `graph.contract.test.ts`, `graph.test.ts`; factory MICROSOFT branch; `docs/ops/MICROSOFT_SETUP.md`.
`MicrosoftOAuth`: authority `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/{authorize,token}`; email = `mail ?? userPrincipalName` of `GET https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName`. Every token response rotates the refresh token and must be persisted via `store.refresh`.
Send (Graph has no send-by-id for raw MIME with a known id other than draft): (1) `POST /me/messages` with `Content-Type: text/plain`, body = base64 of `buildMime(m,{keepBcc:true})` → draft `id`, `conversationId`; (2) `POST /me/messages/{id}/send` → 202. Result `{ rfcMessageId: mime.messageId, providerMessageId: draft id, providerThreadId: conversationId }`. Failure in step 1 → `TransientBeforeSendError` (nothing sent) except 401/403 → `AuthError`, 400 → `PermanentSendError`; step 2: 429 → `RateLimitedError`, 5xx/timeout → `AmbiguousSendError`, 4xx → `PermanentSendError` (and best-effort `DELETE` of the draft).
Sync: `GET /me/mailFolders/{inbox|sentitems}/messages/delta?$select=id` → each new id fetched as `GET /me/messages/{id}/$value` and parsed with `parseRaw`; `@removed` entries skipped; HTTP 410 on a delta link → `{expired:true}`; `currentCursor()` calls delta with `$filter=receivedDateTime ge <now − 5 min>` and follows pages to the final `@odata.deltaLink` (duplicates are removed by P4 ingest); `findSent` = `GET /me/mailFolders/sentitems/messages?$filter=internetMessageId eq '<…>'`; `listMessages` = `$filter=receivedDateTime ge <since>` with `@odata.nextLink` as the page token.
- [ ] `graph.contract.test.ts`: contract suite with a Graph fixture harness (`supports`: `rate_limit`, `auth_revoked`, `api_5xx`, `connect_refused`, `timeout_after_write`, `permanent_rejected`).
- [ ] `graph.test.ts`: draft-then-send call order (create precedes send, ids match); draft creation 5xx → `TransientBeforeSendError` and the send route is never called; send 5xx → `AmbiguousSendError`.
- [ ] Review Focus 2: send answered `429` with `Retry-After: 120` → `RateLimitedError.retryAfterSec === 120`; the same on `delta` with `503` + `Retry-After: 30` → `RateLimitedError(30)`; a 429 without the header → 60.
- [ ] Review Focus 1 (rotation): two concurrent calls with an expired token through a shared real store → token endpoint called once, and the stored refresh token is the rotated one from that single response.
- [ ] Tier: `tierFor("MICROSOFT","a@outlook.com") === "OUTLOOK_COM"`; route `POST /api/v1/oauth/microsoft/start` returns an `authUrl` with `login.microsoftonline.com/common` and the four scopes.
- [ ] `MICROSOFT_SETUP.md`: Entra registration for "any organizational directory and personal accounts", Web redirect URI, secret, delegated permissions `Mail.Send Mail.ReadWrite offline_access User.Read`, admin-consent note, `MS_TENANT`, the "SMTP AUTH disabled" note pointing to this OAuth route.
- [ ] Commit `feat(providers): Microsoft Graph connect and provider`.

## P2-T06 IMAP/SMTP provider + connect form

Model: sonnet. Owns: PS-ACC-04, PS-ACC-29, PS-SEND-15 (SMTP), PS-SYNC-01/02 (IMAP).
Files: `packages/providers/src/imap-smtp/{provider,folders,hints}.ts`, tests `imap.contract.test.ts` (two variants), `imap.test.ts`, `harness.ts`; `packages/core/src/accounts/{smtp-connect.ts,factory.ts}`; `apps/web/app/api/v1/accounts/{route.ts,test-connection/route.ts}`; `apps/web/app/(app)/accounts/connect-smtp.tsx`; `apps/web/e2e/accounts-smtp.spec.ts`.
Design: one IMAP connection per operation (connect, work, logout; stays under Gmail's ~15-connection cap, no idle state to leak). Send = nodemailer `sendMail({ raw: buildMime(m), envelope })` so our `Message-ID` is untouched; then, if `appendToSent`, IMAP `APPEND` of `buildMime(m,{keepBcc:true})` to the Sent folder (flag `\Seen`); an APPEND failure after SMTP success is logged and does not fail the send. `appendToSent` defaults to false for `smtp.gmail.com` and `smtp.office365.com`, else true. Sent folder: `LIST` special-use `\Sent`, else first of `Sent, Sent Items, Sent Mail, INBOX.Sent`; none → diagnostics check `sent_folder` fails. Cursor per folder `{uidValidity, lastUid, highestModseq?}`: UIDVALIDITY change → `{expired:true}`; with CONDSTORE and equal `highestModseq` skip the fetch; without it fetch UIDs `> lastUid` only. SMTP mapping: `EAUTH`/535 → `AuthError("bad_credentials")`, 4xx/connect errors → `TransientBeforeSendError`, 5xx → `PermanentSendError`, socket closed after DATA without reply → `AmbiguousSendError`. `msSmtpHint(host: string, response: string): string | null` returns `MS_SMTP_DISABLED_HINT` = `"Microsoft has SMTP AUTH disabled for this mailbox. Enable Authenticated SMTP for the mailbox or use Connect with Microsoft, remove the account, wait about an hour, then reconnect."` when host ends with `office365.com` or `outlook.com` and the response contains `5.7.139` or `SmtpClientAuthentication`.
- [ ] Spike first (step 0, 30 min cap): start `hoodiecrow-imap` (plugins UIDPLUS, SPECIAL-USE, CONDSTORE) plus `smtp-server` on random ports under Node 24 on Windows; if it cannot be made to work, record in DECISIONS and fall back to an `ImapClientLike` fixture double, keeping the same contract cases.
- [ ] `imap.contract.test.ts` runs `runProviderContract` twice: `imap-smtp (CONDSTORE)` and `imap-smtp (no CONDSTORE)` (plugin off). Harness: SMTP `onData` stores raw / `onRcptTo` returns 450 or 550 / `onAuth` 535 / destroys the socket for `timeout_after_write`; inbound mail via imapflow `append`; `expireCursors()` deletes and recreates INBOX (new UIDVALIDITY). Skip `api_5xx`, `rate_limit`.
- [ ] Review Focus 3 in `imap.test.ts`: against the no-CONDSTORE server the stored cursor has no `highestModseq`, a new message is found via UID range, and a flag-only change (`\Seen` on an old message) returns zero messages; against the CONDSTORE server an unchanged mailbox causes no `UID FETCH` command (hoodiecrow command log) while a new message does.
- [ ] `imap.test.ts` also: `appendToSent:false` → no APPEND issued and `findSent` finds the message because the test server auto-files it; APPEND failure after SMTP success → `send` resolves; Sent folder discovery by special-use and by the `Sent Items` name; wrong IMAP password → `diagnostics` check `imap_login` `ok false`, code from the server; `msSmtpHint("smtp.office365.com","535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled")` equals the constant, and `msSmtpHint("smtp.example.com", same)` is `null`; a message without `Message-ID` yields `rfcMessageId null`.
- [ ] Core `smtp-connect.ts`: `connectSmtpAccount(prisma, clock, deps, workspaceId, actorId, input)` with the twelve PS-ACC-04 inputs (`email, firstName, lastName, imap{host,port,secure,username,password}, smtp{host,port,secure,username,password}`, optional `providerCap`) runs `diagnostics()` first; failure → 422 with the checks and nothing saved; duplicate email → `account_exists`; stored encrypted; audit `account.connect`. `POST /accounts/test-connection` runs the same checks without saving. Tests: success saves one row with `capTier SMTP`, `providerCap 100`, password only inside `credentialsEnc`; bad credentials (`FakeProvider` host `fail.example.test`) → 422, zero rows; duplicate → `account_exists`; MEMBER → 403 (user-supplied host/port makes this a server-side connection, so ADMIN only).
- [ ] Playwright `accounts-smtp.spec.ts`: form validation messages; "Save" disabled until "Test connection" passes; failing host shows the failed check names; after save the row appears and no password text is in the page HTML.
- [ ] Commit `feat(providers): IMAP/SMTP provider, connect form with test`.

## P2-T07 Test-send + live verification

Model: sonnet. Owns: PS-SEND-18.
Files: `packages/core/src/accounts/{test-send,live-verify}.ts`; `apps/web/app/api/v1/accounts/[id]/test-send/route.ts`; test-send dialog in `account-drawer.tsx`; `scripts/live-verify.ts`; `docs/ops/LIVE_VERIFICATION.md`; `apps/web/e2e/test-send.spec.ts`; `docs/ops/GOOGLE_SETUP.md`/`MICROSOFT_SETUP.md` cross-links.
Signatures: `sendTestEmail(prisma, clock, deps, p: { workspaceId; actorId; accountId; to: string; confirmAuthorized: boolean }): Promise<{ rfcMessageId; providerMessageId? }>`; `liveVerify(provider: MailProvider, to: string, clock: Clock): Promise<{ step: string; ok: boolean; detail?: string }[]>` with steps `diagnostics, send, findSent, cursor, changes` (waits up to 60 s for the sent copy to appear in `listChangesSince`).
- [ ] Tests (core): `confirmAuthorized:false` → 400 and nothing sent; success: `FakeProvider.sentRaw()[0]` has `X-RightNow-Test: 1`, `From` = account address and name, `Reply-To` = account `replyTo`, signature appended, a fresh `Message-ID`; no `AccountDailyUsage`/`WorkspaceDailyUsage` row created or changed; audit `account.test_send` with `to` domain only; 6th send within 10 minutes for one account → 429 (counted from audit rows, fixed clock); `AuthError` → `recordProviderError` applied and 409 `needs_attention`; `AmbiguousSendError` → 502 `{error:"outcome_unknown", rfcMessageId}` and no retry; `RateLimitedError(30)` → 429 with `retryAfterSec 30`; MEMBER → 403; foreign account → 404.
- [ ] `live-verify.test.ts`: against `FakeProvider` every step is `ok`; with `failNext("auth_revoked")` the `send` step is `ok:false` and later steps are skipped.
- [ ] Playwright `test-send.spec.ts` (E2E #2): send button disabled until the authorization checkbox is ticked; success toast; the Fake's recorded message has the test header.
- [ ] `LIVE_VERIFICATION.md`: per provider (Google, Microsoft, IMAP/SMTP) prerequisites, the exact command `npx tsx scripts/live-verify.ts --account <id> --to <your address>` (runs inside Compose with `docker compose run --rm migrate …` variant), the expected `PASS` lines, and what to check by hand: Message-ID identical in the received message's original headers, List-Unsubscribe visible, reply threads in the recipient client, Graph keeps our `Message-ID` for MIME drafts (if not: switch the draft call to JSON with `internetMessageId`), token revoked in the provider console turns the account to NEEDS_ATTENTION within one failed test-send, 7-day refresh expiry check for Google "Testing" apps. Fixtures are re-checked against real responses and updated here.
- [ ] Commit `feat(accounts): test-send and live verification guide`.

## Models
All seven tasks: sonnet. Interfaces are fully pinned above and every behaviour has a test, so no task needs opus. P3-T09/T11 (opus) consume this interface; T01 is the freeze point and gets a closer review.

## Coverage self-check
- PS-ACC-01..31: see "PS-ACC allocation"; deferred parts are listed there with their owning task.
- Phase 1 carry-overs: M1–M4 (T01 Part A), `ENCRYPTED_COLUMNS` + rotate DB-loop test (T02), I7 (T02).
- Master E2E rows #1 (T02) and #2 (T07). Review Focus (master) #5 is covered by T03/T04 here; P5-T06 finishes it.

## Phase gate
Full `npm test`, lint, typecheck, Playwright, CI incl. `compose-smoke` rotation step green; `docs/ops/LIVE_VERIFICATION.md` checklist run by the user when credentials exist (not a gate for merge, recorded in HANDOFF); `ponytail-audit` by a fresh reviewer; tick PS-ACC items in PRODUCT_SPEC (partial ones annotated with their later task); update PROGRESS/HANDOFF/REVIEW_LOG; fast-forward merge to `main`; push.
