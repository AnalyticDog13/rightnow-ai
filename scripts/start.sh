#!/bin/sh
set -e
. "$(dirname "$0")/_mode.sh"
docker compose $P up -d --build
