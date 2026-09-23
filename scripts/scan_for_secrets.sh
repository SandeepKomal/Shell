#!/usr/bin/env bash
set -euo pipefail
PATTERN='(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----|api[_-]?key|secret[_-]?key|password|token)'
if git grep -nE -i "$PATTERN" -- ':!*.md' ':!SECURITY.md' ':!CONTRIBUTING.md'; then
  echo "Potential secret-like content detected. Review matches before committing."
  exit 1
fi
echo "No obvious secret patterns found."
