#!/bin/bash

###############################################################################
# Author: DW -  (based on Abhishek Veeramalla’s AWS script)
# Version: v0.0.1
#
# Script to automate the process of listing resources in a GCP project.
#
# Supported services:
# 1. Compute Engine (VM instances)
# 2. Cloud SQL
# 3. Cloud Storage
# 4. Cloud Functions
# 5. VPC Networks
# 6. IAM (Service Accounts)
# 7. Cloud DNS
# 8. Monitoring (Alert Policies)
# 9. Deployment Manager
# 10. Cloud Run
# 11. Pub/Sub
# 12. BigQuery
# 13. Spanner
# 14. Persistent Disks
#
# Usage: ./gcp_resource_list.sh <gcp_region> <gcp_service>
# Example: ./gcp_resource_list.sh us-central1 compute
###############################################################################

# Check if correct arguments are passed
if [ $# -ne 2 ]; then
    echo "Usage: ./gcp_resource_list.sh <gcp_region> <gcp_service>"
    echo "Example: ./gcp_resource_list.sh us-central1 compute"
    exit 1
fi

# Assign arguments
gcp_region=$1
gcp_service=$2

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
    echo "gcloud CLI is not installed. Please install it using:"
    echo "  https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if gcloud is configured
if ! gcloud config get-value project &> /dev/null; then
    echo "gcloud CLI is not configured. Please run:"
    echo "  gcloud init"
    exit 1
fi

# List the resources based on the service
case $gcp_service in
    compute)
        echo "Listing Compute Engine Instances in region $gcp_region"
        gcloud compute instances list --filter="zone:($gcp_region*)"
        ;;
    sql)
        echo "Listing Cloud SQL Instances in region $gcp_region"
        gcloud sql instances list --filter="region:($gcp_region)"
        ;;
    storage)
        echo "Listing Cloud Storage Buckets"
        gcloud storage buckets list
        ;;
    functions)
        echo "Listing Cloud Functions in region $gcp_region"
        gcloud functions list --region=$gcp_region
        ;;
    vpc)
        echo "Listing VPC Networks"
        gcloud compute networks list
        ;;
    iam)
        echo "Listing IAM Service Accounts"
        gcloud iam service-accounts list
        ;;
    dns)
        echo "Listing Cloud DNS Managed Zones"
        gcloud dns managed-zones list
        ;;
    monitoring)
        echo "Listing Cloud Monitoring Alert Policies"
        gcloud monitoring policies list
        ;;
    deployment)
        echo "Listing Deployment Manager Deployments"
        gcloud deployment-manager deployments list
        ;;
    cloudrun)
        echo "Listing Cloud Run Services in region $gcp_region"
        gcloud run services list --region=$gcp_region
        ;;
    pubsub)
        echo "Listing Pub/Sub Topics"
        gcloud pubsub topics list
        ;;
    bigquery)
        echo "Listing BigQuery Datasets"
        gcloud bigquery datasets list
        ;;
    spanner)
        echo "Listing Cloud Spanner Instances"
        gcloud spanner instances list
        ;;
    disks)
        echo "Listing Compute Engine Disks in region $gcp_region"
        gcloud compute disks list --filter="zone:($gcp_region*)"
        ;;
    *)
        echo "Invalid service. Please enter a valid service name."
        echo "Supported services: compute, sql, storage, functions, vpc, iam, dns, monitoring, deployment, cloudrun, pubsub, bigquery, spanner, disks"
        exit 1
        ;;
esac
