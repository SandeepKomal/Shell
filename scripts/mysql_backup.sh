#!/usr/bin/env bash
# Back up one MySQL or MariaDB database: a consistent mysqldump, gzip,
# checked for completeness, a SHA-256 checksum, rotation that keeps the newest
# -k, and an optional encrypted copy in S3.
# --single-transaction gives a consistent snapshot without locking InnoDB
# tables (MyISAM tables are not covered: convert them or stop writes first).
# The dump goes to a .partial file and is kept only if gzip reads it back and
# it ends with mysqldump's "Dump completed" line, the line a dump cut short by
# a timeout, a full disk or a dropped connection never has.
#
# Usage: mysql_backup.sh [-c option-file] [-k keep] [-s s3://bucket/prefix] [-t hours] [-n] database backup-dir
#   -c  MySQL option file with [client] user= and password= (chmod 600; default ~/.my.cnf)
#   -k  backups to keep in backup-dir (default 7)
#   -s  also upload to S3 with SSE (needs s3:PutObject on that prefix)
#   -t  give up when the dump takes longer than this many hours (default 6)
#   -n  dry run: say what would be dumped, uploaded and deleted
# Never pass -p<password> or MYSQL_PWD: other users can read both from ps or /proc.
# Restore: gunzip < FILE.sql.gz | mysql   (the dump creates and selects the database itself)
# Example: mysql_backup.sh -c /etc/mysql/backup.cnf -k 14 shop /var/backups/mysql
# Exit:  0 backed up and verified, 1 the dump, verification or upload failed
#        (older backups are kept), 2 bad usage or another backup is running.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

cnf="" keep=7 s3="" hours=6 dry=0
while getopts ":c:k:s:t:nh" opt; do
  case "$opt" in
    c) cnf="$OPTARG" ;;
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
[[ "$db" =~ ^[A-Za-z0-9_$-]+$ && -n "$dest" && "$keep" =~ ^[1-9][0-9]*$ && "$hours" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }
[[ -z "$s3" || "$s3" =~ ^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](/.*)?$ ]] || { usage >&2; exit 2; }
[[ -z "$cnf" || -r "$cnf" ]] || { echo "mysql_backup: cannot read option file $cnf" >&2; exit 2; }
[[ -z "${MYSQL_PWD:-}" ]] || echo "mysql_backup: warning: MYSQL_PWD is set; use an option file instead" >&2
needed=(mysqldump gzip sha256sum flock)
[[ -n "$s3" ]] && needed+=(aws)
for c in "${needed[@]}"; do command -v "$c" >/dev/null || { echo "mysql_backup: $c is required" >&2; exit 2; }; done

file="$dest/$db-$(date +%Y%m%d-%H%M%S).sql.gz"
mapfile -t old < <(find "$dest" -maxdepth 1 -name "$db-*.sql.gz" -printf '%p\n' 2>/dev/null | sort -r | tail -n +"$keep")
if (( dry )); then
  echo "would dump database $db to $file${s3:+ and upload it to $s3/}"
  for f in "${old[@]}"; do echo "would delete $f"; done
  exit 0
fi

mkdir -p "$dest"
umask 077   # backups hold every row of the database: readable by this user only
exec 9>"$dest/.$db.lock"
flock -n 9 || { echo "mysql_backup: another backup of $db is running" >&2; exit 2; }
trap 'rm -f "$file.partial"' EXIT

# --defaults-extra-file must be the first option. --no-tablespaces avoids needing the PROCESS privilege.
opts=(); [[ -n "$cnf" ]] && opts=(--defaults-extra-file="$cnf")
opts+=(--single-transaction --quick --routines --triggers --events --hex-blob --no-tablespaces --connect-timeout=10)
started=$SECONDS
# pipefail makes a failed mysqldump fail this line, even though gzip succeeded.
if ! timeout "${hours}h" mysqldump "${opts[@]}" --databases "$db" | gzip -6 > "$file.partial"; then
  echo "mysql_backup: mysqldump of $db failed; older backups are untouched" >&2
  exit 1
fi
if ! gzip -t "$file.partial" || ! gzip -dc "$file.partial" | tail -n 1 | grep -q '^-- Dump completed'; then
  echo "mysql_backup: $file.partial is incomplete (no 'Dump completed' line); not keeping it" >&2
  exit 1
fi
mv -- "$file.partial" "$file"
(cd "$dest" && sha256sum -- "$(basename "$file")" > "$(basename "$file").sha256")
echo "dumped $db to $file ($(du -h "$file" | cut -f1), $(( SECONDS - started ))s), verified"

if [[ -n "$s3" ]]; then
  export AWS_RETRY_MODE="${AWS_RETRY_MODE:-standard}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-5}"
  for f in "$file" "$file.sha256"; do
    aws --cli-connect-timeout 10 --cli-read-timeout 120 s3 cp "$f" "$s3/$(basename "$f")" --sse AES256 --only-show-errors \
      || { echo "mysql_backup: upload of $f to $s3 failed; the local backup is kept" >&2; exit 1; }
  done
  echo "uploaded to $s3/$(basename "$file")"
fi

mapfile -t old < <(find "$dest" -maxdepth 1 -name "$db-*.sql.gz" -printf '%p\n' | sort -r | tail -n +"$(( keep + 1 ))")
for f in "${old[@]}"; do rm -f -- "${f:?}" "${f:?}.sha256"; echo "deleted $f"; done
