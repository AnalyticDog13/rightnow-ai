# Email Provider Compliance Gate

Researched 2026-10-19. "Verified" = read on the official page today; "From knowledge" = long-standing rule not re-fetched, confirm before relying on it. Not legal advice.

## 1. Gmail API
Sources: https://developers.google.com/workspace/gmail/api/auth/scopes , https://support.google.com/a/answer/81126 , https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace

| Scope | Class (verified) | Use |
|---|---|---|
| gmail.send | Sensitive | Send only. OAuth verification, no CASA. |
| gmail.modify | Restricted | Read, label, send, mark read. |
| gmail.readonly | Restricted | Read replies/bounces. |
| gmail.compose, gmail.metadata | Restricted | Not needed. |

- Public multi-user apps with restricted scopes need Google OAuth verification plus an annual third-party CASA security assessment (Tier 2 for server-side apps; cost reports range $500-$75k, vendor sources, unverified). Official: https://appdefensealliance.dev/casa
- **Self-hosted model avoids this:** each owner creates their own Google Cloud project and OAuth client and is the app's only user. Unverified app = warning screen and 100-user cap, fine for one owner (from knowledge).
- **Critical (from knowledge, https://developers.google.com/identity/protocols/oauth2#expiration):** an External app left in "Testing" status gets refresh tokens that expire after 7 days. Setup docs must tell the owner to set the consent screen to "In production" (stays unverified) or use an Internal Workspace app. Handle `invalid_grant` by marking the mailbox "needs reconnect" and stopping sends.
- Reading replies needs gmail.readonly or gmail.modify (restricted). gmail.send alone cannot detect replies; offer IMAP as the fallback.

Limits (verified, Workspace): 2,000 messages/day per user (1,500 via mail merge), 10,000 total recipients/day, 3,000 external recipients/day, 3,000 unique recipients/day (trial: 500), rolling 24h; Gmail API max 500 recipients per message. Consumer @gmail.com: about 500/day (from knowledge; not on the Workspace page). New mailboxes need warm-up far below caps (our policy, not a Google rule).

Bulk sender rules (verified; formally apply at >5,000 msgs/day to Gmail, treat as baseline for all): SPF + DKIM (>=1024 bit, 2048 recommended) + DMARC (p=none ok); From domain aligned with SPF or DKIM; Postmaster Tools spam rate below 0.30% (aim <0.10%); marketing mail needs one-click unsubscribe with both `List-Unsubscribe: <https-url>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) plus a visible body link. Honor within 2 days (from knowledge; the page states no deadline).

### Gmail push and sync
Source: https://developers.google.com/workspace/gmail/api/guides/push (verified)
- `users.watch` with a Pub/Sub topic; grant `publish` to `gmail-api-push@system.gserviceaccount.com`. Watch expires in 7 days: re-call at least every 7 days, recommended daily. Max 1 notification/sec per user; notifications can be delayed or dropped, so also poll `history.list` periodically.
- Notification carries only `emailAddress` + `historyId`; call `history.list(startHistoryId=last)`, store the newest `historyId`.
- historyId validity: usually at least a week, sometimes only hours (from knowledge, https://developers.google.com/workspace/gmail/api/guides/sync). If `history.list` returns **404**, discard the cursor, do a full resync of recent messages, then store a fresh historyId from `users.getProfile`.
- Pub/Sub push needs a public HTTPS URL; a laptop install cannot receive it. Default to polling every 1-2 min (or Pub/Sub pull); make push optional.

## 2. Microsoft Graph / Exchange Online
Sources: https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits , https://learn.microsoft.com/en-us/graph/api/resources/subscription , https://techcommunity.microsoft.com/blog/outlook/strengthening-email-security-outlook-new-requirements-for-high-volume-senders/4399730
- Delegated scopes: `Mail.Send`, `Mail.ReadWrite`, `offline_access`, `User.Read`. Per-owner Entra app registration (multi-tenant + personal accounts). No Microsoft security assessment; tenant admins may block user consent, then admin consent is needed.
- Limits (verified): recipient rate limit 10,000 recipients/day per mailbox (rolling 24h; distribution groups count as 1); message rate limit 30 messages/minute (SMTP submission rejected above it); tenant external recipient limit (TERRL) scales with licenses and may be lower. Consumer outlook.com limits are lower and undisclosed; use 250-300/day (from knowledge).
- Delta queries: `GET /me/mailFolders/inbox/messages/delta`, persist `@odata.deltaLink`; use for reply sync and as the poll fallback.
- Webhook subscriptions (verified): Outlook message max lifetime 10,080 minutes (under 7 days); rich notifications with resource data 1,440 minutes; minimum 45 minutes. Needs a public HTTPS notificationUrl, validation-token handshake, `clientState` check, and `lifecycleNotificationUrl` for `reauthorizationRequired`/`missed`. Renew daily. Same laptop caveat: default to delta polling.
- Outlook.com high-volume rules (search-verified, sources conflict on details): domains sending >5,000/day to outlook.com/hotmail.com/live.com need SPF, DKIM, DMARC (at least p=none, aligned); enforcement from 2025-05-05; non-compliant mail goes to Junk and may be rejected (code reported as 550 5.7.515 or 5.7.15).

## 3. IMAP / SMTP (app passwords, other hosts)
- Gmail app passwords require 2-Step Verification. Microsoft 365 disables SMTP AUTH basic auth by default in many tenants (verify); prefer OAuth. Shared hosts commonly allow 100-500 messages/day; make the cap a required per-mailbox setting, default 100/day.
- IMAP connection limits are small (Gmail about 15 simultaneous); one IDLE connection per mailbox, reconnect with backoff. Gmail/Outlook SMTP save to Sent automatically; generic hosts may not.
- Always set `Message-ID`, `Date`, and `In-Reply-To`/`References` on follow-ups.

## 4. CAN-SPAM, GDPR/PECR (cold email; from knowledge)
Sources: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business , https://gdpr-info.eu
- CAN-SPAM (US, applies to B2B too): accurate From/Reply-To and non-deceptive subject; valid physical postal address in every message; clear opt-out working at least 30 days; honor opt-outs within 10 business days, no fee, no further mail, never sell the address. Penalties are per message.
- GDPR/UK PECR: B2B cold email to corporate addresses may rely on legitimate interest (Art. 6(1)(f)) in some states; individuals and UK sole traders generally need consent. Must disclose data source and rights (Art. 14), honor objection/erasure, keep a record of lawful basis. Store per-lead `country`, `lawful_basis`, `source`.
- Suppression is permanent, workspace-wide, and checked at send time, not only at enqueue.

## Rules our code must enforce
- [ ] Every campaign message carries `List-Unsubscribe: <https://.../u/token>, <mailto:...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the endpoint accepts unauthenticated POST and is idempotent.
- [ ] Visible unsubscribe link and the sender's physical postal address in every campaign footer; sending blocked while the workspace address is empty.
- [ ] Unsubscribe, hard bounce, spam complaint, "not interested" go to the suppression list immediately; re-checked in the same transaction that claims a send.
- [ ] Per-mailbox daily cap defaults: Gmail Workspace 1,500, @gmail.com 400, Microsoft 365 5,000 recipients, outlook.com 250, generic SMTP 100. Hard-clamp to provider maxima even if the user enters more; rolling 24h window; warm-up ramp for new mailboxes; Microsoft max 25 msgs/minute (limit 30).
- [ ] One recipient per message (no Cc/Bcc fan-out) so quota maps 1:1 to messages.
- [ ] On `invalid_grant`/401/revoked or Testing-mode token expiry: pause the mailbox, show "reconnect", never retry auth failures blindly.
- [ ] 4xx/429: exponential backoff honoring `Retry-After`; 5xx/550 permanent failures are bounces and never retried.
- [ ] Auto-pause mailbox/campaign when bounce rate >2% or complaint rate >0.1% over a rolling window (Gmail hard line is 0.3%).
- [ ] Pre-send DNS check per sending domain: SPF, DKIM (>=1024 bit), DMARC present and aligned; warn loudly, block campaigns when absent.
- [ ] Self-hosted per-owner OAuth clients (Google project, Entra app); never ship a shared client; client secrets and tokens encrypted at rest. Setup docs: publish Google consent screen to "In production".
- [ ] Minimal scopes: gmail.send + gmail.modify (D12: modify instead of readonly so spam rescue and mark-read need no later reconnect); Graph delegated Mail.Send + Mail.ReadWrite.
- [ ] Gmail watch and Graph subscription renewal jobs (daily) plus polling fallback; on Gmail history 404 run a full resync.
- [ ] Reply, out-of-office and bounce detection stops the sequence for that lead; GDPR delete/export removes personal data but keeps a hashed suppression entry.
- [ ] Sends respect lead/campaign timezone and business-hours window, and never run while the mailbox is paused.
