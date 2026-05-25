# Menjalankan SyncGuard server (dipanggil dari portable-run.ps1)
param(
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot)
)

Set-Location $AppDir
$env:PORT = '7432'
$env:SYNCGUARD_PORTABLE = '1'

$nodeEnv = & (Join-Path $AppDir 'scripts\node-env.ps1') -AppDir $AppDir
if (-not $nodeEnv) { exit 1 }

$logDir = Join-Path $AppDir 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir 'syncguard-server.log'

$serverJs = Join-Path $AppDir 'backend\server.js'
& $nodeEnv.Node $serverJs *>> $logFile 2>&1
