#!/usr/bin/env bash
# Back up a directory to a dated .tar.gz with a SHA-256 checksum, verify the
# archive, and keep only the newest N backups.
# A backup you have not verified is only a hope; this one checks itself.
#
# Usage: backup_rotate.sh [-k keep] [-n] source-dir backup-dir
#   -k  how many backups to keep (default 7)
#   -n  dry run: show what would be created and deleted
# Exit:  0 on success, 1 if the archive or its checksum fails, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

keep=7 dry=0
while getopts ":k:nh" opt; do
  case "$opt" in
    k) keep="$OPTARG" ;;
    n) dry=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
src="${1:-}" dest="${2:-}"
[[ -d "$src" && -n "$dest" && "$keep" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }

name="$(basename "$(cd "$src" && pwd)")"
archive="$dest/${name}-$(date +%Y%m%d-%H%M%S).tar.gz"

if (( dry )); then
  echo "would create $archive"
else
  mkdir -p "$dest"
  tar -czf "$archive" -C "$(dirname "$(cd "$src" && pwd)")" "$name"
  (cd "$dest" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
  # Prove the archive is readable and matches its checksum before trusting it.
  if ! tar -tzf "$archive" >/dev/null || ! (cd "$dest" && sha256sum -c --quiet "$(basename "$archive").sha256"); then
    echo "backup_rotate: verification failed for $archive" >&2
    exit 1
  fi
  echo "created $archive ($(du -h "$archive" | cut -f1)), verified"
fi

# Names carry the timestamp, so a reverse sort is newest first; everything past $keep goes.
mapfile -t old < <(find "$dest" -maxdepth 1 -name "${name}-*.tar.gz" -printf '%p\n' 2>/dev/null | sort -r | tail -n +"$(( keep + 1 ))")
for f in "${old[@]}"; do
  if (( dry )); then echo "would delete $f"; else rm -f -- "$f" "$f.sha256"; echo "deleted $f"; fi
done
