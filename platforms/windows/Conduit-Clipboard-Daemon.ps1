$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$env:CONDUIT_PARENT_PID = "$PID"
$cli = Join-Path $root "runtime/dist/src/cli/index.js"
if (Test-Path $cli) {
  node $cli daemon start --interval-ms 1000
} else {
  npm run conduit -- daemon start --interval-ms 1000
}
