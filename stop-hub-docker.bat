@echo off
cd /d "%~dp0"
docker compose -f docker/local/docker-compose.yml down
echo SyncGuard Hub Docker stopped.
