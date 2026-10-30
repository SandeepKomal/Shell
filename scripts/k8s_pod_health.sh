#!/usr/bin/env bash
set -euo pipefail
NAMESPACE="${1:-default}"
command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl is required" >&2; exit 1; }
kubectl get pods -n "$NAMESPACE" -o wide
