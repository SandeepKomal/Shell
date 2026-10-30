#!/usr/bin/env bash
# Run a command until it succeeds, waiting longer after each failure.
# Use it for flaky network calls in CI and deploy scripts: package mirrors,
# registry pushes, API calls that hit a rate limit.
#
# Usage: retry.sh [-n attempts] [-d first-delay-seconds] [-m max-delay] -- command [args...]
# Exit:  the command's own exit code from its last attempt.
set -euo pipefail

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

attempts=5 delay=2 max_delay=60
while getopts ":n:d:m:h" opt; do
  case "$opt" in
    n) attempts="$OPTARG" ;;
    d) delay="$OPTARG" ;;
    m) max_delay="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ "${1:-}" == "--" ]] && shift
(( $# > 0 )) || { usage >&2; exit 2; }
for v in "$attempts" "$delay" "$max_delay"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "retry: numbers only: $v" >&2; exit 2; }
done

for (( i = 1; ; i++ )); do
  status=0
  "$@" || status=$?
  (( status == 0 )) && exit 0
  if (( i >= attempts )); then
    echo "retry: '$*' failed $i times, giving up (exit $status)" >&2
    exit "$status"
  fi
  # Jitter spreads retries from many machines so they do not hit a service together.
  wait_for=$(( delay + RANDOM % (delay + 1) ))
  echo "retry: attempt $i/$attempts failed (exit $status), next in ${wait_for}s" >&2
  sleep "$wait_for"
  delay=$(( delay * 2 > max_delay ? max_delay : delay * 2 ))
done
