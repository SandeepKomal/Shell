#!/usr/bin/env bash
# Mask personal data in logs: Aadhaar numbers, PAN, Indian mobile numbers,
# e-mail addresses, UPI IDs, bank account numbers next to an IFSC code,
# passport and voter ID numbers become [AADHAAR], [PAN], [MOBILE] and so on.
# It errs on the side of masking: any number in Aadhaar shape is masked,
# checksum or not (pii_scan.sh is the precise one, for reporting).
#
# Two ways to use it:
#   On a stream, standard input to standard output, line by line:
#     tail -F /var/log/shop/app.log | pii_redact.sh >> /var/log/shop/app.redacted.log
#     my-app 2>&1 | pii_redact.sh | logger -t my-app
#   On files in place (plain or .gz). Dry run by default: it says how many
#   lines in each file would change. -y rewrites them atomically, keeping
#   their permissions. Redact rotated files (app.log.1, app.log.2.gz), not the
#   live one: the program writing it keeps writing to the old, replaced file.
# Masking a file does not reach its copies: backups, log shippers and search
# indexes need their own clean-up. Fix the logging code so it stops writing them.
#
# Usage: pii_redact.sh                       (filter: stdin to stdout)
#        pii_redact.sh [-y] file ...         (in place; dry run without -y)
# Exit:  0 done (or nothing to mask), 1 dry run found lines to mask, 2 bad usage
#        or a file that cannot be read or replaced.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

apply=0
while getopts ":yh" opt; do
  case "$opt" in
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

# Order matters: account numbers before mobiles, e-mail before UPI (both have an @).
prog='
s/\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/[AADHAAR]/g
/\b[A-Z]{4}0[A-Z0-9]{6}\b/ s/\b[0-9]{9,18}\b/[ACCOUNT]/g
s/\b[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]\b/[PAN]/g
s/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/[EMAIL]/g
s/\b[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}\b/[UPI]/g
s/(\+91[ -]?|\b(91|0)[ -]?|\b)[6-9][0-9]{9}\b/[MOBILE]/g
s/\b[A-PR-WY][1-9][0-9]{5}[1-9]\b/[PASSPORT]/g
s/\b[A-Z]{3}[0-9]{7}\b/[VOTER-ID]/g
'

if (( $# == 0 )); then
  # -u: one line in, one line out, so tail -F and pipes are not held up by buffering.
  exec sed -u -E "$prog"
fi

status=0
for f in "$@"; do
  [[ -f "$f" && -r "$f" ]] || { echo "pii_redact: cannot read $f" >&2; status=2; continue; }
  dir="$(dirname -- "$f")"
  tmp="$(mktemp "$dir/.pii_redact.XXXXXX")" || { echo "pii_redact: cannot write in $dir" >&2; status=2; continue; }
  trap 'rm -f "$tmp"' EXIT
  if [[ "$f" == *.gz ]]; then
    gzip -dc -- "$f" | sed -E "$prog" | gzip -c > "$tmp"
    changed=$(diff <(gzip -dc -- "$f") <(gzip -dc -- "$tmp") | grep -c '^>' || true)
  else
    sed -E "$prog" -- "$f" > "$tmp"
    changed=$(diff -- "$f" "$tmp" | grep -c '^>' || true)
  fi
  if (( changed == 0 )); then
    rm -f "$tmp"; echo "$f: nothing to mask"
  elif (( ! apply )); then
    rm -f "$tmp"; echo "$f: $changed line(s) would be masked"
    status=$(( status == 0 ? 1 : status ))
  else
    chmod --reference="$f" "$tmp"
    chown --reference="$f" "$tmp" 2>/dev/null || true
    mv -f -- "$tmp" "$f"
    echo "$f: masked $changed line(s)"
  fi
done
(( apply || status != 1 )) || echo "(dry run; add -y to rewrite the files)"
exit "$status"
