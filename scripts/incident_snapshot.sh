#!/usr/bin/env bash
# Collect a read-only snapshot of a Linux host's state into one archive, the
# first thing to grab during an incident before anyone restarts anything.
# It captures load, memory, disks, processes, sockets, recent kernel and
# systemd messages, and failed units. It changes nothing on the host.
#
# Usage: incident_snapshot.sh [output-dir]      (default: /tmp)
# Exit:  0 with the archive path printed; sections that need missing tools or
#        root are recorded as skipped, not treated as errors.
set -euo pipefail

[[ "${1:-}" == "-h" ]] && { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
out_dir="${1:-/tmp}"
stamp="$(hostname)-$(date +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/$stamp"

# capture <file> <command...>: run a read-only command, keep its output or why it failed.
capture() {
  local file="$1"; shift
  if ! command -v "$1" >/dev/null 2>&1; then echo "skipped: $1 not installed" > "$work/$stamp/$file"; return; fi
  { echo "\$ $*"; timeout 20 "$@" 2>&1 || echo "(exit $?)"; } > "$work/$stamp/$file"
}

capture uptime.txt        uptime
capture memory.txt        free -m
capture disks.txt         df -hT
capture inodes.txt        df -i
capture processes.txt     ps aux --sort=-%cpu
capture top-memory.txt    ps aux --sort=-%mem
capture sockets.txt       ss -tulpn
capture connections.txt   ss -s
capture kernel.txt        dmesg --ctime --level=err,warn
capture failed-units.txt  systemctl --failed --no-pager
capture journal.txt       journalctl -p warning -n 300 --no-pager
capture mounts.txt        findmnt
capture network.txt       ip -brief address
capture routes.txt        ip route

archive="$out_dir/incident-$stamp.tar.gz"
mkdir -p "$out_dir"
tar -czf "$archive" -C "$work" "$stamp"
echo "$archive"
