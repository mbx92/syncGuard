# Wrapper: panggil convert-icon.mjs (ICO standar Windows 16/32/48/256)
$nodeScript = Join-Path $PSScriptRoot 'convert-icon.mjs'
if (-not (Test-Path $nodeScript)) {
    Write-Error "convert-icon.mjs not found"
    exit 1
}
& node $nodeScript
exit $LASTEXITCODE
