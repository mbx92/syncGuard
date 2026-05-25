#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT="${PORT:-7432}"
NODE_BIN="${NODE_BIN:-node}"

cd "$APP_DIR"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "[ERROR] Node.js tidak ditemukan di PATH." >&2
  echo "        Install Node.js >= 16 atau set NODE_BIN ke path binary yang benar." >&2
  exit 1
fi

if [ ! -f "backend/server.js" ]; then
  echo "[ERROR] backend/server.js tidak ditemukan di $APP_DIR" >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[ERROR] node_modules belum ada." >&2
  echo "        Jalankan: npm install --omit=dev" >&2
  exit 1
fi

mkdir -p logs config

export PORT
exec "$NODE_BIN" backend/server.js
