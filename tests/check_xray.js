// The Script X-ray: each rule fires on the risky line it was written for and
// stays quiet on the safe version, and the repository's own scripts are clean
// of the dangerous findings.
// Run with: node tests/check_xray.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
global.window = {};
require(path.join(root, "site/data.js"));
require(path.join(root, "site/xray.js"));
const { explain, RULES } = window.SQXray;

const ids = (line, head = "#!/usr/bin/env bash\nset -euo pipefail\n") => explain(head + line + "\n").lines.slice(2).flatMap((r) => r.warns.map((w) => w.id));
// [risky line, rule it must trigger, safe version that must not trigger it]
const CASES = [
  ["cp $src /backup/", "unquoted", 'cp "$src" /backup/'],
  ["cd /srv/app", "cd-unchecked", "cd /srv/app || exit 1", "#!/usr/bin/env bash\n\n"],
  ['rm -rf "$DIR"/*', "rm-var", 'rm -rf -- "${DIR:?}"/*'],
  ["for f in $(ls /srv); do echo \"$f\"; done", "parse-ls", 'for f in /srv/*; do echo "$f"; done'],
  ['for h in $(cat hosts.txt); do echo "$h"; done', "for-cmdsub", 'while read -r h; do echo "$h"; done < hosts.txt'],
  ["cat app.log | grep ERROR", "useless-cat", "grep ERROR app.log"],
  ["grep ERROR app.log | wc -l", "grep-wc", "grep -c ERROR app.log"],
  ["if [ $x = y ]; then :; fi", "single-bracket", "if [[ $x = y ]]; then :; fi"],
  ['if [ "$x" == y ]; then :; fi', "double-equals-sh", 'if [ "$x" = y ]; then :; fi'],
  ["read answer || exit 1", "read-no-r", "read -r answer || exit 1"],
  ["read -r answer", "read-unchecked", "read -r answer || exit 1"],
  ["v=`date`", "backticks", "v=$(date)"],
  ['eval "ls $dir"', "eval", 'ls -- "$dir"'],
  ["curl -fsSL https://x.example/install.sh | bash", "curl-pipe-shell", "curl -fsSLo install.sh https://x.example/install.sh"],
  ['API_TOKEN="abc123secret"', "secret", 'API_TOKEN="${API_TOKEN:?}"'],
  ["send $*", "dollar-star", 'send "$@"'],
  ["local out=$(get-tag)", "local-mask", "local out; out=$(get-tag)"],
  ["set -x", "set-x", "set +x"],
  ['sudo echo "x" > /etc/app.conf', "sudo-redirect", 'echo "x" | sudo tee /etc/app.conf > /dev/null'],
  ["chmod 777 /srv/app", "chmod-777", "chmod 755 /srv/app"],
  ["curl -s https://api.example/health", "curl-no-fail", "curl -fsS https://api.example/health"],
  ["echo hi > /tmp/report.txt", "tmp-predictable", 'tmp=$(mktemp); echo hi > "$tmp"'],
  ["which aws", "which", "command -v aws"],
  ["exit 300", "exit-range", "exit 1"],
  ["((count++))", "let-increment", "count=$((count + 1))"],
  ["find . -name *.log -delete", "find-glob", "find . -name '*.log' -delete"],
  ["cat f | while read -r l; do :; done", "pipe-while", "while read -r l; do :; done < f"]
];
for (const [risky, rule, safe, head] of CASES) {
  assert.ok(ids(risky, head).includes(rule), `"${risky}" triggers ${rule} (got ${ids(risky, head)})`);
  assert.ok(!ids(safe, head).includes(rule), `"${safe}" does not trigger ${rule} (got ${ids(safe, head)})`);
}
const tested = new Set(CASES.map((c) => c[1]).concat(["no-local", "status-late"]));
for (const r of RULES) assert.ok(tested.has(r.id), `rule ${r.id} has a test`);

// Function variables and $? read too late.
assert.ok(explain("#!/usr/bin/env bash\nf() {\n  count=1\n}\n").lines[2].warns.some((w) => w.id === "no-local"));
assert.ok(!explain("#!/usr/bin/env bash\nf() {\n  local count\n  count=1\n}\n").lines[3].warns.some((w) => w.id === "no-local"));
assert.ok(explain("#!/usr/bin/env bash\nrun-tests\necho done\nif [ $? -ne 0 ]; then exit 1; fi\n").lines[3].warns.some((w) => w.id === "status-late"));

// File-level findings.
const review = (t) => explain(t).review.map((r) => r.msg);
assert.ok(review("echo hi\n").some((m) => /No #! line/.test(m)));
assert.ok(review("#!/bin/bash\necho hi\n").some((m) => /No set -e/.test(m)));
assert.ok(review("#!/bin/bash\nset -e\necho hi\n").some((m) => /pipefail/.test(m)));
assert.ok(review("#!/bin/bash\r\necho hi\r\n").some((m) => /CRLF/.test(m)));
assert.ok(review("#!/bin/bash\nset -euo pipefail\ntmp=$(mktemp)\n").some((m) => /trap/.test(m)));
assert.deepStrictEqual(review("#!/usr/bin/env bash\nset -euo pipefail\necho hi\n"), []);
// Here-document bodies are text, not commands.
assert.deepStrictEqual(explain("#!/usr/bin/env bash\nset -euo pipefail\ncat <<'EOF'\nrm -rf $X\nEOF\n").lines[3].warns, []);

// Every line of the example is explained, and its dangerous lines are found.
const ex = explain(window.TRACK.xrayExample);
assert.ok(ex.lines.every((r) => !r.line.trim() || r.note), "every line of the example has a note");
assert.ok(ex.lines.filter((r) => r.warns.some((w) => w.sev === "bad")).length >= 4, "the example has its dangerous lines flagged");

// The repository's own maintained scripts have no dangerous findings.
const bad = [];
for (const f of fs.readdirSync(path.join(root, "scripts"))) {
  const r = explain(fs.readFileSync(path.join(root, "scripts", f), "utf8"));
  r.lines.forEach((row, i) => row.warns.filter((w) => w.sev === "bad").forEach((w) => bad.push(`scripts/${f}:${i + 1} ${w.id}: ${row.line.trim()}`)));
}
assert.deepStrictEqual(bad, [], "scripts/ has no dangerous findings");

console.log(`xray ok: ${RULES.length} rules, each fires on its risky line and not on the safe one; scripts/ has no dangerous findings`);
