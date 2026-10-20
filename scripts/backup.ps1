# Writes backups\rightnow-<ts>.dump, readable only by you. Also back up ENCRYPTION_KEY (in .env).
. "$PSScriptRoot\_mode.ps1"
$prefix = if ($env:BACKUP_PREFIX) { $env:BACKUP_PREFIX } else { "rightnow" }
New-Item -ItemType Directory -Force backups | Out-Null
X icacls backups /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
$f = "backups\$prefix-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
# cmd keeps the binary dump intact (PowerShell 5.1 redirection would re-encode it)
cmd /c "docker compose exec -T postgres pg_dump -U rightnow -Fc rightnow > $f"
if ($LASTEXITCODE -ne 0) { Remove-Item -ErrorAction SilentlyContinue $f; throw "backup failed" }
$f
