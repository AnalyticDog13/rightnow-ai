# usage: scripts\restore.ps1 backups\rightnow-<ts>.dump  (replaces current data)
param([Parameter(Mandatory)][string]$File)
$f = (Resolve-Path $File).Path
. "$PSScriptRoot\_mode.ps1"
docker compose stop web worker
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U rightnow -d postgres -c "DROP DATABASE rightnow WITH (FORCE)" -c "CREATE DATABASE rightnow"
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
cmd /c "docker compose exec -T postgres pg_restore -U rightnow -d rightnow --no-owner < `"$f`""
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
docker compose @P up -d web worker
