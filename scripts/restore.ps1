# usage: scripts\restore.ps1 backups\rightnow-<ts>.dump  (replaces current data)
# Validates the dump, saves a pre-restore backup of the current data, then recreates the database.
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $File -PathType Leaf)) { throw "dump not found: $File" }
$f = (Resolve-Path $File).Path
. "$PSScriptRoot\_mode.ps1"
$toc = cmd /c "docker compose exec -T postgres pg_restore -l < `"$f`""
if ($LASTEXITCODE -ne 0 -or -not $toc) { throw "not a valid dump, nothing changed" }
"safety backup of current data:"
$env:BACKUP_PREFIX = "pre-restore"
try { & "$PSScriptRoot\backup.ps1" } finally { Remove-Item Env:BACKUP_PREFIX }
X docker compose stop web worker
X docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U rightnow -d postgres -c "DROP DATABASE rightnow WITH (FORCE)" -c "CREATE DATABASE rightnow"
cmd /c "docker compose exec -T postgres pg_restore -U rightnow -d rightnow --no-owner < `"$f`""
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
X docker compose @P run --rm migrate
X docker compose @P up -d web worker
