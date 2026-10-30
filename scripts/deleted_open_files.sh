#!/usr/bin/env bash
# Find files that were deleted but are still held open by a process.
# This is the classic "df says the disk is full, du cannot find the files"
# mystery: a log was rm'd while the app kept writing to it, so its space is
# only freed when the process closes it or restarts.
#
# Usage: deleted_open_files.sh [min-size-MB]     (default 10; run as root to see every process)
# Exit:  0 none found, 1 found some (listed largest first).
set -euo pipefail

[[ "${1:-}" == "-h" ]] && { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
min_mb="${1:-10}"
[[ "$min_mb" =~ ^[0-9]+$ ]] || { echo "deleted_open_files: size must be a number of MB" >&2; exit 2; }

# /proc/<pid>/fd/* links end in " (deleted)" for such files; no lsof needed.
results=()
for fd in /proc/[0-9]*/fd/*; do
  target="$(readlink "$fd" 2>/dev/null)" || continue
  [[ "$target" == *" (deleted)" ]] || continue
  size=$(stat -L -c %s "$fd" 2>/dev/null) || continue
  (( size >= min_mb * 1024 * 1024 )) || continue
  pid="${fd#/proc/}"; pid="${pid%%/*}"
  results+=("$size	$pid	$(cat "/proc/$pid/comm" 2>/dev/null)	${target% (deleted)}")
done

if (( ${#results[@]} == 0 )); then
  echo "No deleted files of ${min_mb}MB or more are held open."
  exit 0
fi
printf '%-10s %-8s %-16s %s\n' SIZE-MB PID PROCESS FILE
printf '%s\n' "${results[@]}" | sort -rn | awk -F'\t' '{ printf "%-10d %-8s %-16s %s\n", $1/1048576, $2, $3, $4 }'
echo
echo "Free the space by restarting or reloading those processes (or truncate in place: : > /proc/<pid>/fd/<n>)."
exit 1
