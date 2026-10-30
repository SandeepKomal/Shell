#!/usr/bin/env python3
"""Scan files for committed secrets: cloud keys, tokens, private keys and passwords.

A fast first gate for pre-commit hooks and CI. It reports file, line and the
kind of secret, and prints the secret itself only masked. Known false
positives go in an allowlist file (one regular expression per line).

Usage:
  secret_scanner.py [paths ...] [--allowlist .secretsallow] [--json]
  git diff --cached --name-only | secret_scanner.py --stdin-files

Exit: 0 clean, 1 secrets found.
"""
import argparse
import json
import math
import os
import re
import sys

RULES = [
    ("AWS access key", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("AWS secret key", re.compile(r"(?i)aws.{0,20}secret.{0,20}['\"=:\s]([A-Za-z0-9/+=]{40})\b")),
    ("GitHub token", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Stripe live key", re.compile(r"\b(sk|rk)_live_[0-9a-zA-Z]{24,}\b")),
    ("Private key", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----")),
    ("JSON Web Token", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("Password in a URL", re.compile(r"[a-z][a-z0-9+.-]*://[^/\s:@]+:([^/\s:@]{4,})@")),
    ("Password assignment", re.compile(r"(?i)\b(password|passwd|pwd|secret|api[_-]?key|token)\b\s*[:=]\s*['\"]([^'\"\s]{8,})['\"]")),
]
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".terraform"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".tar", ".jar", ".woff", ".woff2", ".lock"}


def entropy(s):
    """Shannon entropy per character; real secrets are random, placeholders are not."""
    if not s:
        return 0.0
    counts = {c: s.count(c) for c in set(s)}
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


def mask(s):
    return s[:4] + "…" + s[-2:] if len(s) > 8 else "…"


def scan_text(text, allow=()):
    hits = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if any(a.search(line) for a in allow):
            continue
        for kind, rule in RULES:
            m = rule.search(line)
            if not m:
                continue
            secret = m.group(m.lastindex or 0) if m.lastindex else m.group(0)
            # Generic assignments must look random; a dictionary word with digits is not worth a page.
            if kind == "Password assignment" and entropy(secret) < 3.0:
                continue
            hits.append({"line": lineno, "kind": kind, "match": mask(secret)})
            break
    return hits


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if os.path.splitext(f)[1].lower() not in SKIP_EXT:
                    yield os.path.join(root, f)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*", default=["."])
    ap.add_argument("--stdin-files", action="store_true", help="read file names from standard input")
    ap.add_argument("--allowlist", default=".secretsallow")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    paths = [l.strip() for l in sys.stdin if l.strip()] if args.stdin_files else args.paths
    allow = []
    if os.path.exists(args.allowlist):
        with open(args.allowlist, encoding="utf-8") as f:
            allow = [re.compile(l.strip()) for l in f if l.strip() and not l.startswith("#")]

    findings = []
    for path in walk(paths):
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read(2_000_000)
        except (UnicodeDecodeError, OSError):
            continue
        findings += [{"file": path, **h} for h in scan_text(text, allow)]

    if args.json:
        print(json.dumps(findings, indent=2))
    else:
        for h in findings:
            print(f"{h['file']}:{h['line']}: {h['kind']} ({h['match']})")
        print(f"{len(findings)} possible secret(s) found." if findings else "No secrets found.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
