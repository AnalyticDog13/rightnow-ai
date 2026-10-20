# Back up first (scripts\backup.ps1).
. "$PSScriptRoot\_mode.ps1"
X git pull --ff-only
X docker compose @P pull --ignore-buildable
X docker compose @P build
X docker compose @P run --rm migrate
X docker compose @P up -d
