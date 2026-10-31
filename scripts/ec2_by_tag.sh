#!/usr/bin/env bash
# List EC2 instances by tag, and optionally stop, start or reboot exactly
# those instances: the nightly "stop the dev servers" job, or a patch window.
# Listing is read-only. An action is a dry run unless -y is given, and it is
# refused when more than -m instances match, so a loose tag cannot stop a fleet.
#
# Usage: ec2_by_tag.sh [-r region] [-s state] [-a stop|start|reboot] [-m max] [-y] [-j] Key=Value [Key=Value...]
#   -r  region (default: from the AWS CLI profile or AWS_REGION)
#   -s  only instances in this state: pending running stopping stopped (default: all but terminated)
#   -a  action on every matching instance
#   -m  refuse the action when more than this many match (default 20)
#   -y  really do the action; without it, only list what would change
#   -j  JSON output (a list of id, name, state, type, private_ip)
# Example: ec2_by_tag.sh -r ap-south-1 -s running -a stop Environment=dev Team=web
#
# Minimum IAM permissions (drop the actions you do not use; scope them by tag):
#   {"Version": "2012-10-17", "Statement": [
#     {"Effect": "Allow", "Action": "ec2:DescribeInstances", "Resource": "*"},
#     {"Effect": "Allow", "Action": ["ec2:StopInstances", "ec2:StartInstances", "ec2:RebootInstances"],
#      "Resource": "arn:aws:ec2:*:*:instance/*",
#      "Condition": {"StringEquals": {"aws:ResourceTag/Environment": "dev"}}}]}
# Credentials: the AWS CLI's usual chain (environment, profile, SSO, instance role).
# Exit:  0 ok (also when nothing matches), 1 an AWS call failed,
#        2 bad usage or too many instances for the action.
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

region="" state="" action="" max=20 apply=0 json=0
while getopts ":r:s:a:m:yjh" opt; do
  case "$opt" in
    r) region="$OPTARG" ;;
    s) state="$OPTARG" ;;
    a) action="$OPTARG" ;;
    m) max="$OPTARG" ;;
    y) apply=1 ;;
    j) json=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
(( $# > 0 )) || { echo "ec2_by_tag: give at least one Key=Value tag filter" >&2; usage >&2; exit 2; }
[[ -z "$state" || "$state" =~ ^(pending|running|stopping|stopped)$ ]] || { usage >&2; exit 2; }
[[ -z "$action" || "$action" =~ ^(stop|start|reboot)$ ]] || { usage >&2; exit 2; }
[[ "$max" =~ ^[1-9][0-9]*$ ]] || { usage >&2; exit 2; }
command -v aws >/dev/null || { echo "ec2_by_tag: the AWS CLI is not installed" >&2; exit 2; }

# Standard retry mode backs off on throttling; the timeouts stop a dead network from hanging cron.
export AWS_RETRY_MODE="${AWS_RETRY_MODE:-standard}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-5}"
aws_=(aws --cli-connect-timeout 10 --cli-read-timeout 60 --output text)
[[ -n "$region" ]] && aws_+=(--region "$region")

filters=("Name=instance-state-name,Values=${state:-pending,running,stopping,stopped}")
for tag in "$@"; do
  [[ "$tag" =~ ^[^=,]+=[^,]+$ ]] || { echo "ec2_by_tag: tag filters look like Key=Value: $tag" >&2; exit 2; }
  filters+=("Name=tag:${tag%%=*},Values=${tag#*=}")
done

# The CLI follows NextToken itself, so every page of results is listed.
# shellcheck disable=SC2016  # the backticks are JMESPath literals, not command substitution
query='Reservations[].Instances[].[InstanceId, Tags[?Key==`Name`]|[0].Value || `-`, State.Name, InstanceType, PrivateIpAddress || `-`]'
if ! rows="$("${aws_[@]}" ec2 describe-instances --filters "${filters[@]}" --query "$query" 2>&1)"; then
  echo "ec2_by_tag: describe-instances failed: $rows" >&2
  exit 1
fi
mapfile -t ids < <(awk 'NF {print $1}' <<< "$rows")

if (( json )); then
  awk -F'\t' 'function q(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return "\"" s "\"" }
    BEGIN { printf "[" }
    NF { printf "%s{\"id\":%s,\"name\":%s,\"state\":%s,\"type\":%s,\"private_ip\":%s}", (n++ ? "," : ""), q($1), q($2), q($3), q($4), q($5) }
    END { print "]" }' <<< "$rows"
else
  awk -F'\t' 'BEGIN { f = "%-20s %-24s %-9s %-12s %s\n"; printf f, "ID", "NAME", "STATE", "TYPE", "PRIVATE_IP" }
    NF { printf f, $1, $2, $3, $4, $5 }' <<< "$rows"
  echo "${#ids[@]} instance(s) match $*"
fi
[[ -z "$action" || ${#ids[@]} -eq 0 ]] && exit 0

if (( ${#ids[@]} > max )); then
  echo "ec2_by_tag: ${#ids[@]} instances match, more than -m $max; refusing to $action them" >&2
  exit 2
fi
if (( ! apply )); then
  for id in "${ids[@]}"; do echo "would $action $id" >&2; done
  echo "(dry run; add -y to $action ${#ids[@]} instance(s))" >&2
  exit 0
fi
"${aws_[@]}" ec2 "$action-instances" --instance-ids "${ids[@]}" >/dev/null || { echo "ec2_by_tag: $action-instances failed" >&2; exit 1; }
echo "$action requested for ${#ids[@]} instance(s): ${ids[*]}" >&2
