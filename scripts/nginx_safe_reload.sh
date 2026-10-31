#!/usr/bin/env bash
# Reload nginx only when its configuration is valid, then prove it still
# serves. A reload with a broken file is refused by nginx, but the error is
# easy to miss in a deploy log; a restart with one takes the site down.
# Without -y it only tests the configuration.
#
# Usage: nginx_safe_reload.sh [-u health-url] [-t seconds] [-y]
#   -u  URL that must answer 2xx/3xx after the reload (default http://127.0.0.1/)
#   -t  how long to wait for that URL (default 15)
#   -y  really reload; without it, only run nginx -t
# Example: sudo nginx_safe_reload.sh -u https://localhost/healthz -y
# Exit:  0 valid (and reloaded and healthy with -y), 1 the configuration is
#        invalid (nothing reloaded) or the health check failed after the
#        reload, 2 bad usage or nginx not found.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

url="http://127.0.0.1/" wait=15 apply=0
while getopts ":u:t:yh" opt; do
  case "$opt" in
    u) url="$OPTARG" ;;
    t) wait="$OPTARG" ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$wait" =~ ^[1-9][0-9]*$ && "$url" =~ ^https?:// ]] || { usage >&2; exit 2; }
command -v nginx >/dev/null || { echo "nginx_safe_reload: nginx is not installed or not on PATH" >&2; exit 2; }

# nginx -t prints to stderr even when the file is fine; keep it for the log.
if ! test_out="$(nginx -t 2>&1)"; then
  echo "$test_out" >&2
  echo "nginx_safe_reload: configuration is invalid; nothing was reloaded" >&2
  exit 1
fi
echo "configuration ok"
if (( ! apply )); then echo "(dry run; add -y to reload)"; exit 0; fi

# A reload starts new workers with the new file and lets old ones finish their requests.
if command -v systemctl >/dev/null && systemctl is-active --quiet nginx 2>/dev/null; then
  systemctl reload nginx
else
  nginx -s reload
fi
echo "reloaded"

deadline=$(( SECONDS + wait ))
until curl -sS -o /dev/null --max-time 5 -w '%{http_code}' "$url" 2>/dev/null | grep -q '^[23]'; do
  if (( SECONDS >= deadline )); then
    echo "nginx_safe_reload: $url did not answer 2xx/3xx within ${wait}s after the reload" >&2
    echo "  check: journalctl -u nginx -n 50; tail /var/log/nginx/error.log" >&2
    exit 1
  fi
  sleep 1
done
echo "healthy: $url"
