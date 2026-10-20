# Live verification (real mailboxes)

Everything in Phase 2 was built and tested against fakes and recorded fixtures. This guide checks those fixtures against the real services. Run it once per provider with a throwaway mailbox you own. Send only to an address you control.

The **Message-ID checks (G4, M2, M3) gate P3-T11**: its UNCERTAIN to SENT/HELD resolution depends on our `Message-ID` surviving. They do not gate the Phase 2 merge.

Record every result in the table at the bottom of this file (date, provider, step, PASS/FAIL, note) and commit it. Where reality differs, correct the fixtures named under "If it differs" in the same commit.

## 0. Prerequisites

| Provider | You need |
|---|---|
| Google | Google Cloud project with the Gmail API enabled, consent screen **In production** (not "Testing"), OAuth client ID and secret in `.env` (`docs/ops/GOOGLE_SETUP.md`). A Gmail or Workspace mailbox, connected in the app (Accounts > Connect Google). |
| Microsoft | Entra app with `Mail.Send` and `Mail.ReadWrite`, client ID and secret in `.env` (`docs/ops/MICROSOFT_SETUP.md`). A Microsoft 365 or Outlook.com mailbox, connected in the app. |
| SMTP/IMAP | A real host with TLS (993/465) and, if available, one with STARTTLS (143/587). Connect it in the app (Connect with SMTP/IMAP). |

All: `MAIL_PROVIDER_FAKE` must be unset. Find the account id via `GET /api/v1/accounts`.

## 1. Scripted run

```
npx tsx scripts/live-verify.ts --account <accountId> --to <your address>
```

Needs `DATABASE_URL`, `ENCRYPTION_KEY` and the provider's OAuth variables of the running app in the environment. Compose variant, from the repo root:

```
docker compose run --rm migrate npx tsx scripts/live-verify.ts --account <accountId> --to <your address>
```

It sends one real message with header `X-RightNow-Test: 1`, then checks the provider. Expected output:

```
PASS diagnostics
PASS send (Message-ID kept)
PASS findSent
PASS locate (SENT)
PASS cursor (gmail, graph or imap)
PASS changes
```

Exit code 0 means everything passed. `changes` waits up to 60 s for the sent copy to show up in the incremental sync. A failed `send` ends the run. Note every `FAIL` detail in the results table.
`send` printing `Message-ID changed to ...` is exactly what P3-T11 needs to know: record it.

## 2. Google

| # | Step | Expected | If it differs |
|---|---|---|---|
| G1 | Accounts > Connect Google, sign in at Google. | The popup closes, the page notices without a reload and lists the account. Google sets Cross-Origin-Opener-Policy, so `popup.closed` may be unreadable: success must still be detected by polling the session. | Polling in `apps/web/app/(app)/accounts/connect-menu.tsx`. |
| G2 | Connect Google again and press Cancel while the popup is open. | Waiting stops and the session is invalidated (a DELETE to `/api/v1/oauth/sessions/<id>` is sent). | Same file. |
| G3 | Run the scripted check (section 1). | All PASS. | See G4 to G10. |
| G4 | Open the received message, "Show original". Compare with the sent copy's original headers too. | `Message-ID` is identical to the one the script sent. **Gates P3-T11.** | Gmail rewrote it: P3-T11 must match another way (thread, recipient, subject); tell that task's owner. |
| G5 | Send one message with a Bcc recipient (scratch script calling `createProvider(...).send({ ..., bcc })`), open the stored copy in Sent, "Show original". | No `Bcc` header in the stored sent copy. | If present, change `packages/providers/test/gmail-fake.ts` and any Bcc assertion. |
| G6 | API explorer: `users.history.list` with the `startHistoryId` from the cursor step, `historyTypes` messageAdded and labelAdded. | Entries carry `messagesAdded[].message.labelIds`, `labelsAdded[]`, `messagesDeleted`; the response has a top-level `historyId`; an expired startHistoryId answers 404. | History fixtures in `packages/providers/test/gmail-fake.ts` and `gmail.test.ts`. |
| G7 | `users.messages.list` with `q=rfc822msgid:<id>` and `includeSpamTrash=true`. Move the test message to Trash first, then repeat with `q=in:anywhere rfc822msgid:<id>`. | The trashed copy is still found; `in:anywhere` includes spam and trash. | `findSent` / `locate` queries in `packages/providers/src/gmail/`. |
| G8 | `users.messages.get?format=minimal` for a message. | The response contains `labelIds`. | The provider relies on it in `locate`; if absent, switch to `format=metadata`. |
| G9 | Make Google answer 403/429 (hit a quota, or call the API with a revoked grant) and read the body. | `error.errors[0].reason` such as `rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded`; `Retry-After` on 429. | Error mapping and fixtures in `packages/providers/src/gmail/` and `gmail.test.ts`. |
| G10 | Revoke the app at myaccount.google.com/permissions. In the app: Account > Run diagnostics, then Send test email. | Account shows "Needs attention"; test-send answers 409 `needs_attention`. | `recordProviderError` in `packages/core/src/accounts/health.ts`, Gmail `invalid_grant` mapping. |
| G11 | (Docs check) A consent screen left in "Testing". | Refresh tokens die after 7 days with `invalid_grant`. Keep "In production". | `docs/ops/GOOGLE_SETUP.md`. |

## 3. Microsoft

| # | Step | Expected | If it differs |
|---|---|---|---|
| M1 | Connect Microsoft (popup), then the scripted run. | All PASS. | See below. |
| M2 | Open the received message and view its internet headers (Outlook: File > Properties). | `Message-ID` identical to the sent one (MIME drafts keep it). **Gates P3-T11.** If Graph rewrote it, confirm `findSent(id, { providerMessageId })` still finds the item through the draft id hint, the fallback the design allows, and record that. | `packages/providers/src/graph/provider.ts`, `packages/providers/test/graph-fake.ts`; tell P3-T11. |
| M3 | The provider sets `Prefer: IdType="ImmutableId"`. Compare the draft id returned at send with the id of the item in Sent Items (`GET /me/mailFolders/sentitems/messages?$select=id,internetMessageId,isDraft`). | Identical ids, `isDraft` false. | The `deleteDraft` guard and send recovery in the Graph provider. |
| M4 | `GET /me/messages?$filter=internetMessageId eq '<id>'` and `GET /me/mailFolders/junkemail/messages?$select=id,isDraft,from`. | Both return the expected items. | Query strings in `graph/provider.ts`. |
| M5 | Delta on inbox and sentitems: permanently delete one message, move one message from Junk to Inbox, call the saved delta link again. | A deleted item has `@removed.reason` ("deleted"; a move out of the folder is "changed"). The Junk to Inbox move appears as an added item in the inbox delta. | `@removed` handling and delta fixtures in `graph.test.ts` / `graph-fake.ts`. |
| M6 | Call a very old saved delta link. | 410 Gone. | Expired-cursor mapping. |
| M7 | Read a throttling response (many sends from a test tenant) or a mailbox without Exchange Online. | 429 with `Retry-After`; no mailbox gives 403 `MailboxNotEnabledForRESTAPI`. | `THROTTLE` regex in `packages/providers/src/graph/http.ts`. |
| M8 | Revoke at myapps.microsoft.com, then Run diagnostics and Send test email. | Account "Needs attention"; test-send answers 409 `needs_attention`. | Auth mapping. |
| M9 | Connect from a tenant that requires admin consent. | Connect ends with `admin_consent_required` (AADSTS65001 / 90094). | `graph/oauth.ts`. |

## 4. SMTP/IMAP

| # | Step | Expected | If it differs |
|---|---|---|---|
| S1 | Connect with implicit TLS (993/465), run the script. | All PASS. | |
| S2 | Connect with STARTTLS (143/587). | Connects. A host that does not offer STARTTLS is refused (no plaintext AUTH). | TLS options in `packages/providers/src/imap-smtp/`. |
| S3 | After the run, look in the Sent folder. | Exactly one copy: with "Save sent mail in the Sent folder" on we APPEND it, with it off the server files it. | `defaultAppendToSent` in `imap-smtp/hints.ts`. |
| S4 | Note `UIDVALIDITY` of INBOX and Sent (IMAP `SELECT`, or the account's sync cursor). If the host lets you recreate a folder, do so and sync. | A changed UIDVALIDITY expires the cursor (full resync), never a silent skip. | Expiry logic in the IMAP provider. |
| S5 | Ambiguous send on generic SMTP: drop the connection after DATA is written. | The send ends HELD and no APPEND happened, so the Sent search finds nothing. Never resent automatically. | Nothing to correct; confirms the design. |

## 5. Test-send and cross-cutting checks

| # | Step | Expected |
|---|---|---|
| X1 | Account drawer > Send test email to yourself (tick the authorization box). | "Test email sent."; the message arrives with `X-RightNow-Test: 1`, the account's From name, Reply-To and signature. |
| X2 | Send 6 test emails within 10 minutes. | The 6th answers 429 `rate_limited` with `retryAfterSec`. |
| X3 | Reply to a received test message from your mail client. | The reply threads under the test message in the recipient client. |
| X4 | Send a scratch message with `headers: { "List-Unsubscribe": "<mailto:you@example.com>" }`. | The recipient client shows its unsubscribe control. |
| X5 | Daily usage on the account after the test-sends. | Unchanged: test-sends never touch usage rows. |

## Results

| Date | Provider | Step | Result | Note |
|---|---|---|---|---|
| | | | | |
