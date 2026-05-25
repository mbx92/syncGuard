# Resolve bundled Node.js (tools/node) or fallback ke sistem
param(
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot)
)

$AppDir = (Resolve-Path $AppDir).Path
$bundledDir = Join-Path $AppDir 'tools\node'
$bundledNode = Join-Path $bundledDir 'node.exe'
$bundledNpm = Join-Path $bundledDir 'npm.cmd'

if (Test-Path -LiteralPath $bundledNode) {
    $env:PATH = "$bundledDir;$env:PATH"
    return [PSCustomObject]@{
        AppDir = $AppDir
        Node   = $bundledNode
        Npm    = $bundledNpm
        Source = 'bundled'
    }
}

$sysNode = Get-Command node -ErrorAction SilentlyContinue
if ($sysNode) {
    return [PSCustomObject]@{
        AppDir = $AppDir
        Node   = $sysNode.Source
        Npm    = 'npm.cmd'
        Source = 'system'
    }
}

return $null
