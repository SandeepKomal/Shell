#!/usr/bin/env bash
set -euo pipefail
URL="${1:?Usage: $0 <url> [timeout_seconds]}"
TIMEOUT="${2:-10}"
curl --fail --silent --show-error --max-time "$TIMEOUT" -o /dev/null "$URL" && echo "OK: $URL" || { echo "ERROR: endpoint unavailable: $URL" >&2; exit 1; }
