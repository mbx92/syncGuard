@echo off
title SyncGuard - Install Node.js (portable)
cd /d "%~dp0"

echo.
echo  Menginstall Node.js LTS ke tools\node\ ...
echo  (Butuh koneksi internet, sekali saja)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node.ps1"
if %errorlevel% neq 0 (
    echo.
    echo  Gagal. Cek koneksi internet atau install Node.js manual:
    echo  https://nodejs.org/dist/
    pause
    exit /b 1
)

echo.
echo  Node.js portable siap di: tools\node\node.exe
echo.
pause
