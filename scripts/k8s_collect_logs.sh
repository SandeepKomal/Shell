#!/usr/bin/env bash
# Collect what you need to debug a Kubernetes namespace into one archive:
# pods, deployments, events in time order, and for every pod its describe
# output and the logs of every container, including the previous (crashed)
# container. Grab it before anyone deletes the failing pods. It only reads.
# Logs can hold personal data: the archive is created readable by you only.
#
# Usage: k8s_collect_logs.sh [-x context] [-n namespace] [-l selector] [-s since] [-o out-dir]
#   -x  kubeconfig context (default: the current one)
#   -n  namespace (default: default)
#   -l  only pods with these labels, e.g. app=api
#   -s  only log lines newer than this, e.g. 2h (default 6h)
#   -o  where to write the archive (default: the current directory)
# Example: k8s_collect_logs.sh -x prod -n shop -l app=api -s 1h -o /tmp
# RBAC: get, list on pods, pods/log, events, deployments, replicasets.
# Exit:  0 with the archive path printed (sections that could not be read are
#        recorded in errors.txt), 2 bad usage or the namespace cannot be read.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

ctx="" ns=default selector="" since=6h out="."
while getopts ":x:n:l:s:o:h" opt; do
  case "$opt" in
    x) ctx="$OPTARG" ;;
    n) ns="$OPTARG" ;;
    l) selector="$OPTARG" ;;
    s) since="$OPTARG" ;;
    o) out="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$ns" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ && "$since" =~ ^[0-9]+[smh]$ && -d "$out" ]] || { usage >&2; exit 2; }
command -v kubectl >/dev/null || { echo "k8s_collect_logs: kubectl not found" >&2; exit 2; }

k=(kubectl --request-timeout=60s -n "$ns")
[[ -n "$ctx" ]] && k+=(--context "$ctx")
sel=(); [[ -n "$selector" ]] && sel=(-l "$selector")

umask 077
stamp="k8s-$ns-$(date +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dir="$work/$stamp"
mkdir -p "$dir/pods"

# grab <file> <kubectl args...>: keep the output, or note why it failed and carry on.
grab() {
  local file="$1"; shift
  "${k[@]}" "$@" > "$dir/$file" 2>&1 || echo "$file: kubectl $* failed: $(head -c 300 "$dir/$file")" >> "$dir/errors.txt"
}

"${k[@]}" get pods "${sel[@]}" -o name > "$dir/pod-names.txt" 2>"$dir/errors.txt" || { cat "$dir/errors.txt" >&2; exit 2; }
grab pods.txt        get pods "${sel[@]}" -o wide
grab deployments.txt get deployments,replicasets,statefulsets,daemonsets -o wide
grab events.txt      get events --sort-by=.lastTimestamp
while IFS= read -r pod; do
  p="${pod#pod/}"
  grab "pods/$p.describe.txt" describe pod "$p"
  for c in $("${k[@]}" get pod "$p" -o jsonpath='{.spec.initContainers[*].name} {.spec.containers[*].name}' 2>/dev/null); do
    grab "pods/$p.$c.log" logs "$p" -c "$c" --since="$since" --timestamps
    # --previous only exists after a restart; its absence is normal, not an error.
    "${k[@]}" logs "$p" -c "$c" --previous --since="$since" --timestamps > "$dir/pods/$p.$c.previous.log" 2>/dev/null || rm -f "$dir/pods/$p.$c.previous.log"
  done
done < "$dir/pod-names.txt"

archive="$out/$stamp.tar.gz"
tar -czf "$archive" -C "$work" "$stamp"
echo "$archive ($(grep -c . "$dir/pod-names.txt" || true) pod(s); treat it like the logs it contains)"
