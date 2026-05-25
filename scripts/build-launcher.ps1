param(
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot)
)

$AppDir = (Resolve-Path $AppDir).Path
$iconIco = Join-Path $AppDir 'assets\icon.ico'
$csFile = Join-Path $PSScriptRoot 'SyncGuardLauncher.cs'
$exeOut = Join-Path $AppDir 'SyncGuard.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $csc)) {
    Write-Error "C# compiler not found: $csc"
    exit 1
}

if (-not (Test-Path $iconIco)) {
    Write-Error "icon.ico not found. Run: node scripts\convert-icon.mjs"
    exit 1
}

$args = @(
    '/nologo',
    '/target:winexe',
    "/win32icon:$iconIco",
    '/reference:System.Windows.Forms.dll',
    "/out:$exeOut",
    $csFile
)

& $csc @args
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build SyncGuard.exe"
    exit 1
}

Write-Host "Built: $exeOut"
