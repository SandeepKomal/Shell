#!/usr/bin/env bash
# Delete local branches that are already merged into the main branch, and
# optionally their remote copies. Dry run by default; protected branches
# (main, master, develop, release/*) are never touched.
#
# Usage: git_prune_branches.sh [-b base-branch] [-r] [-y]
#   -b  branch they must be merged into (default: origin's default branch)
#   -r  also delete the merged branches on origin
#   -y  really delete; without it, only list
# Exit:  0 on success, 2 when not in a git repository.
set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }

base="" remote=0 apply=0
while getopts ":b:ryh" opt; do
  case "$opt" in
    b) base="$OPTARG" ;;
    r) remote=1 ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
git rev-parse --git-dir >/dev/null 2>&1 || { echo "git_prune_branches: not a git repository" >&2; exit 2; }
if [[ -z "$base" ]]; then
  base="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')" || true
  base="${base:-main}"
fi
protected='^(main|master|develop|release/.*)$'
current="$(git branch --show-current)"

mapfile -t merged < <(git branch --format='%(refname:short)' --merged "$base" | grep -Ev "$protected" | grep -vx -- "$base" | grep -vx -- "$current" || true)
if (( ${#merged[@]} == 0 )); then echo "No merged local branches to delete."; else
  for b in "${merged[@]}"; do
    if (( apply )); then git branch -d -- "$b"; else echo "would delete local $b"; fi
  done
fi

if (( remote )); then
  git fetch --prune origin >/dev/null 2>&1 || true
  mapfile -t rmerged < <(git branch -r --format='%(refname:short)' --merged "origin/$base" | sed -n 's#^origin/##p' | grep -Ev "$protected|^HEAD$" | grep -vx -- "$base" || true)
  for b in "${rmerged[@]}"; do
    if (( apply )); then git push origin --delete -- "$b"; else echo "would delete origin/$b"; fi
  done
fi
(( apply )) || echo "(dry run; add -y to delete)"
