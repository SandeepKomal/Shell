#!/usr/bin/env python3
"""Send an alert to Slack, Microsoft Teams, Discord or any JSON webhook.

The last step of a cron job or pipeline: "backup failed on db-01". The webhook
URL comes from an environment variable, never from the command line, so it does
not end up in shell history or CI logs.

Usage:
  WEBHOOK_URL=https://hooks.slack.com/... webhook_notify.py "Backup failed on db-01" [--level error] [--kind slack]
  some_command || webhook_notify.py "some_command failed" --level error
  webhook_notify.py "test" --dry-run        (print the payload, send nothing)

Exit: 0 sent, 1 the webhook refused it, 2 no URL configured.
"""
import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.request

ICONS = {"info": "ℹ️", "warning": "⚠️", "error": "🔴", "ok": "✅"}
COLORS = {"info": 3447003, "warning": 16763904, "error": 15158332, "ok": 3066993}


def payload(kind, text, level, host):
    title = f"{ICONS[level]} [{level.upper()}] {host}"
    if kind == "slack":
        return {"text": f"*{title}*\n{text}"}
    if kind == "teams":
        return {"text": f"**{title}**<br>{text}"}
    if kind == "discord":
        return {"embeds": [{"title": title, "description": text, "color": COLORS[level]}]}
    return {"level": level, "host": host, "message": text}


def guess_kind(url):
    for kind, marker in (("slack", "hooks.slack.com"), ("teams", "office.com"), ("discord", "discord.com/api/webhooks")):
        if marker in url:
            return kind
    return "generic"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("message")
    ap.add_argument("--level", choices=list(ICONS), default="info")
    ap.add_argument("--kind", choices=["auto", "slack", "teams", "discord", "generic"], default="auto")
    ap.add_argument("--url-env", default="WEBHOOK_URL", help="environment variable that holds the URL")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    url = os.environ.get(args.url_env, "")
    kind = guess_kind(url) if args.kind == "auto" else args.kind
    body = payload(kind, args.message, args.level, socket.gethostname())
    if args.dry_run:
        print(json.dumps(body, indent=2, ensure_ascii=False))
        return 0
    if not url.startswith("https://"):
        print(f"webhook_notify: set {args.url_env} to an https:// webhook URL", file=sys.stderr)
        return 2
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"sent ({resp.status})")
            return 0
    except (urllib.error.URLError, OSError) as e:
        print(f"webhook_notify: not sent: {getattr(e, 'reason', e)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
