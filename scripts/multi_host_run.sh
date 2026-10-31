#!/usr/bin/env bash
# Run one command on many hosts over ssh, a few at a time, and report which
# hosts failed. Output is grouped per host so it stays readable.
# Dry run by default: it lists the hosts and the command; -y runs it.
#
# Usage: multi_host_run.sh -f hosts.txt [-p parallel] [-t timeout] [-u user] [-y] -- command [args...]
#   -f  hosts file, one host per line (# comments and blank lines are ignored)
#   -p  how many hosts at once (default 5)
#   -t  seconds before one host's run is stopped (default 60)
#   -u  ssh user (default: your ssh config)
#   -y  really run; without it, only show what would run
# Example: multi_host_run.sh -f web.txt -p 10 -y -- systemctl is-active nginx
# Safety: ssh runs with BatchMode (no password prompts), -n (it cannot eat the
#   host list) and normal host key checking. Unknown hosts fail; add them to
#   known_hosts first rather than turning checking off.
# Exit:  0 every host succeeded, 1 one or more failed (listed at the end), 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

hosts_file="" parallel=5 limit=60 user="" apply=0
while getopts ":f:p:t:u:yh" opt; do
  case "$opt" in
    f) hosts_file="$OPTARG" ;;
    p) parallel="$OPTARG" ;;
    t) limit="$OPTARG" ;;
    u) user="$OPTARG" ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[[ "${1:-}" == "--" ]] && shift
[[ -r "$hosts_file" && $# -gt 0 && "$parallel" =~ ^[1-9][0-9]*$ && "$limit" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }

hosts=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"; line="${line//[[:space:]]/}"
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "multi_host_run: not a host name: $line" >&2; exit 2; }
  hosts+=("$line")
done < "$hosts_file"
(( ${#hosts[@]} > 0 )) || { echo "multi_host_run: no hosts in $hosts_file" >&2; exit 2; }

# ssh joins its arguments into one remote command line; quote each one so it arrives intact.
remote="$(printf '%q ' "$@")"
if (( ! apply )); then
  for h in "${hosts[@]}"; do echo "would run on $h: ${remote% }"; done
  echo "(dry run; add -y to run on ${#hosts[@]} host(s), $parallel at a time)"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ssh_opts=(-n -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2)
[[ -n "$user" ]] && ssh_opts+=(-l "$user")

run_one() {
  local i="$1" h="$2" rc=0
  timeout --kill-after=10 "$limit" ssh "${ssh_opts[@]}" -- "$h" "$remote" > "$work/$i.out" 2>&1 || rc=$?
  echo "$rc" > "$work/$i.rc"
}

running=0
for i in "${!hosts[@]}"; do
  if (( running >= parallel )); then wait -n || true; running=$(( running - 1 )); fi
  run_one "$i" "${hosts[$i]}" &
  running=$(( running + 1 ))
done
wait || true

failed=()
for i in "${!hosts[@]}"; do
  rc="$(cat "$work/$i.rc" 2>/dev/null || echo 255)"
  echo "== ${hosts[$i]} (exit $rc)"
  sed 's/^/   /' "$work/$i.out" 2>/dev/null || true
  if [[ "$rc" != 0 ]]; then
    case "$rc" in 124|137) why="timed out after ${limit}s" ;; 255) why="ssh failed" ;; *) why="exit $rc" ;; esac
    failed+=("${hosts[$i]} ($why)")
  fi
done

echo "${#hosts[@]} host(s), $(( ${#hosts[@]} - ${#failed[@]} )) ok, ${#failed[@]} failed"
if (( ${#failed[@]} )); then printf '  failed: %s\n' "${failed[@]}"; exit 1; fi
