#!/bin/sh
# Usage: scripts/rotate-key.sh [NEW_KEY]   (a new key is generated if omitted)
# Backs up, stops web and worker, re-encrypts every stored credential from the .env ENCRYPTION_KEY to NEW_KEY.
# .env is not changed: afterwards set ENCRYPTION_KEY to the new key and start. See docs/ops/KEY_ROTATION.md.
set -e
. "$(dirname "$0")/_mode.sh"
OLD_ENCRYPTION_KEY=$(sed -n 's/^ENCRYPTION_KEY=//p' .env | tail -n 1 | tr -d "\"'\r")
NEW_ENCRYPTION_KEY=${1:-$(openssl rand -base64 32)}
[ -n "$OLD_ENCRYPTION_KEY" ] || { echo "ENCRYPTION_KEY missing in .env" >&2; exit 1; }
export OLD_ENCRYPTION_KEY NEW_ENCRYPTION_KEY
# printed first so it is not lost if a step fails (rerunning with the same key is safe)
echo "New ENCRYPTION_KEY (store it safely now): $NEW_ENCRYPTION_KEY"
sh scripts/backup.sh
docker compose $P stop web worker
docker compose $P run --rm --no-deps -e OLD_ENCRYPTION_KEY -e NEW_ENCRYPTION_KEY migrate rotate-key
echo "Next: set ENCRYPTION_KEY=$NEW_ENCRYPTION_KEY in .env, back it up, then run scripts/start.sh"
