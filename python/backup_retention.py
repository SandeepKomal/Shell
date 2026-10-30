#!/usr/bin/env python3
"""Apply a grandfather-father-son retention policy to dated backup files.

Keeps the newest backup of each of the last N days, N weeks and N months, and
lists (or deletes) the rest. Far fewer files than "keep 30 days", and you
can still restore from three months ago.

Backup names must contain a date: app-2026-10-30.tar.gz, db_20261030T0200.sql.gz ...

Usage:
  backup_retention.py /backups [--pattern '*.tar.gz'] [--daily 7] [--weekly 4] [--monthly 6]
  backup_retention.py /backups --delete         (without --delete it only reports)

Exit: 0, or 2 when a file has no date in its name (it is kept, and reported).
"""
import argparse
import datetime as dt
import pathlib
import re
import sys

DATE = re.compile(r"(\d{4})-?(\d{2})-?(\d{2})")


def date_of(name):
    m = DATE.search(name)
    if not m:
        return None
    try:
        return dt.date(*map(int, m.groups()))
    except ValueError:
        return None


def plan(names, daily=7, weekly=4, monthly=6):
    """Return (keep, delete, undated) for a list of file names."""
    dated = sorted(((date_of(n), n) for n in names if date_of(n)), reverse=True)
    undated = [n for n in names if not date_of(n)]
    keep = set()
    # Each tier keeps the newest file in each of its most recent N buckets.
    for bucket_of, count in [
        (lambda d: d, daily),
        (lambda d: d.isocalendar()[:2], weekly),
        (lambda d: (d.year, d.month), monthly),
    ]:
        seen = []
        for day, name in dated:
            b = bucket_of(day)
            if b in seen:
                continue
            if len(seen) >= count:
                break
            seen.append(b)
            keep.add(name)
    delete = [n for _, n in dated if n not in keep]
    return sorted(keep, reverse=True), delete, undated


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("directory", type=pathlib.Path)
    ap.add_argument("--pattern", default="*")
    ap.add_argument("--daily", type=int, default=7)
    ap.add_argument("--weekly", type=int, default=4)
    ap.add_argument("--monthly", type=int, default=6)
    ap.add_argument("--delete", action="store_true", help="really delete; otherwise only report")
    args = ap.parse_args(argv)
    files = {p.name: p for p in args.directory.glob(args.pattern) if p.is_file()}
    keep, delete, undated = plan(list(files), args.daily, args.weekly, args.monthly)

    for n in keep:
        print(f"keep    {n}")
    for n in delete:
        if args.delete:
            files[n].unlink()
            print(f"deleted {n}")
        else:
            print(f"delete  {n}")
    for n in undated:
        print(f"skip    {n}   (no date in the name; kept)", file=sys.stderr)
    if not args.delete and delete:
        print(f"\n{len(delete)} file(s) would be deleted. Run again with --delete.")
    return 2 if undated else 0


if __name__ == "__main__":
    sys.exit(main())
