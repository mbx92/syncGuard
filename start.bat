@echo off
title SyncGuard - NAS Backup (jangan tutup jendela ini)
cd /d "%~dp0"

echo.
echo  ========================================
echo         SyncGuard - NAS Backup
echo  ========================================
echo.

call "%~dp0scripts\node-env.bat"
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan.
    echo          Jalankan install-node.bat atau setup-portable.bat
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  Installing dependencies...
    call "%SYNCGUARD_NPM%" install --omit=dev
    echo.
)

if not exist "tools\cwrsync\bin\rsync.exe" (
    echo  [INFO] cwRsync belum terinstall di project.
    echo         Jalankan install-cwrsync.bat sekali.
    echo.
)

echo  Memeriksa port 7432...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-port.ps1" -Port 7432 -Quiet
echo.

set PORT=7432
set SYNCGUARD_DESKTOP=1

echo  Memulai server...
echo  Dashboard: http://localhost:7432
echo  Node: %SYNCGUARD_NODE_SOURCE% (%SYNCGUARD_NODE%)
echo.
echo  +---------------------------------------------------------+
echo  ^|  Tutup SyncGuard:                                       ^|
echo  ^|    - Tekan Ctrl+C di jendela ini, ATAU                  ^|
echo  ^|    - Klik "Stop Server" di dashboard, ATAU              ^|
echo  ^|    - Jalankan stop.bat                                  ^|
echo  ^|  Menutup tab browser SAJA tidak menghentikan server.   ^|
echo  +---------------------------------------------------------+
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:7432"

"%SYNCGUARD_NODE%" backend/server.js
set EXITCODE=%errorlevel%

echo.
if %EXITCODE% neq 0 (
    echo  Server berhenti dengan error. Cek pesan di atas.
) else (
    echo  SyncGuard telah dihentikan dengan bersih.
)
echo.
pause
exit /b %EXITCODE%
