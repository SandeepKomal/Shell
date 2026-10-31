#!/usr/bin/env bash
# Find personal data in files and logs before it leaks: Indian identifiers
# and contact details, for CI, pre-commit or a periodic sweep of log folders.
# It reports file, line and kind with the value masked, plus counts per file,
# and never prints what it found. A starting point for data discovery, not
# legal advice: tune it to the data your systems really hold.
#
# What it looks for:
#   Aadhaar   12 digits (optionally 4-4-4), first digit 2-9, Verhoeff checksum valid
#   PAN       AAAAA9999A, with a valid holder-type letter in the 4th place
#   Mobile    Indian mobile numbers, with or without +91 / 0
#   Email     e-mail addresses
#   UPI ID    name@bank handles (an @ with no dot after it)
#   Bank a/c  an account number (9-18 digits) on a line with an IFSC code
#   Passport  Indian passport number format (letter + 7 digits)
#   Voter ID  EPIC number format (3 letters + 7 digits)
# Mobile numbers are the noisiest rule (any 10-digit id starting 6-9 looks
# the same); use an allowlist rather than dropping the rule.
#
# Usage: pii_scan.sh [-a allowlist] [-c] [-j] [path ...]      (default path: .; - reads standard input)
#   -a  file of regular expressions, one per line (# comments), matched against
#       "file:line:value"; matching findings are ignored (test fixtures, sample numbers)
#   -c  counts per file only, no per-line findings
#   -j  JSON: {"findings": [...], "files": {file: {kind: count}}}
# Example: pii_scan.sh -a .piiallow /var/log/shop
#          git diff --cached --name-only -z | xargs -0 -r pii_scan.sh     (pre-commit)
# Exit:  0 nothing found, 1 personal data found, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

allow="" counts=0 json=0
while getopts ":a:cjh" opt; do
  case "$opt" in
    a) allow="$OPTARG" ;;
    c) counts=1 ;;
    j) json=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
(( $# > 0 )) || set -- .
[[ -z "$allow" || -r "$allow" ]] || { echo "pii_scan: cannot read allowlist $allow" >&2; exit 2; }

# Each rule reads the input again, so standard input is kept in a private temporary file.
stdin_copy=""
for i in $(seq 1 $#); do
  if [[ "${!i}" == "-" ]]; then
    umask 077; stdin_copy="$(mktemp)"; trap 'rm -f "$stdin_copy"' EXIT
    cat > "$stdin_copy"
    set -- "${@:1:i-1}" "$stdin_copy" "${@:i+1}"
    break
  fi
done

# kind<TAB>extended regular expression. grep finds candidates; awk validates and masks them.
rules=$'Aadhaar\t\\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\\b
PAN\t\\b[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]\\b
Mobile\t(\\+91[ -]?|\\b(91|0)[ -]?|\\b)[6-9][0-9]{9}\\b
At\t\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*
IFSC\t\\b[A-Z]{4}0[A-Z0-9]{6}\\b
Passport\t\\b[A-PR-WY][1-9][0-9]{5}[1-9]\\b
Voter ID\t\\b[A-Z]{3}[0-9]{7}\\b'

# grep prints file:line:value. Binary files, .git and dependency folders are skipped.
grep_=(grep -rnHIE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.terraform --exclude-dir=vendor)
# Allowlist lines starting with # are comments; blank lines are dropped (an empty pattern matches everything).
allowed() { if [[ -n "$allow" ]]; then grep -vEf <(grep -vE '^[[:space:]]*(#|$)' "$allow") || true; else cat; fi; }
candidates() {
  local kind re only
  while IFS=$'\t' read -r kind re; do
    # -o prints just the value; for IFSC the whole line is kept, to look for an account number on it.
    only=-o; [[ "$kind" == IFSC ]] && only=""
    "${grep_[@]}" ${only:+"$only"} -e "$re" -- "$@" | allowed | sed "s/^/$kind	/" || true
  done <<< "$rules"
}

found="$(candidates "$@" | awk -F'\t' -v counts="$counts" -v json="$json" -v stdin_copy="$stdin_copy" '
  BEGIN {
    split("0123456789 1234067895 2340178956 3401289567 4012395678 5987604321 6598710432 7659821043 8765932104 9876543210", D, " ")
    split("0123456789 1576283094 5803796142 8916043527 9453126870 4286573901 2793806415 7046913258", P, " ")
    nk = split("Aadhaar,PAN,Mobile,Email,UPI ID,Bank a/c,Passport,Voter ID", ORDER, ",")
  }
  function verhoeff(s,   c, i, n) {
    c = 0; n = length(s)
    for (i = 0; i < n; i++) c = substr(D[c + 1], substr(P[i % 8 + 1], substr(s, n - i, 1) + 1, 1) + 1, 1) + 0
    return c == 0
  }
  function tail2(s) { return "…" substr(s, length(s) - 1) }
  function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
  function hit(file, line, kind, masked) {
    n++; F[n] = file; L[n] = line; K[n] = kind; M[n] = masked
    cnt[file, kind]++; seenfile[file] = 1
  }
  {
    kind = $1; rest = substr($0, length(kind) + 2)
    # file:line:value; the first ":digits:" ends the file name (an IFSC line may hold more colons).
    if (!match(rest, /:[0-9]+:/)) next
    file = substr(rest, 1, RSTART - 1); line = substr(rest, RSTART + 1, RLENGTH - 2); value = substr(rest, RSTART + RLENGTH)
    if (stdin_copy != "" && file == stdin_copy) file = "stdin"
    if (kind == "Aadhaar") { d = value; gsub(/[ -]/, "", d); if (verhoeff(d)) hit(file, line, kind, "…" substr(d, 11)) }
    else if (kind == "At") {
      at = index(value, "@"); dom = substr(value, at + 1)
      if (dom ~ /\.[A-Za-z][A-Za-z]+$/) hit(file, line, "Email", "…@" dom)
      else if (dom ~ /^[A-Za-z][A-Za-z]+$/ && at > 2) hit(file, line, "UPI ID", "…@" dom)
    }
    else if (kind == "IFSC") {
      # An account number is a run of 9 to 18 digits on the same line.
      s = value
      while (match(s, /[0-9]+/)) {
        if (RLENGTH >= 9 && RLENGTH <= 18) { hit(file, line, "Bank a/c", tail2(substr(s, RSTART, RLENGTH))); break }
        s = substr(s, RSTART + RLENGTH)
      }
    }
    else { v = value; gsub(/[ -]/, "", v); hit(file, line, kind, tail2(v)) }
  }
  END {
    if (json) {
      printf "{\"findings\":["
      for (i = 1; i <= n; i++) printf "%s{\"file\":\"%s\",\"line\":%d,\"kind\":\"%s\",\"match\":\"%s\"}", (i > 1 ? "," : ""), esc(F[i]), L[i], K[i], M[i]
      printf "],\"files\":{"; sep = ""
      for (f in seenfile) {
        printf "%s\"%s\":{", sep, esc(f); s2 = ""
        for (j = 1; j <= nk; j++) { k = ORDER[j]; if ((f, k) in cnt) { printf "%s\"%s\":%d", s2, k, cnt[f, k]; s2 = "," } }
        printf "}"; sep = ","
      }
      print "}}"
    } else {
      if (!counts) {
        for (i = 1; i <= n; i++) printf "%s:%s: %s (%s)\n", F[i], L[i], K[i], M[i] | "sort -t: -k1,1 -k2,2n -s"
        close("sort -t: -k1,1 -k2,2n -s")
      }
      files = 0; fflush()
      for (f in seenfile) {
        files++; line = ""
        for (j = 1; j <= nk; j++) { k = ORDER[j]; if ((f, k) in cnt) line = line sprintf("%s%s %d", (line == "" ? "" : ", "), k, cnt[f, k]) }
        printf "%s: %s\n", f, line | "sort"
      }
      close("sort")
      if (n) printf "%d possible personal data item(s) in %d file(s).\n", n, files
      else print "No personal data found."
    }
    exit (n > 0)
  }')" && status=0 || status=$?
echo "$found"
exit "$status"
