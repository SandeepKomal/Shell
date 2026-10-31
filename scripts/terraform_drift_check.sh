#!/usr/bin/env bash
# Check one or more Terraform (or OpenTofu) root modules for drift: changes
# made outside Terraform, or code merged but never applied. It runs a plan
# with -detailed-exitcode, which exits 0 for no changes, 2 for changes and 1
# for an error, and lists the resources that would change.
# It never applies and plans with -lock=false so it does not block anyone's
# apply. Credentials come from the usual places (environment, profile, role).
#
# Usage: terraform_drift_check.sh [-b terraform|tofu] [-j] dir [dir...]
#   -b  binary to use (default: terraform, or tofu when terraform is missing)
#   -j  one JSON object per directory, for a dashboard
# Example: terraform_drift_check.sh -j envs/prod envs/staging
# Exit:  0 no drift anywhere, 1 drift in at least one directory,
#        2 bad usage, or a plan that could not run (init, credentials, syntax).
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

tf="" json=0
while getopts ":b:jh" opt; do
  case "$opt" in
    b) tf="$OPTARG" ;;
    j) json=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
(( $# > 0 )) || { usage >&2; exit 2; }
tf="${tf:-$(command -v terraform >/dev/null && echo terraform || echo tofu)}"
command -v "$tf" >/dev/null || { echo "terraform_drift_check: $tf not found" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export TF_IN_AUTOMATION=1 TF_INPUT=0
worst=0

for dir in "$@"; do
  [[ -d "$dir" ]] || { echo "terraform_drift_check: no such directory: $dir" >&2; worst=2; continue; }
  log="$work/plan.txt" rc=0
  # init only downloads providers and modules into .terraform; -lockfile=readonly keeps the lock file as committed.
  if ! "$tf" -chdir="$dir" init -input=false -no-color -lockfile=readonly > "$log" 2>&1; then
    rc=1
  else
    # Capture the status instead of letting set -e treat "2: changes present" as a crash.
    timeout 1800 "$tf" -chdir="$dir" plan -detailed-exitcode -lock=false -input=false -no-color > "$log" 2>&1 || rc=$?
  fi
  changes="$(sed -n 's/^  # \(.*\) \(will\|must\) be \(.*\)$/\1 (\3)/p' "$log")"
  count=$(grep -c . <<< "$changes" || true)
  case "$rc" in
    0) state=clean ;;
    2) state=drift; worst=$(( worst > 1 ? worst : 1 )) ;;
    *) state=error; worst=2 ;;
  esac
  if (( json )); then
    printf '{"dir":"%s","state":"%s","changes":%d}\n' "$dir" "$state" "$count"
  else
    case "$state" in
      clean) echo "$dir: no drift" ;;
      drift) echo "$dir: DRIFT, $count resource(s) would change"; awk '{print "  " $0}' <<< "$changes" ;;
      error) echo "$dir: could not plan (exit $rc):"; grep -m 5 -E '^(Error|│ Error)' "$log" | sed 's/^/  /' || tail -n 5 "$log" | sed 's/^/  /' ;;
    esac
  fi
done
exit "$worst"
