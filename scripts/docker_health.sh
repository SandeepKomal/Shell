#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${1:?Usage: $0 <container-name-or-id>}"
running="$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$running" == "true" ]] || { echo "ERROR: container is not running: $CONTAINER" >&2; exit 1; }
printf 'Container: %s\nRunning: %s\nHealth: %s\n' "$CONTAINER" "$running" "$health"
