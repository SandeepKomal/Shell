#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-HEAD~1}"
git diff --name-status "$BASE"...HEAD
