#!/usr/bin/env bash
# Take a Kubernetes node out of service safely before maintenance: cordon it,
# list what will move, then drain it through the Eviction API so that
# PodDisruptionBudgets are respected. Uncordon it again with -u afterwards.
# Without -y it shows the pods that would be evicted and runs the drain as a
# server-side dry run; nothing is cordoned or evicted.
#
# Usage: k8s_node_drain.sh [-x context] [-t timeout] [-e] [-y] node
#        k8s_node_drain.sh [-x context] -u [-y] node
#   -x  kubeconfig context (default: the current one, printed)
#   -t  how long the drain may take, e.g. 10m (default 10m)
#   -e  also evict pods that use emptyDir volumes (their emptyDir data is lost)
#   -u  uncordon: let the scheduler use the node again
#   -y  really do it
# Example: k8s_node_drain.sh -x prod -t 15m -y ip-10-0-3-17.ec2.internal
# It never uses --force (pods with no controller would be lost for good) or
# --disable-eviction (which bypasses PodDisruptionBudgets).
# RBAC: get, list, patch on nodes; list on pods; create on pods/eviction.
# Exit:  0 done, 1 the drain did not finish (the node stays cordoned; the
#        output says which pods blocked it), 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

ctx="" limit=10m emptydir=0 uncordon=0 apply=0
while getopts ":x:t:euyh" opt; do
  case "$opt" in
    x) ctx="$OPTARG" ;;
    t) limit="$OPTARG" ;;
    e) emptydir=1 ;;
    u) uncordon=1 ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
node="${1:-}"
[[ "$node" =~ ^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$ && "$limit" =~ ^[0-9]+[smh]$ ]] || { usage >&2; exit 2; }
command -v kubectl >/dev/null || { echo "k8s_node_drain: kubectl not found" >&2; exit 2; }

k=(kubectl)
[[ -n "$ctx" ]] && k+=(--context "$ctx")
echo "context: ${ctx:-$(kubectl config current-context 2>/dev/null || echo unknown)}  node: $node"
"${k[@]}" --request-timeout=30s get node "$node" -o name >/dev/null || exit 2

if (( uncordon )); then
  if (( apply )); then "${k[@]}" uncordon "$node"; else echo "would uncordon $node (add -y)"; fi
  exit 0
fi

echo "pods on $node (DaemonSet pods stay; the rest are evicted and rescheduled elsewhere):"
"${k[@]}" --request-timeout=30s get pods --all-namespaces --field-selector "spec.nodeName=$node" \
  -o custom-columns='NAMESPACE:.metadata.namespace,POD:.metadata.name,OWNER:.metadata.ownerReferences[0].kind' | sed 's/^/  /'

drain=(drain "$node" --ignore-daemonsets --timeout="$limit")
(( emptydir )) && drain+=(--delete-emptydir-data)

if (( ! apply )); then
  "${k[@]}" "${drain[@]}" --dry-run=server || { echo "k8s_node_drain: the dry run says this drain would fail (see above)" >&2; exit 1; }
  echo "(dry run; add -y to cordon and drain $node)"
  exit 0
fi

"${k[@]}" cordon "$node"
if ! "${k[@]}" "${drain[@]}"; then
  echo "k8s_node_drain: drain of $node did not finish within $limit; the node stays cordoned." >&2
  echo "  Usual causes: a PodDisruptionBudget allows no disruption right now, a pod with no controller," >&2
  echo "  or a pod with emptyDir data (-e). Fix that, run again, or k8s_node_drain.sh -u -y $node to undo." >&2
  exit 1
fi
echo "$node is drained and cordoned; uncordon it with: $0${ctx:+ -x $ctx} -u -y $node"
