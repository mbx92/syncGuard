#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-syncguard-agent}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] Script ini harus dijalankan sebagai root (sudo)." >&2
  exit 1
fi

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl stop "$SERVICE_NAME" || true
  systemctl disable "$SERVICE_NAME" || true
fi

if [ -f "$SERVICE_FILE" ]; then
  rm -f "$SERVICE_FILE"
fi

systemctl daemon-reload

echo "SyncGuard agent service dihapus. Config dan log aplikasi tetap utuh."
