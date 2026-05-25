@echo off
cd /d "%~dp0"
title SyncGuard Hub

if not exist "hub\public\index.html" (
  echo Building hub UI...
  call npm run hub:build
  if errorlevel 1 exit /b 1
)

echo Starting SyncGuard Hub on port 7443...
node hub/server.js
pause
