#!/usr/bin/env bash
# Copy a local backup directory to S3 with server-side encryption, then check
# that nothing is left to upload. Without -y it runs "aws s3 sync --dryrun"
# and shows what would be uploaded (and deleted, with -D).
# -D mirrors deletions to the bucket. It is refused when the source is empty
# or has fewer than -m files, because an unmounted disk looks exactly like
# "delete everything". Turn on bucket versioning so a mistake can be undone.
#
# Usage: s3_backup_sync.sh [-k kms-key-id] [-c storage-class] [-D] [-m min-files] [-r region] [-y] source-dir s3://bucket/prefix
#   -k  encrypt with this KMS key (default: SSE-S3, AES256)
#   -c  storage class, e.g. STANDARD_IA or GLACIER_IR (default STANDARD)
#   -D  also delete objects that no longer exist locally
#   -m  with -D, the source must have at least this many files (default 1)
#   -y  really upload; without it, a dry run
# Example: s3_backup_sync.sh -c STANDARD_IA -y /var/backups/postgres s3://acme-backups/db/web-01
#
# Minimum IAM permissions (replace BUCKET and PREFIX; DeleteObject only with -D,
# kms:GenerateDataKey only with -k):
#   {"Version": "2012-10-17", "Statement": [
#     {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET",
#      "Condition": {"StringLike": {"s3:prefix": "PREFIX/*"}}},
#     {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
#      "Resource": "arn:aws:s3:::BUCKET/PREFIX/*"},
#     {"Effect": "Allow", "Action": "kms:GenerateDataKey", "Resource": "KMS-KEY-ARN"}]}
# Credentials: the AWS CLI's usual chain (environment, profile, SSO, instance role).
# Exit:  0 synced and verified (or dry run done), 1 the sync failed or files
#        were still missing afterwards, 2 bad usage or a refused -D.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

kms="" class=STANDARD delete=0 min=1 region="" apply=0
while getopts ":k:c:Dm:r:yh" opt; do
  case "$opt" in
    k) kms="$OPTARG" ;;
    c) class="$OPTARG" ;;
    D) delete=1 ;;
    m) min="$OPTARG" ;;
    r) region="$OPTARG" ;;
    y) apply=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
src="${1:-}" dest="${2:-}"
[[ -d "$src" && "$dest" =~ ^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](/.*)?$ && "$min" =~ ^[1-9][0-9]*$ && "$class" =~ ^[A-Z_]+$ ]] || { usage >&2; exit 2; }
command -v aws >/dev/null || { echo "s3_backup_sync: the AWS CLI is not installed" >&2; exit 2; }

files=$(find "$src" -type f | wc -l)
if (( files == 0 )); then
  echo "s3_backup_sync: $src is empty; is the backup disk mounted? Nothing to upload." >&2
  exit 2
fi
if (( delete && files < min )); then
  echo "s3_backup_sync: $src has $files file(s), fewer than -m $min; refusing to mirror deletions" >&2
  exit 2
fi

export AWS_RETRY_MODE="${AWS_RETRY_MODE:-standard}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-5}"
aws_=(aws --cli-connect-timeout 10 --cli-read-timeout 120)
[[ -n "$region" ]] && aws_+=(--region "$region")
sync=(s3 sync "$src" "$dest" --storage-class "$class")
if [[ -n "$kms" ]]; then sync+=(--sse aws:kms --sse-kms-key-id "$kms"); else sync+=(--sse AES256); fi
(( delete )) && sync+=(--delete)

if (( ! apply )); then
  # --dryrun lists each "(dryrun) upload:" or "(dryrun) delete:" without changing anything.
  plan="$("${aws_[@]}" "${sync[@]}" --no-progress --dryrun)" || { echo "s3_backup_sync: dry run failed" >&2; exit 1; }
  [[ -n "$plan" ]] && echo "$plan"
  echo "$(grep -c 'upload:' <<< "$plan" || true) upload(s), $(grep -c 'delete:' <<< "$plan" || true) delete(s) planned from $files local file(s)"
  echo "(dry run; add -y to sync)"
  exit 0
fi

"${aws_[@]}" "${sync[@]}" --only-show-errors || { echo "s3_backup_sync: sync to $dest failed" >&2; exit 1; }
# Verify: a second dry run must find nothing left to upload.
check="$("${aws_[@]}" "${sync[@]}" --no-progress --dryrun)" || { echo "s3_backup_sync: could not verify $dest" >&2; exit 1; }
left=$(grep -c 'upload:' <<< "$check" || true)
if [[ "$left" != 0 ]]; then
  echo "s3_backup_sync: $left file(s) still differ after the sync" >&2
  exit 1
fi
echo "synced $files file(s) to $dest ($class, ${kms:+SSE-KMS}${kms:-SSE-S3}), verified"
