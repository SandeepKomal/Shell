#!/usr/bin/env bash
# Wait until a TCP port or an HTTP URL answers, or give up after a timeout.
# Use it to start an app only once its database is up, or to gate a CI step
# on a service that a previous step started.
#
# Usage: wait_for.sh [-t timeout-seconds] host:port | http(s)://url
# Exit:  0 when it answers, 1 on timeout, 2 on bad usage.
set -euo pipefail

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

timeout=60
while getopts ":t:h" opt; do
  case "$opt" in
    t) timeout="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
target="${1:-}"
[[ -n "$target" && "$timeout" =~ ^[0-9]+$ ]] || { usage >&2; exit 2; }

if [[ "$target" =~ ^https?:// ]]; then
  command -v curl >/dev/null || { echo "wait_for: curl is required for URLs" >&2; exit 2; }
  check() { curl -fsS -o /dev/null --max-time 5 "$target"; }
else
  host="${target%:*}" port="${target##*:}"
  [[ -n "$host" && "$port" =~ ^[0-9]+$ && "$host" != "$target" ]] || { usage >&2; exit 2; }
  # bash's /dev/tcp needs no extra tools, which matters in slim containers.
  check() { timeout 5 bash -c ": >/dev/tcp/$host/$port" 2>/dev/null; }
fi

deadline=$(( SECONDS + timeout ))
until check; do
  if (( SECONDS >= deadline )); then
    echo "wait_for: $target did not answer within ${timeout}s" >&2
    exit 1
  fi
  sleep 1
done
echo "wait_for: $target is up after $(( SECONDS ))s"
