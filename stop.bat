@echo off
title SyncGuard - Stop
cd /d "%~dp0"

echo.
echo  Menghentikan SyncGuard...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-port.ps1" -Port 7432

if exist "config\syncguard.pid" del /f /q "config\syncguard.pid" 2>nul

echo.
echo  SyncGuard dihentikan.
echo.
pause
