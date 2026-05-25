# SyncGuard portable launcher — dipanggil dari SyncGuard.exe / SyncGuard.vbs
param(
    [string]$AppDir = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

Set-Location $AppDir
$ErrorActionPreference = 'SilentlyContinue'

function Show-Error($msg) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($msg, 'SyncGuard', 'OK', 'Error') | Out-Null
}

function Test-PortListening([int]$Port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($c) { return $true }
    } catch {}
    return [bool](netstat -ano | Select-String ":$Port\s+.*LISTENING")
}

function Test-SyncGuardApi([int]$Port) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/server-info" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-SyncGuardReady([int]$Port, [int]$TimeoutSec = 25) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-SyncGuardApi $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

$nodeEnv = & (Join-Path $AppDir 'scripts\node-env.ps1') -AppDir $AppDir
if (-not $nodeEnv) {
    Show-Error "Node.js tidak ditemukan.`n`nJalankan setup-portable.bat sekali."
    exit 1
}

$npmCmd = if ($nodeEnv.Source -eq 'bundled') { $nodeEnv.Npm } else { 'npm.cmd' }
$port = 7432

& "$AppDir\scripts\stop-port.ps1" -Port $port -Quiet | Out-Null
Start-Sleep -Milliseconds 400

if (Test-SyncGuardApi $port) {
    Start-Process "http://localhost:$port"
    exit 0
}

if (-not (Test-Path "$AppDir\node_modules")) {
    $npmProc = Start-Process -FilePath $npmCmd -ArgumentList 'install', '--omit=dev' `
        -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru -Wait
    if ($npmProc -and $npmProc.ExitCode -ne 0) {
        Show-Error "npm install gagal. Cek koneksi internet lalu jalankan setup-portable.bat."
        exit 1
    }
}

$startScript = Join-Path $AppDir 'scripts\start-server-hidden.ps1'
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`" -AppDir `"$AppDir`"" `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden | Out-Null

if (Wait-SyncGuardReady $port) {
    Start-Process "http://localhost:$port"
    exit 0
}

$logFile = Join-Path $AppDir 'logs\syncguard-server.log'
$tail = ''
if (Test-Path $logFile) {
    $tail = (Get-Content $logFile -Tail 8 -ErrorAction SilentlyContinue) -join "`n"
}
Show-Error @"
Server tidak dapat dimulai (port $port).

Cek log:
$logFile

$tail

Coba jalankan start.bat untuk melihat error di konsol.
"@
exit 1
