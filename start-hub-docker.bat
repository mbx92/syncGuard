@echo off
setlocal
cd /d "%~dp0"

echo.
echo  SyncGuard Hub - Docker local
echo  =============================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo  Docker tidak ditemukan. Install Docker Desktop lalu coba lagi.
  exit /b 1
)

if not exist "docker\local\.env" (
  copy "docker\local\.env.example" "docker\local\.env" >nul
  echo  Created docker\local\.env from example
)

echo  Building image (pertama kali bisa beberapa menit)...
docker compose -f docker/local/docker-compose.yml --env-file docker/local/.env up -d --build
if errorlevel 1 (
  echo.
  echo  Build/start gagal.
  exit /b 1
)

echo.
echo  Hub: http://localhost:7443
echo  Login token: lihat HUB_ADMIN_TOKEN di docker\local\.env
echo.
echo  Logs:  docker compose -f docker/local/docker-compose.yml logs -f
echo  Stop:  stop-hub-docker.bat
echo.
endlocal
