#!/usr/bin/env bash
# Check that a host or CI runner is ready before a deploy: required commands,
# environment variables, free disk space, and ports that must still be free.
# A failed preflight costs seconds; a deploy that fails half way costs an evening.
#
# Usage: preflight_check.sh [-c "cmd1 cmd2"] [-e "VAR1 VAR2"] [-d path:min-free-GB] [-p "port1 port2"]
# Example: preflight_check.sh -c "docker kubectl" -e "IMAGE_TAG KUBECONFIG" -d /var:5 -p "8080"
# Exit:  0 everything ready, 1 something is missing (all problems are listed).
set -euo pipefail

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

cmds="" vars="" disks=() ports=""
while getopts ":c:e:d:p:h" opt; do
  case "$opt" in
    c) cmds="$OPTARG" ;;
    e) vars="$OPTARG" ;;
    d) disks+=("$OPTARG") ;;
    p) ports="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

problems=0
ok()   { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; problems=$((problems + 1)); }

for c in $cmds; do
  if command -v "$c" >/dev/null; then ok "command $c"; else fail "command $c is not installed"; fi
done
for v in $vars; do
  # Only say whether it is set: never print the value, it may be a secret.
  if [[ -n "${!v:-}" ]]; then ok "variable $v is set"; else fail "variable $v is empty or unset"; fi
done
for d in "${disks[@]}"; do
  path="${d%%:*}" need="${d##*:}"
  free=$(df -PBG "$path" 2>/dev/null | awk 'NR==2 { gsub("G","",$4); print $4 }')
  if [[ -z "$free" ]]; then fail "disk $path does not exist"
  elif (( free >= need )); then ok "disk $path has ${free}G free (need ${need}G)"
  else fail "disk $path has ${free}G free, needs ${need}G"; fi
done
for p in $ports; do
  if ss -ltn "sport = :$p" 2>/dev/null | grep -q LISTEN; then fail "port $p is already in use"; else ok "port $p is free"; fi
done

if (( problems )); then echo "$problems problem(s): not ready."; exit 1; fi
echo "Ready."
