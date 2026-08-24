$RepoRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $RepoRoot "apps\cli\dist\index.js"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
& node $Cli @args
exit $LASTEXITCODE
