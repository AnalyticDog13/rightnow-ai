# Connecting Google (Gmail) mailboxes

Free Gmail and Google Workspace both work. One Google Cloud project serves every mailbox you connect.

## 1. Create the project and enable Gmail

1. Open https://console.cloud.google.com and create a project (any name, for example "rightnow").
2. APIs & Services > Library > search "Gmail API" > Enable.

## 2. Configure the consent screen and publish it

1. APIs & Services > OAuth consent screen. User type **External** (Internal if every mailbox is in your own Workspace domain).
2. Fill in the app name and your email. Add the two scopes below under "Data access".
3. **Set the publishing status to "In production" (Publish app).** An External app left in "Testing" gets refresh tokens that **expire after 7 days**, so every mailbox would silently disconnect weekly (`invalid_grant`). The "Google hasn't verified this app" warning is expected for a single owner: click Advanced > Go to app. You do not need verification for your own mailboxes.

Scopes, verbatim:

```
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
```

Why `gmail.modify` and not `gmail.readonly` (decision D12): rescuing mail from spam and marking replies read (warm-up) need modify access. Adding a scope later would force every mailbox to reconnect. Both scopes are in Google's restricted class; that costs nothing for a self-hosted single owner.

## 3. Create the OAuth client

1. APIs & Services > Credentials > Create credentials > OAuth client ID > **Web application**.
2. Authorized redirect URI, exactly (it is built from `APP_URL`; the scheme, host and port must match):
   `${APP_URL}/api/v1/oauth/google/callback`, for example `http://localhost:3000/api/v1/oauth/google/callback` locally or `https://mail.example.com/api/v1/oauth/google/callback` on a VPS.
3. Copy the client ID and secret into `.env`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

4. Restart the stack. Without these two variables the "Connect Google" button is disabled with a message; nothing else is affected.

## 4. Connect a mailbox

Email Accounts > Connect Google. Tick both permission boxes. If you untick one, the connection is refused with "both permissions are required". If the browser blocks the popup, the page redirects to Google instead and returns to the list.

The session cookie must stay `SameSite=Lax` (the default): Google redirects back as a cross-site top-level navigation, and `Strict` would make you look signed out on return.

## Sending limits

Google enforces its own daily limits per mailbox; we stay at half of them: free Gmail about 400 per rolling 24 h (we cap at 200 per day), Google Workspace about 1,500 (we cap at 750). The cap is set from the address domain (`gmail.com` / `googlemail.com` is free Gmail, anything else is Workspace).

## Troubleshooting

- **`invalid_grant` / mailbox shows "needs reconnect":** the refresh token was revoked, expired, or the password changed. The most common cause is a consent screen still in **Testing** (7-day expiry): publish it "In production", then reconnect the mailbox from its row (same account, history kept).
- **"Google did not return a refresh token":** remove the app at https://myaccount.google.com/permissions and connect again.
- **`redirect_uri_mismatch`:** the URI in the Cloud console differs from `${APP_URL}/api/v1/oauth/google/callback`. Check scheme, host, port and trailing slash.
- **`access_denied`:** you cancelled, or (Testing mode) the address is not on the test-user list. Publish the app.
