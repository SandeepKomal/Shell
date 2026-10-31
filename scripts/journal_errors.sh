#!/usr/bin/env bash
# Summarise errors in the systemd journal: how many per unit, and the most
# common messages with numbers, addresses and e-mail addresses folded together
# so that "timeout after 3012ms" and "timeout after 2981ms" count as one.
# Folding also keeps personal data (e-mails, IPs, phone numbers) out of the
# report you paste into a ticket. It only reads the journal.
#
# Usage: journal_errors.sh [-s since] [-p priority] [-u unit] [-n top] [-m max] [-j]
#   -s  start of the window, anything journalctl --since takes (default "1 hour ago")
#   -p  lowest priority to include: emerg alert crit err warning (default err)
#   -u  only this systemd unit
#   -n  how many of the most common messages to show (default 10)
#   -m  allowed number of messages before exit 1 (default 0)
#   -j  JSON output for a dashboard
# Example: journal_errors.sh -s "today" -p warning -u nginx.service
# Exit:  0 at most -m messages, 1 more than -m, 2 bad usage or no journalctl.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

since="1 hour ago" prio=err unit="" top=10 max=0 json=0
while getopts ":s:p:u:n:m:jh" opt; do
  case "$opt" in
    s) since="$OPTARG" ;;
    p) prio="$OPTARG" ;;
    u) unit="$OPTARG" ;;
    n) top="$OPTARG" ;;
    m) max="$OPTARG" ;;
    j) json=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$prio" =~ ^(emerg|alert|crit|err|warning|[0-4])$ && "$top" =~ ^[0-9]+$ && "$max" =~ ^[0-9]+$ ]] || { usage >&2; exit 2; }
command -v journalctl >/dev/null || { echo "journal_errors: journalctl not found (not a systemd host?)" >&2; exit 2; }

args=(-q --no-pager -o short-iso -p "$prio" --since "$since")
[[ -n "$unit" ]] && args+=(-u "$unit")
if ! raw="$(timeout 60 journalctl "${args[@]}" 2>&1)"; then
  echo "journal_errors: journalctl failed: ${raw%%$'\n'*}" >&2
  exit 2
fi

# Lines look like: 2026-10-31T09:12:01+0530 web-01 nginx[812]: message
summary="$(awk -v top="$top" -v json="$json" -v since="$since" -v prio="$prio" '
  function fold(m) {
    gsub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/, "<email>", m)
    gsub(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/, "<ip>", m)
    gsub(/[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]+/, "<hex>", m)
    gsub(/[0-9]+/, "N", m)
    return m
  }
  function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\t/, " ", s); return s }
  NF >= 3 && $1 ~ /^[0-9][0-9][0-9][0-9]-/ {
    id = $3; sub(/\[[0-9]+\]:?$/, "", id); sub(/:$/, "", id)
    msg = $0; sub(/^[^ ]+ [^ ]+ [^ ]+ ?/, "", msg)
    total++; per[id]++; key = id "\t" fold(msg); count[key]++
  }
  END {
    printf "%d\n", total
    n = 0; for (k in count) keys[++n] = k
    # Sort by count, highest first (insertion sort: the lists are short).
    for (i = 2; i <= n; i++) { k = keys[i]; for (j = i - 1; j > 0 && count[keys[j]] < count[k]; j--) keys[j + 1] = keys[j]; keys[j + 1] = k }
    if (json) {
      printf "{\"since\":\"%s\",\"priority\":\"%s\",\"total\":%d,\"units\":{", esc(since), prio, total
      sep = ""; for (u in per) { printf "%s\"%s\":%d", sep, esc(u), per[u]; sep = "," }
      printf "},\"top\":["
      for (i = 1; i <= n && i <= top; i++) { split(keys[i], p, "\t"); printf "%s{\"unit\":\"%s\",\"count\":%d,\"message\":\"%s\"}", (i > 1 ? "," : ""), esc(p[1]), count[keys[i]], esc(p[2]) }
      print "]}"
    } else {
      printf "%d message(s) at priority %s or worse since %s\n", total, prio, since
      fflush()
      for (u in per) printf "  %6d  %s\n", per[u], u | "sort -rn"
      close("sort -rn")
      if (n) print "Most common:"
      for (i = 1; i <= n && i <= top; i++) { split(keys[i], p, "\t"); printf "  %6d  %s: %s\n", count[keys[i]], p[1], substr(p[2], 1, 160) }
    }
  }' <<< "$raw")"
# The first line is the total, for the exit status; the rest is the report.
total="${summary%%$'\n'*}"
echo "${summary#*$'\n'}"
if (( total > max )); then exit 1; fi
