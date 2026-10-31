#!/usr/bin/env bash
# Delete old container images from an ECR repository: every untagged image
# older than -u days, and tagged images beyond the newest -k, except tags that
# match the protected pattern. Dry run by default: it lists what it would
# delete, oldest first, with sizes. -y deletes, 100 images per API call.
# For a permanent rule, an ECR lifecycle policy does this inside AWS; this
# script is for a one-off clean-up, or for rules a lifecycle policy cannot say.
# Check that no running task, pod or launch template still uses an image
# before deleting it: ECR does not know what is deployed.
#
# Usage: ecr_cleanup.sh [-r region] [-k keep] [-u untagged-days] [-p protect-regex] [-y] [-j] repository
#   -k  tagged images to keep, newest first (default 30)
#   -u  delete untagged images older than this many days (default 7)
#   -p  never delete images with a tag matching this (default ^(latest|prod|production|stable|release-.*)$)
#   -y  really delete; without it, only list
#   -j  JSON list of the images it would delete (or deleted)
# Example: ecr_cleanup.sh -r ap-south-1 -k 50 shop/api
#
# Minimum IAM permissions (replace REGION, ACCOUNT and REPO):
#   {"Version": "2012-10-17", "Statement": [
#     {"Effect": "Allow", "Action": ["ecr:DescribeImages", "ecr:BatchDeleteImage"],
#      "Resource": "arn:aws:ecr:REGION:ACCOUNT:repository/REPO"}]}
# Credentials: the AWS CLI's usual chain (environment, profile, SSO, instance role).
# Exit:  0 ok, 1 an AWS call failed or some images could not be deleted, 2 bad usage.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

region="" keep=30 untagged_days=7 protect='^(latest|prod|production|stable|release-.*)$' apply=0 json=0
while getopts ":r:k:u:p:yjh" opt; do
  case "$opt" in
    r) region="$OPTARG" ;;
    k) keep="$OPTARG" ;;
    u) untagged_days="$OPTARG" ;;
    p) protect="$OPTARG" ;;
    y) apply=1 ;;
    j) json=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
repo="${1:-}"
[[ "$repo" =~ ^[a-z0-9]+([._/-][a-z0-9]+)*$ && "$keep" =~ ^[0-9]+$ && "$untagged_days" =~ ^[0-9]+$ ]] || { usage >&2; exit 2; }
command -v aws >/dev/null || { echo "ecr_cleanup: the AWS CLI is not installed" >&2; exit 2; }

export AWS_RETRY_MODE="${AWS_RETRY_MODE:-standard}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-5}"
aws_=(aws --cli-connect-timeout 10 --cli-read-timeout 60 --output text)
[[ -n "$region" ]] && aws_+=(--region "$region")

# One line per image: digest, push time, size in bytes, tags joined by commas (or "-"), manifest type.
# The CLI follows nextToken itself, so a repository with thousands of images is listed in full.
# shellcheck disable=SC2016  # the backticks are JMESPath literals, not command substitution
query='imageDetails[].[imageDigest, imagePushedAt, imageSizeInBytes, join(`,`, imageTags || [`-`]), imageManifestMediaType || `-`]'
if ! rows="$("${aws_[@]}" ecr describe-images --repository-name "$repo" --query "$query" 2>&1)"; then
  echo "ecr_cleanup: describe-images failed: $rows" >&2
  exit 1
fi

cutoff=$(( $(date +%s) - untagged_days * 86400 ))
# A multi-arch image is an index whose per-platform images are untagged. Deleting those breaks the
# tagged image, so untagged images are left alone in a repository that has any index.
multiarch=0
if grep -qE 'manifest\.list|image\.index' <<< "$rows"; then
  multiarch=1
  echo "ecr_cleanup: $repo has multi-arch images; untagged images may be their parts and are kept" >&2
fi
# Newest first, then decide per image. imagePushedAt is epoch seconds or ISO 8601 depending on the
# CLI version; both become epoch seconds here.
plan="$(while IFS=$'\t' read -r digest pushed size tags _; do
          [[ -z "$digest" ]] && continue
          [[ "$pushed" =~ ^[0-9.]+$ ]] || pushed="$(date -d "$pushed" +%s)"
          printf '%s\t%s\t%s\t%s\n' "${pushed%.*}" "$digest" "$size" "$tags"
        done <<< "$rows" | sort -rn -k1,1 | awk -F'\t' -v keep="$keep" -v cutoff="$cutoff" -v protect="$protect" -v multiarch="$multiarch" '
  {
    if ($4 == "-") { if (!multiarch && $1 < cutoff) print $0 "\tuntagged"; next }
    n = split($4, t, ","); safe = 0
    for (i = 1; i <= n; i++) if (t[i] ~ protect) safe = 1
    if (safe) next
    if (++kept > keep) print $0 "\tbeyond newest " keep
  }')"

if [[ -z "$plan" ]]; then
  if (( json )); then echo "[]"; else echo "$repo: nothing to delete"; fi
  exit 0
fi
mapfile -t digests < <(cut -f2 <<< "$plan")
bytes=$(awk -F'\t' '{s += $3} END {printf "%.0f", s}' <<< "$plan")

if (( json )); then
  awk -F'\t' 'BEGIN { printf "[" } { printf "%s{\"digest\":\"%s\",\"pushed\":%d,\"bytes\":%d,\"tags\":\"%s\",\"reason\":\"%s\"}", (NR > 1 ? "," : ""), $2, $1, $3, $4, $5 } END { print "]" }' <<< "$plan"
else
  verb="would delete"; (( apply )) && verb="delete"
  sort -n -k1,1 <<< "$plan" | while IFS=$'\t' read -r pushed digest size tags why; do
    printf '%s %s %6s MB  %-28s %s\n' "$verb" "$(date -u -d "@$pushed" +%F)" "$(( size / 1048576 ))" "$tags" "${digest:7:12} ($why)"
  done
  echo "${#digests[@]} image(s), $(( bytes / 1048576 )) MB in $repo"
fi
if (( ! apply )); then echo "(dry run; add -y to delete)" >&2; exit 0; fi

failed=0
for (( i = 0; i < ${#digests[@]}; i += 100 )); do
  ids=(); for d in "${digests[@]:i:100}"; do ids+=("imageDigest=$d"); done
  out="$("${aws_[@]}" ecr batch-delete-image --repository-name "$repo" --image-ids "${ids[@]}" --query 'length(failures)' 2>&1)" || { echo "ecr_cleanup: batch-delete-image failed: $out" >&2; exit 1; }
  failed=$(( failed + ${out:-0} ))
done
if (( failed )); then echo "ecr_cleanup: $failed image(s) could not be deleted" >&2; exit 1; fi
echo "deleted ${#digests[@]} image(s)" >&2
