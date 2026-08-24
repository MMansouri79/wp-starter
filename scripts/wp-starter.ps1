$RepoRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $RepoRoot "apps\cli\dist\index.js"
& node $Cli @args
exit $LASTEXITCODE
