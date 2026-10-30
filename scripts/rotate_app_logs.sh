#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="${1:?Usage: $0 <log-file> [keep-count]}"
KEEP="${2:-5}"
[[ -f "$LOG_FILE" ]] || { echo "ERROR: log file not found: $LOG_FILE" >&2; exit 1; }
for ((i=KEEP-1; i>=1; i--)); do
  [[ -f "$LOG_FILE.$i" ]] && mv -- "$LOG_FILE.$i" "$LOG_FILE.$((i+1))"
done
cp -- "$LOG_FILE" "$LOG_FILE.1"
: > "$LOG_FILE"
echo "Rotated $LOG_FILE; kept $KEEP archived copies."
