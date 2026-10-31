#!/usr/bin/env bash
# Back up one PostgreSQL database: a consistent pg_dump in custom format
# (compressed, restorable table by table), verified by reading it back with
# pg_restore --list, a SHA-256 checksum, rotation that keeps the newest -k,
# and an optional encrypted copy in S3.
# pg_dump reads from one snapshot, so the dump is consistent while the
# database keeps serving. The file is written as .partial and renamed only
# after it verifies, so a failed run never leaves something that looks like a
# backup. Old backups are deleted only after a new one has verified.
# Roles and tablespaces are cluster-wide: back them up with pg_dumpall --globals-only.
#
# Usage: pg_backup.sh [-k keep] [-s s3://bucket/prefix] [-t hours] [-n] database backup-dir
#   -k  backups to keep in backup-dir (default 7)
#   -s  also upload to S3 with SSE (see s3_backup_sync.sh for the IAM policy; needs s3:PutObject)
#   -t  give up when the dump takes longer than this many hours (default 6)
#   -n  dry run: say what would be dumped, uploaded and deleted
# Connection: the libpq environment (PGHOST, PGPORT, PGUSER) and a password in
#   ~/.pgpass (chmod 600) or PGPASSFILE. Never put a password on the command line.
# Restore: pg_restore --clean --if-exists -d DATABASE FILE.dump
# Example: PGHOST=db.internal PGUSER=backup pg_backup.sh -k 14 -s s3://acme-backups/pg shop /var/backups/pg
# Exit:  0 backed up and verified, 1 the dump, verification or upload failed
#        (older backups are kept), 2 bad usage or another backup is running.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

keep=7 s3="" hours=6 dry=0
while getopts ":k:s:t:nh" opt; do
  case "$opt" in
    k) keep="$OPTARG" ;;
    s) s3="${OPTARG%/}" ;;
    t) hours="$OPTARG" ;;
    n) dry=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
db="${1:-}" dest="${2:-}"
[[ "$db" =~ ^[A-Za-z0-9_.-]+$ && -n "$dest" && "$keep" =~ ^[1-9][0-9]*$ && "$hours" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }
[[ -z "$s3" || "$s3" =~ ^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](/.*)?$ ]] || { usage >&2; exit 2; }
needed=(pg_dump pg_restore sha256sum flock)
[[ -n "$s3" ]] && needed+=(aws)
for c in "${needed[@]}"; do command -v "$c" >/dev/null || { echo "pg_backup: $c is required" >&2; exit 2; }; done

stamp="$(date +%Y%m%d-%H%M%S)"
file="$dest/$db-$stamp.dump"
mapfile -t old < <(find "$dest" -maxdepth 1 -name "$db-*.dump" -printf '%p\n' 2>/dev/null | sort -r | tail -n +"$keep")
if (( dry )); then
  echo "would dump database $db to $file${s3:+ and upload it to $s3/}"
  for f in "${old[@]}"; do echo "would delete $f"; done
  exit 0
fi

mkdir -p "$dest"
umask 077   # backups hold every row of the database: readable by this user only
exec 9>"$dest/.$db.lock"
flock -n 9 || { echo "pg_backup: another backup of $db is running" >&2; exit 2; }
trap 'rm -f "$file.partial"' EXIT
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

started=$SECONDS
if ! timeout "${hours}h" pg_dump --format=custom --compress=6 --no-password --file="$file.partial" "$db"; then
  echo "pg_backup: pg_dump of $db failed; older backups are untouched" >&2
  exit 1
fi
# Reading the table of contents proves the archive is complete and readable.
if [[ ! -s "$file.partial" ]] || ! pg_restore --list "$file.partial" >/dev/null; then
  echo "pg_backup: $file.partial does not read back; not keeping it" >&2
  exit 1
fi
mv -- "$file.partial" "$file"
(cd "$dest" && sha256sum -- "$(basename "$file")" > "$(basename "$file").sha256")
echo "dumped $db to $file ($(du -h "$file" | cut -f1), $(( SECONDS - started ))s), verified"

if [[ -n "$s3" ]]; then
  export AWS_RETRY_MODE="${AWS_RETRY_MODE:-standard}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-5}"
  for f in "$file" "$file.sha256"; do
    aws --cli-connect-timeout 10 --cli-read-timeout 120 s3 cp "$f" "$s3/$(basename "$f")" --sse AES256 --only-show-errors \
      || { echo "pg_backup: upload of $f to $s3 failed; the local backup is kept" >&2; exit 1; }
  done
  echo "uploaded to $s3/$(basename "$file")"
fi

# Rotate: the newest $keep stay, counting the one just made.
mapfile -t old < <(find "$dest" -maxdepth 1 -name "$db-*.dump" -printf '%p\n' | sort -r | tail -n +"$(( keep + 1 ))")
for f in "${old[@]}"; do rm -f -- "${f:?}" "${f:?}.sha256"; echo "deleted $f"; done
