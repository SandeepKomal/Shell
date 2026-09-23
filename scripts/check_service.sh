#!/usr/bin/env bash
set -euo pipefail
SERVICE="${1:?Usage: $0 <service-name>}"
if systemctl is-active --quiet "$SERVICE"; then
  echo "OK: $SERVICE is running"
else
  echo "ERROR: $SERVICE is not running" >&2
  systemctl status "$SERVICE" --no-pager || true
  exit 1
fi
