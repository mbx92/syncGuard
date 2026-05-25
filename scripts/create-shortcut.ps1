param(
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$Desktop,
    [switch]$Startup,
    [switch]$All
)

if ($All) { $Desktop = $true; $Startup = $true }

$AppDir = (Resolve-Path $AppDir).Path
$wsh = New-Object -ComObject WScript.Shell
$target = Join-Path $AppDir 'SyncGuard.exe'
$desc = 'SyncGuard - NAS Backup Manager (portable)'

if (-not (Test-Path -LiteralPath $target)) {
    Write-Error "SyncGuard.exe not found. Run setup-portable.bat first."
    exit 1
}

function New-SyncGuardShortcut($location) {
    if (Test-Path -LiteralPath $location) {
        Remove-Item -LiteralPath $location -Force
    }
    $sc = $wsh.CreateShortcut($location)
    $sc.TargetPath = $target
    $sc.WorkingDirectory = $AppDir
    $sc.Description = $desc
    $sc.WindowStyle = 1
    $sc.IconLocation = "$target,0"
    $sc.Save()
    Write-Host "Shortcut: $location"
}

if ($Desktop -or (-not $Desktop -and -not $Startup)) {
    $desk = [Environment]::GetFolderPath('Desktop')
    New-SyncGuardShortcut (Join-Path $desk 'SyncGuard.lnk')
}

if ($Startup) {
    $startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    New-SyncGuardShortcut (Join-Path $startupDir 'SyncGuard.lnk')
}
