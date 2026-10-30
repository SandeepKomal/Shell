#!/usr/bin/env python3
"""Check a list of HTTP endpoints concurrently: status, latency, and optional body text.

A smoke test after a deploy, or a cron check that pages someone. Each URL can
say what it expects:  https://shop.example/healthz 200 "ok"

Usage:
  http_monitor.py https://example.com/healthz [...] [--timeout 5] [--retries 2] [--slow 1.0] [--json]
  http_monitor.py --file endpoints.txt      (url [expected-status] ["text"] per line, # comments)

Exit: 0 all healthy, 1 any endpoint failed, was slow, or did not contain its text.
"""
import argparse
import concurrent.futures
import json
import shlex
import sys
import time
import urllib.error
import urllib.request


def parse_spec(line):
    parts = shlex.split(line)
    url = parts[0]
    status = int(parts[1]) if len(parts) > 1 else 200
    text = parts[2] if len(parts) > 2 else None
    return {"url": url, "status": status, "text": text}


def probe(spec, timeout, retries, slow, opener=urllib.request.urlopen):
    last = None
    for attempt in range(retries + 1):
        start = time.monotonic()
        try:
            req = urllib.request.Request(spec["url"], headers={"User-Agent": "http-monitor/1.0"})
            with opener(req, timeout=timeout) as resp:
                code, body = resp.status, resp.read(65536).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            code, body = e.code, ""
        except (urllib.error.URLError, OSError) as e:
            last = {"url": spec["url"], "ok": False, "status": None, "seconds": None, "problem": str(getattr(e, "reason", e))}
            if attempt < retries:
                time.sleep(min(2 ** attempt, 5))
            continue
        seconds = round(time.monotonic() - start, 3)
        problem = None
        if code != spec["status"]:
            problem = f"status {code}, want {spec['status']}"
        elif spec["text"] and spec["text"] not in body:
            problem = f"body does not contain {spec['text']!r}"
        elif seconds > slow:
            problem = f"slow: {seconds}s > {slow}s"
        last = {"url": spec["url"], "ok": problem is None, "status": code, "seconds": seconds, "problem": problem}
        if last["ok"]:
            break
    return last


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--timeout", type=float, default=5)
    ap.add_argument("--retries", type=int, default=2)
    ap.add_argument("--slow", type=float, default=1.0, help="seconds above which a response counts as failed")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    specs = [parse_spec(u) for u in args.urls]
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            specs += [parse_spec(l) for l in f if l.split("#")[0].strip()]
    if not specs:
        ap.error("give at least one URL, or --file")

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda s: probe(s, args.timeout, args.retries, args.slow), specs))
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            mark = "OK  " if r["ok"] else "FAIL"
            secs = f"{r['seconds']:.3f}s" if r["seconds"] is not None else "-"
            print(f"{mark} {r['status'] or '-':>4} {secs:>8}  {r['url']}" + (f"   ({r['problem']})" if r["problem"] else ""))
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
