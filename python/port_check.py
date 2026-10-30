#!/usr/bin/env python3
"""Check that services answer on their TCP ports, across many hosts at once.

For firewall changes, security-group reviews and "is the database reachable
from this box?" questions. It only opens a TCP connection; nothing is sent.

Usage:
  port_check.py db.internal:5432 cache.internal:6379 [--timeout 3] [--json]
  port_check.py --file targets.txt         (host:port per line, # comments)
  port_check.py web-01:22 --expect closed  (fail if the port IS open, for hardening checks)

Exit: 0 every port as expected, 1 otherwise.
"""
import argparse
import concurrent.futures
import json
import socket
import sys
import time


def probe(target, timeout):
    host, _, port = target.rpartition(":")
    start = time.monotonic()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return {"target": target, "open": True, "ms": round((time.monotonic() - start) * 1000, 1), "error": None}
    except (OSError, ValueError) as e:
        return {"target": target, "open": False, "ms": None, "error": str(e) or type(e).__name__}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("targets", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--timeout", type=float, default=3)
    ap.add_argument("--expect", choices=["open", "closed"], default="open")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    targets = list(args.targets)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            targets += [l.split("#")[0].strip() for l in f if l.split("#")[0].strip()]
    bad = [t for t in targets if ":" not in t]
    if not targets or bad:
        ap.error(f"give host:port targets{': ' + ', '.join(bad) if bad else ''}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(lambda t: probe(t, args.timeout), targets))
    want_open = args.expect == "open"
    for r in results:
        r["as_expected"] = r["open"] == want_open
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            state = f"open ({r['ms']} ms)" if r["open"] else f"closed ({r['error']})"
            print(f"{'OK  ' if r['as_expected'] else 'FAIL'} {r['target']:<36} {state}")
    return 0 if all(r["as_expected"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
