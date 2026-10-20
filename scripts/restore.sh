#!/bin/sh
# usage: scripts/restore.sh backups/rightnow-<ts>.dump  (replaces current data)
set -e
[ -f "$1" ] || { echo "usage: $0 <dump file>" >&2; exit 1; }
f="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
. "$(dirname "$0")/_mode.sh"
docker compose stop web worker
# recreate the database: pg_restore --clean cannot drop pg-boss partitioned tables
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U rightnow -d postgres -c "DROP DATABASE rightnow WITH (FORCE)" -c "CREATE DATABASE rightnow"
docker compose exec -T postgres pg_restore -U rightnow -d rightnow --no-owner < "$f"
docker compose $P up -d web worker
