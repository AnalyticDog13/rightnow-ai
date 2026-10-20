#!/bin/sh
# Back up first (scripts/backup.sh). Pulls code and images, rebuilds, migrates, restarts.
set -e
. "$(dirname "$0")/_mode.sh"
git pull --ff-only
docker compose $P pull --ignore-buildable
docker compose $P build
docker compose $P run --rm migrate
docker compose $P up -d
