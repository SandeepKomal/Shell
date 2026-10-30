// Drives the playground without a browser: every scenario starts broken,
// wrong-but-tempting fixes keep it broken, and the intended fix solves it.
// Run with: node tests/check_playground.js
"use strict";
const path = require("path");
const assert = require("assert");

for (const f of ["bash", "builtins", "coreutils", "scenarios"]) require(path.resolve(__dirname, `../site/${f}.js`));
const { SCENARIOS, GROUPS, start } = globalThis.ShellScenarios;

// edits: [from, to] replacements in the scenario's script (what the editor does), or a command line.
function apply(sys, s, edits) {
  for (const e of edits) {
    if (typeof e === "string") { sys.run(e); continue; }
    const n = sys.fs.get(s.file);
    assert.ok(typeof e[0] !== "string" || n.text.includes(e[0]), `${s.id}: the script contains ${JSON.stringify(e[0])}`);
    n.text = n.text.replace(e[0], () => e[1]);
  }
}

const CASES = {
  noexec: { fix: ["chmod +x report.sh"], wrong: [["bash report.sh"], ["sudo ./report.sh"], ["chmod +r report.sh"]] },
  typo: { fix: [["ehco", "echo"]], wrong: [["ehco() { echo \"$@\"; }", "./deploy.sh"], ["alias ehco=echo"], [["ehco \"Deploy finished\"", "ehco \"Deploy finished\" || true"]]] },
  assign: { fix: [["ENV = production", "ENV=production"], ["REGION = eu-west-1", "REGION=eu-west-1"]], wrong: [["export ENV=production REGION=eu-west-1"], [["ENV = production", "ENV= production"], ["REGION = eu-west-1", "REGION= eu-west-1"]]] },
  singlequotes: { fix: [["'Released $VERSION to $HOST *** watch the dashboard'", "\"Released $VERSION to $HOST *** watch the dashboard\""]], wrong: [[["'Released $VERSION to $HOST *** watch the dashboard'", "Released $VERSION to $HOST *** watch the dashboard"]], [["'Released $VERSION", "'Released \\$VERSION"]]] },
  math: { fix: [["count=$count+1", "count=$((count + 1))"]], wrong: [[["count=$count+1", "let count=count + 1"]], [["count=$count+1", "count=\"$count+1\""]]] },
  spaces: { fix: [["cp -r $SRC $DEST/", "cp -r \"$SRC\" \"$DEST/\""]], wrong: [[["SRC=/srv/reports/Q3\\ Sales", "SRC=\"/srv/reports/Q3 Sales\""]], ["mv \"/srv/reports/Q3 Sales\" /srv/reports/Q3_Sales"]] },
  emptytest: { fix: [["[ $STATUS != \"ok\" ]", "[ \"$STATUS\" != \"ok\" ]"]], wrong: [[["[ $STATUS != \"ok\" ]", "[ $STATUS != \"ok\" ] 2>/dev/null"]], [["[ $STATUS != \"ok\" ]", "[ \"$STATUS\" == \"ok\" ]"]]] },
  globvar: { fix: [["echo $MSG", "echo \"$MSG\""]], wrong: [[["90% * check", "90% \\* check"]], [["echo $MSG", "echo ${MSG}"]]] },
  heredoc: { fix: [["<<EOF", "<<'EOF'"]], wrong: [[["dir=${1:?usage: cleanup.sh DIR}", "dir=\\${1:?usage: cleanup.sh DIR}"]], [["<<EOF", "<<-EOF"]]] },
  nounset: { fix: [["\"$DEBUG\"", "\"${DEBUG:-0}\""]], wrong: [[["set -u\n", ""]], ["export DEBUG=0"], [["\"$DEBUG\"", "\"${DEBUG}\""]]] },
  dollarstar: { fix: [["$*", "\"$@\""]], wrong: [[["$*", "\"$*\""]], [["$*", "$@"]]] },
  statusover: { fix: [["run-tests\necho \"Tests finished\"\nif [ $? -ne 0 ]", "if ! run-tests"]], wrong: [[["echo \"All good\"", "exit $?"]], [["if [ $? -ne 0 ]", "if [ \"$?\" != 0 ]"]]] },
  testcmd: { fix: [["if [ grep -q \"ERROR\" /var/log/app.log ]", "if grep -q \"ERROR\" /var/log/app.log"]], wrong: [[["if [ grep", "if [[ grep"], ["/var/log/app.log ]", "/var/log/app.log ]]"]], [["if [ grep -q", "if [ $(grep -c"], ["/var/log/app.log ]", "/var/log/app.log) ]"]]] },
  intcompare: { fix: [["if [", "usage=${usage%\\%}\nif ["]], wrong: [[["-gt 90", "> 90"]], [["[ \"$usage\" -gt 90 ]", "[[ $usage > 90 ]]"]]] },
  pipefail: { fix: [["set -e", "set -euo pipefail"]], wrong: [[["shop.sql.gz", "shop.sql.gz || exit 1"]], [["set -e", "set -eu"]]] },
  cdfail: { fix: [["releases/old", "releases/old || exit 1"]], wrong: [[["releases/old", "releases/old 2>/dev/null"]], [["rm -rf *", "rm -rf ./*"]], ["mkdir -p /var/www/app/releases/old"]] },
  localmask: { fix: [["local tag=$(get-tag)", "local tag\n  tag=$(get-tag)"]], wrong: [[["local tag=$(get-tag)", "local tag=$(get-tag) || exit 1"]], [["local tag=$(get-tag)", "local tag=\"$(get-tag)\""]]] },
  arithexit: { fix: [["((count++))", "count=$((count + 1))"]], wrong: [[["((count++))", "let count++"]], [["((count++))", "(( count += 0 )); ((count++))"]]] },
  trap: { fix: [["tmp=$(mktemp)\n", "tmp=$(mktemp)\ntrap 'rm -f \"$tmp\"' EXIT\n"]], wrong: [[["rm -f \"$tmp\"\n", "rm -f \"$tmp\"\nrm -f /tmp/tmp.*\n"]], [["set -euo pipefail\n", ""]]] },
  forls: { fix: [["for f in $(ls /srv/uploads); do\n  mv \"/srv/uploads/$f\" /srv/archive/", "for f in /srv/uploads/*; do\n  mv \"$f\" /srv/archive/"]], wrong: [[["$(ls /srv/uploads)", "\"$(ls /srv/uploads)\""]], [["$(ls /srv/uploads)", "`ls /srv/uploads`"]]] },
  lastline: { fix: [["while read -r host; do", "while read -r host || [[ -n $host ]]; do"]], wrong: [["echo >> hosts.txt"], [["read -r host", "read host"]]] },
  pipesub: { fix: [["grep '/bin/bash$' /etc/passwd | while", "while"], ["done\n", "done < <(grep '/bin/bash$' /etc/passwd)\n"]], wrong: [[["total=0", "export total=0"]], [["total=$((total + 1))", "((total++)); export total"]]] },
  nomatch: { fix: [["for f", "shopt -s nullglob\nfor f"]], wrong: [[["gzip \"$f\"", "gzip \"$f\" 2>/dev/null"]], [["/var/log/app/*.log", "\"/var/log/app/*.log\""]]] },
  extension: { fix: [["\"$(echo \"$f\" | cut -d. -f1).jpg\"", "\"${f%.jpeg}.jpg\""]], wrong: [[["cut -d. -f1", "cut -d. -f1-2"]], [["\"$(echo \"$f\" | cut -d. -f1).jpg\"", "\"${f%%.*}.jpg\""]]] },
  findglob: { fix: [["-name *.log", "-name '*.log'"]], wrong: [["cd /tmp"], [["-name *.log", "-name \\*.log -o -name *.log"]]] },
  sedslash: { fix: [["s/__ROOT__/$NEW_ROOT/", "s|__ROOT__|$NEW_ROOT|"]], wrong: [[["s/__ROOT__/$NEW_ROOT/", "s/__ROOT__/'$NEW_ROOT'/"]], [["sed -i \"", "sed -i -E \""]]] },
  uniqsort: { fix: [["| uniq -c", "| sort | uniq -c"]], wrong: [[["sort -rn", "sort -n"]], [["uniq -c", "uniq -c -i"]]] },
  grepdot: { fix: [["grep -c \"$IP\"", "grep -cFw \"$IP\""]], wrong: [[["grep -c \"$IP\"", "grep -cF \"$IP\""]], [["grep -c \"$IP\"", "grep -c \"^$IP\""]]] },
  cutspaces: { fix: [["df -P | tail -n +2 | while read -r line; do\n  mount=$(echo \"$line\" | cut -d' ' -f6)\n  used=$(echo \"$line\" | cut -d' ' -f5)\n  echo \"$mount $used\"\ndone", "df -P | awk 'NR > 1 {print $6, $5}'"]], wrong: [[["cut -d' ' -f6", "cut -d' ' -f12"]], [["cut -d' '", "cut -d'\t'"], ["cut -d' '", "cut -d'\t'"]]] },
  grepset: { fix: [["/var/log/app.log)", "/var/log/app.log || true)"]], wrong: [[["/var/log/app.log)", "/var/log/app.log 2>/dev/null)"]], [["grep -c", "grep -sc"]]] },
  crlfdata: { fix: [["$(cat maintenance.txt)", "$(tr -d '\\r' < maintenance.txt)"]], wrong: [["sed -i 's/\\r$//' maintenance.txt"], [["\"$mode\" != \"off\"", "$mode != off"]]] },
  slowloop: { fix: [[/[\s\S]*/, "#!/usr/bin/env bash\nawk '$9 >= 500 {err++; next} {ok++} END {print \"ok=\" ok \" err=\" err}' /var/log/nginx/access.log\n"]], wrong: [[["code=$(echo \"$line\" | cut -d' ' -f9)", "code=$(awk '{print $9}' <<< \"$line\")"]]] },
  funcreturn: { fix: [["return \"production\"", "echo \"production\""], ["env_name\nENV=$?", "ENV=$(env_name)"]], wrong: [[["return \"production\"", "echo \"production\""]], [["ENV=$?", "ENV=$(env_name)"]]] },
  getopts: { fix: [["\"ve\"", "\"ve:\""], ["version=$1", "shift $((OPTIND - 1))\nversion=$1"]], wrong: [[["\"ve\"", "\"ve:\""]], [["version=$1", "shift $((OPTIND - 1))\nversion=$1"]]] },
  nolocal: { fix: [["upload() {\n", "upload() {\n  local i\n"]], wrong: [[["upload() {\n", "upload() {\n  export i\n"]], [["  i=$((i + 1))", "  ((i++))"]]] },
  sourcepath: { fix: [["source ./lib/common.sh", "source \"$(dirname \"${BASH_SOURCE[0]}\")/lib/common.sh\""]], wrong: [["cd /opt/tools"], [["source ./lib/common.sh", "source lib/common.sh"]]] },
  exitpipe: { fix: [["cat app.conf | while", "while"], ["done\n", "done < app.conf\n"]], wrong: [[["exit 1", "exit 2"]], [["exit 1", "return 1"]]] },
  rmempty: { fix: [["\"$STAGING_DIR\"/*", "\"${STAGING_DIR:?STAGING_DIR is not set}\"/*"]], wrong: [[["rm -rf", "set -e\nrm -rf"]], [["\"$STAGING_DIR\"/*", "\"$STAGING_DIR/\"*"]]] },
  logrotate: { fix: [["find $LOG_DIR", "find \"${LOGDIR:?}\""]], wrong: [[["find $LOG_DIR", "find \"$LOG_DIR\""]], [["-mtime +7", "-mtime +30"]]] },
  lockfile: { fix: [["echo \"syncing mirror\"", "exec 9>/var/lock/sync.lock\nflock -n 9 || { echo \"already running\"; exit 0; }\necho \"syncing mirror\""]], wrong: [[["echo \"syncing mirror\"", "[ -e /var/lock/sync.lock ] && { echo \"already running\"; exit 0; }\necho \"syncing mirror\""]], ["kill 3120"]] },
  retry: { fix: [["curl -fsS -o shop.tar.gz \"$URL\"", "for n in 1 2 3 4 5; do\n  curl -fsS -o shop.tar.gz \"$URL\" && break\n  [ \"$n\" -eq 5 ] && exit 1\n  sleep $((2 ** n))\ndone"]], wrong: [[["curl -fsS -o shop.tar.gz \"$URL\"", "until curl -fsS -o shop.tar.gz \"$URL\"; do :; done"]], [["curl -fsS -o shop.tar.gz \"$URL\"", "for n in 1 2 3 4 5; do curl -fsS -o shop.tar.gz \"$URL\" && break; done"]], [["curl -fsS -o shop.tar.gz \"$URL\"", "until curl -fsS -o shop.tar.gz \"$URL\"; do sleep 1; done"]]] },
  secretleak: { fix: [["set -euxo pipefail", "set -euo pipefail"], ["echo \"Using token $API_TOKEN\"\n", ""]], wrong: [[["echo \"Using token $API_TOKEN\"\n", ""]], [["set -euxo pipefail", "set -euo pipefail"]]] },
  evalinject: { fix: [["eval \"ls -l '$DIR'\"", "ls -l -- \"$DIR\""]], wrong: [[["eval \"ls -l '$DIR'\"", "eval \"ls -l \\\"$DIR\\\"\""]], [["DIR=$1", "DIR=\"$1\""]]] },
  cronpath: { fix: [["set -euo pipefail\n", "set -euo pipefail\nPATH=/usr/local/bin:/usr/bin:/bin\n"]], wrong: [["echo 'export PATH=/usr/local/bin:$PATH' >> ~/.bashrc"], [["#!/usr/bin/env bash", "#!/bin/bash -l"]]] },
  cronenv: { fix: [["set -eo pipefail\n", "set -eo pipefail\nset -a; source /etc/shop/report.env; set +a\n"]], wrong: [["echo 'export DB_HOST=db.internal' >> ~/.profile"], [["set -eo pipefail\n", "set -eo pipefail\nexport DB_HOST\n"]]] },
  crlf: { fix: ["sed -i 's/\\r$//' deploy.sh"], wrong: [["bash deploy.sh"], ["chmod 755 deploy.sh"]] },
  noshebang: { fix: [["# Daily report", "#!/usr/bin/env bash\n# Daily report"]], wrong: [["bash report.sh"], [["# Daily report", "#!/bin/sh\n# Daily report"]]] },
  sudoredirect: { fix: [["sudo echo \"vm.swappiness=10\" > /etc/sysctl.d/99-shop.conf", "echo \"vm.swappiness=10\" | sudo tee /etc/sysctl.d/99-shop.conf > /dev/null"]], wrong: [[["> /etc", ">> /etc"]], ["sudo ./setup.sh"], [["sudo echo \"vm.swappiness=10\" > /etc/sysctl.d/99-shop.conf", "echo \"vm.swappiness=10\" | tee /etc/sysctl.d/99-shop.conf"]]] },
  octal: { fix: [["$(( hour * 60 + min ))", "$(( 10#$hour * 60 + 10#$min ))"]], wrong: [[["$(( hour * 60 + min ))", "$(( \"$hour\" * 60 + min ))"]], [["  hour=${time%%:*}", "  hour=$((${time%%:*}))"]]] },
  argstring: { fix: [["FIND_OPTS=\"-name '*.tmp' -mtime +1\"", "FIND_OPTS=(-name '*.tmp' -mtime +1)"], ["$FIND_OPTS", "\"${FIND_OPTS[@]}\""]], wrong: [[["$FIND_OPTS", "\"$FIND_OPTS\""]], [["'*.tmp'", "*.tmp"]]] },
  sshloop: { fix: [["ssh \"$host\" uptime", "ssh -n \"$host\" uptime"]], wrong: [[["while read -r host; do", "while read -r host || [[ -n $host ]]; do"]], [["ssh \"$host\" uptime", "ssh $host uptime"]]] },
  curlfail: { fix: [["curl -s", "curl -fsS"]], wrong: [[["curl -s", "curl -sS"]], [["curl -s", "curl -s --retry 3"]]] },
  ntest: { fix: [["[ -n $API_KEY ]", "[ -n \"$API_KEY\" ]"]], wrong: [[["[ -n $API_KEY ]", "[ -n ${API_KEY} ]"]], [["[ -n $API_KEY ]", "[ -n $API_KEY ] 2>/dev/null"]], ["export API_KEY=k-123"]] },
  export: { fix: [["DEPLOY_ENV=staging", "export DEPLOY_ENV=staging"]], wrong: [["export DEPLOY_ENV=staging"], [["DEPLOY_ENV=staging", "declare DEPLOY_ENV=staging"]]] }
};

assert.strictEqual(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length, "scenario ids are unique");
assert.deepStrictEqual(GROUPS.flatMap(([, ids]) => ids).sort(), SCENARIOS.map((s) => s.id).sort(), "every scenario is in exactly one group");
assert.ok(SCENARIOS.length >= 30, "at least 30 scenarios");
for (const s of SCENARIOS) {
  const c = CASES[s.id];
  assert.ok(c, `${s.id}: has a test case`);
  assert.strictEqual(s.hints.length, 3, `${s.id}: three hints`);
  for (const k of ["title", "story", "goal", "done", "lesson", "level", "file"]) assert.ok(s[k], `${s.id}: ${k}`);
  assert.ok(s.tries.length, `${s.id}: suggested commands`);
  const sys = start(s);
  assert.ok(sys.fs.get(s.file), `${s.id}: its script exists`);
  const first = s.check(sys);
  assert.ok(first.label && first.text && !first.ok, `${s.id}: must start broken (${first.text})`);
  // The suggested commands are all supported here.
  for (const t of s.tries) {
    const out = start(s).run(t).map((l) => l[0]).join("\n");
    assert.ok(!/playground:/.test(out) && !out.startsWith(`bash: ${t.split(" ")[0]}: command not found`), `${s.id}: "${t}" runs`);
  }
  for (const w of c.wrong) {
    const ws = start(s);
    apply(ws, s, w);
    assert.ok(!s.won(ws), `${s.id}: wrong move ${JSON.stringify(w)} must not solve it`);
  }
  const fs2 = start(s);
  fs2.run(s.tries[0]);
  apply(fs2, s, c.fix);
  const r = s.check(fs2);
  assert.ok(r.ok, `${s.id}: the fix must solve it (${r.label}: ${r.text})`);
}
for (const id of Object.keys(CASES)) assert.ok(SCENARIOS.some((s) => s.id === id), `test case ${id} has a scenario`);

console.log(`playground ok: ${SCENARIOS.length} scenarios start broken, ${Object.values(CASES).reduce((n, c) => n + c.wrong.length, 0)} wrong moves do not fix them, every intended fix does`);
