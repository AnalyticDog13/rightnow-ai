#!/bin/sh
# Backs up first (migrations are forward-only), then pulls code and images, rebuilds, migrates, restarts.
set -e
. "$(dirname "$0")/_mode.sh"
sh "$(dirname "$0")/backup.sh"
git pull --ff-only
docker compose $P pull --ignore-buildable
docker compose $P build
docker compose $P run --rm migrate
docker compose $P up -d
