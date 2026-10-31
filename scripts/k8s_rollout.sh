#!/usr/bin/env bash
# Roll a new image out to a Kubernetes Deployment, wait until it is healthy,
# and roll back automatically when it is not. Without -y it shows the current
# and new image and validates the change on the server (--dry-run=server).
#
# Usage: k8s_rollout.sh [-x context] [-n namespace] [-c container] [-t timeout] [-y] deployment image
#   -x  kubeconfig context (default: the current one, printed so you can check it)
#   -n  namespace (default: default)
#   -c  container to update (default: the first container in the pod spec)
#   -t  how long the rollout may take, e.g. 5m (default 5m)
#   -y  really roll out; without it, only show and validate
# Example: k8s_rollout.sh -x prod -n shop -y api registry.example.com/shop/api:1.4.2
# RBAC: get, patch on deployments; get, list, watch on replicasets and pods.
# Exit:  0 rolled out and healthy, 1 the rollout failed and was rolled back,
#        2 bad usage or the change was rejected, 3 the rollback failed too (page someone).
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

ctx="" ns=default container="" limit=5m apply=0
while getopts ":x:n:c:t:yh" opt; do
  case "$opt" in
    x) ctx="$OPTARG" ;;
    n) ns="$OPTARG" ;;
    c) container="$OPTARG" ;;
    t) limit="$OPTARG" ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
deploy="${1:-}" image="${2:-}"
[[ -n "$deploy" && -n "$image" && "$limit" =~ ^[0-9]+[smh]$ ]] || { usage >&2; exit 2; }
name_re='^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$'
[[ "$deploy" =~ $name_re && ( -z "$container" || "$container" =~ $name_re ) ]] || { echo "k8s_rollout: not a valid Kubernetes name" >&2; exit 2; }
command -v kubectl >/dev/null || { echo "k8s_rollout: kubectl not found" >&2; exit 2; }

k=(kubectl -n "$ns")
[[ -n "$ctx" ]] && k+=(--context "$ctx")
# Single requests get a timeout; rollout status is a watch and has its own --timeout.
kq=("${k[@]}" --request-timeout=30s)
echo "context: ${ctx:-$(kubectl config current-context 2>/dev/null || echo unknown)}  namespace: $ns"

if [[ -z "$container" ]]; then
  container="$("${kq[@]}" get deployment "$deploy" -o jsonpath='{.spec.template.spec.containers[0].name}')" || exit 2
fi
current="$("${kq[@]}" get deployment "$deploy" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$container\")].image}")" || exit 2
[[ -n "$current" ]] || { echo "k8s_rollout: no container $container in deployment/$deploy" >&2; exit 2; }
echo "deployment/$deploy container $container: $current -> $image"
[[ "$current" == "$image" ]] && { echo "already running $image; nothing to do"; exit 0; }

if (( ! apply )); then
  "${kq[@]}" set image "deployment/$deploy" "$container=$image" --dry-run=server -o name >/dev/null || exit 2
  echo "(dry run: the API server accepts the change; add -y to roll out)"
  exit 0
fi

"${kq[@]}" set image "deployment/$deploy" "$container=$image" || exit 2
"${kq[@]}" annotate "deployment/$deploy" --overwrite "kubernetes.io/change-cause=k8s_rollout.sh: $container=$image by ${USER:-unknown}" >/dev/null || true
# rollout status exits non-zero on a timeout or when the progress deadline is exceeded.
if "${k[@]}" rollout status "deployment/$deploy" --timeout="$limit"; then
  echo "rolled out: $image"
  exit 0
fi

echo "k8s_rollout: rollout of $image did not become healthy in $limit; rolling back" >&2
echo "  to see why: k8s_collect_logs.sh -n $ns${ctx:+ -x $ctx}" >&2
if "${k[@]}" rollout undo "deployment/$deploy" && "${k[@]}" rollout status "deployment/$deploy" --timeout="$limit"; then
  echo "rolled back to the previous revision ($current)" >&2
  exit 1
fi
echo "k8s_rollout: ROLLBACK FAILED for deployment/$deploy in $ns; it needs a human now" >&2
"${kq[@]}" get deployment "$deploy" -o wide >&2 || true
exit 3
