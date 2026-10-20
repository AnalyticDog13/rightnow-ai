# dot-sourced by the other scripts: fail fast, cd to repo root, set $P to the compose profile flag for VPS mode
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot)
if (-not (Test-Path .env)) { throw ".env missing: copy .env.example and fill it in" }
$P = @(); if (Select-String -Path .env -Pattern '^MODE=vps' -Quiet) { $P = @("--profile", "vps") }
# run a native command, throw if it fails
function X { $a = $args; & $a[0] $a[1..($a.Count - 1)]; if ($LASTEXITCODE -ne 0) { throw "failed: $a" } }
