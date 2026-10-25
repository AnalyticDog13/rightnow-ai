# Running locally (Docker Compose)

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux), and git.
- Windows: use the `.ps1` scripts in PowerShell; macOS/Linux: the `.sh` scripts.

## First run

1. `cp .env.example .env` and fill in:
   - `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`: `openssl rand -base64 32` each.
   - `SETUP_TOKEN`: any secret string of 16+ characters.
   - Leave `MODE=local` and `APP_URL=http://localhost:3000`. (`DATABASE_URL` in `.env` is for running outside Docker; compose overrides it to point at the `postgres` service.)
2. `scripts/start.sh` (Windows: `scripts\start.ps1`). The first build takes a few minutes.
3. Open http://localhost:3000/sign-up and create the owner account with your `SETUP_TOKEN`. Sign-up closes after the first owner; everyone else joins by invite.
   Always open the app at the exact host in `APP_URL` (e.g. `localhost`, not `127.0.0.1`); a mismatch makes the cross-site check reject every form submission with 403.

## Daily use

| Task | Command |
|---|---|
| Start | `scripts/start.sh` |
| Stop (data is kept) | `scripts/stop.sh` |
| Backup | `scripts/backup.sh` writes `backups/rightnow-<timestamp>.dump` |
| Restore | `scripts/restore.sh backups/rightnow-<timestamp>.dump` (replaces current data; asks for `yes`, or pass `--yes`) |
| Upgrade | `scripts/upgrade.sh`: backs up, then git pull, rebuild, run migrations, restart. |

**Restore pauses every active campaign** (audit log: `campaign.pause` with reason `restore`). Messages sent after the dump was taken are missing from the restored data, but they are not sent again: a mailbox sends only after a full sync, and a campaign step whose copy is already in that workspace's Sent folders is recorded as sent instead (D53). Resume the campaigns only after every mailbox on the Accounts page shows a sync completed since the restore: a mailbox that cannot sync (for example NEEDS_ATTENTION because the restored credentials predate a reconnect) must be fixed first, or its leads are moved to another mailbox that finds no Sent copy and sends step 1 again. Not covered: a sent message deleted from the Sent folder, a mailbox that keeps no Sent copy, and sends made by a version before D53; if any of these applies, cancel the affected leads' rows under Scheduled messages before resuming. The script keeps a `pre-restore-*` dump of the data it replaced and prints its path (also if the restore fails).

Data lives in the Docker volume `pgdata`. `docker compose down -v` deletes it; the scripts never do.

**Back up `ENCRYPTION_KEY` (from `.env`) together with every database dump.** Stored mailbox credentials are encrypted with it; a dump restored with a different key cannot be decrypted. Keep `.env` out of git and out of the backups folder if that folder is shared.

## While the laptop sleeps

Containers freeze (they are not restarted). Nothing sends or syncs while asleep. On wake, sending resumes only for mailboxes whose last successful sync is recent (`SYNC_MAX_STALENESS_SEC`, default 300 s), so the app first catches up on replies and then sends. Scheduled sends missed during sleep go out late (inside their schedule window) or wait for the next window. Campaigns therefore only progress while the machine is awake; use a VPS ([VPS.md](VPS.md)) for always-on sending.

A send that was in flight when the machine slept or the worker crashed is never resent automatically. After `SEND_LEASE_SEC` (default 600 s, minimum 300) the worker searches the mailbox's Sent folder for it. If the copy is found, it counts as sent. If it is not found twice, 15 minutes apart, the message is HELD until you release or cancel it (`GET /api/v1/scheduled-messages?status=HELD`).

## Limitation: tracking links need a public URL (PS-DEPLOY-13)

With `APP_URL=http://localhost:3000`, open/click tracking links and one-click unsubscribe links point at your own machine, so recipients cannot reach them. Locally, emails carry mailto-only unsubscribe and click/open tracking is unavailable. For tracking, run in VPS mode or expose the app on a public HTTPS URL and set `APP_URL` to it.

To try tracking from a laptop, start a tunnel to port 3000 (for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`), set `APP_URL` in `.env` to the HTTPS address it prints and restart. The address changes on every tunnel start for the free tiers, and links already sent keep the old address, so use a tunnel for tests, not for a real campaign. Accounts with a custom tracking domain also need its CNAME to point at the `APP_URL` host (the account's connection test reports `tracking_cname`).

## Dry-run mode: no real mailbox needed (PS-DEPLOY-15)

`MAIL_PROVIDER_FAKE=1` in `.env` replaces Gmail, Microsoft and IMAP/SMTP with an in-process fake mailbox (state in `FAKE_MAIL_DIR`). Connect an account of any type, build a campaign, launch it, and the whole pipeline (planner, send queue, sync, replies, bounces, warm-up, placement tests) runs against it without contacting a provider. Read a fake mailbox through `GET /api/v1/_fake/mailbox/<address>`. The app refuses this flag when `MODE=vps`. Real providers stay off for campaign sending until `scripts/live-verify.ts` passes ([LIVE_VERIFICATION.md](LIVE_VERIFICATION.md), D17).

## Private hosts for webhooks, the AI base URL and the verifier

By default a webhook URL, the AI base URL (Settings, AI) and the email-verifier URL must resolve to public addresses. Set `ALLOW_PRIVATE_HTTP_HOSTS=1` in `.env` to let them reach a LAN or loopback host, for example a local Ollama or LM Studio server or a webhook receiver on your network. Cloud metadata endpoints (169.254.169.254 and similar) and link-local addresses stay blocked whatever the setting. It does not affect mail hosts (`ALLOW_PRIVATE_MAIL_HOSTS`).

## Sending limits per account

The daily limit you set is never allowed above half of the provider's rolling 24-hour cap. Calendar-day
counting is only safe against a rolling window with that margin. Larger values are saved at the maximum
and the page tells you so.

| Account type | Provider cap (default / highest you can set) | Highest daily limit | Minimum gap |
|---|---|---|---|
| Google Workspace | 1500 / 2000 | 750 | none |
| Gmail (gmail.com) | 400 / 500 | 200 | none |
| Microsoft 365 | 5000 / 10000 | 2500 | 3 s |
| Outlook.com, Hotmail, Live | 250 / 300 | 125 | 3 s |
| SMTP | 100 / 10000 | 50 | none |

New accounts start at 30 a day (or the maximum, if lower). Counts follow the account's own timezone.

Rate limits in local mode: no client header is trusted, so every caller counts as one client (`local`), for example 5
sign-ins a minute in total. `npm run dev` (`next dev`) listens on all interfaces, so other hosts on your LAN can reach it
and share that bucket; Docker Compose binds web to `127.0.0.1` only.

## Lost two-factor device

A user who lost both the authenticator app and the 10 backup codes is locked out of sign-in. The operator turns two-factor off for that user (this ends their sessions and writes an `auth.2fa_disable` audit row with `via: "ops"`); they then sign in with the password and enrol again in Settings > Security:

`DATABASE_URL=... npx tsx scripts/disable-2fa.ts user@example.com`

With Compose, run it from the repo root against the published Postgres port, or inside the `migrate` image the same way `rotate-key` runs.
