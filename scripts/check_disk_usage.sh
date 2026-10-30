#!/usr/bin/env bash
set -euo pipefail
THRESHOLD="${1:-80}"
found=0
while read -r usage mount; do
  usage="${usage%%%}"
  if (( usage >= THRESHOLD )); then
    printf 'WARNING: %s is %s%% full\n' "$mount" "$usage"
    found=1
  fi
done < <(df -P -x tmpfs -x devtmpfs | awk 'NR>1 {print $5, $6}')
exit "$found"
