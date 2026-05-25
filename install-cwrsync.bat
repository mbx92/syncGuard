@echo off
title SyncGuard - Install cwRsync
cd /d "%~dp0"

call "%~dp0scripts\node-env.bat"
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan. Jalankan install-node.bat
    pause
    exit /b 1
)

echo.
echo  Menginstall cwRsync ke tools\cwrsync\ ...
echo.

"%SYNCGUARD_NODE%" -e "const r=require('./backend/rsync-util'); r.installBundledCwRsync().then(x=>{ if(x.ok){console.log('OK:',x.path); process.exit(0)} else {console.error(x.error); process.exit(1)} })"
if %errorlevel% neq 0 (
    echo.
    echo  Gagal. Pastikan cwRsync terinstall di C:\cwrsync
    echo  Download: https://itefix.net/cwrsync
    pause
    exit /b 1
)

echo.
echo  cwRsync siap di: tools\cwrsync\bin\rsync.exe
echo  Jalankan start.bat lalu buka Settings ^> Test Rsync
echo.
pause
