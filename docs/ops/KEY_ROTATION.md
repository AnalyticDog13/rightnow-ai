# Rotating ENCRYPTION_KEY

`ENCRYPTION_KEY` encrypts every stored credential. Lose it and they are unrecoverable, so always back it up together with the database.

1. Back up the database (and the current key).
2. Stop web and worker.
3. Generate a new key: `openssl rand -base64 32`.
4. Run, with `DATABASE_URL` pointing at the database:
   `OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> npx tsx scripts/rotate-key.ts`
   The script re-encrypts each column in `ENCRYPTED_COLUMNS` in one transaction per column. Rerunning after a failure is safe: values already on the new key are skipped. If a value decrypts with neither key, that column is left unchanged and the script exits non-zero.
5. Set `ENCRYPTION_KEY` to the new key in your env and back it up.
6. Start web and worker.
