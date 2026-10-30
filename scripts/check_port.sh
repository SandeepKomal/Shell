#!/usr/bin/env bash
set -euo pipefail
PORT="${1:?Usage: $0 <port>}"
if ss -lnt "( sport = :$PORT )" | tail -n +2 | grep -q .; then
  echo "OK: TCP port $PORT is listening"
else
  echo "ERROR: TCP port $PORT is not listening" >&2
  exit 1
fi
