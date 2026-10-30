#!/usr/bin/env python3
"""Show what is using the space under a directory: biggest directories and files.

Like "du | sort" and "find -size" together, but in one pass, on one file
system, with readable sizes and an exit code you can alert on.

Usage:
  disk_report.py /var [--top 15] [--depth 2] [--alert-percent 85] [--json]

Exit: 0, or 1 when the file system holding the path is above --alert-percent full.
"""
import argparse
import heapq
import json
import os
import shutil
import sys


def human(n):
    for unit in ("B", "K", "M", "G", "T"):
        if n < 1024 or unit == "T":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024


def scan(root, depth=2, top=15):
    """Walk once without crossing mount points; size each directory up to `depth` levels."""
    root = os.path.abspath(root)
    dev = os.stat(root).st_dev
    base = root.rstrip(os.sep).count(os.sep)
    dirs, files = {}, []
    for current, subdirs, names in os.walk(root, onerror=lambda e: None):
        subdirs[:] = [d for d in subdirs if not os.path.islink(os.path.join(current, d))
                      and os.lstat(os.path.join(current, d)).st_dev == dev]
        level = current.rstrip(os.sep).count(os.sep) - base
        key = current if level <= depth else os.sep.join(current.split(os.sep)[: base + depth + 1])
        for n in names:
            path = os.path.join(current, n)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            size = st.st_blocks * 512  # space actually used, so sparse files do not mislead
            dirs[key] = dirs.get(key, 0) + size
            heapq.heappush(files, (size, path))
            if len(files) > top:
                heapq.heappop(files)
    # Roll sizes up so each directory includes everything below it.
    totals = {}
    for d, size in dirs.items():
        p = d
        while True:
            if p.rstrip(os.sep).count(os.sep) - base <= depth:
                totals[p] = totals.get(p, 0) + size
            if p == root:
                break
            p = os.path.dirname(p)
    return sorted(totals.items(), key=lambda x: -x[1])[:top], sorted(files, reverse=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("path", nargs="?", default=".")
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--alert-percent", type=float, default=85)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    usage = shutil.disk_usage(args.path)
    percent = round(100 * usage.used / usage.total, 1)
    biggest_dirs, biggest_files = scan(args.path, args.depth, args.top)
    if args.json:
        print(json.dumps({"percent_used": percent, "directories": biggest_dirs, "files": [(p, s) for s, p in biggest_files]}, indent=2))
    else:
        print(f"File system: {human(usage.used)} of {human(usage.total)} used ({percent}%)")
        print("\nLargest directories:")
        for d, s in biggest_dirs:
            print(f"  {human(s):>8}  {d}")
        print("\nLargest files:")
        for s, p in biggest_files:
            print(f"  {human(s):>8}  {p}")
    return 1 if percent > args.alert_percent else 0


if __name__ == "__main__":
    sys.exit(main())
