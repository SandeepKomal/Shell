#!/usr/bin/env bash
# Enforce a retention period: find files older than N days (exports, reports,
# uploads, rotated logs that hold personal data) and delete them. Keeping
# personal data only as long as its purpose needs is a storage-limitation
# duty under privacy laws such as India's DPDP Act; this is the job that does
# it. Dry run by default: it lists the files, their age and the total size.
# -y deletes them and, with -l, appends what was erased to a log (paths,
# sizes, dates; never contents) as evidence that erasure happened.
#
# Usage: retention_cleanup.sh -d days [-p pattern ...] [-m max-files] [-l log] [-y] dir ...
#   -d  delete files last modified more than this many days ago (required)
#   -p  only file names matching this glob, e.g. '*.csv' (repeatable; default all files)
#   -m  refuse to delete more than this many files in one run (default 10000)
#   -l  append a record of each deleted file to this log
#   -y  really delete; without it, only list
# Example: retention_cleanup.sh -d 180 -p '*.csv' -p '*.xlsx' -l /var/log/retention.log /srv/exports
# Safety: it stays on one file system, never follows symbolic links, never
#   deletes directories, and refuses /, /home, /etc, /usr, /var and the like.
# Exit:  0 nothing past retention, or deleted; 1 files past retention found
#        (dry run) or some could not be deleted; 2 bad usage or a refused path.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

days="" patterns=() max=10000 log="" apply=0
while getopts ":d:p:m:l:yh" opt; do
  case "$opt" in
    d) days="$OPTARG" ;;
    p) patterns+=("$OPTARG") ;;
    m) max="$OPTARG" ;;
    l) log="$OPTARG" ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ "$days" =~ ^[1-9][0-9]*$ && "$max" =~ ^[1-9][0-9]*$ && $# -gt 0 ]] || { usage >&2; exit 2; }

dirs=()
for dir in "$@"; do
  [[ -d "$dir" && ! -L "$dir" ]] || { echo "retention_cleanup: not a directory: $dir" >&2; exit 2; }
  real="$(cd "$dir" && pwd -P)"
  case "$real" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/usr|/var|/var/log|/tmp)
      echo "retention_cleanup: refusing to clean $real itself; point it at the folder that holds the data" >&2; exit 2 ;;
  esac
  [[ "$real" != "$(cd ~ && pwd -P)" ]] || { echo "retention_cleanup: refusing to clean your home directory" >&2; exit 2; }
  dirs+=("$real")   # absolute, so a name starting with - cannot be read as a find option
done

# Name tests: ( -name a -o -name b ), or every file when no -p is given.
names=()
for p in "${patterns[@]}"; do
  (( ${#names[@]} )) && names+=(-o)
  names+=(-name "$p")
done
(( ${#names[@]} )) && names=('(' "${names[@]}" ')')

# -mtime +N means "more than N whole days ago". -xdev: one file system; -P (the default): no symlinks.
mapfile -d '' files < <(find -P "${dirs[@]}" -xdev -type f "${names[@]}" -mtime +"$(( days - 1 ))" -print0)
if (( ${#files[@]} == 0 )); then
  echo "nothing older than $days days in ${dirs[*]}"
  exit 0
fi
if (( ${#files[@]} > max )); then
  echo "retention_cleanup: ${#files[@]} files are past retention, more than -m $max; check the path and pattern, then raise -m" >&2
  exit 2
fi

total=0 failed=0
for f in "${files[@]}"; do
  read -r size mtime < <(stat -c '%s %Y' -- "$f")
  total=$(( total + size ))
  when="$(date -d "@$mtime" +%F)"
  if (( ! apply )); then
    printf 'would delete  %s  %8s KB  %s\n' "$when" "$(( size / 1024 ))" "$f"
  elif rm -f -- "$f"; then
    printf 'deleted  %s  %8s KB  %s\n' "$when" "$(( size / 1024 ))" "$f"
    [[ -z "$log" ]] || printf '%s\tdeleted\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$when" "$size" "$days" "$f" >> "$log"
  else
    failed=$(( failed + 1 ))
  fi
done
echo "${#files[@]} file(s), $(( total / 1048576 )) MB, older than $days days"
if (( ! apply )); then echo "(dry run; add -y to delete)"; exit 1; fi
if (( failed )); then echo "retention_cleanup: $failed file(s) could not be deleted" >&2; exit 1; fi
