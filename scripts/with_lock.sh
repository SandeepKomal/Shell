#!/usr/bin/env bash
# Run a command only if no other copy of it is running, using flock(1).
# Wrap any cron job with it so a slow run never overlaps the next one. The
# kernel drops the lock when the process ends, even after kill -9, so there is
# no stale lock file to clean up by hand.
#
# Usage: with_lock.sh [-n name | -f lock-file] [-w wait-seconds] [-t timeout] [-s] -- command [args...]
#   -n  lock name; the file is /run/lock/<name>.lock (or $TMPDIR when that is not writable)
#   -f  lock file to use instead
#   -w  wait this long for the lock (default 0: give up at once)
#   -t  stop the command after this many seconds (timeout), so a hung run cannot hold the lock forever
#   -s  skip quietly: exit 0 when another run holds the lock (for cron)
# Example: */5 * * * * /opt/scripts/with_lock.sh -n mirror -t 900 -s -- /opt/scripts/sync_mirror.sh
# Exit:  the command's own status; 75 when the lock is held (0 with -s); 124 when -t stopped it; 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

name="" file="" wait=0 limit=0 skip=0
while getopts ":n:f:w:t:sh" opt; do
  case "$opt" in
    n) name="$OPTARG" ;;
    f) file="$OPTARG" ;;
    w) wait="$OPTARG" ;;
    t) limit="$OPTARG" ;;
    s) skip=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ "${1:-}" == "--" ]] && shift
(( $# > 0 )) || { usage >&2; exit 2; }
[[ "$wait" =~ ^[0-9]+$ && "$limit" =~ ^[0-9]+$ ]] || { echo "with_lock: -w and -t take whole seconds" >&2; exit 2; }
command -v flock >/dev/null || { echo "with_lock: flock is required (util-linux)" >&2; exit 2; }

if [[ -z "$file" ]]; then
  # Default name: the command's base name, so two different jobs never share a lock by accident.
  name="${name:-$(basename "$1")}"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "with_lock: lock name may only use letters, digits, . _ -" >&2; exit 2; }
  dir=/run/lock; [[ -w "$dir" ]] || dir="${TMPDIR:-/tmp}"
  file="$dir/$name.lock"
fi

# Open the lock file on fd 9 without truncating it, then ask for the lock.
exec 9>>"$file"
if ! flock -w "$wait" 9; then
  if (( skip )); then exit 0; fi
  echo "with_lock: another run holds $file; not starting '$*'" >&2
  exit 75
fi

# The command inherits fd 9, so the lock is held for as long as it (and its children) run.
if (( limit > 0 )); then
  exec timeout --kill-after=30 "$limit" "$@"
fi
exec "$@"
