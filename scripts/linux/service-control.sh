#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-syncguard-agent}"

usage() {
  cat <<'EOF'
Usage: service-control.sh <start|stop|restart|status|logs>
EOF
}

if [ $# -ne 1 ]; then
  usage
  exit 1
fi

ACTION="$1"

case "$ACTION" in
  start|stop|restart|status)
    exec systemctl "$ACTION" "$SERVICE_NAME"
    ;;
  logs)
    exec journalctl -u "$SERVICE_NAME" -n 200 --no-pager
    ;;
  *)
    usage
    exit 1
    ;;
esac
