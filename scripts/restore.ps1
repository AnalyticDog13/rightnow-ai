# usage: scripts\restore.ps1 [-Yes] backups\rightnow-<ts>.dump  (replaces current data; asks first unless -Yes)
# Validates the dump, saves a pre-restore backup of the current data, recreates the database, migrates and pauses
# every active campaign (rows sent after the dump would otherwise be sent again) before web and worker start.
param([Parameter(Mandatory)][string]$File, [switch]$Yes)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $File -PathType Leaf)) { throw "dump not found: $File" }
$f = (Resolve-Path $File).Path
. "$PSScriptRoot\_mode.ps1"
$toc = cmd /c "docker compose exec -T postgres pg_restore -l < `"$f`""
if ($LASTEXITCODE -ne 0 -or -not $toc) { throw "not a valid dump, nothing changed" }
if (-not $Yes -and (Read-Host "This REPLACES all current data with $File. Type yes to continue") -ne "yes") { throw "cancelled, nothing changed" }
"safety backup of current data:"
$env:BACKUP_PREFIX = "pre-restore"
try { $safety = & "$PSScriptRoot\backup.ps1" } finally { Remove-Item Env:BACKUP_PREFIX }
$safety
X docker compose stop web worker
X docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U rightnow -d postgres -c "DROP DATABASE rightnow WITH (FORCE)" -c "CREATE DATABASE rightnow"
cmd /c "docker compose exec -T postgres pg_restore -U rightnow -d rightnow --no-owner < `"$f`""
if ($LASTEXITCODE -ne 0) { throw "restore failed; web and worker are stopped. Your previous data is in $safety" }
X docker compose @P run --rm migrate
X docker compose @P run --rm --no-deps migrate pause-campaigns
"Active campaigns were paused: sends after this dump would otherwise repeat. Resume them after checking the Sent folders."
X docker compose @P up -d web worker
