// Playground scenarios: each one is a small server with a script that is
// broken the way real scripts break. check() runs the learner's version of
// the script in a fresh copy of that server and says whether it now works;
// wrong-but-tempting fixes fail it (tests/check_playground.js proves both).
"use strict";

(function (root) {
  const { System, EPOCH } = root.ShellSim;
  const H = "/home/dev";
  const DAY = 86400;
  // How cron runs a job: /bin/sh -c, a minimal environment, the home directory.
  const cron = (cmd) => `cd ${H} && env -i HOME=${H} LOGNAME=dev SHELL=/bin/sh PATH=/usr/bin:/bin /bin/sh -c '${cmd}'`;

  // Run cmd in a fresh copy of the scenario's server that has the learner's
  // version of the files they may edit.
  function trial(sc, sys, cmd, tweak = {}) {
    const t = new System({ ...sc, ...(tweak.spec || {}) });
    for (const p of sc.editable) {
      const n = sys.fs.get(p);
      if (n) t.fs.nodes.set(p, { ...n }); else t.fs.nodes.delete(p);
    }
    if (tweak.setup) tweak.setup(t);
    t.run(cmd);
    return { out: t.stdout, err: t.stderr, all: t.stdout + t.stderr, status: t.term.status, sys: t, fs: t.fs, text: (p) => (t.fs.get(p) || {}).text };
  }
  const firstLine = (s) => (s.split("\n").find((l) => l.trim()) || "").slice(0, 120);
  const ok = (label, text) => ({ ok: true, label, text });
  const bad = (label, text) => ({ ok: false, label, text });
  // The usual verdict: what failed first, or that it now works.
  const verdict = (label, r, good, why) => (good ? ok(label, why || "works")
    : bad(label, r.status ? `exit ${r.status}: ${firstLine(r.err) || firstLine(r.out) || "no output"}` : firstLine(r.err) || (r.out ? `prints: ${firstLine(r.out)}` : "no output")));

  const SCENARIOS = [
    // --- Basics -------------------------------------------------------------------
    {
      id: "noexec",
      title: "Permission denied",
      level: "00",
      story: "You wrote a health report script and added it to cron. Cron mails you every five minutes: Permission denied.",
      goal: "Make ./report.sh runnable the way cron runs it.",
      done: "report.sh runs on its own.",
      file: `${H}/report.sh`,
      files: { [`${H}/report.sh`]: { text: `#!/usr/bin/env bash\n# Health report for the on-call channel.\necho "Health report for $(hostname)"\nuptime_days=12\necho "Up $uptime_days days"\n`, mode: 0o644 } },
      crontab: "*/5 * * * * /home/dev/report.sh >> /home/dev/report.log 2>&1\n",
      hints: [
        "Run it the way cron does: ./report.sh. Then look at ls -l report.sh. Which permission bits does it have?",
        "-rw-r--r-- has no x: the kernel will not execute the file, whatever its first line says.",
        "Give it the execute bit: chmod +x report.sh (or chmod 755 report.sh), then ./report.sh."
      ],
      lesson: "A script needs the execute bit to run as a program. bash report.sh works without it, but cron, CI and other scripts call the file directly.",
      tries: ["./report.sh", "ls -l report.sh", "crontab -l"],
      check(sys) {
        const r = trial(this, sys, "./report.sh");
        return verdict("./report.sh", r, r.status === 0 && /Health report for web-01/.test(r.out));
      }
    },
    {
      id: "typo",
      title: "command not found",
      level: "00",
      story: "The deploy script prints a scary line at the end and the CI job turns red, although the deploy itself looked fine.",
      goal: "Make ./deploy.sh finish with exit status 0.",
      done: "deploy.sh exits 0.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\necho "Copying release 1.4.2"\nmkdir -p /srv/app/releases/1.4.2\necho "Switching traffic"\nehco "Deploy finished"\n` },
      hints: [
        "Run ./deploy.sh and then echo $?. Read the error line: it names the file, the line and the word bash could not run.",
        "Line 5 says ehco. Bash looks for a command with that name on your PATH and finds none, so it returns 127.",
        "Fix the typo: edit deploy.sh (or sed -i 's/^ehco/echo/' deploy.sh) and run it again."
      ],
      lesson: "Exit status 127 means command not found. The error names the line, so the fix is quick; CI fails because the script's last command decides its exit status.",
      tries: ["./deploy.sh", "echo $?", "cat -n deploy.sh"],
      check(sys) {
        const r = trial(this, sys, "./deploy.sh");
        return verdict("./deploy.sh", r, r.status === 0 && /Deploy finished/.test(r.out));
      }
    },
    {
      id: "assign",
      title: "Spaces around =",
      level: "01",
      story: "A colleague tidied up the deploy script. Now it says it is deploying to nowhere.",
      goal: "Make deploy.sh print: Deploying to production",
      done: "The variable is set.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nENV = production\nREGION = eu-west-1\necho "Deploying to $ENV in $REGION"\n` },
      hints: [
        "Run ./deploy.sh. What does bash say about ENV on line 2?",
        "With spaces, ENV = production is a command named ENV with two arguments, = and production. An assignment has no spaces around =.",
        "Write ENV=production and REGION=eu-west-1, with no spaces."
      ],
      lesson: "name=value is an assignment only with no spaces. With spaces bash runs a command called name, and the variable stays empty.",
      tries: ["./deploy.sh", "cat deploy.sh"],
      check(sys) {
        const r = trial(this, sys, "./deploy.sh");
        return verdict("./deploy.sh", r, /^Deploying to production in eu-west-1$/m.test(r.out) && !r.err, "prints the environment");
      }
    },
    {
      id: "singlequotes",
      title: "Single quotes",
      level: "01",
      story: "The release bot posts the note your script writes. Today it posted, word for word: Released $VERSION to $HOST.",
      goal: "Write the real version and host into release-note.txt, with the note's text unchanged.",
      done: "The note has the version and host.",
      file: `${H}/release.sh`,
      files: {
        [`${H}/release.sh`]: `#!/usr/bin/env bash\nVERSION=1.4.2\nHOST=$(hostname)\necho 'Released $VERSION to $HOST *** watch the dashboard' > release-note.txt\ncat release-note.txt\n`,
        [`${H}/dashboard.url`]: "https://grafana.internal/d/shop\n",
        [`${H}/notes.md`]: "# release notes\n"
      },
      hints: [
        "Run ./release.sh. Which part of the line did bash leave alone?",
        "Inside single quotes nothing expands: $VERSION stays as text. Double quotes expand variables but still protect spaces and *.",
        "Use double quotes: echo \"Released $VERSION to $HOST *** watch the dashboard\". Without any quotes the *** would turn into file names."
      ],
      lesson: "Single quotes keep everything literal; double quotes expand $variables and $(commands) but stop word splitting and globbing. Leaving quotes off is worse: *** became a list of files.",
      tries: ["./release.sh", "cat release-note.txt"],
      check(sys) {
        const r = trial(this, sys, "./release.sh");
        const note = r.text(`${H}/release-note.txt`) || "";
        return note === "Released 1.4.2 to web-01 *** watch the dashboard\n" ? ok("release-note.txt", "has the version and host")
          : bad("release-note.txt", note ? `says: ${firstLine(note)}` : "not written");
      }
    },
    {
      id: "math",
      title: "Arithmetic as text",
      level: "01",
      story: "The failed-login report says: Failed logins: 0+1+1+1. Security asked for a number.",
      goal: "Make failed-logins.sh print Failed logins: 3",
      done: "The count is a number.",
      file: `${H}/failed-logins.sh`,
      files: {
        [`${H}/failed-logins.sh`]: `#!/usr/bin/env bash\ncount=0\nwhile read -r line; do\n  case "$line" in\n    *"Failed password"*) count=$count+1 ;;\n  esac\ndone < /var/log/auth.log\necho "Failed logins: $count"\n`,
        "/var/log/auth.log": "Oct 30 02:11:04 web-01 sshd[811]: Failed password for root from 203.0.113.9 port 51122 ssh2\nOct 30 02:11:09 web-01 sshd[811]: Failed password for root from 203.0.113.9 port 51122 ssh2\nOct 30 02:14:30 web-01 sshd[902]: Accepted publickey for dev from 10.0.0.4 port 50210 ssh2\nOct 30 02:20:41 web-01 sshd[955]: Failed password for admin from 198.51.100.7 port 40022 ssh2\n"
      },
      hints: [
        "Run it. Bash variables hold strings; what does count=$count+1 store?",
        "Bash only does arithmetic inside $(( )), (( )) or let. Note let count=count + 1 with spaces fails too: let sees three arguments.",
        "Write count=$((count + 1))."
      ],
      lesson: "Variables are strings. $(( )) evaluates arithmetic and names inside it need no $.",
      tries: ["./failed-logins.sh", "grep -c 'Failed password' /var/log/auth.log"],
      check(sys) {
        const r = trial(this, sys, "./failed-logins.sh");
        return verdict("./failed-logins.sh", r, /^Failed logins: 3$/m.test(r.out) && r.status === 0, "counts 3");
      }
    },

    // --- Quoting and expansion -------------------------------------------------------
    {
      id: "spaces",
      title: "Spaces in a path",
      level: "01",
      story: "The nightly backup of the finance reports has been failing for a week. Nobody noticed.",
      goal: "Copy the \"Q3 Sales\" folder into /var/backups.",
      done: "The folder is backed up.",
      file: `${H}/backup.sh`,
      files: {
        [`${H}/backup.sh`]: `#!/usr/bin/env bash\nSRC=/srv/reports/Q3\\ Sales\nDEST=/var/backups\ncp -r $SRC $DEST/\necho "Backed up $SRC"\n`,
        "/srv/reports/Q3 Sales/summary.csv": "region,total\nnorth,1200\n",
        "/srv/reports/Q3 Sales/by-week.csv": "week,total\n1,90\n"
      },
      hints: [
        "Run ./backup.sh and read the two cp errors. How many arguments did cp get?",
        "The backslash only protects the space while the assignment is read. When $SRC is used without quotes, bash splits its value on spaces again.",
        "Quote every use: cp -r \"$SRC\" \"$DEST/\" (and SRC=\"/srv/reports/Q3 Sales\" reads better)."
      ],
      lesson: "An unquoted $var is split into words and globbed. Quote variables when you use them: \"$var\".",
      tries: ["./backup.sh", "ls /srv/reports", "ls /var/backups"],
      check(sys) {
        const r = trial(this, sys, "./backup.sh");
        return verdict("/var/backups", r, r.fs.isFile("/var/backups/Q3 Sales/summary.csv") && r.status === 0, "has Q3 Sales");
      }
    },
    {
      id: "emptytest",
      title: "unary operator expected",
      level: "02",
      story: "The shop's health check runs every minute. Last night the app was down for forty minutes and it never alerted.",
      goal: "Make health.sh print ALERT when the app is down, and stay quiet when it is up.",
      done: "Down means an alert.",
      file: `${H}/health.sh`,
      files: { [`${H}/health.sh`]: `#!/usr/bin/env bash\nSTATUS=$(curl -s http://localhost:8080/health)\nif [ $STATUS != "ok" ]; then\n  echo "ALERT: shop is unhealthy"\nfi\n` },
      net: { "http://localhost:8080/health": "refused" },
      hints: [
        "Run ./health.sh while the app is down. What does [ complain about?",
        "curl printed nothing, so $STATUS is empty and unquoted: the test becomes [ != ok ], which is an error (status 2), not true. No alert.",
        "Quote it: if [ \"$STATUS\" != \"ok\" ], or use [[ $STATUS != ok ]], which does not split words."
      ],
      lesson: "An empty unquoted variable disappears from the command line. Quote variables in [ ], or use [[ ]].",
      tries: ["./health.sh", "curl -s http://localhost:8080/health; echo $?"],
      check(sys) {
        const down = trial(this, sys, "./health.sh");
        const up = trial(this, sys, "./health.sh", { spec: { net: { "http://localhost:8080/health": { status: 200, body: "ok" } } } });
        if (!/ALERT/.test(down.out)) return bad("app down", down.err ? firstLine(down.err) : "no alert");
        if (/ALERT/.test(up.out)) return bad("app up", "alerts anyway");
        return ok("health.sh", "alerts only when down");
      }
    },
    {
      id: "globvar",
      title: "An asterisk in a message",
      level: "01",
      story: "The disk alert in alerts.log reads: Disk above 90% alerts.log backup.sh notes.txt check /var/log. Someone asked if the server was hacked.",
      goal: "Write the alert text exactly as written in the script.",
      done: "The message is literal.",
      file: `${H}/disk-alert.sh`,
      files: {
        [`${H}/disk-alert.sh`]: `#!/usr/bin/env bash\nMSG="Disk above 90% * check /var/log"\necho $MSG >> alerts.log\n`,
        [`${H}/alerts.log`]: "",
        [`${H}/notes.txt`]: "rotate logs on friday\n"
      },
      hints: [
        "Run ./disk-alert.sh and cat alerts.log. Where did the file names come from?",
        "The quotes in MSG=\"...\" are gone by the time $MSG is used. Unquoted, the * in its value is a glob and matches the files in the current directory.",
        "Quote the use: echo \"$MSG\" >> alerts.log."
      ],
      lesson: "Unquoted expansions are globbed as well as split: a * in a value becomes file names.",
      tries: ["./disk-alert.sh", "cat alerts.log"],
      check(sys) {
        const r = trial(this, sys, "./disk-alert.sh");
        const log = r.text(`${H}/alerts.log`) || "";
        return log === "Disk above 90% * check /var/log\n" ? ok("alerts.log", "literal message") : bad("alerts.log", log ? `has: ${firstLine(log)}` : "empty");
      }
    },
    {
      id: "heredoc",
      title: "Here-document expands too early",
      level: "06",
      story: "install.sh writes a cleanup helper into ~/bin. The helper always cleans the same folder and stamps every run with the install date.",
      goal: "Make the generated ~/bin/cleanup.sh keep $1 and $(date +%F) as written.",
      done: "The helper is written literally.",
      file: `${H}/install.sh`,
      files: { [`${H}/install.sh`]: `#!/usr/bin/env bash\nmkdir -p ~/bin\ncat > ~/bin/cleanup.sh <<EOF\n#!/usr/bin/env bash\ndir=\${1:?usage: cleanup.sh DIR}\necho "Cleaning $dir on $(date +%F)"\nfind "$dir" -name '*.tmp' -delete\nEOF\nchmod +x ~/bin/cleanup.sh\necho "Installed ~/bin/cleanup.sh"\n` },
      hints: [
        "Run ./install.sh and cat ~/bin/cleanup.sh. Compare it with what install.sh meant to write.",
        "With an unquoted delimiter (<<EOF) the body is expanded like a double-quoted string, while install.sh runs. ${1:?...} even stops it, because install.sh has no $1.",
        "Quote the delimiter: <<'EOF'. Then nothing in the body is expanded."
      ],
      lesson: "<<EOF expands $vars and $(commands) when the here-document is read; <<'EOF' keeps the text exactly. Use the quoted form to write scripts and templates.",
      tries: ["./install.sh", "cat ~/bin/cleanup.sh"],
      check(sys) {
        const r = trial(this, sys, "./install.sh");
        const out = r.text(`${H}/bin/cleanup.sh`) || "";
        return out.includes("dir=${1:?usage: cleanup.sh DIR}") && out.includes('echo "Cleaning $dir on $(date +%F)"') ? ok("~/bin/cleanup.sh", "written literally")
          : bad("~/bin/cleanup.sh", r.status ? `exit ${r.status}: ${firstLine(r.err)}` : out ? "variables were expanded" : "not written");
      }
    },
    {
      id: "nounset",
      title: "unbound variable",
      level: "05",
      story: "You added set -u to the sync job, as the review asked. Now it dies at once, unless you remember to set DEBUG.",
      goal: "Let sync.sh run without DEBUG set, and keep set -u.",
      done: "Optional settings have defaults.",
      file: `${H}/sync.sh`,
      files: { [`${H}/sync.sh`]: `#!/usr/bin/env bash\nset -u\nif [ "$DEBUG" = 1 ]; then\n  echo "debug: syncing /srv/shared"\nfi\necho "Sync complete"\n` },
      hints: [
        "Run ./sync.sh. set -u turns using an unset variable into an error that ends the script.",
        "DEBUG is optional, so give it a default where you read it.",
        "Use ${DEBUG:-0}: if [ \"${DEBUG:-0}\" = 1 ]. Keep set -u; it catches real typos."
      ],
      lesson: "With set -u, give optional variables a default: ${VAR:-default}. Required ones can fail with a message: ${VAR:?message}.",
      tries: ["./sync.sh", "DEBUG=1 ./sync.sh"],
      check(sys) {
        const text = sys.fs.get(this.file).text;
        if (!/^\s*set\s+-[a-z]*u|set -o nounset/m.test(text)) return bad("sync.sh", "set -u was removed");
        const plain = trial(this, sys, "./sync.sh");
        const dbg = trial(this, sys, "DEBUG=1 ./sync.sh");
        if (plain.status || !/Sync complete/.test(plain.out)) return verdict("without DEBUG", plain, false);
        if (!/debug: syncing/.test(dbg.out)) return bad("DEBUG=1", "no debug line");
        return ok("sync.sh", "runs with and without DEBUG");
      }
    },
    {
      id: "dollarstar",
      title: "$* loses the arguments",
      level: "09",
      story: "notify.sh wraps the chat tool. Messages arrive cut into pieces, sent to channels that do not exist.",
      goal: "Pass each argument through unchanged: ./notify.sh \"Deploy done\" \"#ops\" must send one message to #ops.",
      done: "Arguments arrive intact.",
      file: `${H}/notify.sh`,
      files: { [`${H}/notify.sh`]: `#!/usr/bin/env bash\n# Usage: notify.sh MESSAGE CHANNEL\nchat-send $*\n` },
      bins: {
        "chat-send": (c) => {
          if (c.args.length !== 2) { c.err(`chat-send: expected MESSAGE CHANNEL, got ${c.args.length} arguments: ${c.args.map((a) => `'${a}'`).join(" ")}\n`); return 2; }
          c.out(`sent to ${c.args[1]}: ${c.args[0]}\n`);
          return 0;
        }
      },
      hints: [
        "Run ./notify.sh \"Deploy done\" \"#ops\". What did chat-send receive?",
        "$* (and $@) without quotes joins the arguments and splits them again on spaces. \"$*\" makes one string of all of them.",
        "Use \"$@\": it expands to each argument as a separate, untouched word."
      ],
      lesson: "\"$@\" is the only way to pass arguments on exactly as they came.",
      tries: ["./notify.sh \"Deploy done\" \"#ops\""],
      check(sys) {
        const r = trial(this, sys, `./notify.sh "Deploy done" "#ops"`);
        return verdict("chat-send", r, r.status === 0 && /sent to #ops: Deploy done/.test(r.out), "got 2 arguments");
      }
    },

    // --- Exit codes and errors --------------------------------------------------------
    {
      id: "statusover",
      title: "$? read too late",
      level: "02",
      story: "Tests fail on main, yet every CI run is green. The CI step runs ci.sh.",
      goal: "Make ci.sh exit non-zero when the tests fail.",
      done: "CI fails when tests fail.",
      file: `${H}/ci.sh`,
      files: { [`${H}/ci.sh`]: `#!/usr/bin/env bash\nrun-tests\necho "Tests finished"\nif [ $? -ne 0 ]; then\n  echo "Tests failed"\n  exit 1\nfi\necho "All good"\n` },
      bins: { "run-tests": (c) => { c.out("test_cart ... ok\ntest_login ... FAIL\n2 tests, 1 failure\n"); return c.sys.spec.testsPass ? 0 : 1; } },
      hints: [
        "Run ./ci.sh; echo $?. Then run-tests; echo $?.",
        "$? is the status of the last command, and the last command before the if is echo, which succeeded.",
        "Test the command itself: if ! run-tests; then echo \"Tests failed\"; exit 1; fi (or save rc=$? right after it)."
      ],
      lesson: "$? changes after every command. Test a command directly with if, or save $? immediately.",
      tries: ["./ci.sh", "echo $?", "run-tests; echo $?"],
      check(sys) {
        const failing = trial(this, sys, "./ci.sh");
        const passing = trial(this, sys, "./ci.sh", { spec: { testsPass: true } });
        if (failing.status === 0) return bad("tests failing", "CI still exits 0");
        if (passing.status !== 0) return bad("tests passing", `CI exits ${passing.status}`);
        return ok("ci.sh", "fails only when tests fail");
      }
    },
    {
      id: "pipefail",
      title: "set -e and a pipeline",
      level: "10",
      story: "The database backup has set -e and says Backup OK every night. Restoring last night's file gave an empty database.",
      goal: "Make backup.sh fail when pg_dump fails.",
      done: "A failed dump fails the backup.",
      file: `${H}/backup.sh`,
      files: { [`${H}/backup.sh`]: `#!/usr/bin/env bash\nset -e\npg_dump shop | gzip > /var/backups/shop.sql.gz\necho "Backup OK"\n` },
      bins: {
        pg_dump: (c) => {
          if (c.sys.spec.dbUp) { c.out("-- PostgreSQL database dump\nCREATE TABLE orders (id int);\n"); return 0; }
          c.err('pg_dump: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n\tIs the server running locally and accepting connections on that socket?\n');
          return 1;
        }
      },
      hints: [
        "Run ./backup.sh. pg_dump fails, so why does the script carry on?",
        "A pipeline's exit status is the status of its last command. gzip succeeded, so set -e saw success.",
        "Add set -o pipefail (set -euo pipefail is the usual first line). Adding || exit 1 after the pipeline does not help: gzip still succeeds."
      ],
      lesson: "set -e only sees a pipeline's last status. pipefail makes any failing command fail the pipeline.",
      tries: ["./backup.sh", "echo $?", "pg_dump shop | gzip > /dev/null; echo ${PIPESTATUS[@]}"],
      check(sys) {
        const down = trial(this, sys, "./backup.sh");
        const up = trial(this, sys, "./backup.sh", { spec: { dbUp: true } });
        if (down.status === 0 || /Backup OK/.test(down.out)) return bad("database down", "reports Backup OK");
        if (up.status !== 0) return verdict("database up", up, false);
        return ok("backup.sh", "fails when pg_dump fails");
      }
    },
    {
      id: "cdfail",
      title: "cd failed, rm ran anyway",
      level: "10",
      story: "The release cleanup ran from cron after the releases folder moved. This morning your home directory is empty.",
      goal: "Make cleanup.sh stop when it cannot cd, so it never deletes files elsewhere.",
      done: "No cd, no rm.",
      file: `${H}/cleanup.sh`,
      files: {
        [`${H}/cleanup.sh`]: `#!/usr/bin/env bash\ncd /var/www/app/releases/old\nrm -rf *\necho "Old releases removed"\n`,
        [`${H}/notes.txt`]: "ssh keys rotated on 2026-10-01\n",
        [`${H}/projects/shop/README.md`]: "# shop\n"
      },
      dirs: ["/var/www/app/archive/old"],
      hints: [
        "Look before you run: cat cleanup.sh, then ls. Now run it from your home directory and ls again.",
        "When cd fails, bash prints an error and carries on in the same directory. rm -rf * then deletes whatever is there.",
        "Stop on failure: cd /var/www/app/releases/old || exit 1 (or set -e). 2>/dev/null only hides the message."
      ],
      lesson: "Always check cd: cd \"$dir\" || exit 1. Commands after a failed cd run in the wrong place.",
      tries: ["cat cleanup.sh", "ls", "./cleanup.sh"],
      check(sys) {
        const r = trial(this, sys, "./cleanup.sh");
        if (!r.fs.get(`${H}/notes.txt`)) return bad("home directory", "files deleted");
        if (r.status === 0) return bad("cleanup.sh", "reports success though cd failed");
        return ok("cleanup.sh", "stops when cd fails");
      }
    },
    {
      id: "localmask",
      title: "local hides a failure",
      level: "08",
      story: "A deploy went out tagged with nothing: app: instead of app:1.4.2. The script has set -e, so how did it carry on?",
      goal: "Make deploy.sh stop when get-tag fails.",
      done: "A failed lookup stops the deploy.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\n\nmain() {\n  local tag=$(get-tag)\n  deploy-tool --image "app:$tag"\n}\n\nmain\n` },
      bins: {
        "get-tag": (c) => { if (c.sys.spec.tagOk) { c.out("1.4.2\n"); return 0; } c.err("get-tag: registry.internal: 503 Service Unavailable\n"); return 1; },
        "deploy-tool": (c) => { c.out(`deploying ${c.args[1]}\n`); c.fs.write("/var/tmp/deployed", c.args[1] + "\n"); return 0; }
      },
      hints: [
        "Run ./deploy.sh. get-tag fails, then deploy-tool runs anyway.",
        "local is a command too. In local tag=$(get-tag) the status set -e sees is local's, which is 0.",
        "Declare first, assign after: local tag; tag=$(get-tag). Then the assignment carries get-tag's status."
      ],
      lesson: "local, export, declare and readonly hide the status of a command substitution. Declare the variable, then assign it on its own line.",
      tries: ["./deploy.sh", "get-tag; echo $?"],
      check(sys) {
        const fail = trial(this, sys, "./deploy.sh");
        const good = trial(this, sys, "./deploy.sh", { spec: { tagOk: true } });
        if (fail.fs.get("/var/tmp/deployed")) return bad("get-tag failing", `deployed ${firstLine(fail.text("/var/tmp/deployed"))}`);
        if (fail.status === 0) return bad("get-tag failing", "exit 0");
        if ((good.text("/var/tmp/deployed") || "") !== "app:1.4.2\n") return verdict("get-tag working", good, false, "did not deploy app:1.4.2");
        return ok("deploy.sh", "stops when get-tag fails");
      }
    },
    {
      id: "testcmd",
      title: "[ with a command inside",
      level: "02",
      story: "The log watcher should page when the app logs an ERROR. It has never paged, and it prints a syntax error every run.",
      goal: "Make watch.sh print PAGE when app.log contains ERROR, and nothing when it does not.",
      done: "The watcher pages on errors.",
      file: `${H}/watch.sh`,
      files: {
        [`${H}/watch.sh`]: `#!/usr/bin/env bash\nif [ grep -q "ERROR" /var/log/app.log ]; then\n  echo "PAGE: errors in app.log"\nfi\n`,
        "/var/log/app.log": "03:00:01 INFO started\n03:00:07 ERROR payment provider timeout\n"
      },
      hints: [
        "Run ./watch.sh. What does [ say?",
        "[ is the test command, not grouping. It received grep, -q, ERROR and a file name as arguments to compare.",
        "if runs any command and checks its exit status: if grep -q \"ERROR\" /var/log/app.log; then ..."
      ],
      lesson: "if takes a command. [ ] is one such command (test); to branch on grep, run grep.",
      tries: ["./watch.sh", "grep -q ERROR /var/log/app.log; echo $?"],
      check(sys) {
        const errs = trial(this, sys, "./watch.sh");
        const clean = trial(this, sys, "./watch.sh", { setup: (t) => t.fs.write("/var/log/app.log", "03:00:01 INFO started\n") });
        if (!/PAGE/.test(errs.out)) return bad("ERROR in log", errs.err ? firstLine(errs.err) : "no page");
        if (/PAGE/.test(clean.out)) return bad("clean log", "pages anyway");
        return ok("watch.sh", "pages only on errors");
      }
    },
    {
      id: "intcompare",
      title: "integer expression expected",
      level: "03",
      story: "The disk check is supposed to warn above 90%. It errors out every run, and the root disk is at 100%.",
      goal: "Make disk.sh print WARN when the disk is above 90%, and not otherwise.",
      done: "The check compares numbers.",
      file: `${H}/disk.sh`,
      files: { [`${H}/disk.sh`]: `#!/usr/bin/env bash\nusage=$(df -P / | awk 'NR==2 {print $5}')\nif [ "$usage" -gt 90 ]; then\n  echo "WARN: / is at $usage"\nfi\n` },
      disks: [["/dev/sda1", 41152736, 41152736, "/"]],
      hints: [
        "Run ./disk.sh, and df -P / | awk 'NR==2 {print $5}'. What exactly is in $usage?",
        "-gt needs integers and 100% is not one. Do not switch to >: inside [ ] that is a redirect, and in [[ ]] it compares text, where \"100\" sorts before \"90\".",
        "Strip the sign first: usage=${usage%\\%}, then [ \"$usage\" -gt 90 ]."
      ],
      lesson: "Test numbers with -gt or (( )), and only after removing units like %. String comparisons sort 100 before 90.",
      tries: ["./disk.sh", "df -P /"],
      check(sys) {
        const at = (pct) => trial(this, sys, "./disk.sh", { spec: { disks: [["/dev/sda1", 1000000, pct * 10000, "/"]] } });
        const full = at(100);
        if (!/WARN/.test(full.out)) return bad("disk at 100%", full.err ? firstLine(full.err) : "no warning");
        if (!/WARN/.test(at(95).out)) return bad("disk at 95%", "no warning");
        if (/WARN/.test(at(9).out) || /WARN/.test(at(50).out)) return bad("disk at 9%", "warns anyway");
        return ok("disk.sh", "warns above 90%");
      }
    },
    {
      id: "arithexit",
      title: "((count++)) ends the script",
      level: "10",
      story: "After adding set -e, the image optimiser only ever processes the first file and exits without a word.",
      goal: "Make optimise.sh process all three images and print the total.",
      done: "Every image is processed.",
      file: `${H}/optimise.sh`,
      files: {
        [`${H}/optimise.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\ncount=0\nfor img in /srv/images/*.png; do\n  echo "optimising $img"\n  ((count++))\ndone\necho "Optimised $count images"\n`,
        "/srv/images/a.png": "png", "/srv/images/b.png": "png", "/srv/images/c.png": "png"
      },
      hints: [
        "Run ./optimise.sh; echo $?. It stops right after the first image.",
        "(( )) returns status 1 when the expression is 0. count++ evaluates to the old value, 0, so set -e ends the script. let count++ does the same.",
        "Use count=$((count + 1)), or ((++count)), which evaluates to the new value."
      ],
      lesson: "(( )) and let return 1 when the result is 0, and set -e treats that as a failure. Prefer var=$((var + 1)) in strict scripts.",
      tries: ["./optimise.sh", "echo $?"],
      check(sys) {
        const r = trial(this, sys, "./optimise.sh");
        return verdict("./optimise.sh", r, r.status === 0 && /Optimised 3 images/.test(r.out) && (r.out.match(/optimising/g) || []).length === 3, "processes all 3");
      }
    },
    {
      id: "trap",
      title: "Temp files pile up",
      level: "10",
      story: "/tmp on the reporting server filled up: thousands of tmp.* files. The report script makes one every run, and the upload fails often.",
      goal: "Make report.sh remove its temp file every time, even when the upload fails.",
      done: "No temp files left behind.",
      file: `${H}/report.sh`,
      files: { [`${H}/report.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\ntmp=$(mktemp)\necho "orders,1204" > "$tmp"\ncurl -fsS -o /dev/null https://reports.internal/upload\nrm -f "$tmp"\necho "Report uploaded"\n` },
      net: { "https://reports.internal/upload": { status: 503, body: "busy" } },
      hints: [
        "Run ./report.sh, then ls /tmp. Run it again. Why is the file never removed?",
        "set -e ends the script at the failed curl, so the rm at the bottom never runs.",
        "Register the cleanup right after creating the file: trap 'rm -f \"$tmp\"' EXIT. It runs however the script ends."
      ],
      lesson: "trap '...' EXIT runs on every exit: success, error or exit 1. Put cleanup there, right after you create what needs cleaning.",
      tries: ["./report.sh", "ls /tmp"],
      check(sys) {
        const leftovers = (r) => r.fs.list("/tmp").filter((n) => n.startsWith("tmp.")).length;
        const failing = trial(this, sys, "./report.sh");
        const working = trial(this, sys, "./report.sh", { spec: { net: { "https://reports.internal/upload": { status: 200, body: "ok" } } } });
        if (leftovers(failing)) return bad("upload failing", `${leftovers(failing)} temp file left in /tmp`);
        if (failing.status === 0) return bad("upload failing", "reports success");
        if (leftovers(working) || working.status) return verdict("upload working", working, false, "temp file left in /tmp");
        return ok("report.sh", "cleans up every time");
      }
    },

    // --- Loops and files ---------------------------------------------------------------
    {
      id: "forls",
      title: "for f in $(ls)",
      level: "04",
      story: "The uploads processor moves invoices to the archive. Some invoices never arrive there.",
      goal: "Move every file from /srv/uploads into /srv/archive.",
      done: "Every invoice is archived.",
      file: `${H}/archive.sh`,
      files: {
        [`${H}/archive.sh`]: `#!/usr/bin/env bash\nfor f in $(ls /srv/uploads); do\n  mv "/srv/uploads/$f" /srv/archive/\n  echo "archived $f"\ndone\n`,
        "/srv/uploads/invoice-1001.pdf": "%PDF", "/srv/uploads/Invoice March 2026.pdf": "%PDF", "/srv/uploads/receipt-77.pdf": "%PDF"
      },
      dirs: ["/srv/archive"],
      hints: [
        "Run ./archive.sh and read the mv errors.",
        "$(ls ...) is text; the for loop splits it on spaces, so \"Invoice March 2026.pdf\" becomes three words. Quoting \"$f\" inside the loop is too late.",
        "Let the shell list the files: for f in /srv/uploads/*; do mv \"$f\" /srv/archive/; done."
      ],
      lesson: "Never parse ls. A glob gives each file name as one word, spaces and all.",
      tries: ["./archive.sh", "ls /srv/uploads", "ls /srv/archive"],
      check(sys) {
        const r = trial(this, sys, "./archive.sh");
        const n = r.fs.list("/srv/archive").length;
        return n === 3 && !r.fs.list("/srv/uploads").length ? ok("/srv/archive", "has all 3 files") : bad("/srv/archive", `has ${n} of 3 files`);
      }
    },
    {
      id: "lastline",
      title: "The last line is skipped",
      level: "04",
      story: "The patch script reads hosts.txt, exported from the inventory tool. db-03 never gets patched.",
      goal: "Make patch.sh handle all three hosts.",
      done: "All hosts are read.",
      file: `${H}/patch.sh`,
      files: {
        [`${H}/patch.sh`]: `#!/usr/bin/env bash\nwhile read -r host; do\n  echo "patching $host"\ndone < hosts.txt\n`,
        [`${H}/hosts.txt`]: "web-01\nweb-02\ndb-03"
      },
      hints: [
        "Run ./patch.sh, then cat -A hosts.txt. How does the last line end?",
        "read returns 1 when it hits the end of input before a newline, even though it filled $host. The loop stops before using it.",
        "while read -r host || [[ -n $host ]]; do ... handles a last line without a newline. The file comes from a tool, so fix the script, not the file."
      ],
      lesson: "Files without a final newline lose their last line in a plain while read loop. Add || [[ -n $line ]].",
      tries: ["./patch.sh", "cat -A hosts.txt", "wc -l hosts.txt"],
      check(sys) {
        const r = trial(this, sys, "./patch.sh");
        return /patching db-03/.test(r.out) && (r.out.match(/patching/g) || []).length === 3 ? ok("./patch.sh", "patches 3 hosts") : bad("./patch.sh", `patches ${(r.out.match(/patching/g) || []).length} of 3 hosts`);
      }
    },
    {
      id: "pipesub",
      title: "A counter stays at 0",
      level: "04",
      story: "The weekly access review says: 0 users with shell access. That cannot be right.",
      goal: "Make users.sh count the accounts with /bin/bash as their shell.",
      done: "The count survives the loop.",
      file: `${H}/users.sh`,
      files: {
        [`${H}/users.sh`]: `#!/usr/bin/env bash\ntotal=0\ngrep '/bin/bash$' /etc/passwd | while IFS=: read -r name _; do\n  echo "shell user: $name"\n  total=$((total + 1))\ndone\necho "$total users with shell access"\n`
      },
      hints: [
        "Run ./users.sh. The loop prints the users, then the total says 0.",
        "Each part of a pipeline runs in a subshell. The loop's total changes in that subshell and disappears with it; export does not help.",
        "Keep the loop in the main shell by redirecting into it instead of piping: done < <(grep '/bin/bash$' /etc/passwd)."
      ],
      lesson: "Variables set in a piped while loop are lost. Feed the loop with a redirection instead: < file, or < <(cmd).",
      tries: ["./users.sh", "grep -c '/bin/bash$' /etc/passwd"],
      check(sys) {
        const r = trial(this, sys, "./users.sh");
        return verdict("./users.sh", r, /^2 users with shell access$/m.test(r.out), "counts 2");
      }
    },
    {
      id: "nomatch",
      title: "A glob that matches nothing",
      level: "04",
      story: "The log compressor runs hourly. On quiet hours cron mails: gzip: /var/log/app/*.log: No such file or directory.",
      goal: "Make compress.sh exit 0 with no errors when there are no logs, and compress them when there are.",
      done: "No logs, no errors.",
      file: `${H}/compress.sh`,
      files: { [`${H}/compress.sh`]: `#!/usr/bin/env bash\nfor f in /var/log/app/*.log; do\n  gzip "$f"\ndone\n` },
      dirs: ["/var/log/app"],
      hints: [
        "Run ./compress.sh; echo $?. What value did $f have?",
        "When a glob matches nothing, bash leaves the pattern as it is, so the loop runs once with the literal text /var/log/app/*.log.",
        "Add shopt -s nullglob before the loop (no match gives no words), or skip it inside: [ -e \"$f\" ] || continue. 2>/dev/null still leaves exit status 1."
      ],
      lesson: "An unmatched glob stays literal. shopt -s nullglob makes it expand to nothing.",
      tries: ["./compress.sh", "ls /var/log/app"],
      check(sys) {
        const none = trial(this, sys, "./compress.sh");
        const some = trial(this, sys, "./compress.sh", { setup: (t) => { t.fs.write("/var/log/app/api.log", "a\n"); t.fs.write("/var/log/app/web.log", "b\n"); } });
        if (none.status || none.err) return verdict("no logs", none, false);
        if (!some.fs.get("/var/log/app/api.log.gz") || !some.fs.get("/var/log/app/web.log.gz")) return bad("two logs", "not compressed");
        return ok("compress.sh", "quiet when there is nothing to do");
      }
    },
    {
      id: "extension",
      title: "Renaming with cut",
      level: "05",
      story: "A rename job turned .jpeg into .jpg. Two photos are gone and one is called team.jpg.",
      goal: "Rename every .jpeg in /srv/photos to .jpg and keep the rest of the name.",
      done: "Names are kept.",
      file: `${H}/rename.sh`,
      files: {
        [`${H}/rename.sh`]: `#!/usr/bin/env bash\ncd /srv/photos || exit 1\nfor f in *.jpeg; do\n  mv "$f" "$(echo "$f" | cut -d. -f1).jpg"\ndone\nls\n`,
        "/srv/photos/team.offsite.2026.jpeg": "a", "/srv/photos/team.party.jpeg": "b", "/srv/photos/logo.jpeg": "c"
      },
      hints: [
        "Run ./rename.sh and ls /srv/photos. What did cut -d. -f1 keep?",
        "cut keeps everything before the first dot; two files became team.jpg, the second overwriting the first.",
        "Remove only the suffix with parameter expansion: mv \"$f\" \"${f%.jpeg}.jpg\"."
      ],
      lesson: "${f%.ext} removes a suffix, ${f##*/} the directory, ${f%.*} the last extension. They are exact and need no extra process.",
      tries: ["./rename.sh", "ls /srv/photos"],
      check(sys) {
        const r = trial(this, sys, "./rename.sh");
        const names = r.fs.list("/srv/photos").join(" ");
        return names === "logo.jpg team.offsite.2026.jpg team.party.jpg" ? ok("/srv/photos", names) : bad("/srv/photos", names || "empty");
      }
    },
    {
      id: "findglob",
      title: "find: paths must precede expression",
      level: "13",
      story: "The old-log cleanup works when you test it in /tmp, and fails from cron with a strange find error.",
      goal: "Make prune-logs.sh delete logs older than 7 days in /var/log/app, from any directory.",
      done: "Only old logs are removed.",
      file: `${H}/prune-logs.sh`,
      files: {
        [`${H}/prune-logs.sh`]: `#!/usr/bin/env bash\nfind /var/log/app -name *.log -mtime +7 -delete\necho "pruned"\n`,
        [`${H}/build.log`]: "local build\n", [`${H}/test.log`]: "local test\n",
        "/var/log/app/old.log": { text: "old\n", mtime: EPOCH - 30 * DAY }, "/var/log/app/new.log": { text: "new\n", mtime: EPOCH - DAY }
      },
      hints: [
        "Run ./prune-logs.sh from your home directory. Then cd /tmp and run ~/prune-logs.sh.",
        "*.log is not quoted, so bash expands it in the current directory before find sees it: find gets -name build.log test.log.",
        "Quote the pattern so find does the matching: -name '*.log'."
      ],
      lesson: "Quote patterns meant for find, grep or other tools: '*.log'. Otherwise the shell expands them first, differently in each directory.",
      tries: ["./prune-logs.sh", "ls -l /var/log/app"],
      check(sys) {
        const r = trial(this, sys, "./prune-logs.sh");
        if (r.err) return bad("from ~", firstLine(r.err));
        if (r.fs.get("/var/log/app/old.log")) return bad("/var/log/app", "old.log still there");
        if (!r.fs.get("/var/log/app/new.log") || !r.fs.get(`${H}/build.log`)) return bad("prune-logs.sh", "deleted the wrong files");
        return ok("prune-logs.sh", "removes only old logs");
      }
    },

    // --- Text processing -----------------------------------------------------------------
    {
      id: "sedslash",
      title: "unknown option to `s'",
      level: "07",
      story: "The provisioning script sets the web root in the nginx config. It fails on every new server with a sed error.",
      goal: "Make setroot.sh write root /srv/www/shop; into site.conf.",
      done: "The config has the new root.",
      file: `${H}/setroot.sh`,
      files: {
        [`${H}/setroot.sh`]: `#!/usr/bin/env bash\nNEW_ROOT=/srv/www/shop\nsed -i "s/__ROOT__/$NEW_ROOT/" site.conf\ngrep root site.conf\n`,
        [`${H}/site.conf`]: "server {\n    listen 80;\n    root __ROOT__;\n}\n"
      },
      hints: [
        "Run ./setroot.sh. What does sed say, and at which character?",
        "After expansion the command is s/__ROOT__//srv/www/shop/: the slashes in the path end the s command early.",
        "Use another delimiter that is not in the path: sed -i \"s|__ROOT__|$NEW_ROOT|\" site.conf."
      ],
      lesson: "sed's s command can use any delimiter. Pick one that cannot appear in the values: s|a|b| or s#a#b#.",
      tries: ["./setroot.sh", "cat site.conf"],
      check(sys) {
        const r = trial(this, sys, "./setroot.sh");
        return /root \/srv\/www\/shop;/.test(r.text(`${H}/site.conf`)) ? ok("site.conf", "root /srv/www/shop;") : verdict("./setroot.sh", r, false, "root not set");
      }
    },
    {
      id: "uniqsort",
      title: "uniq without sort",
      level: "07",
      story: "The top-talkers report says 10.0.0.7 sent 1 request. The firewall team can see it sent five.",
      goal: "Make top-ips.sh print the right count for each IP, busiest first.",
      done: "Counts are correct.",
      file: `${H}/top-ips.sh`,
      files: {
        [`${H}/top-ips.sh`]: `#!/usr/bin/env bash\ncut -d' ' -f1 /var/log/nginx/access.log | uniq -c | sort -rn | head -3\n`,
        "/var/log/nginx/access.log": ["10.0.0.7", "10.0.0.7", "10.0.0.2", "10.0.0.7", "10.0.0.9", "10.0.0.7", "10.0.0.2", "10.0.0.7"].map((ip, k) => `${ip} - - [30/Oct/2026:02:5${k}:00 +0000] "GET /cart HTTP/1.1" 200 512`).join("\n") + "\n"
      },
      hints: [
        "Run ./top-ips.sh. Why does 10.0.0.7 appear more than once?",
        "uniq only merges identical lines that are next to each other.",
        "Sort before counting: cut -d' ' -f1 access.log | sort | uniq -c | sort -rn | head -3."
      ],
      lesson: "sort | uniq -c | sort -rn is the counting idiom: uniq needs its input sorted.",
      tries: ["./top-ips.sh", "head -3 /var/log/nginx/access.log"],
      check(sys) {
        const r = trial(this, sys, "./top-ips.sh");
        const got = r.out.trim().split("\n").map((l) => l.trim().replace(/\s+/g, " "));
        return got.join("|") === "5 10.0.0.7|2 10.0.0.2|1 10.0.0.9" ? ok("./top-ips.sh", "5, 2, 1") : bad("./top-ips.sh", got.slice(0, 3).join(", ") || "no output");
      }
    },
    {
      id: "grepdot",
      title: "grep matches too much",
      level: "07",
      story: "The abuse script blocked 10.0.0.15 and 10.0.0.150, two office printers, when you asked it to count 10.0.0.1.",
      goal: "Make count-ip.sh count only requests from exactly 10.0.0.1.",
      done: "Only the exact address is counted.",
      file: `${H}/count-ip.sh`,
      files: {
        [`${H}/count-ip.sh`]: `#!/usr/bin/env bash\nIP=10.0.0.1\necho "$IP made $(grep -c "$IP" /var/log/nginx/access.log) requests"\n`,
        "/var/log/nginx/access.log": ["10.0.0.1", "10.0.0.15", "10.0.0.150", "10.0.0.1", "10.0.0.2", "10.0.0.1"].map((ip) => `${ip} - - [30/Oct/2026:03:00:00 +0000] "GET / HTTP/1.1" 200 64`).join("\n") + "\n"
      },
      hints: [
        "Run ./count-ip.sh, then grep \"10.0.0.1\" /var/log/nginx/access.log.",
        "In a regex . matches any character, and nothing stops the match at the end of the address: 10.0.0.15 contains 10.0.0.1.",
        "Match the fixed string as a whole word: grep -cFw \"$IP\" (or anchor it: grep -c \"^$IP \")."
      ],
      lesson: "grep patterns are regexes: . matches anything and matches can be partial. -F takes the text literally, -w matches whole words.",
      tries: ["./count-ip.sh", "grep 10.0.0.1 /var/log/nginx/access.log"],
      check(sys) {
        const r = trial(this, sys, "./count-ip.sh");
        return verdict("./count-ip.sh", r, /10\.0\.0\.1 made 3 requests/.test(r.out), "counts 3");
      }
    },
    {
      id: "cutspaces",
      title: "cut and aligned columns",
      level: "07",
      story: "The capacity email should show how full each disk is. The Use% column comes out blank.",
      goal: "Make capacity.sh print each mount with its Use%.",
      done: "Columns are read correctly.",
      file: `${H}/capacity.sh`,
      files: { [`${H}/capacity.sh`]: `#!/usr/bin/env bash\ndf -P | tail -n +2 | while read -r line; do\n  mount=$(echo "$line" | cut -d' ' -f6)\n  used=$(echo "$line" | cut -d' ' -f5)\n  echo "$mount $used"\ndone\n` },
      disks: [["/dev/sda1", 41152736, 30864552, "/"], ["/dev/sdb1", 524032000, 99566080, "/srv"]],
      hints: [
        "Run df -P, then ./capacity.sh. How many spaces separate the columns?",
        "cut -d' ' treats every single space as a separator, so runs of spaces make empty fields.",
        "Let awk split on runs of blanks: df -P | awk 'NR > 1 {print $6, $5}'."
      ],
      lesson: "cut splits on each delimiter character. For columns padded with spaces, use awk (or read with IFS).",
      tries: ["df -P", "./capacity.sh"],
      check(sys) {
        const r = trial(this, sys, "./capacity.sh");
        return r.out === "/ 75%\n/srv 19%\n" ? ok("./capacity.sh", "/ 75%, /srv 19%") : bad("./capacity.sh", firstLine(r.out.replace(/^\s*\n/gm, "")) || "blank columns");
      }
    },
    {
      id: "grepset",
      title: "A clean day kills the script",
      level: "10",
      story: "The daily error summary works on bad days. On good days nobody gets an email at all, and cron shows exit status 1.",
      goal: "Make summary.sh print \"0 errors today\" on a clean day, and the right count otherwise.",
      done: "Zero is a valid answer.",
      file: `${H}/summary.sh`,
      files: {
        [`${H}/summary.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\nerrors=$(grep -c ERROR /var/log/app.log)\necho "$errors errors today"\n`,
        "/var/log/app.log": "03:00:01 INFO started\n03:10:44 INFO healthy\n"
      },
      hints: [
        "Run ./summary.sh; echo $?. Then grep -c ERROR /var/log/app.log; echo $?.",
        "grep exits 1 when nothing matches, even with -c printing 0. The assignment carries that status and set -e ends the script.",
        "Allow that one status: errors=$(grep -c ERROR /var/log/app.log || true). 2>/dev/null does not change the exit status."
      ],
      lesson: "grep's exit status 1 means no match, not an error. Under set -e, add || true where no match is fine.",
      tries: ["./summary.sh", "grep -c ERROR /var/log/app.log; echo $?"],
      check(sys) {
        const clean = trial(this, sys, "./summary.sh");
        const bad3 = trial(this, sys, "./summary.sh", { setup: (t) => t.fs.write("/var/log/app.log", "ERROR a\nERROR b\nINFO c\nERROR d\n") });
        if (clean.status || !/^0 errors today$/m.test(clean.out)) return verdict("clean day", clean, false, clean.out ? `prints ${firstLine(clean.out)}` : "no summary");
        if (!/^3 errors today$/m.test(bad3.out)) return bad("3 errors", firstLine(bad3.out) || "no summary");
        return ok("summary.sh", "works on good and bad days");
      }
    },
    {
      id: "crlfdata",
      title: "A Windows file breaks a comparison",
      level: "07",
      story: "Ops edits maintenance.txt on a laptop. It says off, yet deploy.sh refuses to deploy: we are in maintenance.",
      goal: "Make deploy.sh deploy when maintenance.txt says off.",
      done: "The flag is read correctly.",
      file: `${H}/deploy.sh`,
      files: {
        [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nmode=$(cat maintenance.txt)\nif [ "$mode" != "off" ]; then\n  echo "Refusing: we are in maintenance ($mode)"\n  exit 1\nfi\necho "Deploying"\n`,
        [`${H}/maintenance.txt`]: "off\r\n"
      },
      hints: [
        "Run ./deploy.sh, then cat -A maintenance.txt. What is the ^M?",
        "The file has Windows line endings: \"off\\r\". The carriage return is invisible but it makes the strings differ.",
        "Strip it where you read the file: mode=$(tr -d '\\r' < maintenance.txt). The file will be edited on a laptop again, so fix the script."
      ],
      lesson: "Files from Windows end lines with \\r\\n. cat -A shows ^M; tr -d '\\r' removes it.",
      tries: ["./deploy.sh", "cat -A maintenance.txt", "file maintenance.txt"],
      check(sys) {
        const off = trial(this, sys, "./deploy.sh");
        const on = trial(this, sys, "./deploy.sh", { setup: (t) => t.fs.write(`${H}/maintenance.txt`, "on\r\n") });
        if (!/^Deploying$/m.test(off.out)) return verdict("maintenance off", off, false, "refuses");
        if (/^Deploying$/m.test(on.out)) return bad("maintenance on", "deploys anyway");
        return ok("deploy.sh", "reads the flag");
      }
    },
    {
      id: "slowloop",
      title: "A loop that takes all night",
      level: "16",
      story: "The status-code report over yesterday's access log has started to overrun its cron slot. It runs a few commands for every line.",
      goal: "Make codes.sh print the count of each status code in one pass, without a command per line.",
      done: "One pass over the log.",
      file: `${H}/codes.sh`,
      files: {
        [`${H}/codes.sh`]: `#!/usr/bin/env bash\nok=0; err=0\nwhile read -r line; do\n  code=$(echo "$line" | cut -d' ' -f9)\n  if [ "$code" -ge 500 ]; then err=$((err + 1)); else ok=$((ok + 1)); fi\ndone < /var/log/nginx/access.log\necho "ok=$ok err=$err"\n`,
        "/var/log/nginx/access.log": Array.from({ length: 4000 }, (_, k) => `10.0.${k % 7}.${k % 200} - - [29/Oct/2026:10:00:00 +0000] "GET /p/${k} HTTP/1.1" ${k % 40 === 0 ? 503 : 200} 128`).join("\n") + "\n"
      },
      hints: [
        "Run ./codes.sh. The playground stops scripts after 40000 commands; every line here costs a subshell, echo, cut and a test.",
        "Starting processes per line is what makes shell loops slow. A single awk reads the whole file once.",
        "Let awk count: awk '$9 >= 500 {err++; next} {ok++} END {print \"ok=\" ok \" err=\" err}' /var/log/nginx/access.log"
      ],
      lesson: "Loops over big files should not start a process per line. awk, grep -c, sort | uniq -c do the work in one pass.",
      tries: ["./codes.sh", "wc -l /var/log/nginx/access.log"],
      check(sys) {
        const r = trial(this, sys, "./codes.sh");
        if (/stopped after/.test(r.err)) return bad("./codes.sh", "too slow: stopped after 40000 commands");
        return verdict("./codes.sh", r, /^ok=3900 err=100$/m.test(r.out) && r.sys.steps < 2000, r.sys.steps >= 2000 ? `still ${r.sys.steps} commands` : "one pass");
      }
    },

    // --- Functions and structure ---------------------------------------------------------
    {
      id: "funcreturn",
      title: "return: numeric argument required",
      level: "08",
      story: "A helper function is meant to tell the deploy which environment it is on. Every deploy goes to an empty environment.",
      goal: "Make deploy.sh print Deploying to production.",
      done: "The function hands back its answer.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nenv_name() {\n  return "production"\n}\nenv_name\nENV=$?\necho "Deploying to $ENV"\n` },
      hints: [
        "Run ./deploy.sh and read the error about return.",
        "return sets an exit status, a number from 0 to 255. Functions hand back text by printing it.",
        "Print it and capture it: env_name() { echo \"production\"; } and ENV=$(env_name)."
      ],
      lesson: "Functions return a status with return and data with echo or printf, captured with $(...).",
      tries: ["./deploy.sh"],
      check(sys) {
        const r = trial(this, sys, "./deploy.sh");
        return verdict("./deploy.sh", r, /^Deploying to production$/m.test(r.out) && !r.err, "prints production");
      }
    },
    {
      id: "getopts",
      title: "Options are ignored",
      level: "09",
      story: "./deploy.sh -e staging -v v1.4.3 deployed v1.4.3 to production, quietly. Someone is not happy.",
      goal: "Make ./deploy.sh -e staging -v v1.4.3 print: Deploying v1.4.3 to staging (verbose)",
      done: "Options and the version are read.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nenv=production\nverbose=""\nwhile getopts "ve" opt; do\n  case $opt in\n    v) verbose=" (verbose)" ;;\n    e) env=$OPTARG ;;\n    *) echo "usage: deploy.sh [-v] [-e ENV] VERSION" >&2; exit 2 ;;\n  esac\ndone\nversion=$1\necho "Deploying $version to $env$verbose"\n` },
      hints: [
        "Run ./deploy.sh -e staging -v v1.4.3. Which parts were lost?",
        "An option that takes a value needs a colon after it in the optstring: e: . Without it, OPTARG is empty and getopts stops at staging.",
        "Use getopts \"ve:\" and, after the loop, shift $((OPTIND - 1)) so $1 is the version."
      ],
      lesson: "getopts \"ve:\": a colon after a letter means it takes a value in $OPTARG. After the loop, shift $((OPTIND - 1)) leaves only the operands.",
      tries: ["./deploy.sh -e staging -v v1.4.3", "./deploy.sh -x"],
      check(sys) {
        const r = trial(this, sys, "./deploy.sh -e staging -v v1.4.3");
        const plain = trial(this, sys, "./deploy.sh v2.0.0");
        if (!/^Deploying v1\.4\.3 to staging \(verbose\)$/m.test(r.out)) return bad("-e staging -v v1.4.3", firstLine(r.out) || firstLine(r.err));
        if (!/^Deploying v2\.0\.0 to production$/m.test(plain.out)) return bad("v2.0.0", firstLine(plain.out) || firstLine(plain.err));
        return ok("deploy.sh", "reads options and the version");
      }
    },
    {
      id: "nolocal",
      title: "A function changes the caller's counter",
      level: "08",
      story: "The upload job should send three files with retries. It sends one and says it is done.",
      goal: "Make upload.sh upload all three files.",
      done: "Every file is uploaded.",
      file: `${H}/upload.sh`,
      files: { [`${H}/upload.sh`]: `#!/usr/bin/env bash\nfiles=(a.csv b.csv c.csv)\n\n# The storage API takes two attempts on a cold start.\nupload() {\n  for i in 1 2 3; do\n    echo "  uploading $1 (attempt $i)"\n    [ "$i" -ge 2 ] && return 0\n  done\n  return 1\n}\n\ni=0\nwhile [ $i -lt \${#files[@]} ]; do\n  upload "\${files[$i]}"\n  i=$((i + 1))\ndone\necho "done"\n` },
      hints: [
        "Run ./upload.sh. Only a.csv goes out. Follow the value of i.",
        "Variables in bash functions are global unless declared local, so upload() changes the caller's i.",
        "Add local i at the top of upload() (and use local for every variable a function owns)."
      ],
      lesson: "Without local, a function's variables are the caller's variables. Declare them local.",
      tries: ["./upload.sh"],
      check(sys) {
        const r = trial(this, sys, "./upload.sh");
        const n = ["a.csv", "b.csv", "c.csv"].filter((f) => r.out.includes(`uploading ${f}`)).length;
        return n === 3 ? ok("./upload.sh", "uploads 3 files") : bad("./upload.sh", `uploads ${n} of 3 files`);
      }
    },
    {
      id: "sourcepath",
      title: "source finds nothing from cron",
      level: "12",
      story: "report.sh in /opt/tools works when you cd there first. From cron it says No such file or directory, then log: command not found.",
      goal: "Make /opt/tools/report.sh work from any directory.",
      done: "The library is found from anywhere.",
      file: "/opt/tools/report.sh",
      files: {
        "/opt/tools/report.sh": `#!/usr/bin/env bash\nsource ./lib/common.sh\nlog "report started"\nlog "orders today: 1204"\n`,
        "/opt/tools/lib/common.sh": `log() { printf '%s %s\\n' "$(date +%T)" "$*"; }\n`
      },
      cwd: H,
      hints: [
        "Run /opt/tools/report.sh from your home directory. Then cd /opt/tools && ./report.sh.",
        "./lib/common.sh is relative to the current directory, not to the script. Cron starts jobs in the home directory.",
        "Build the path from the script's own location: source \"$(dirname \"${BASH_SOURCE[0]}\")/lib/common.sh\"."
      ],
      lesson: "Relative paths follow the current directory. Find files next to the script with $(dirname \"${BASH_SOURCE[0]}\").",
      tries: ["/opt/tools/report.sh", "cd /opt/tools && ./report.sh"],
      check(sys) {
        const r = trial(this, sys, "/opt/tools/report.sh");
        return verdict("from ~", r, r.status === 0 && /orders today: 1204/.test(r.out) && !r.err, "finds lib/common.sh");
      }
    },
    {
      id: "exitpipe",
      title: "exit in a piped loop",
      level: "06",
      story: "The config validator found a bad line and printed invalid, then the deploy went ahead anyway.",
      goal: "Make validate.sh stop with a non-zero status, before deploying, when the config has a bad line.",
      done: "A bad config stops the deploy.",
      file: `${H}/validate.sh`,
      files: {
        [`${H}/validate.sh`]: `#!/usr/bin/env bash\ncat app.conf | while IFS='=' read -r key value; do\n  if [ -z "$value" ]; then\n    echo "invalid line: $key"\n    exit 1\n  fi\ndone\necho "config OK, deploying"\n`,
        [`${H}/app.conf`]: "port=8080\nworkers=\nlog_level=info\n"
      },
      hints: [
        "Run ./validate.sh; echo $?.",
        "The while loop is part of a pipeline, so it runs in a subshell. exit 1 ends that subshell, not the script.",
        "Read the file without a pipe: while ...; done < app.conf. Then exit 1 ends the script."
      ],
      lesson: "exit inside a piped loop only leaves the subshell. Redirect into the loop instead of piping.",
      tries: ["./validate.sh", "echo $?"],
      check(sys) {
        const badConf = trial(this, sys, "./validate.sh");
        const good = trial(this, sys, "./validate.sh", { setup: (t) => t.fs.write(`${H}/app.conf`, "port=8080\nworkers=4\n") });
        if (/deploying/.test(badConf.out) || badConf.status === 0) return bad("bad config", "deploys anyway");
        if (!/deploying/.test(good.out)) return bad("good config", "does not deploy");
        return ok("validate.sh", "stops on a bad line");
      }
    },

    // --- Safety -----------------------------------------------------------------------
    {
      id: "rmempty",
      title: "rm -rf with an empty variable",
      level: "13",
      story: "The staging cleanup ran from cron last night. This morning the shop's files in /srv and your home directory are gone.",
      goal: "Make clean-staging.sh refuse to run when STAGING_DIR is not set, and clean it when it is.",
      done: "No variable, no rm.",
      file: `${H}/clean-staging.sh`,
      files: {
        [`${H}/clean-staging.sh`]: `#!/usr/bin/env bash\n# STAGING_DIR is exported in ~/.bashrc\nrm -rf "$STAGING_DIR"/*\necho "staging cleaned"\n`,
        [`${H}/.bashrc`]: "export STAGING_DIR=/srv/staging\n",
        "/srv/staging/build-41/app.js": "x", "/srv/staging/build-42/app.js": "y", "/srv/shop/index.html": "<h1>shop</h1>\n"
      },
      env: { STAGING_DIR: "/srv/staging" },
      crontab: "0 4 * * * /home/dev/clean-staging.sh\n",
      hints: [
        "It works from your terminal. Run it the way cron does: env -i PATH=/usr/bin:/bin HOME=/home/dev ./clean-staging.sh, then ls /srv and ls ~. (This is a playground.)",
        "Cron does not read ~/.bashrc, so STAGING_DIR is empty and \"$STAGING_DIR\"/* becomes /*. The quotes are already there; they do not help.",
        "Make an empty value fatal: rm -rf \"${STAGING_DIR:?STAGING_DIR is not set}\"/* (set -u also catches an unset one)."
      ],
      lesson: "Guard every rm -rf with a variable: \"${DIR:?}\" stops the script if DIR is empty or unset.",
      tries: ["./clean-staging.sh", "env -i PATH=/usr/bin:/bin HOME=/home/dev ./clean-staging.sh", "ls /srv"],
      check(sys) {
        const cronRun = trial(this, sys, cron(`${H}/clean-staging.sh`));
        if (!cronRun.fs.get("/srv/shop/index.html") || !cronRun.fs.get(`${H}/.bashrc`)) return bad("from cron", "deleted everything it could under /");
        if (cronRun.status === 0) return bad("from cron", "reports success without STAGING_DIR");
        const term = trial(this, sys, "./clean-staging.sh");
        if (term.fs.list("/srv/staging").length) return bad("with STAGING_DIR", "staging not cleaned");
        return ok("clean-staging.sh", "refuses without STAGING_DIR");
      }
    },
    {
      id: "logrotate",
      title: "Log cleanup deletes the wrong files",
      level: "13",
      story: "The log rotation job removed old files from /home/dev, including the audit log you were asked to keep. /var/log/myapp keeps growing.",
      goal: "Make rotate.sh delete only .log files older than 7 days in /var/log/myapp.",
      done: "Only old app logs are deleted.",
      file: `${H}/rotate.sh`,
      files: {
        [`${H}/rotate.sh`]: `#!/usr/bin/env bash\nLOGDIR=/var/log/myapp\nfind $LOG_DIR -name '*.log' -mtime +7 -delete\necho "rotated $LOGDIR"\n`,
        [`${H}/audit-2026-q3.log`]: { text: "keep for compliance\n", mtime: EPOCH - 40 * DAY },
        "/var/log/myapp/app-2026-10-01.log": { text: "old\n", mtime: EPOCH - 29 * DAY },
        "/var/log/myapp/app-2026-10-29.log": { text: "new\n", mtime: EPOCH - DAY }
      },
      hints: [
        "Read rotate.sh carefully. Which variable is set, and which one is used?",
        "$LOG_DIR is empty, so find gets no path and searches the current directory: under cron, your home.",
        "Use the right name, and make mistakes fatal: set -u, and find \"${LOGDIR:?}\" -name '*.log' -mtime +7 -delete."
      ],
      lesson: "A typo in a variable name expands to nothing. set -u and \"${VAR:?}\" turn that into an error instead of a search of the wrong directory.",
      tries: ["cat rotate.sh", "ls -l /var/log/myapp", "find /var/log/myapp -name '*.log' -mtime +7"],
      check(sys) {
        const r = trial(this, sys, "./rotate.sh");
        if (!r.fs.get(`${H}/audit-2026-q3.log`)) return bad("home directory", "audit log deleted");
        if (r.fs.get("/var/log/myapp/app-2026-10-01.log")) return bad("/var/log/myapp", "old log still there");
        if (!r.fs.get("/var/log/myapp/app-2026-10-29.log")) return bad("/var/log/myapp", "new log deleted");
        return ok("rotate.sh", "deletes only old app logs");
      }
    },
    {
      id: "lockfile",
      title: "Two runs at once",
      level: "14",
      story: "sync.sh runs every minute and sometimes takes three. Overlapping runs corrupted the mirror twice this week. One is running right now (see ps aux).",
      goal: "Make sync.sh exit without syncing while another run holds the lock, and sync when none does.",
      done: "Only one run at a time.",
      file: `${H}/sync.sh`,
      files: {
        [`${H}/sync.sh`]: `#!/usr/bin/env bash\n# Runs every minute from cron.\necho "syncing mirror"\necho "synced at $(date +%T)" >> /srv/mirror/sync.log\n`,
        "/srv/mirror/sync.log": "", "/var/lock/sync.lock": ""
      },
      procs: [{ pid: 3120, cmd: "/bin/bash /home/dev/sync.sh", user: "dev" }],
      locks: ["/var/lock/sync.lock"],
      hints: [
        "ps aux shows a sync.sh already running. It holds an flock on /var/lock/sync.lock.",
        "Checking whether the lock file exists does not work: the file stays there between runs. Ask for the lock itself.",
        "At the top: exec 9>/var/lock/sync.lock; flock -n 9 || { echo \"already running\"; exit 0; }. The lock goes away when the script exits."
      ],
      lesson: "flock -n gives you a lock or fails at once, and the kernel releases it when the process ends, even after a crash. Lock files you test with [ -e ] go stale.",
      tries: ["ps aux", "./sync.sh", "cat /srv/mirror/sync.log"],
      check(sys) {
        const busy = trial(this, sys, "./sync.sh");
        const free = trial(this, sys, "./sync.sh", { spec: { locks: [], procs: [] } });
        if (busy.text("/srv/mirror/sync.log")) return bad("while another run holds the lock", "synced anyway");
        if (!free.text("/srv/mirror/sync.log")) return bad("with no other run", "did not sync");
        return ok("sync.sh", "one run at a time");
      }
    },
    {
      id: "retry",
      title: "Retry with backoff",
      level: "14",
      story: "Deploys fail a few times a day: the artifact store answers 503 for a few seconds during its own deploys.",
      goal: "Make fetch.sh retry the download, waiting longer each time, and give up after a few attempts.",
      done: "Brief outages no longer fail the deploy.",
      file: `${H}/fetch.sh`,
      files: { [`${H}/fetch.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\nURL=https://artifacts.internal/shop-1.4.2.tar.gz\ncurl -fsS -o shop.tar.gz "$URL"\necho "downloaded"\n` },
      net: { "https://artifacts.internal/shop-1.4.2.tar.gz": (sys, n) => (n <= 2 ? { status: 503, body: "" } : { status: 200, body: "TARSIM\n{}" }) },
      hints: [
        "Run ./fetch.sh a few times. The first two requests get 503.",
        "Retry in a loop, sleeping longer each time, and stop after a limit. Without a limit a real outage hangs the deploy; without a sleep you hammer the server.",
        "for n in 1 2 3 4 5; do curl -fsS -o shop.tar.gz \"$URL\" && break; [ $n -eq 5 ] && exit 1; sleep $((2 ** n)); done (or curl --retry 5, or this repository's scripts/retry.sh)."
      ],
      lesson: "Retry transient failures with a limit and growing waits. scripts/retry.sh in this repository does it with jitter as well.",
      tries: ["./fetch.sh", "curl -fsS https://artifacts.internal/shop-1.4.2.tar.gz"],
      check(sys) {
        const flaky = trial(this, sys, "./fetch.sh");
        const down = trial(this, sys, "./fetch.sh", { spec: { net: { "https://artifacts.internal/shop-1.4.2.tar.gz": { status: 503, body: "" } } } });
        if (flaky.status || !flaky.fs.get(`${H}/shop.tar.gz`)) return verdict("503 twice, then OK", flaky, false, "did not download");
        if (/stopped after/.test(down.err)) return bad("store down", "retries forever");
        if (down.status === 0) return bad("store down", "reports success");
        const waits = down.sys.slept;
        if (waits.length < 2) return bad("store down", "no waits between attempts");
        if (waits.some((w, k) => k && w < waits[k - 1]) || waits[waits.length - 1] <= waits[0]) return bad("store down", "waits do not grow");
        const tries = down.sys.netHits["https://artifacts.internal/shop-1.4.2.tar.gz"];
        if (tries > 10) return bad("store down", `${tries} attempts`);
        return ok("fetch.sh", `retries ${tries} times with growing waits`);
      }
    },
    {
      id: "secretleak",
      title: "A token in the CI log",
      level: "15",
      story: "Security found the production API token in a public CI log. The deploy step runs with set -x for debugging.",
      goal: "Keep the token out of the output while still calling the API.",
      done: "The token stays secret.",
      file: `${H}/notify-deploy.sh`,
      files: { [`${H}/notify-deploy.sh`]: `#!/usr/bin/env bash\nset -euxo pipefail\necho "Using token $API_TOKEN"\ncurl -fsS -H "Authorization: Bearer $API_TOKEN" https://api.internal/deploys\necho "notified"\n` },
      env: { API_TOKEN: "tok_live_4f9a1c2e7b" },
      net: { "https://api.internal/deploys": { status: 200, body: "{\"ok\":true}\n" } },
      hints: [
        "Run ./notify-deploy.sh and look for tok_live in the output, on both lines that start with + and the echo.",
        "set -x prints every command after expansion, secrets included. The echo prints it on purpose.",
        "Remove the echo and the x from set -euxo pipefail (or turn tracing off around the call with set +x). Do not print secrets, even shortened."
      ],
      lesson: "set -x and echo write secrets into logs. Never trace a script that handles secrets, and never print them.",
      tries: ["./notify-deploy.sh"],
      check(sys) {
        const r = trial(this, sys, "./notify-deploy.sh");
        if (r.all.includes("tok_live_4f9a1c2e7b")) return bad("output", "contains the token");
        if (!r.sys.netHits["https://api.internal/deploys"]) return bad("API", "not called");
        if (r.status) return verdict("./notify-deploy.sh", r, false);
        return ok("output", "no token, API called");
      }
    },
    {
      id: "evalinject",
      title: "eval runs what it is given",
      level: "15",
      story: "A support tool lists a customer's export folder. Someone passed it a folder name with a semicolon in it, and it ran their command.",
      goal: "Make inspect.sh list the folder it is given and never run text from its argument.",
      done: "Arguments stay data.",
      file: `${H}/inspect.sh`,
      files: {
        [`${H}/inspect.sh`]: `#!/usr/bin/env bash\nDIR=$1\neval "ls -l '$DIR'"\n`,
        "/srv/exports/acme/orders.csv": "id\n1\n"
      },
      hints: [
        "Try ./inspect.sh \"/srv/exports/acme'; touch /tmp/owned; echo '\" then ls /tmp.",
        "eval parses its text as code. The quotes inside it are part of that text, so an argument with its own quote ends them.",
        "Do not eval: ls -l -- \"$DIR\". Quoted expansions are never parsed as code."
      ],
      lesson: "eval turns data into code. Pass arguments in quoted variables instead; if you think you need eval, use an array.",
      tries: ["./inspect.sh /srv/exports/acme", "ls /tmp"],
      check(sys) {
        for (const arg of [`"/srv/exports/acme'; touch /tmp/owned; echo '"`, `'/srv/exports/acme$(touch /tmp/owned)'`]) {
          if (trial(this, sys, `./inspect.sh ${arg}`).fs.get("/tmp/owned")) return bad("hostile argument", "ran touch /tmp/owned");
        }
        const normal = trial(this, sys, "./inspect.sh /srv/exports/acme");
        if (!/orders\.csv/.test(normal.out)) return verdict("normal argument", normal, false, "does not list the folder");
        return ok("inspect.sh", "arguments stay data");
      }
    },

    // --- Cron and environment ---------------------------------------------------------
    {
      id: "cronpath",
      title: "Works in the terminal, not in cron",
      level: "12",
      story: "The backup works every time you run it. From cron it fails with backup-tool: command not found.",
      goal: "Make backup.sh work under cron's environment.",
      done: "The job finds its tools.",
      file: `${H}/backup.sh`,
      files: {
        [`${H}/backup.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\nbackup-tool --source /srv/shop --dest s3://backups/shop\necho "backup done"\n`,
        "/usr/local/bin/backup-tool": "#!/usr/bin/env bash\necho \"uploaded $2 to $4\"\n"
      },
      crontab: "30 2 * * * /home/dev/backup.sh\n",
      hints: [
        "Reproduce cron: env -i HOME=/home/dev PATH=/usr/bin:/bin ./backup.sh. Then which backup-tool in your terminal.",
        "Cron's PATH is only /usr/bin:/bin. backup-tool lives in /usr/local/bin, which your login shell adds.",
        "Set PATH at the top of the script (PATH=/usr/local/bin:/usr/bin:/bin) or call /usr/local/bin/backup-tool. Editing ~/.bashrc does not help: cron does not read it."
      ],
      lesson: "Cron runs jobs with PATH=/usr/bin:/bin and no profile. Scripts must set PATH or use full paths. Test with env -i.",
      tries: ["env -i HOME=/home/dev PATH=/usr/bin:/bin ./backup.sh", "which backup-tool", "crontab -l"],
      check(sys) {
        const r = trial(this, sys, cron(`${H}/backup.sh`));
        return verdict("under cron", r, r.status === 0 && /backup done/.test(r.out), "finds backup-tool");
      }
    },
    {
      id: "cronenv",
      title: "A variable from .bashrc",
      level: "12",
      story: "The report job connects to the database named in DB_HOST. From cron it tries to connect to an empty host name.",
      goal: "Make report.sh get DB_HOST under cron, from the app's env file.",
      done: "The job has its settings.",
      file: `${H}/report.sh`,
      files: {
        [`${H}/report.sh`]: `#!/usr/bin/env bash\nset -eo pipefail\necho "connecting to \${DB_HOST}"\ndb-report --host "$DB_HOST"\n`,
        [`${H}/.bashrc`]: "export DB_HOST=db.internal\n",
        "/etc/shop/report.env": "DB_HOST=db.internal\n"
      },
      env: { DB_HOST: "db.internal" },
      bins: { "db-report": (c) => { if (c.args[1] !== "db.internal") { c.err(`db-report: could not translate host name "${c.args[1] ?? ""}" to address: Name or service not known\n`); return 2; } c.out("orders: 1204\n"); return 0; } },
      crontab: "0 6 * * * /home/dev/report.sh\n",
      hints: [
        "Run it like cron: env -i HOME=/home/dev PATH=/usr/bin:/bin ./report.sh.",
        "DB_HOST comes from ~/.bashrc, which only interactive shells read. Cron's environment has almost nothing in it.",
        "Load the settings in the script, by absolute path: set -a; source /etc/shop/report.env; set +a (or DB_HOST=${DB_HOST:-db.internal})."
      ],
      lesson: "Scripts must load their own configuration. Do not depend on variables from your login shell.",
      tries: ["env -i HOME=/home/dev PATH=/usr/bin:/bin ./report.sh", "cat /etc/shop/report.env"],
      check(sys) {
        const r = trial(this, sys, cron(`${H}/report.sh`));
        return verdict("under cron", r, r.status === 0 && /orders: 1204/.test(r.out), "connects to db.internal");
      }
    },
    {
      id: "crlf",
      title: "cannot execute: required file not found",
      level: "12",
      story: "Someone fixed deploy.sh in an editor on Windows and pushed it. Now ./deploy.sh fails at once, though the file is right there.",
      goal: "Make ./deploy.sh run again.",
      done: "The line endings are Unix.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: { text: "#!/bin/bash\r\necho \"deploying shop\"\r\necho \"done\"\r\n", mode: 0o755 } },
      hints: [
        "Run ./deploy.sh, then cat -A deploy.sh. (Older bash prints bad interpreter: No such file or directory.)",
        "Every line ends in ^M, a carriage return. The kernel looks for an interpreter called /bin/bash followed by \\r, and there is none.",
        "Remove the carriage returns: sed -i 's/\\r$//' deploy.sh (or dos2unix deploy.sh). Add *.sh text eol=lf to .gitattributes so it does not come back."
      ],
      lesson: "CRLF line endings break the #! line. cat -A or file shows them; sed -i 's/\\r$//' or dos2unix removes them.",
      tries: ["./deploy.sh", "cat -A deploy.sh", "file deploy.sh"],
      check(sys) {
        const r = trial(this, sys, "./deploy.sh");
        return verdict("./deploy.sh", r, r.status === 0 && r.out === "deploying shop\ndone\n", "runs");
      }
    },
    {
      id: "noshebang",
      title: "[[: not found",
      level: "12",
      story: "report.sh works when you run it. Cron's mail says: /home/dev/report.sh: 3: [[: not found.",
      goal: "Make report.sh run correctly the way cron starts it.",
      done: "The script says which shell it needs.",
      file: `${H}/report.sh`,
      files: { [`${H}/report.sh`]: { text: `# Daily report\nday=$(date +%a)\nif [[ $day == Fri ]]; then\n  echo "weekly summary"\nfi\necho "daily report for $day"\n`, mode: 0o755 } },
      crontab: "0 7 * * * /home/dev/report.sh\n",
      hints: [
        "Run it as cron does: sh -c /home/dev/report.sh. Compare with ./report.sh from bash.",
        "There is no #! line. bash runs such a file with bash, but cron's /bin/sh (dash) runs it with sh, which has no [[.",
        "Make the first line #!/usr/bin/env bash (or #!/bin/bash)."
      ],
      lesson: "Start every script with a #! line. Without one, the calling shell decides, and /bin/sh is often dash.",
      tries: ["sh -c /home/dev/report.sh", "./report.sh", "head -1 report.sh"],
      check(sys) {
        const r = trial(this, sys, cron(`${H}/report.sh`));
        return verdict("under cron", r, r.status === 0 && /weekly summary/.test(r.out) && !r.err, "runs in bash");
      }
    },
    {
      id: "export",
      title: "A child script sees nothing",
      level: "12",
      story: "release.sh sets DEPLOY_ENV and calls migrate.sh. migrate.sh insists DEPLOY_ENV is not set.",
      goal: "Make ./release.sh run the migration for staging.",
      done: "The child process gets the variable.",
      file: `${H}/release.sh`,
      editable: [`${H}/release.sh`],
      files: {
        [`${H}/release.sh`]: `#!/usr/bin/env bash\nDEPLOY_ENV=staging\n./migrate.sh\n`,
        [`${H}/migrate.sh`]: `#!/usr/bin/env bash\n: "\${DEPLOY_ENV:?DEPLOY_ENV is not set}"\necho "migrating $DEPLOY_ENV database"\n`
      },
      hints: [
        "Run ./release.sh. migrate.sh is a separate process; what does it receive?",
        "Plain variables stay inside the shell that set them. Only exported variables go into the environment of programs it starts.",
        "export DEPLOY_ENV=staging (or DEPLOY_ENV=staging ./migrate.sh for that one command)."
      ],
      lesson: "A child process sees only exported variables. export VAR, or put VAR=value before the command.",
      tries: ["./release.sh", "./migrate.sh"],
      check(sys) {
        const r = trial(this, sys, "./release.sh");
        return verdict("./release.sh", r, r.status === 0 && /migrating staging database/.test(r.out), "migrates staging");
      }
    },
    {
      id: "sudoredirect",
      title: "sudo and a redirect",
      level: "15",
      story: "setup.sh tunes the kernel on new servers. It runs as the deploy user, who has sudo, and stops with Permission denied although the line starts with sudo.",
      goal: "Make ./setup.sh write vm.swappiness=10 into /etc/sysctl.d/99-shop.conf.",
      done: "The privileged write works.",
      file: `${H}/setup.sh`,
      files: { [`${H}/setup.sh`]: `#!/usr/bin/env bash\nset -euo pipefail\nsudo echo "vm.swappiness=10" > /etc/sysctl.d/99-shop.conf\necho "tuned"\n` },
      dirs: ["/etc/sysctl.d"],
      hints: [
        "Run ./setup.sh. Who opens /etc/sysctl.d/99-shop.conf for writing: echo, sudo or your shell?",
        "Your shell sets up the > redirection before it runs sudo, as your own user. sudo only raises echo, which needs no privileges.",
        "Let a root process open the file: echo \"vm.swappiness=10\" | sudo tee /etc/sysctl.d/99-shop.conf > /dev/null."
      ],
      lesson: "Redirections belong to the shell that runs the command, not to sudo. Use sudo tee (tee -a to append) to write root-owned files.",
      tries: ["./setup.sh", "ls -l /etc/sysctl.d"],
      check(sys) {
        const r = trial(this, sys, "./setup.sh");
        return r.text("/etc/sysctl.d/99-shop.conf") === "vm.swappiness=10\n" && r.status === 0 ? ok("/etc/sysctl.d/99-shop.conf", "written") : verdict("./setup.sh", r, false);
      }
    },
    {
      id: "octal",
      title: "value too great for base",
      level: "05",
      story: "The shift report turns login times into minutes since midnight. It works for the night shift and fails every morning.",
      goal: "Make shift.sh print the minutes for every login.",
      done: "Leading zeros are read as decimal.",
      file: `${H}/shift.sh`,
      files: {
        [`${H}/shift.sh`]: `#!/usr/bin/env bash\nwhile read -r time user; do\n  hour=\${time%%:*}\n  min=\${time##*:}\n  echo "$user $(( hour * 60 + min ))"\ndone < logins.txt\n`,
        [`${H}/logins.txt`]: "07:55 alice\n08:15 bob\n09:05 carol\n10:30 dave\n"
      },
      hints: [
        "Run ./shift.sh. Which time does it stop at, and what does the error say about base?",
        "In arithmetic a leading 0 means octal, where 8 and 9 are not digits. 07 works by luck; 08 and 09 fail.",
        "Force base 10: $(( 10#$hour * 60 + 10#$min ))."
      ],
      lesson: "Numbers with leading zeros (dates, times, months) are octal in $(( )). Prefix them with 10#.",
      tries: ["./shift.sh", "echo $(( 07 )) $(( 010 ))"],
      check(sys) {
        const r = trial(this, sys, "./shift.sh");
        return verdict("./shift.sh", r, r.out === "alice 475\nbob 495\ncarol 545\ndave 630\n", "all four logins");
      }
    },
    {
      id: "argstring",
      title: "Options kept in a string",
      level: "09",
      story: "The cache cleaner keeps its find options in a variable. It runs every night, says cache cleaned, and the disk keeps filling with .tmp files.",
      goal: "Make clean-cache.sh delete .tmp files older than a day in /srv/cache, and nothing else.",
      done: "The options reach find intact.",
      file: `${H}/clean-cache.sh`,
      files: {
        [`${H}/clean-cache.sh`]: `#!/usr/bin/env bash\nFIND_OPTS="-name '*.tmp' -mtime +1"\nfind /srv/cache $FIND_OPTS -delete\necho "cache cleaned"\n`,
        [`${H}/notes.tmp`]: "draft\n",
        "/srv/cache/a.tmp": { text: "a", mtime: EPOCH - 5 * DAY }, "/srv/cache/b.tmp": { text: "b", mtime: EPOCH - 3 * DAY },
        "/srv/cache/keep.dat": { text: "k", mtime: EPOCH - 5 * DAY }, "/srv/cache/new.tmp": { text: "n", mtime: EPOCH - 3600 }
      },
      hints: [
        "Run bash -x clean-cache.sh. Look at the -name argument find receives.",
        "Quotes inside a variable's value are just characters. After splitting, find looks for files literally named '*.tmp', quotes included.",
        "Keep arguments in an array: FIND_OPTS=(-name '*.tmp' -mtime +1) and find /srv/cache \"${FIND_OPTS[@]}\" -delete."
      ],
      lesson: "A string cannot hold a list of arguments with quoting. Use an array and expand it as \"${arr[@]}\".",
      tries: ["./clean-cache.sh", "bash -x clean-cache.sh", "ls -l /srv/cache"],
      check(sys) {
        const r = trial(this, sys, "./clean-cache.sh");
        const left = r.fs.list("/srv/cache").join(" ");
        return left === "keep.dat new.tmp" && r.fs.get(`${H}/notes.tmp`) ? ok("/srv/cache", left) : bad("/srv/cache", r.err ? firstLine(r.err) : `left: ${left || "nothing"}`);
      }
    },
    {
      id: "sshloop",
      title: "ssh eats the loop's input",
      level: "04",
      story: "uptime-all.sh should check every web server. It only ever reports on web-01.",
      goal: "Make uptime-all.sh report on all three hosts.",
      done: "Every host is checked.",
      file: `${H}/uptime-all.sh`,
      files: {
        [`${H}/uptime-all.sh`]: `#!/usr/bin/env bash\nwhile read -r host; do\n  echo "== $host"\n  ssh "$host" uptime\ndone < hosts.txt\n`,
        [`${H}/hosts.txt`]: "web-01\nweb-02\nweb-03\n"
      },
      bins: {
        ssh: (c) => {
          const args = c.args.filter((a) => a !== "-n" && a !== "-T");
          if (!c.args.includes("-n")) c.stdin(); // like ssh, read stdin to send it to the remote command
          c.out(`${args[0]}: 03:00:00 up 12 days,  load average: 0.08, 0.05, 0.01\n`);
          return 0;
        }
      },
      hints: [
        "Run ./uptime-all.sh. The loop stops after the first host, without an error.",
        "ssh reads its standard input to pass it to the remote command, and it shares the loop's input: it swallowed web-02 and web-03.",
        "Give ssh no input: ssh -n \"$host\" uptime (or ssh \"$host\" uptime < /dev/null)."
      ],
      lesson: "Commands inside a while read loop share its input. ssh, ffmpeg and others read it; use ssh -n or < /dev/null.",
      tries: ["./uptime-all.sh"],
      check(sys) {
        const r = trial(this, sys, "./uptime-all.sh");
        const n = ["web-01", "web-02", "web-03"].filter((x) => r.out.includes(`${x}: 03:00:00 up`)).length;
        return n === 3 ? ok("./uptime-all.sh", "checks 3 hosts") : bad("./uptime-all.sh", `checks ${n} of 3 hosts`);
      }
    },
    {
      id: "curlfail",
      title: "curl says success on a 500",
      level: "14",
      story: "The shop answered every request with 500 for an hour. The health check said healthy all along.",
      goal: "Make check.sh print ALERT when the shop returns an HTTP error, and healthy when it returns 200.",
      done: "HTTP errors count as failures.",
      file: `${H}/check.sh`,
      files: { [`${H}/check.sh`]: `#!/usr/bin/env bash\nif curl -s -o /dev/null http://localhost:8080/health; then\n  echo "healthy"\nelse\n  echo "ALERT: shop is down"\nfi\n` },
      net: { "http://localhost:8080/health": { status: 500, body: "<h1>Internal Server Error</h1>" } },
      hints: [
        "Run curl -s -o /dev/null http://localhost:8080/health; echo $?. Then the same with -w '%{http_code}'.",
        "curl's exit status says whether the transfer worked, not whether the server was happy. A 500 page downloads fine.",
        "Add -f (--fail): curl -fsS -o /dev/null ... exits 22 on HTTP errors."
      ],
      lesson: "Always use curl -f in scripts: without it, error pages count as success.",
      tries: ["./check.sh", "curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:8080/health"],
      check(sys) {
        const err = trial(this, sys, "./check.sh");
        const down = trial(this, sys, "./check.sh", { spec: { net: { "http://localhost:8080/health": "refused" } } });
        const up = trial(this, sys, "./check.sh", { spec: { net: { "http://localhost:8080/health": { status: 200, body: "ok" } } } });
        if (!/ALERT/.test(err.out)) return bad("HTTP 500", "says healthy");
        if (!/ALERT/.test(down.out)) return bad("connection refused", "says healthy");
        if (!/^healthy$/m.test(up.out)) return bad("HTTP 200", "does not say healthy");
        return ok("check.sh", "alerts on HTTP errors");
      }
    },
    {
      id: "ntest",
      title: "[ -n $var ] is always true",
      level: "02",
      story: "deploy.sh checks that API_KEY is set before deploying. Last night it deployed without one and every request failed.",
      goal: "Make deploy.sh refuse to deploy when API_KEY is empty, and deploy when it is set.",
      done: "The guard works.",
      file: `${H}/deploy.sh`,
      files: { [`${H}/deploy.sh`]: `#!/usr/bin/env bash\nif [ -n $API_KEY ]; then\n  echo "deploying"\n  deploy-tool\nelse\n  echo "API_KEY is not set" >&2\n  exit 1\nfi\n` },
      bins: { "deploy-tool": (c) => { c.fs.write("/var/tmp/deployed", (c.env.API_KEY || "") + "\n"); c.out("deployed\n"); return 0; } },
      hints: [
        "Run ./deploy.sh with no API_KEY, then bash -x deploy.sh to see the test bash ran.",
        "With API_KEY empty and unquoted, the test is [ -n ]: one argument, a non-empty string, so it is true.",
        "Quote it: [ -n \"$API_KEY\" ], or use [[ -n $API_KEY ]], or guard with : \"${API_KEY:?}\"."
      ],
      lesson: "[ -n $var ] with an empty var becomes [ -n ], which is true. Quote variables in [ ] or use [[ ]].",
      tries: ["./deploy.sh", "bash -x deploy.sh", "API_KEY=k-123 ./deploy.sh"],
      check(sys) {
        const none = trial(this, sys, "./deploy.sh");
        const set = trial(this, sys, "API_KEY=k-123 ./deploy.sh");
        if (none.fs.get("/var/tmp/deployed") || none.status === 0) return bad("API_KEY empty", "deploys anyway");
        if ((set.text("/var/tmp/deployed") || "") !== "k-123\n") return bad("API_KEY set", "does not deploy");
        return ok("deploy.sh", "refuses without a key");
      }
    }
  ];

  // Easiest first, then by what goes wrong.
  const GROUPS = [
    ["Basics", ["noexec", "typo", "assign", "singlequotes", "math"]],
    ["Quoting and expansion", ["spaces", "emptytest", "ntest", "globvar", "heredoc", "nounset", "dollarstar", "argstring"]],
    ["Exit codes and errors", ["statusover", "testcmd", "intcompare", "octal", "curlfail", "pipefail", "cdfail", "localmask", "arithexit", "trap"]],
    ["Loops and files", ["forls", "lastline", "pipesub", "sshloop", "nomatch", "extension", "findglob"]],
    ["Text processing", ["sedslash", "uniqsort", "grepdot", "cutspaces", "grepset", "crlfdata", "slowloop"]],
    ["Functions and structure", ["funcreturn", "getopts", "nolocal", "sourcepath", "exitpipe"]],
    ["Safety", ["rmempty", "logrotate", "lockfile", "retry", "secretleak", "evalinject", "sudoredirect"]],
    ["Cron and environment", ["cronpath", "cronenv", "crlf", "noshebang", "export"]]
  ];
  const order = GROUPS.flatMap(([, ids]) => ids);
  SCENARIOS.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  for (const [group, ids] of GROUPS) for (const id of ids) SCENARIOS.find((s) => s.id === id).group = group;
  for (const s of SCENARIOS) {
    s.editable = s.editable || [s.file];
    s.cwd = s.cwd || H;
    s.won = (sys) => s.check(sys).ok;
  }
  // A fresh server for a scenario, at its starting point.
  const start = (s) => new System(s);

  root.ShellScenarios = { SCENARIOS, GROUPS, start, trial, cron };
})(typeof window !== "undefined" ? window : globalThis);
