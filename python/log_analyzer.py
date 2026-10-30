#!/usr/bin/env python3
"""Summarise nginx or Apache access logs: traffic, errors, top clients and slow requests.

Reads the "combined" log format, with an optional request time in seconds at
the end of the line (nginx: add $request_time to log_format). Use it during an
incident to see in seconds whether errors rose, which paths fail, and who is
hammering the site.

Usage:
  log_analyzer.py access.log [access.log.1 ...] [--top 10] [--json]
  zcat access.log.*.gz | log_analyzer.py -

Exit: 0, or 1 when more than --max-5xx percent of requests failed (default 5).
"""
import argparse
import json
import re
import sys
from collections import Counter

LINE = re.compile(
    r'(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] "(?P<method>\S+) (?P<path>\S+)[^"]*" '
    r'(?P<status>\d{3}) (?P<bytes>\d+|-)(?: "[^"]*" "(?P<agent>[^"]*)")?(?: (?P<rt>[\d.]+))?'
)


def parse(lines):
    """Yield one dict per log line that matches; malformed lines are counted, not fatal."""
    for line in lines:
        m = LINE.match(line)
        yield m.groupdict() if m else None


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def summarise(lines, top=10):
    total = bad = 0
    statuses, ips, paths, errors, agents = Counter(), Counter(), Counter(), Counter(), Counter()
    times, slow = [], []
    for row in parse(lines):
        if row is None:
            bad += 1
            continue
        total += 1
        path = row["path"].split("?")[0]  # query strings would split one page into thousands
        statuses[row["status"][0] + "xx"] += 1
        ips[row["ip"]] += 1
        paths[path] += 1
        if row["status"].startswith("5"):
            errors[path] += 1
        if row.get("agent"):
            agents[row["agent"]] += 1
        if row.get("rt"):
            rt = float(row["rt"])
            times.append(rt)
            slow.append((rt, row["method"], path))
    return {
        "requests": total,
        "unparsed_lines": bad,
        "status": dict(sorted(statuses.items())),
        "error_rate_5xx": round(100 * statuses["5xx"] / total, 2) if total else 0.0,
        "top_clients": ips.most_common(top),
        "top_paths": paths.most_common(top),
        "top_5xx_paths": errors.most_common(top),
        "top_user_agents": agents.most_common(top),
        "latency_seconds": {"p50": percentile(times, 50), "p95": percentile(times, 95), "p99": percentile(times, 99)} if times else None,
        "slowest": [{"seconds": t, "request": f"{m} {p}"} for t, m, p in sorted(slow, reverse=True)[:top]],
    }


def print_report(r):
    print(f"Requests: {r['requests']}  (unparsed lines: {r['unparsed_lines']})")
    print("Status:   " + "  ".join(f"{k} {v}" for k, v in r["status"].items()) + f"   5xx rate: {r['error_rate_5xx']}%")
    if r["latency_seconds"]:
        lat = r["latency_seconds"]
        print(f"Latency:  p50 {lat['p50']}s  p95 {lat['p95']}s  p99 {lat['p99']}s")
    for title, key in [("Top clients", "top_clients"), ("Top paths", "top_paths"), ("Paths returning 5xx", "top_5xx_paths")]:
        if r[key]:
            print(f"\n{title}:")
            for name, count in r[key]:
                print(f"  {count:>8}  {name}")
    if r["slowest"]:
        print("\nSlowest requests:")
        for s in r["slowest"]:
            print(f"  {s['seconds']:>8.3f}s  {s['request']}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="+", help="log files, or - for standard input")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--json", action="store_true", help="print JSON for other tools")
    ap.add_argument("--max-5xx", type=float, default=5.0, help="fail above this 5xx percentage")
    args = ap.parse_args(argv)

    def lines():
        for name in args.files:
            stream = sys.stdin if name == "-" else open(name, encoding="utf-8", errors="replace")
            with stream:
                yield from stream

    report = summarise(lines(), args.top)
    print(json.dumps(report, indent=2) if args.json else "", end="")
    if not args.json:
        print_report(report)
    return 1 if report["error_rate_5xx"] > args.max_5xx else 0


if __name__ == "__main__":
    sys.exit(main())
