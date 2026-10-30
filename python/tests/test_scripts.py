"""Tests for the automation scripts. Run with: python3 -m unittest discover -s python/tests"""
import contextlib
import datetime as dt
import http.server
import io
import os
import pathlib
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import backup_retention  # noqa: E402
import cert_checker  # noqa: E402
import disk_report  # noqa: E402
import env_validator  # noqa: E402
import http_monitor  # noqa: E402
import log_analyzer  # noqa: E402
import port_check  # noqa: E402
import secret_scanner  # noqa: E402
import webhook_notify  # noqa: E402


def run(main, *args):
    """Call a script's main() and return (exit code, stdout)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = main(list(args))
    return code, out.getvalue()


class Server:
    """A local HTTP server: /ok answers 200 "ok", /slow sleeps, anything else is a 500."""

    def __enter__(self):
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/slow":
                    import time
                    time.sleep(0.3)
                code = 200 if self.path in ("/ok", "/slow") else 500
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b"ok" if code == 200 else b"boom")

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def __exit__(self, *a):
        self.httpd.shutdown()


LOG = """\
10.0.0.1 - - [30/Oct/2026:10:00:00 +0000] "GET /menu?page=2 HTTP/1.1" 200 512 "-" "curl/8" 0.120
10.0.0.1 - - [30/Oct/2026:10:00:01 +0000] "GET /menu HTTP/1.1" 200 512 "-" "curl/8" 0.080
10.0.0.2 - - [30/Oct/2026:10:00:02 +0000] "POST /orders HTTP/1.1" 502 0 "-" "app/1" 2.500
10.0.0.3 - - [30/Oct/2026:10:00:03 +0000] "GET /health HTTP/1.1" 200 2 "-" "kube-probe" 0.001
this line is not a log line
"""


class LogAnalyzer(unittest.TestCase):
    def test_summary(self):
        r = log_analyzer.summarise(LOG.splitlines())
        self.assertEqual(r["requests"], 4)
        self.assertEqual(r["unparsed_lines"], 1)
        self.assertEqual(r["status"], {"2xx": 3, "5xx": 1})
        self.assertEqual(r["error_rate_5xx"], 25.0)
        self.assertEqual(r["top_paths"][0], ("/menu", 2), "query strings are folded into the path")
        self.assertEqual(r["top_5xx_paths"], [("/orders", 1)])
        self.assertEqual(r["slowest"][0]["request"], "POST /orders")

    def test_exit_code_on_errors(self):
        with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False) as f:
            f.write(LOG)
        self.addCleanup(os.unlink, f.name)
        self.assertEqual(run(log_analyzer.main, f.name)[0], 1, "25% 5xx is above the 5% default")
        self.assertEqual(run(log_analyzer.main, f.name, "--max-5xx", "30")[0], 0)


class Retention(unittest.TestCase):
    def test_gfs_plan(self):
        start = dt.date(2026, 10, 30)
        names = [f"db-{(start - dt.timedelta(days=i)).isoformat()}.sql.gz" for i in range(120)] + ["notes.txt"]
        keep, delete, undated = backup_retention.plan(names, daily=7, weekly=4, monthly=3)
        self.assertIn("db-2026-10-30.sql.gz", keep)
        self.assertEqual(undated, ["notes.txt"])
        self.assertEqual(len(keep) + len(delete), 120)
        self.assertLess(len(keep), 15, "far fewer than 120 kept")
        months = {n[3:10] for n in keep}
        self.assertEqual(len(months), 3, "one per month for three months")

    def test_dry_run_deletes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(10):
                pathlib.Path(d, f"app-2026-10-{10 + i}.tar.gz").write_text("x")
            code, out = run(backup_retention.main, d, "--daily", "3", "--weekly", "0", "--monthly", "0")
            self.assertEqual(code, 0)
            self.assertIn("would be deleted", out)
            self.assertEqual(len(os.listdir(d)), 10)
            run(backup_retention.main, d, "--daily", "3", "--weekly", "0", "--monthly", "0", "--delete")
            self.assertEqual(len(os.listdir(d)), 3)


class EnvValidator(unittest.TestCase):
    def test_compare_never_prints_values(self):
        with tempfile.TemporaryDirectory() as d:
            pathlib.Path(d, ".env.example").write_text("DB_URL=\nAPI_KEY=\nDEBUG=\n")
            pathlib.Path(d, ".env").write_text('export DB_URL="postgres://u:topsecret@db/app"\nAPI_KEY=changeme\nEXTRA=1\n')
            code, out = run(env_validator.main, str(pathlib.Path(d, ".env")))
            self.assertEqual(code, 1)
            self.assertIn("missing: DEBUG", out)
            self.assertIn("placeholder value: API_KEY", out)
            self.assertIn("not in the template: EXTRA", out)
            self.assertNotIn("topsecret", out)


class SecretScanner(unittest.TestCase):
    def test_finds_and_masks(self):
        fake_key = "AKIA" + "Q3EXAMPLEKEY7Z2B"
        text = f'aws_key = "{fake_key}"\npassword = "changeme"\ntoken = "9fK2xQ7mZp4LwT8vR1sY"\n'
        hits = secret_scanner.scan_text(text)
        self.assertEqual([h["kind"] for h in hits], ["AWS access key", "Password assignment"])
        self.assertTrue(all(fake_key not in h["match"] for h in hits), "secrets are masked")

    def test_allowlist_and_exit(self):
        with tempfile.TemporaryDirectory() as d:
            pathlib.Path(d, "app.py").write_text("-----BEGIN RSA PRIVATE KEY-----\n")
            self.assertEqual(run(secret_scanner.main, d, "--allowlist", "/nonexistent")[0], 1)
            allow = pathlib.Path(d, "allow")
            allow.write_text("BEGIN RSA PRIVATE KEY\n")
            self.assertEqual(run(secret_scanner.main, str(pathlib.Path(d, "app.py")), "--allowlist", str(allow))[0], 0)


class HttpAndPorts(unittest.TestCase):
    def test_http_monitor(self):
        with Server() as base:
            self.assertEqual(run(http_monitor.main, f"{base}/ok", "--retries", "0")[0], 0)
            code, out = run(http_monitor.main, f"{base}/broken", "--retries", "0")
            self.assertEqual(code, 1)
            self.assertIn("status 500, want 200", out)
            self.assertEqual(run(http_monitor.main, f'{base}/broken 500', "--retries", "0")[0], 0, "expected status per URL")
            self.assertEqual(run(http_monitor.main, f'{base}/ok 200 "nope"', "--retries", "0")[0], 1)
            self.assertEqual(run(http_monitor.main, f"{base}/slow", "--slow", "0.1", "--retries", "0")[0], 1)

    def test_port_check(self):
        with Server() as base:
            port = base.rsplit(":", 1)[1]
            self.assertEqual(run(port_check.main, f"127.0.0.1:{port}")[0], 0)
            self.assertEqual(run(port_check.main, f"127.0.0.1:{port}", "--expect", "closed")[0], 1)
        free = socket.socket()
        free.bind(("127.0.0.1", 0))
        closed = free.getsockname()[1]
        free.close()
        self.assertEqual(run(port_check.main, f"127.0.0.1:{closed}", "--timeout", "1")[0], 1)


class Certs(unittest.TestCase):
    def test_days_and_targets(self):
        now = dt.datetime(2026, 10, 30, tzinfo=dt.timezone.utc)
        self.assertEqual(cert_checker.days_left(now + dt.timedelta(days=10, hours=3), now), 10)
        self.assertEqual(cert_checker.split_target("api.example.com:8443"), ("api.example.com", 8443))
        self.assertEqual(cert_checker.split_target("example.com"), ("example.com", 443))

    def test_unreachable_host_fails(self):
        r = cert_checker.check("127.0.0.1:1", 21)
        self.assertFalse(r["ok"])
        self.assertIsNotNone(r["error"])


class DiskAndWebhook(unittest.TestCase):
    def test_disk_report(self):
        with tempfile.TemporaryDirectory() as d:
            pathlib.Path(d, "big").mkdir()
            pathlib.Path(d, "big", "blob").write_bytes(os.urandom(300_000))
            pathlib.Path(d, "small.txt").write_text("x")
            dirs, files = disk_report.scan(d, depth=1, top=5)
            self.assertEqual(files[0][1], os.path.join(d, "big", "blob"))
            self.assertEqual(dirs[0][0], os.path.abspath(d), "the root includes everything below it")
            self.assertEqual(run(disk_report.main, d, "--alert-percent", "100")[0], 0)
        self.assertEqual(disk_report.human(1536), "1.5K")

    def test_webhook_payloads(self):
        self.assertEqual(webhook_notify.guess_kind("https://hooks.slack.com/services/x"), "slack")
        self.assertIn("embeds", webhook_notify.payload("discord", "hi", "error", "db-01"))
        code, out = run(webhook_notify.main, "backup failed", "--level", "error", "--kind", "slack", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("backup failed", out)
        os.environ.pop("WEBHOOK_URL", None)
        self.assertEqual(run(webhook_notify.main, "x")[0], 2, "no URL configured")


if __name__ == "__main__":
    unittest.main()
