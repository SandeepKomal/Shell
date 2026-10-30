#!/usr/bin/env bash
set -euo pipefail
REGION="${1:?Usage: $0 <aws-region>}"
command -v aws >/dev/null 2>&1 || { echo "ERROR: AWS CLI is required" >&2; exit 1; }
echo "Region: $REGION"
echo "EC2 instances: $(aws ec2 describe-instances --region "$REGION" --query 'length(Reservations[].Instances[])' --output text)"
echo "EBS volumes:   $(aws ec2 describe-volumes --region "$REGION" --query 'length(Volumes[])' --output text)"
echo "RDS instances: $(aws rds describe-db-instances --region "$REGION" --query 'length(DBInstances[])' --output text)"
echo "Lambda funcs:  $(aws lambda list-functions --region "$REGION" --query 'length(Functions[])' --output text)"
