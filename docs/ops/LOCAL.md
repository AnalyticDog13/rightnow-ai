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
| Restore | `scripts/restore.sh backups/rightnow-<timestamp>.dump` (replaces current data) |
| Upgrade | `scripts/upgrade.sh`: git pull, rebuild, run migrations, restart. Back up first. |

Data lives in the Docker volume `pgdata`. `docker compose down -v` deletes it; the scripts never do.

**Back up `ENCRYPTION_KEY` (from `.env`) together with every database dump.** Stored mailbox credentials are encrypted with it; a dump restored with a different key cannot be decrypted. Keep `.env` out of git and out of the backups folder if that folder is shared.

## While the laptop sleeps

Containers freeze (they are not restarted). Nothing sends or syncs while asleep. On wake, sending resumes only for mailboxes whose last successful sync is recent (`SYNC_MAX_STALENESS_SEC`, default 300 s), so the app first catches up on replies and then sends. Scheduled sends missed during sleep go out late (inside their schedule window) or wait for the next window. Campaigns therefore only progress while the machine is awake; use a VPS ([VPS.md](VPS.md)) for always-on sending.

A send that was in flight when the machine slept or the worker crashed is never resent automatically. After `SEND_LEASE_SEC` (default 600 s, minimum 300) the worker searches the mailbox's Sent folder for it. If the copy is found, it counts as sent. If it is not found twice, 15 minutes apart, the message is HELD until you release or cancel it (`GET /api/v1/scheduled-messages?status=HELD`).

## Limitation: tracking links need a public URL (PS-DEPLOY-13)

With `APP_URL=http://localhost:3000`, open/click tracking links and one-click unsubscribe links point at your own machine, so recipients cannot reach them. Locally, emails carry mailto-only unsubscribe and click/open tracking is unavailable. For tracking, run in VPS mode or expose the app on a public HTTPS URL and set `APP_URL` to it.

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
