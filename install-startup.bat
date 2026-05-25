@echo off
cd /d "%~dp0"
echo Menambahkan SyncGuard ke Startup Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" -Startup
echo.
echo Selesai. SyncGuard akan start otomatis saat login.
pause
