#!/usr/bin/env bash
# Check when the TLS certificates of one or more hosts expire, and fail if any
# expires within the warning window. Run it daily from cron or CI so an
# expired certificate never becomes an outage.
#
# Usage: ssl_cert_expiry.sh [-w warn-days] host[:port] ...
#        ssl_cert_expiry.sh [-w warn-days] -f hosts.txt     (one host per line, # comments)
# Exit:  0 all fine, 1 one expires soon or cannot be checked, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

warn_days=21 file=""
while getopts ":w:f:h" opt; do
  case "$opt" in
    w) warn_days="$OPTARG" ;;
    f) file="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ "$warn_days" =~ ^[0-9]+$ ]] || { usage >&2; exit 2; }
command -v openssl >/dev/null || { echo "ssl_cert_expiry: openssl is required" >&2; exit 2; }

hosts=("$@")
if [[ -n "$file" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="${line//[[:space:]]/}"
    [[ -n "$line" ]] && hosts+=("$line")
  done < "$file"
fi
(( ${#hosts[@]} > 0 )) || { usage >&2; exit 2; }

now=$(date +%s)
status=0
printf '%-40s %-12s %s\n' HOST DAYS-LEFT EXPIRES
for entry in "${hosts[@]}"; do
  host="${entry%%:*}" port="443"
  [[ "$entry" == *:* ]] && port="${entry##*:}"
  # -servername sends SNI, without which shared hosts return a default certificate.
  end=$(echo | timeout 10 openssl s_client -connect "$host:$port" -servername "$host" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) || true
  if [[ -z "$end" ]]; then
    printf '%-40s %-12s %s\n' "$host:$port" "ERROR" "could not read a certificate"
    status=1; continue
  fi
  days=$(( ( $(date -d "$end" +%s) - now ) / 86400 ))
  flag=""
  (( days < warn_days )) && { flag="  <- renew"; status=1; }
  printf '%-40s %-12s %s%s\n' "$host:$port" "$days" "$end" "$flag"
done
exit "$status"
