# Backs up first (migrations are forward-only), then pulls code and images, rebuilds, migrates, restarts.
. "$PSScriptRoot\_mode.ps1"
& "$PSScriptRoot\backup.ps1"
X git pull --ff-only
X docker compose @P pull --ignore-buildable
X docker compose @P build
X docker compose @P run --rm migrate
X docker compose @P up -d
