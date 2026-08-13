#!/bin/bash

echo "🔍 Running native pre-commit hook..."

# Block if any .env-style file is staged
if git diff --cached --name-only | grep -iE "\.env$|env\.env$"; then
  echo "❌ .env file staged for commit. Commit blocked."
  echo "   Files matched:"
  git diff --cached --name-only | grep -iE "\.env$|env\.env$"
  exit 1
fi

# Block if diff content contains common secret-related keywords
if git diff --cached | grep -iE "secret|password|passwd|api[_-]?key|access[_-]?key|token|private[_-]?key|aws_secret|BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY"; then
  echo "❌ Potential secret detected in staged changes. Commit blocked."
  exit 1
fi

echo "✅ Commit passed security checks."
exit 0
