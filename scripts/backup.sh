#!/bin/sh
# Writes backups/rightnow-<ts>.dump. Also back up ENCRYPTION_KEY (in .env): the dump is useless without it.
set -e
. "$(dirname "$0")/_mode.sh"
mkdir -p backups
f="backups/rightnow-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U rightnow -Fc rightnow > "$f" || { rm -f "$f"; echo "backup failed" >&2; exit 1; }
echo "$f"
