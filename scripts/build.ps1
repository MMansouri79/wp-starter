param(
    [Parameter(Mandatory = $true)]
    [string]$Profile,

    [Parameter(Mandatory = $true)]
    [string]$Output
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $RepoRoot "apps\cli\dist\index.js"

if (-not (Test-Path $Cli)) {
    Write-Error "Compiled CLI not found. Run npm install and npm run build first, or use the prebuilt toolkit."
    exit 1
}

node $Cli build --profile $Profile --output $Output
exit $LASTEXITCODE
