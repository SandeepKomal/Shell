#!/usr/bin/env bash
# Deploy a build into a new release directory and switch a "current" symlink
# to it in one atomic step; roll back by switching it to the previous release.
# This is the layout many teams use for apps on plain VMs:
#   /srv/app/releases/20260101-120000/   one directory per deploy
#   /srv/app/current -> releases/...      what the service runs
#
# Usage: release_deploy.sh deploy   app-root build-dir [keep]
#        release_deploy.sh rollback app-root
#        release_deploy.sh list     app-root
# Exit:  0 on success, 1 when there is nothing to roll back to, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

cmd="${1:-}" root="${2:-}"
[[ -n "$cmd" && -n "$root" ]] || { usage >&2; exit 2; }
releases="$root/releases"

# Release directories, newest first (their names are timestamps).
list_releases() { find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -r; }

# ln -sfn then mv -T replaces the link in a single rename, so nothing ever sees it missing.
switch_to() {
  ln -sfn "releases/$1" "$root/current.tmp"
  mv -Tf "$root/current.tmp" "$root/current"
  echo "current -> releases/$1"
}

case "$cmd" in
  deploy)
    build="${3:-}" keep="${4:-5}"
    [[ -d "$build" && "$keep" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }
    id="$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$releases"
    [[ -e "$releases/$id" ]] && id="$id-$$"
    cp -a "$build" "$releases/$id"
    switch_to "$id"
    mapfile -t old < <(list_releases | tail -n +"$(( keep + 1 ))")
    for r in "${old[@]}"; do rm -rf -- "${releases:?}/$r"; echo "removed old release $r"; done
    ;;
  rollback)
    now="$(basename "$(readlink "$root/current")")"
    prev="$(list_releases | grep -A1 -x -- "$now" | tail -n +2 || true)"
    [[ -n "$prev" ]] || { echo "release_deploy: no release older than $now" >&2; exit 1; }
    switch_to "$prev"
    echo "(remember to restart or reload the service if it does not follow the link by itself)"
    ;;
  list)
    now="$(basename "$(readlink "$root/current" 2>/dev/null || echo none)")"
    while IFS= read -r r; do
      if [[ "$r" == "$now" ]]; then echo "* $r (current)"; else echo "  $r"; fi
    done < <(list_releases)
    ;;
  *) usage >&2; exit 2 ;;
esac
