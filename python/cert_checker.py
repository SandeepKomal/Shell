#!/usr/bin/env python3
"""Check TLS certificate expiry for many hosts at once, for cron, CI or a dashboard.

Usage:
  cert_checker.py example.com api.example.com:8443 [--warn-days 21] [--json]
  cert_checker.py --file hosts.txt          (one host[:port] per line, # comments)

Exit: 0 all fine, 1 a certificate expires within --warn-days or cannot be read.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import socket
import ssl
import sys


def split_target(target):
    host, _, port = target.partition(":")
    return host, int(port or 443)


def fetch_expiry(host, port, timeout=10):
    """Return the certificate's notAfter as an aware datetime. Verifies the chain and the name."""
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            not_after = tls.getpeercert()["notAfter"]
    return dt.datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), dt.timezone.utc)


def days_left(expiry, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    return (expiry - now).days


def check(target, warn_days):
    host, port = split_target(target)
    try:
        expiry = fetch_expiry(host, port)
    except (OSError, ssl.SSLError, ValueError) as e:
        # An invalid chain or hostname is as urgent as an expiry: browsers refuse it too.
        return {"target": f"{host}:{port}", "ok": False, "days_left": None, "expires": None, "error": str(e)}
    left = days_left(expiry)
    return {"target": f"{host}:{port}", "ok": left >= warn_days, "days_left": left, "expires": expiry.isoformat(), "error": None}


def read_targets(path):
    with open(path, encoding="utf-8") as f:
        return [line.split("#")[0].strip() for line in f if line.split("#")[0].strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("targets", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--warn-days", type=int, default=21)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    targets = args.targets + (read_targets(args.file) if args.file else [])
    if not targets:
        ap.error("give at least one host, or --file")

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda t: check(t, args.warn_days), targets))
    results.sort(key=lambda r: (r["days_left"] is not None, r["days_left"] or 0))

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(f"{'HOST':<40} {'DAYS':>6}  EXPIRES / ERROR")
        for r in results:
            mark = "" if r["ok"] else "  <- action needed"
            detail = r["expires"] or r["error"]
            print(f"{r['target']:<40} {r['days_left'] if r['days_left'] is not None else '-':>6}  {detail}{mark}")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
