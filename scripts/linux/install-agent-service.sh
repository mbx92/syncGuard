#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/syncguard-agent.service.template"
SERVICE_NAME="${SERVICE_NAME:-syncguard-agent}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

USER_NAME=""
APP_DIR="$APP_DIR_DEFAULT"
PORT="7432"
ENABLE_ON_BOOT="1"

usage() {
  cat <<EOF
Usage: sudo ./scripts/linux/install-agent-service.sh --user <linux-user> [--app-dir <path>] [--port <port>] [--no-enable]

Options:
  --user       User Linux yang menjalankan service (required)
  --app-dir    Root aplikasi SyncGuard (default: $APP_DIR_DEFAULT)
  --port       Port agent (default: 7432)
  --no-enable  Install service tanpa enable saat boot
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user)
      USER_NAME="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --no-enable)
      ENABLE_ON_BOOT="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Argumen tidak dikenal: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] Script ini harus dijalankan sebagai root (sudo)." >&2
  exit 1
fi

if [ -z "$USER_NAME" ]; then
  echo "[ERROR] --user wajib diisi." >&2
  usage
  exit 1
fi

if ! id "$USER_NAME" >/dev/null 2>&1; then
  echo "[ERROR] User Linux '$USER_NAME' tidak ditemukan." >&2
  exit 1
fi

APP_DIR="$(cd "$APP_DIR" && pwd)"

if [ ! -f "$APP_DIR/backend/server.js" ]; then
  echo "[ERROR] Root aplikasi tidak valid: $APP_DIR" >&2
  echo "        File backend/server.js tidak ditemukan." >&2
  exit 1
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "[ERROR] Template service tidak ditemukan: $TEMPLATE_FILE" >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] Port harus berupa angka." >&2
  exit 1
fi

TEMP_SERVICE_FILE="$(mktemp)"
trap 'rm -f "$TEMP_SERVICE_FILE"' EXIT

sed \
  -e "s|__USER__|$USER_NAME|g" \
  -e "s|__WORKDIR__|$APP_DIR|g" \
  -e "s|__PORT__|$PORT|g" \
  "$TEMPLATE_FILE" > "$TEMP_SERVICE_FILE"

install -m 0644 "$TEMP_SERVICE_FILE" "$SERVICE_FILE"
chmod +x "$APP_DIR/scripts/linux/start-agent.sh" "$APP_DIR/scripts/linux/service-control.sh"

systemctl daemon-reload

if [ "$ENABLE_ON_BOOT" = "1" ]; then
  systemctl enable "$SERVICE_NAME"
fi

systemctl start "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "SyncGuard agent service terinstall: $SERVICE_FILE"
echo "Control: $APP_DIR/scripts/linux/service-control.sh <start|stop|restart|status|logs>"
