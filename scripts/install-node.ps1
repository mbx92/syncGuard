# Download Node.js LTS win-x64 ke tools/node/ (portable bundle)
param(
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot),
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path $AppDir).Path
$targetDir = Join-Path $AppDir 'tools\node'
$nodeExe = Join-Path $targetDir 'node.exe'

if (Test-Path -LiteralPath $nodeExe) {
    $ver = & $nodeExe -v 2>$null
    Write-Host "Node.js sudah ada: $nodeExe ($ver)"
    exit 0
}

if (-not $Version) {
    Write-Host "Mencari versi Node.js LTS..."
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $lts = @($index | Where-Object { $_.lts -and $_.lts -ne $false })[0]
    if (-not $lts) { throw 'Tidak menemukan release LTS di nodejs.org' }
    $Version = $lts.version
}

$zipName = "node-$Version-win-x64.zip"
$url = "https://nodejs.org/dist/$Version/$zipName"
$tempDir = Join-Path $env:TEMP "syncguard-node-$Version"
$zipPath = Join-Path $env:TEMP $zipName

Write-Host "Download: $url"
if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir -Force

    $extracted = Get-ChildItem -LiteralPath $tempDir -Directory | Where-Object { $_.Name -like 'node-*-win-x64' } | Select-Object -First 1
    if (-not $extracted) { throw "Isi arsip tidak dikenali: $zipName" }

    if (Test-Path $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $targetDir -Parent) -Force | Out-Null
    Move-Item -LiteralPath $extracted.FullName -Destination $targetDir

    if (-not (Test-Path -LiteralPath $nodeExe)) { throw "node.exe tidak ditemukan setelah ekstrak" }

    $ver = & $nodeExe -v
    Write-Host "OK: $nodeExe ($ver)"
} finally {
    if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
