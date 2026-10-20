#!/bin/sh
# usage: scripts/restore.sh backups/rightnow-<ts>.dump  (replaces current data)
set -e
[ -f "$1" ] || { echo "usage: $0 <dump file>" >&2; exit 1; }
f="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
. "$(dirname "$0")/_mode.sh"
docker compose stop web worker
docker compose exec -T postgres pg_restore -U rightnow -d rightnow --clean --if-exists --no-owner < "$f"
docker compose $P up -d web worker
