param(
    [string]$Version,
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot),
    [string]$IssPath = (Join-Path $PSScriptRoot 'syncguard-installer.iss')
)

$ErrorActionPreference = 'Stop'

$AppDir = (Resolve-Path $AppDir).Path
$IssPath = (Resolve-Path $IssPath).Path

if (-not $Version) {
    $pkgPath = Join-Path $AppDir 'package.json'
    if (-not (Test-Path $pkgPath)) {
        throw "package.json tidak ditemukan: $pkgPath"
    }
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $Version = [string]$pkg.version
}

if (-not $Version -or -not ($Version -match '^\d+\.\d+\.\d+([\-+].+)?$')) {
    throw "Version tidak valid: '$Version' (contoh: 1.0.1 atau 1.0.1-beta.1)"
}

$isccCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
)

$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
    throw 'ISCC.exe tidak ditemukan. Install Inno Setup 6 terlebih dulu.'
}

Write-Host "Building installer version: $Version"
Write-Host "ISCC: $iscc"

$mcBundled = Join-Path $AppDir 'tools\mc\mc.exe'
$mcRoot = Join-Path $AppDir 'mc.exe'
if (-not (Test-Path $mcBundled)) {
    if (Test-Path $mcRoot) {
        $mcDir = Split-Path $mcBundled
        New-Item -ItemType Directory -Force -Path $mcDir | Out-Null
        Copy-Item -Path $mcRoot -Destination $mcBundled -Force
        Write-Host "mc.exe disalin ke tools\mc\ untuk installer offline."
    } else {
        Write-Warning 'mc.exe tidak ditemukan. Letakkan mc.exe di root project atau tools\mc\ sebelum build installer MinIO offline.'
    }
} else {
    Write-Host "mc.exe bundled: tools\mc\mc.exe"
}

& $iscc "/DMyAppVersion=$Version" $IssPath
if ($LASTEXITCODE -ne 0) {
    throw "Build installer gagal (exit $LASTEXITCODE)."
}

$output = Join-Path $AppDir "dist\SyncGuard-Setup-Offline-$Version.exe"
if (Test-Path $output) {
    Write-Host "Installer siap: $output"
} else {
    Write-Warning "Build selesai, tapi file output tidak ditemukan di path default: $output"
}
