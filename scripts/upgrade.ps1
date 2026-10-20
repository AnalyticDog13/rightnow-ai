# Back up first (scripts\backup.ps1).
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_mode.ps1"
git pull --ff-only
docker compose @P pull --ignore-buildable
docker compose @P build
docker compose @P run --rm migrate
docker compose @P up -d
