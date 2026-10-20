# Connecting Microsoft 365 / Outlook.com mailboxes

Microsoft 365 work and school accounts and personal Outlook.com, Hotmail, Live and MSN accounts all connect through one Microsoft Entra app registration. Mail is sent and read through Microsoft Graph with OAuth. No SMTP password is involved.

**Use this route instead of SMTP.** Microsoft turns SMTP AUTH (basic authentication) off by default in most Microsoft 365 tenants and for Outlook.com. If adding the mailbox over SMTP fails with an authentication error, connect it here.

## 1. Register the app

1. Open https://entra.microsoft.com > Identity > Applications > App registrations > New registration. (Personal-only setups can use https://portal.azure.com the same way.)
2. Name: anything, for example "rightnow".
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (multitenant plus personal). This is what lets both Microsoft 365 and Outlook.com mailboxes connect.
4. Redirect URI: platform **Web**, exactly `${APP_URL}/api/v1/oauth/microsoft/callback`, for example `http://localhost:3000/api/v1/oauth/microsoft/callback` locally or `https://mail.example.com/api/v1/oauth/microsoft/callback` on a VPS. The scheme, host and port must match `APP_URL`.
5. Register. Copy the **Application (client) ID**.

## 2. Create a client secret

Certificates & secrets > New client secret. Copy the **Value** immediately (it is shown once). Secrets expire (24 months at most); put the expiry in your calendar, because an expired secret stops every refresh with `invalid_client`.

## 3. Add the permissions

API permissions > Add a permission > Microsoft Graph > **Delegated permissions**, then add exactly:

```
Mail.Send
Mail.ReadWrite
offline_access
User.Read
```

`Mail.ReadWrite` is needed to rescue replies from Junk and mark them read. None of these needs admin consent in a default tenant, but see below.

## 4. Configure rightnow

```
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<secret value>
MS_TENANT=common
```

Restart the stack. Without `MS_CLIENT_ID` and `MS_CLIENT_SECRET` the "Connect Microsoft" button is disabled with a message; nothing else is affected.

`MS_TENANT` chooses the sign-in authority (it applies to both the authorize and the token endpoint):

| Value | Who can connect |
|---|---|
| `common` (default) | work/school and personal accounts |
| `organizations` | work/school accounts only |
| `consumers` | personal accounts only |
| a tenant id (GUID) | only that one organization (the app registration must then be single-tenant for that directory) |

## 5. Connect a mailbox

Email Accounts > Connect Microsoft, sign in, accept the permissions. A mailbox that stops working shows "needs reconnect": use Reconnect on its row (same account, history kept).

## Admin consent

Some organizations forbid users from approving apps themselves. The connect then ends with "Your organization requires an administrator to approve this app" (`AADSTS65001` / `AADSTS90094`). A tenant admin can approve it once for everyone in Entra: Enterprise applications > the app > Permissions > Grant admin consent, or send the admin the link `https://login.microsoftonline.com/<tenant>/adminconsent?client_id=<client id>`.

## Removing access

**Disconnect in rightnow only deletes the tokens stored here.** Microsoft has no per-token revocation we can call without signing the user out of everything, so the grant stays on the Microsoft side until the user removes it:

- Work or school account: https://myapps.microsoft.com > the account menu > Manage your account > Organizations / "My apps" > select the app > Revoke permissions (or "Remove").
- Personal account: https://account.live.com/consent/Manage > the app > Remove these permissions.

## Sending limits

Microsoft enforces its own limits per mailbox; we stay at half of them: Microsoft 365 about 10,000 recipients a day (we cap at 2,500 messages a day by default, adjustable), Outlook.com about 300 a day (we cap at 125). Graph allows about 30 messages a minute and about 4 concurrent requests per mailbox, so Microsoft accounts have a minimum **3 second** gap between sends that cannot be lowered. The tier comes from the address domain (`outlook.com`, `hotmail.com`, `live.com`, `msn.com` are Outlook.com; anything else is Microsoft 365).

## Troubleshooting

- **`invalid_grant` / "needs reconnect":** the refresh token was revoked, the password changed or an admin removed consent. Reconnect from the account row. A brief Microsoft outage is not treated as this: token-server 5xx errors are retried.
- **`invalid_client`:** the client secret is wrong or expired. Create a new one (step 2) and update `MS_CLIENT_SECRET`.
- **`redirect_uri_mismatch` / AADSTS50011:** the URI in the registration differs from `${APP_URL}/api/v1/oauth/microsoft/callback`.
- **Sending fails with 403 / "MailboxNotEnabledForRESTAPI":** the mailbox has no Exchange Online license (or is on-premises). It is retried as a temporary error and never disconnects the account.
- **Both permissions are required:** the consent screen was accepted with a permission removed. Connect again and accept everything.
