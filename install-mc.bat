@echo off
title SyncGuard - Install MinIO Client (mc)
cd /d "%~dp0"

call "%~dp0scripts\node-env.bat"
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan. Jalankan install-node.bat
    pause
    exit /b 1
)

echo.
echo  Menginstall MinIO Client (mc) ke tools\mc\ ...
echo.

"%SYNCGUARD_NODE%" -e "const m=require('./backend/minio-util'); m.installBundledMc().then(x=>{ if(x.ok){console.log('OK:',x.path); process.exit(0)} else {console.error(x.error); process.exit(1)} })"
if %errorlevel% neq 0 (
    echo.
    echo  Gagal. Letakkan mc.exe di folder root project, atau download:
    echo  https://dl.min.io/client/mc/release/windows-amd64/mc.exe
    pause
    exit /b 1
)

echo.
echo  mc siap di: tools\mc\mc.exe
echo  Settings ^> MinIO ^> mc Path: tools/mc/mc.exe
echo.
pause
