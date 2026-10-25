# Running on a VPS (Docker Compose + Caddy HTTPS)

Same compose file as local mode; `MODE=vps` adds the `caddy` service, which gets a Let's Encrypt certificate automatically.

## 1. Server and DNS

- A Linux VPS with Docker Engine + Compose plugin and git (1 vCPU / 2 GB RAM is enough to start).
- Create an `A` (and `AAAA` if you have IPv6) record for your domain, e.g. `app.example.com`, pointing at the server. Wait until it resolves before starting; Caddy needs it to obtain the certificate.
- Firewall: allow inbound 22 (SSH), 80 and 443 only, e.g. `ufw allow 22,80,443/tcp && ufw enable`. Postgres is not published; the web port 3000 is bound to 127.0.0.1.

## 2. Configure

```
git clone <repo> && cd rightnow-ai
cp .env.example .env
```

Edit `.env`:

```
MODE=vps
DOMAIN=app.example.com
APP_URL=https://app.example.com
ENCRYPTION_KEY=<openssl rand -base64 32>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
SETUP_TOKEN=<16+ random characters>
POSTGRES_PASSWORD=<long random string>   # set before the first start
```

Then `scripts/start.sh`, open `https://app.example.com/sign-up` and create the owner with `SETUP_TOKEN`.

## 2b. Private hosts (optional)

Webhook URLs, the AI base URL and the verifier URL must be public by default. `ALLOW_PRIVATE_HTTP_HOSTS=1` in `.env` lets them reach hosts on the server's private network (an Ollama or LM Studio box, an internal webhook receiver). Cloud metadata (169.254.169.254) and link-local addresses stay blocked whatever the setting; leave it unset unless you need it, since it widens what a user-supplied URL can reach.

## 3. Backups (cron)

```
0 3 * * * cd /home/you/rightnow-ai && mkdir -p backups && scripts/backup.sh >> backups/cron.log 2>&1 && find backups -name '*.dump' -mtime +14 -delete
```

Copy `backups/` off the server (rsync, object storage); a backup on the same disk does not survive losing the VPS. **Store `ENCRYPTION_KEY` with them, in a password manager or other separate secure place.** Without the key, restored mailbox credentials are unreadable. Test a restore occasionally on a separate machine or volume, never over the live stack: a restore replaces the data and pauses every active campaign, and the live stack then needs `--yes` or a typed `yes` to proceed. Messages sent after the dump are recognised from the Sent folders and not sent again (see the Restore note in `LOCAL.md` for what is not covered); resume the campaigns when ready.

## 3b. Tracking domain (optional)

Open and click links use `APP_URL` by default. To send them from your own domain per mailbox, create a `CNAME` record (e.g. `track.example.com`) pointing at `DOMAIN`, set it on the mailbox and run the check in the app. Once it is `VERIFIED`, Caddy requests a certificate for that host on first use (it asks `/api/tracking-domain/check` first, so unknown hostnames get none) and serves only `/t/*` and `/u/*` there. Until it verifies, links keep using `APP_URL`; with a non-https `APP_URL` and no verified domain nothing is tracked.

## 3c. Moving from local to a VPS

Proven in CI (`compose-smoke`): a seeded mailbox credential and a 4096-byte attachment survive backup, fresh volume and restore, still decrypt under the same `ENCRYPTION_KEY`, are rejected under another key, and still verify after key rotation. The rest is procedure; tick each checkpoint.

1. [ ] Stop the local stack (`scripts/stop.sh|.ps1`) and keep it stopped: two instances must never sync or send from one mailbox.
2. [ ] On the laptop run `scripts/backup.sh`.
3. [ ] Copy `backups/*.dump` and the `.env` `ENCRYPTION_KEY` to the server out of band (the restore succeeds under any key, but with a different key the app cannot decrypt the stored credentials).
4. [ ] Set up a fresh VPS per sections 1-2 with the same `ENCRYPTION_KEY`; do not start it before the restore.
5. [ ] Run `scripts/restore.sh <dump>` (it pauses every active campaign; resume them once the mailboxes have synced, see the Restore note in `LOCAL.md`), then start the stack.
6. [ ] Verify: sign in, `/api/readyz` is green, each mailbox shows its state, and **manually** download one attachment from the inbox.
7. [ ] Add the new domain's redirect URI in the Google and Microsoft consoles ([GOOGLE_SETUP.md](GOOGLE_SETUP.md), [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md)) and reconnect any account that shows `NEEDS_ATTENTION`.
8. [ ] Switch DNS and tracking-domain CNAMEs only after the checks above pass.
9. [ ] Never restart the local install afterwards (or wipe its volume): it would send the same mail a second time.

First start: an account syncs before it sends (the freshness gate, `SYNC_MAX_STALENESS_SEC`), proved by `packages/core/test/dispatch.test.ts` and `packages/core/test/e2e/downtime.test.ts`; it is not re-tested in CI.

## 4. Updating

```
scripts/upgrade.sh
```

`upgrade.sh` backs up first, then pulls the code, rebuilds the image, runs database migrations, and restarts the services. Check with `docker compose ps` (all `healthy`) and `docker compose logs -f web worker`.
