#!/bin/sh
# usage: scripts/restore.sh [--yes] backups/rightnow-<ts>.dump  (replaces current data; asks first unless --yes)
# Validates the dump, saves a pre-restore backup of the current data, recreates the database, migrates and pauses
# every active campaign (defence in depth; sends after the dump are recognised from the Sent folders, D53) before
# web and worker start.
set -e
yes=; [ "$1" = "--yes" ] && { yes=1; shift; }
[ -f "$1" ] || { echo "usage: $0 [--yes] <dump file>" >&2; exit 1; }
f="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
dir="$(dirname "$0")"
. "$dir/_mode.sh"
toc="$(docker compose exec -T postgres pg_restore -l < "$f")" || { echo "not a valid dump, nothing changed" >&2; exit 1; }
[ -n "$toc" ] || { echo "empty dump, nothing changed" >&2; exit 1; }
if [ -z "$yes" ]; then
  printf "This REPLACES all current data with %s. Type yes to continue: " "$1"
  read -r ans; [ "$ans" = yes ] || { echo "cancelled, nothing changed" >&2; exit 1; }
fi
echo "safety backup of current data:"
safety="$(BACKUP_PREFIX=pre-restore sh "$dir/backup.sh")"
echo "$safety"
docker compose stop web worker
# recreate the database: pg_restore --clean cannot drop pg-boss partitioned tables
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U rightnow -d postgres -c "DROP DATABASE rightnow WITH (FORCE)" -c "CREATE DATABASE rightnow"
docker compose exec -T postgres pg_restore -U rightnow -d rightnow --no-owner < "$f" || { echo "restore failed; web and worker are stopped. Your previous data is in $safety" >&2; exit 1; }
docker compose $P run --rm migrate
docker compose $P run --rm --no-deps migrate pause-campaigns
echo "Active campaigns were paused (audit reason: restore). Steps sent after this dump are recognised from each mailbox's Sent folder before anything is sent and are not repeated. Resume the campaigns when ready (docs/ops/LOCAL.md, Restore)."
docker compose $P up -d web worker
