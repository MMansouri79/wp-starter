$RepoRoot = Split-Path -Parent $PSScriptRoot
$Gui = Join-Path $RepoRoot "apps\gui\index.mjs"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
& node $Gui
exit $LASTEXITCODE
