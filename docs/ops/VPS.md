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
0 3 * * * cd /home/you/rightnow-ai && scripts/backup.sh >> backups/cron.log 2>&1 && find backups -name '*.dump' -mtime +14 -delete
```

Copy `backups/` off the server (rsync, object storage); a backup on the same disk does not survive losing the VPS. **Store `ENCRYPTION_KEY` with them, in a password manager or other separate secure place.** Without the key, restored mailbox credentials are unreadable. Test a restore occasionally: `scripts/restore.sh backups/<file>.dump`.

## 3b. Tracking domain (optional)

Open and click links use `APP_URL` by default. To send them from your own domain per mailbox, create a `CNAME` record (e.g. `track.example.com`) pointing at `DOMAIN`, set it on the mailbox and run the check in the app. Once it is `VERIFIED`, Caddy requests a certificate for that host on first use (it asks `/api/tracking-domain/check` first, so unknown hostnames get none) and serves only `/t/*` and `/u/*` there. Until it verifies, links keep using `APP_URL`; with a non-https `APP_URL` and no verified domain nothing is tracked.

## 4. Updating

```
scripts/backup.sh && scripts/upgrade.sh
```

`upgrade.sh` pulls the code, rebuilds the image, runs database migrations, and restarts the services. Check with `docker compose ps` (all `healthy`) and `docker compose logs -f web worker`.
