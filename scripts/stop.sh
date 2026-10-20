#!/bin/sh
set -e
. "$(dirname "$0")/_mode.sh"
docker compose --profile vps down # keeps volumes (your data)
