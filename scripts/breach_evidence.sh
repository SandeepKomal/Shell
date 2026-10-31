#!/usr/bin/env bash
# Collect evidence on one host after a suspected personal data breach,
# without copying the personal data itself: a timeline of logins, sudo and
# web requests in the incident window, the files changed in it (metadata
# only), and who collected what and when, with checksums for every file.
# Breach laws such as India's DPDP Act expect you to tell the regulator and
# the people affected what happened; this gathers the facts for that report
# and for the investigation. It is engineering help, not legal advice.
#
# What it keeps out of the bundle:
#   web visitors' IP addresses are replaced by pseudonyms (a keyed hash; the
#   key is printed once on the terminal and is not in the bundle), except the
#   addresses given with -i, which stay readable and are flagged;
#   query strings are dropped, and e-mail addresses and phone or Aadhaar-like
#   numbers in URL paths are masked; file contents are never copied.
# Login and sudo records keep account names and source addresses: they are
# the staff accounts and attacker addresses the investigation is about.
#
# Usage: breach_evidence.sh -s since [-u until] [-l access-log ...] [-c dir ...] [-i "ip ip"] [-n case-id] [-o out-dir]
#   -s  start of the window, anything date -d understands, e.g. "2026-10-30 18:00"
#   -u  end of the window (default: now)
#   -l  web access log in combined format (repeatable; default /var/log/nginx/access.log*)
#   -c  directory to list files changed in the window (repeatable; default /etc /var/www)
#   -i  indicator IP addresses to keep readable and flag in the timeline
#   -n  case id for the bundle name (default: breach-<host>-<time>)
#   -o  where to write the bundle (default: the current directory)
# Example: sudo breach_evidence.sh -s "2026-10-30 18:00" -i "203.0.113.7" -n INC-1042 -o /root/cases
# The host's timezone is assumed for log times. It only reads; run it as root
# to see every log. Copy the bundle off the host, and keep the key apart from it.
# Exit:  0 with the bundle path and its SHA-256 printed, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

since="" until="now" logs=() dirs=() iocs="" case_id="" out="."
while getopts ":s:u:l:c:i:n:o:h" opt; do
  case "$opt" in
    s) since="$OPTARG" ;;
    u) until="$OPTARG" ;;
    l) logs+=("$OPTARG") ;;
    c) dirs+=("$OPTARG") ;;
    i) iocs="$OPTARG" ;;
    n) case_id="$OPTARG" ;;
    o) out="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -n "$since" && -d "$out" ]] || { usage >&2; exit 2; }
from="$(date -d "$since" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null)" || { echo "breach_evidence: cannot read -s $since" >&2; exit 2; }
to="$(date -d "$until" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null)" || { echo "breach_evidence: cannot read -u $until" >&2; exit 2; }
[[ "$from" < "$to" ]] || { echo "breach_evidence: -s must be before -u" >&2; exit 2; }
for ip in $iocs; do [[ "$ip" =~ ^[0-9A-Fa-f:.]+$ ]] || { echo "breach_evidence: not an IP address: $ip" >&2; exit 2; }; done
host="$(hostname)"
case_id="${case_id:-breach-$host-$(date +%Y%m%d-%H%M%S)}"
[[ "$case_id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "breach_evidence: case id may only use letters, digits, . _ -" >&2; exit 2; }
(( ${#logs[@]} )) || for f in /var/log/nginx/access.log*; do [[ -f "$f" ]] && logs+=("$f"); done
(( ${#dirs[@]} )) || for d in /etc /var/www; do [[ -d "$d" ]] && dirs+=("$d"); done

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dir="$work/$case_id"
mkdir -p "$dir"
note() { echo "$*" >> "$dir/collection-notes.txt"; }

# 1. Who collected what, when, with which tool.
{
  echo "case:          $case_id"
  echo "host:          $host"
  echo "window:        $from to $to (host time, $(date +%Z))"
  echo "collected at:  $(date -u '+%Y-%m-%dT%H:%M:%SZ') by $(id -un) (uid $(id -u))"
  echo "tool:          $(basename "$0") sha256 $(sha256sum "$0" | cut -c1-64)"
  echo "access logs:   ${logs[*]:-none}"
  echo "changed files: ${dirs[*]:-none}"
  echo "indicators:    ${iocs:-none}"
} > "$dir/case.txt"

# 2. The host as it is now.
{
  echo "== uname";   uname -a
  echo "== uptime";  uptime
  echo "== clock";   date -u; command -v timedatectl >/dev/null && timedatectl show -p NTPSynchronized 2>/dev/null || true
  echo "== addresses"; ip -brief address 2>/dev/null || hostname -I 2>/dev/null || true
  echo "== listening"; ss -tulpn 2>/dev/null || true
} > "$dir/host.txt" 2>&1

# 3. Logins and privilege use in the window.
{
  echo "== logged in now"; who 2>/dev/null || true
  echo "== logins in the window"; last -F -s "$from" -t "$to" 2>/dev/null || note "last: wtmp not readable"
} > "$dir/sessions.txt"
if command -v journalctl >/dev/null; then
  journalctl -q --no-pager -o short-iso --since "$from" --until "$to" _COMM=sshd + _COMM=sudo + _COMM=su + _COMM=useradd + _COMM=usermod + _COMM=passwd \
    > "$dir/auth-timeline.txt" 2>/dev/null || note "journalctl: no access to the journal (run as root?)"
else
  grep -hE 'sshd|sudo|su:|useradd|usermod|passwd' /var/log/auth.log /var/log/secure 2>/dev/null > "$dir/auth-timeline.txt" \
    || note "auth.log/secure not readable; auth-timeline.txt is not filtered by time"
fi

# 4. Web requests in the window, without the personal data in them.
key="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
if (( ${#logs[@]} )); then
  # Unique client addresses in the window, each with its keyed pseudonym (indicators stay readable).
  for f in "${logs[@]}"; do if [[ "$f" == *.gz ]]; then gzip -dc -- "$f"; else cat -- "$f"; fi; done > "$work/access.raw" 2>/dev/null || note "some access logs could not be read"
  awk '{print $1}' "$work/access.raw" | sort -u | while IFS= read -r ip; do
    if [[ " $iocs " == *" $ip "* ]]; then printf '%s\t%s\n' "$ip" "IOC:$ip"
    else printf '%s\tc-%s\n' "$ip" "$(printf '%s%s' "$key" "$ip" | sha256sum | cut -c1-12)"; fi
  done > "$work/pseudonyms.tsv"
  awk -v from="$from" -v to="$to" '
    BEGIN {
      split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", m, " "); for (i = 1; i <= 12; i++) mon[m[i]] = sprintf("%02d", i)
      d = "[0-9]"; ten = "[6-9]" d d d d d d d d d; twelve = "[2-9]" d d d d d d d d d d d
    }
    FNR == NR { alias[$1] = $2; next }
    {
      # 1.2.3.4 - - [31/Oct/2026:10:00:01 +0530] "GET /orders/42?x=1 HTTP/1.1" 200 512 ...
      t = substr($4, 2); split(t, a, /[\/:]/)
      ts = a[3] "-" mon[a[2]] "-" a[1] "T" a[4] ":" a[5] ":" a[6]
      if (ts < from || ts > to) next
      method = substr($6, 2); path = $7; sub(/\?.*/, "", path)
      gsub(/[A-Za-z0-9._%+-]+(@|%40)[A-Za-z0-9.-]+/, "<email>", path)
      gsub(twelve, "<number>", path); gsub(ten, "<number>", path)
      print ts "\t" alias[$1] "\t" method "\t" path "\t" $9 "\t" ($10 ~ /^[0-9]+$/ ? $10 : 0)
    }' "$work/pseudonyms.tsv" "$work/access.raw" | sort | { printf 'time\tclient\tmethod\tpath\tstatus\tbytes\n'; cat; } > "$dir/access-timeline.tsv"
  rm -f "$work/access.raw" "$work/pseudonyms.tsv"
  awk -F'\t' 'NR > 1 {
      n++; hour[substr($1, 1, 13)]++; status[$5]++; paths[$4]++; bytes[$2] += $6; reqs[$2]++
      if ($2 ~ /^IOC:/) ioc++
    }
    END {
      printf "%d request(s) in the window, %d from indicator addresses\n\n== per hour\n", n, ioc
      for (h in hour) printf "%s:00  %d\n", h, hour[h] | "sort"; close("sort")
      print "\n== status codes"; for (s in status) printf "%s  %d\n", s, status[s] | "sort"; close("sort")
      print "\n== top paths (query strings removed)"; for (p in paths) printf "%8d  %s\n", paths[p], p | "sort -rn | head -20"; close("sort -rn | head -20")
      print "\n== clients by bytes sent to them (large numbers can mean data taken)"
      for (c in bytes) printf "%12d bytes  %6d req  %s\n", bytes[c], reqs[c], c | "sort -rn | head -20"; close("sort -rn | head -20")
    }' "$dir/access-timeline.tsv" > "$dir/access-summary.txt"
else
  note "no web access logs given or found"
fi

# 5. Files changed in the window: metadata only, never contents.
if (( ${#dirs[@]} )); then
  printf 'modified\tsize\towner\tmode\tpath\n' > "$dir/changed-files.tsv"
  find "${dirs[@]}" -xdev -type f -newermt "$from" ! -newermt "$to" -printf '%TY-%Tm-%TdT%TH:%TM\t%s\t%u\t%m\t%p\n' 2>/dev/null | sort >> "$dir/changed-files.tsv" || true
fi

# 6. The facts a breach report needs, to fill in by hand.
cat > "$dir/report-facts.md" <<EOF
# $case_id: facts for the breach report

Fill in from the evidence and the investigation. Not legal advice: your
privacy or legal team decides what to notify, to whom and when.

- When it was discovered, and by whom:
- What happened (nature of the breach), as far as known:
- Window of exposure: $from to $to (host time) on $host
- Systems and data stores involved:
- Categories of personal data likely affected (contact, identity numbers, financial, children's data, ...):
- Approximate number of people affected, and how that was counted:
- Likely consequences for the people affected:
- What has been done to contain it and reduce harm:
- What people affected can do to protect themselves:
- Contact point for questions:
- Evidence: this bundle (see manifest.sha256)
EOF

(cd "$dir" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$work/manifest.sha256" && mv "$work/manifest.sha256" .)
bundle="$out/$case_id.tar.gz"
tar -czf "$bundle" -C "$work" "$case_id"
echo "$bundle"
echo "sha256 $(sha256sum "$bundle" | cut -c1-64)  (record it in the case log)"
echo "pseudonym key: $key  (keep it in the case record, apart from the bundle)" >&2
