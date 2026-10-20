# dot-sourced by the other scripts: cd to repo root, set $P to the compose profile flag for VPS mode
Set-Location (Split-Path $PSScriptRoot)
if (-not (Test-Path .env)) { throw ".env missing: copy .env.example and fill it in" }
$P = @(); if (Select-String -Path .env -Pattern '^MODE=vps' -Quiet) { $P = @("--profile", "vps") }
