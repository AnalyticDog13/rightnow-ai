# Rotating ENCRYPTION_KEY

`ENCRYPTION_KEY` encrypts every stored credential (mailbox OAuth tokens and SMTP/IMAP passwords, pending OAuth verifiers). Lose it and they are unrecoverable, so always back it up together with the database.

## Docker Compose (local and VPS)

Run from the repo root, optionally passing the new key (one is generated with `openssl rand -base64 32` otherwise):

- Linux/macOS: `scripts/rotate-key.sh [NEW_KEY]`
- Windows: `scripts\rotate-key.ps1 [NEW_KEY]`

The script:

1. Prints the new key first. Store it safely right away.
2. Backs up the database (`scripts/backup.*`).
3. Stops web and worker (`docker compose stop web worker`); Postgres keeps running.
4. Runs `docker compose run --rm --no-deps -e OLD_ENCRYPTION_KEY -e NEW_ENCRYPTION_KEY migrate rotate-key`, which re-encrypts every column in `ENCRYPTED_COLUMNS` from the `.env` key to the new one and prints `Model.field: re-encrypted N` per column.
5. Leaves `.env` unchanged. Then set `ENCRYPTION_KEY=<new key>` in `.env`, back up the new key, and start with `scripts/start.*`.

Each column is re-encrypted in one transaction. If a value decrypts with neither key, that column is left unchanged and the script exits non-zero with the column and row id. Rerunning with the same two keys is safe: values already on the new key are skipped. Until you change `.env`, the old key stays valid for any column that was not rotated.

## Without Compose

Stop web and worker, back up, then with `DATABASE_URL` pointing at the database:
`OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> npx tsx scripts/rotate-key.ts`
Then set `ENCRYPTION_KEY` to the new key, back it up, and start web and worker.

## Unsubscribe links

Unsubscribe links in sent emails are signed with a key derived from `ENCRYPTION_KEY` (HKDF), and emails stay in inboxes for years. `rotate-key` does not touch them, so after rotating, set `OLD_ENCRYPTION_KEY=<previous key>` in `.env` next to the new `ENCRYPTION_KEY`. New links use the new key; links signed with the old one still verify. Without it, old links show "This unsubscribe link is invalid", which is a compliance problem (CAN-SPAM requires an opt-out to work for at least 30 days after sending). Keep it until you no longer care about links in mail older than that, then remove it.

Only one previous key is honored. Rotating twice invalidates links signed with the key before the previous one, so keep `OLD_ENCRYPTION_KEY` as the key you just replaced and do not rotate again until old mail no longer matters.
