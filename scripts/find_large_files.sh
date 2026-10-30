#!/usr/bin/env bash
set -euo pipefail
PATH_TO_SCAN="${1:-.}"
MIN_SIZE="${2:-500M}"
echo "Files larger than $MIN_SIZE under $PATH_TO_SCAN:"
find "$PATH_TO_SCAN" -type f -size +"$MIN_SIZE" -printf '%s %p\n' 2>/dev/null |
  sort -nr | numfmt --field=1 --to=iec | head -n 50
