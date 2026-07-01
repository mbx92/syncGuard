@echo off
title SyncGuard - Setup Portable
cd /d "%~dp0"

echo.
echo  ========================================
echo       SyncGuard - Setup Portable
echo  ========================================
echo.

if not exist "tools\node\node.exe" (
    echo  [1/5] Install Node.js portable ke tools\node\ ...
    echo         Butuh internet sekali...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node.ps1"
    if %errorlevel% neq 0 (
        echo  [ERROR] Gagal install Node.js. Jalankan install-node.bat
        pause
        exit /b 1
    )
    echo.
) else (
    echo  [1/5] Node.js portable sudah ada di tools\node\
    echo.
)

call "%~dp0scripts\node-env.bat"
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan.
    pause
    exit /b 1
)

echo  [2/5] Install npm dependencies...
call "%SYNCGUARD_NPM%" install --omit=dev
echo.

if not exist "tools\cwrsync\bin\rsync.exe" (
    echo  [3/5] Install cwRsync ke project...
    call install-cwrsync.bat
) else (
    echo  [3/5] cwRsync sudah ada di tools\cwrsync\
)

if not exist "tools\mc\mc.exe" (
    echo         Install MinIO Client mc ke tools\mc\ ...
    call install-mc.bat
) else (
    echo         mc sudah ada di tools\mc\
)
echo.

echo  [4/5] Buat icon dan shortcut Desktop...
"%SYNCGUARD_NODE%" "%~dp0scripts\convert-icon.mjs"
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal buat icon.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-launcher.ps1"
if %errorlevel% neq 0 pause & exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" -Desktop
echo.

set /p STARTUP="  [5/5] Tambahkan ke Startup Windows? (Y/N): "
if /i "%STARTUP%"=="Y" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" -Startup
    echo  SyncGuard akan jalan otomatis saat login Windows.
) else (
    echo  Startup dilewati. Jalankan install-startup.bat kapan saja.
)

echo.
echo  ----------------------------------------
echo   Selesai! Double-click icon SyncGuard
echo   di Desktop untuk menjalankan.
echo.
echo   Folder ini self-contained:
echo   Node.js ada di tools\node\
echo   Copy ke USB / PC lain tanpa install Node.
echo  ----------------------------------------
echo.
pause
