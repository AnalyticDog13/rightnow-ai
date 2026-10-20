# Usage: scripts\rotate-key.ps1 [NEW_KEY]   (a new key is generated if omitted)
# Backs up, stops web and worker, re-encrypts every stored credential from the .env ENCRYPTION_KEY to NEW_KEY.
# .env is not changed: afterwards set ENCRYPTION_KEY to the new key and start. See docs/ops/KEY_ROTATION.md.
param([string]$NewKey)
. "$PSScriptRoot\_mode.ps1"
$old = (Select-String -Path .env -Pattern '^ENCRYPTION_KEY=(.*)$' | Select-Object -Last 1).Matches.Groups[1].Value.Trim('"', "'", "`r")
if (-not $old) { throw "ENCRYPTION_KEY missing in .env" }
if (-not $NewKey) {
  $b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $NewKey = [Convert]::ToBase64String($b)
}
$env:OLD_ENCRYPTION_KEY = $old
$env:NEW_ENCRYPTION_KEY = $NewKey
# printed first so it is not lost if a step fails (rerunning with the same key is safe)
"New ENCRYPTION_KEY (store it safely now): $NewKey"
& "$PSScriptRoot\backup.ps1"
X docker compose @P stop web worker
X docker compose @P run --rm --no-deps -e OLD_ENCRYPTION_KEY -e NEW_ENCRYPTION_KEY migrate rotate-key
"Next: set ENCRYPTION_KEY=$NewKey in .env, back it up, then run scripts\start.ps1"
