# usage: scripts\restore.ps1 backups\rightnow-<ts>.dump  (replaces current data)
param([Parameter(Mandatory)][string]$File)
$f = (Resolve-Path $File).Path
. "$PSScriptRoot\_mode.ps1"
docker compose stop web worker
cmd /c "docker compose exec -T postgres pg_restore -U rightnow -d rightnow --clean --if-exists --no-owner < `"$f`""
if ($LASTEXITCODE -ne 0) { throw "restore failed" }
docker compose @P up -d web worker
