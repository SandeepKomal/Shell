// Checks the site's content: levels point at scripts that exist, quizzes are
// well formed, every Troubleshoot entry is complete and linked, every cheat
// sheet Try row really runs in its scenario, and problems.html is current.
// Run with: node tests/check_site_data.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
global.window = {};
for (const f of ["data", "quiz-bank", "bash", "builtins", "coreutils", "scenarios", "xray", "search"]) require(path.join(root, `site/${f}.js`));
const Q = window.QUEST;
const quiz = window.QUEST_QUIZ;
const { SCENARIOS, start } = window.ShellScenarios;
const ids = new Set(SCENARIOS.map((s) => s.id));
const ticks = (text, where) => assert.strictEqual((text.match(/`/g) || []).length % 2, 0, `${where}: unbalanced backticks in "${text}"`);

// Levels
Q.levels.forEach((lv, i) => {
  assert.strictEqual(lv.id, String(i).padStart(2, "0"), `level ids run in order: ${lv.id}`);
  assert.ok(lv.title && lv.topic && lv.stage, `level ${lv.id}: title, topic, stage`);
  assert.ok(lv.learn.length >= 3 && lv.lab.length >= 2, `level ${lv.id}: what you learn and a lab`);
  for (const p of lv.scripts) assert.ok(fs.existsSync(path.join(root, p)), `level ${lv.id}: ${p} exists in the repository`);
  for (const id of lv.practise) assert.ok(ids.has(id), `level ${lv.id}: practises a missing scenario ${id}`);
  lv.learn.forEach((t) => ticks(t, `level ${lv.id}`));
});
for (const s of SCENARIOS) assert.ok(Q.levels.some((l) => l.id === s.level), `scenario ${s.id}: its level exists`);
const used = new Set(Q.levels.flatMap((l) => l.practise).concat(Q.doctor.flatMap((d) => d.scenarios)));
for (const s of SCENARIOS) assert.ok(used.has(s.id), `scenario ${s.id} is linked from a level or a Troubleshoot entry`);
// Every script in scripts/ is used by some level.
for (const f of fs.readdirSync(path.join(root, "scripts"))) {
  assert.ok(Q.levels.some((l) => l.scripts.includes(`scripts/${f}`)) || ["aws_resource_count.sh", "check_http_endpoint.sh", "docker_health.sh", "git_changed_files.sh", "k8s_pod_health.sh", "process_watch.sh", "ssl_cert_expiry.sh"].includes(f), `scripts/${f} is used by a level`);
}

// Quiz
let total = 0;
assert.deepStrictEqual(Object.keys(quiz).sort(), Q.levels.map((l) => l.id), "a quiz for every level and no other");
for (const lv of Q.levels) {
  const items = quiz[lv.id];
  assert.ok(items.length >= 4, `level ${lv.id} needs at least 4 questions, has ${items.length}`);
  const seen = new Set();
  for (const item of items) {
    total++;
    const where = `quiz ${lv.id}: "${item.q}"`;
    assert.ok(item.q.length > 10 && !seen.has(item.q), `${where}: unique question text`);
    seen.add(item.q);
    assert.strictEqual(item.options.length, 4, `${where}: 4 options`);
    assert.strictEqual(new Set(item.options).size, 4, `${where}: options differ`);
    assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 4, `${where}: answer index`);
    assert.ok(item.why.length > 40, `${where}: explanation`);
    for (const t of [item.q, item.why, ...item.options]) ticks(t, where);
  }
}

// Troubleshoot: reference-style entries with stable links
const keys = ["id", "title", "error", "group", "level", "symptom", "meaning", "causes", "confirm", "fix", "prevent", "scenarios"];
for (const d of Q.doctor) {
  for (const k of keys) assert.ok(d[k] !== undefined && d[k] !== "", `doctor ${d.id}: ${k}`);
  assert.match(d.id, /^[a-z0-9-]+$/, `doctor ${d.id}: link-safe id`);
  assert.ok(d.causes.length && d.confirm.length, `doctor ${d.id}: causes and confirm commands`);
  assert.ok(Q.levels.some((l) => l.id === d.level), `doctor ${d.id}: level exists`);
  for (const s of d.scenarios) assert.ok(ids.has(s), `doctor ${d.id}: scenario ${s} exists`);
  for (const t of [d.symptom, d.meaning, d.fix, d.prevent, ...d.causes]) ticks(t, `doctor ${d.id}`);
}
assert.ok(Q.doctor.length >= 30, "at least 30 Troubleshoot entries");
assert.strictEqual(new Set(Q.doctor.map((d) => d.id)).size, Q.doctor.length, "Troubleshoot links are unique");
assert.deepStrictEqual(Q.doctorGroups.flatMap(([, x]) => x).sort(), Q.doctor.map((d) => d.id).sort(), "every entry is in exactly one group");
// Search: pasting the error bash printed finds its entry first.
const PASTED = {
  "./deploy.sh: line 5: ehco: command not found": "command-not-found",
  "bash: ./report.sh: Permission denied": "permission-denied",
  "bash: ./deploy.sh: cannot execute: required file not found": "required-file-not-found",
  "/usr/bin/env: 'bash\\r': No such file or directory": "required-file-not-found",
  "bash: ./deploy.sh: /bin/bash^M: bad interpreter: No such file or directory": "required-file-not-found",
  "deploy.sh: line 2: $'\\r': command not found": "carriage-return",
  "./sync.sh: line 3: DEBUG: unbound variable": "unbound-variable",
  "./health.sh: line 3: [: !=: unary operator expected": "unary-operator-expected",
  "./watch.sh: line 2: [: -q: binary operator expected": "binary-operator-expected",
  "./check.sh: line 4: [: too many arguments": "too-many-arguments",
  "./disk.sh: line 3: [: 100%: integer expression expected": "integer-expression-expected",
  "./report.sh: line 6: 91%: syntax error: operand expected (error token is \"%\")": "operand-expected",
  "./shift.sh: line 5: 08: value too great for base (error token is \"08\")": "value-too-great-for-base",
  "/home/dev/report.sh: 3: [[: not found": "dash-not-found",
  "sed: -e expression #1, char 13: unknown option to `s'": "unknown-option-to-s",
  "find: paths must precede expression: `test.log'": "find-paths-must-precede",
  "./deploy.sh: line 9: syntax error near unexpected token `fi'": "syntax-error-token",
  "deploy.sh: line 14: syntax error: unexpected end of file": "unexpected-end-of-file",
  "./deploy.sh: line 3: return: production: numeric argument required": "return-numeric",
  "./backup.sh: line 5: $LOG: ambiguous redirect": "ambiguous-redirect",
  "curl: (22) The requested URL returned error: 503": "curl-errors",
  "works in terminal but fails in cron": "works-in-terminal-not-cron"
};
for (const [text, id] of Object.entries(PASTED)) {
  const top = window.SQSearch.rank(Q.doctor, text)[0];
  assert.strictEqual(Q.doctor[top.i].id, id, `pasting "${text}" finds ${id}, not ${Q.doctor[top.i].id}`);
}

// Cheat sheet: Try rows run in their scenario with no "command not found" for the command itself.
let tries = 0;
for (const row of Q.cheats) {
  const [cmd, what, group, where] = row;
  assert.ok(row.length === 3 || row.length === 4, `cheat "${cmd}": [command, what, group, where?]`);
  assert.ok(cmd && what && group, `cheat "${cmd}": filled in`);
  if (!where) continue;
  tries++;
  const s = where === "any" ? SCENARIOS[0] : SCENARIOS.find((x) => x.id === where);
  assert.ok(s, `cheat "${cmd}": scenario ${where} exists`);
  const sys = start(s);
  const line = cmd.replace(/<script>/g, s.file.replace(/^\/home\/dev\//, ""));
  const out = sys.run(line).map((l) => l[0]).join("\n");
  // Errors from the scenario's own broken script are expected; errors about the typed line itself are not.
  assert.doesNotMatch(out, /^(bash: |playground:|\w+: (invalid|unrecognized) option|.*: cannot access|.*: can't read)/m, `cheat "${cmd}" in ${where}: ${out.split("\n")[0]}`);
}
assert.strictEqual(new Set(Q.cheats.map((r) => r[0])).size, Q.cheats.length, "cheat sheet commands are unique");

// Architecture and guides
for (const a of Q.architecture) {
  assert.ok(a.id && a.name && a.short && a.text && a.breaks && a.look.length, `architecture ${a.id}: complete`);
  ticks(a.text, `architecture ${a.id}`);
}
for (const [key, g] of Object.entries(Q.guides)) assert.ok(g.what && g.steps.length && g.uses.length && g.tips.length, `guide ${key}: complete`);

// The pages: CSP, no inline code, no third parties, footer, search-engine files
const html = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`;
const problems = fs.readFileSync(path.join(root, "site/problems.html"), "utf8");
for (const [name, page] of [["index.html", html], ["problems.html", problems]]) {
  assert.ok(page.includes(CSP), `${name}: the CSP`);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=|<script>(?!<\/script>)|<style/i, `${name}: no inline styles, handlers or scripts`);
  assert.doesNotMatch(page, /<(script|img)[^>]+src="https?:|<link(?![^>]*rel="canonical")[^>]+href="https?:/i, `${name}: nothing loaded from other sites`);
  assert.match(page, /<meta name="description" content="[^"]{60,}">/, `${name}: a meta description`);
  assert.match(page, /<meta property="og:title"/, `${name}: Open Graph tags`);
  assert.match(page, /Bash is a GNU project of the Free Software Foundation\. This project is independent and not affiliated with the FSF or the GNU project\./, `${name}: trademark line`);
}
for (const src of html.match(/(src|href)="[^"#:]+"/g)) assert.ok(fs.existsSync(path.join(root, "site", src.split('"')[1])), `${src} exists`);
assert.match(html, /<title>Shell Quest<\/title>/);
assert.ok(html.includes(`${SCENARIOS.length} incidents in a bash playground`), "the meta description has the real scenario count");
assert.match(html, /© 2024–2026 Sandeep Komal Pothu and contributors\./);
assert.match(html, /id="forget"/, "a Clear it button");
assert.strictEqual(problems, require(path.join(root, "tools/build_problems.js")).build(), "site/problems.html is current: run node tools/build_problems.js");
for (const d of Q.doctor) assert.ok(problems.includes(`id="${d.id}"`) && problems.includes(d.error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")), `problems.html has ${d.id} and its error text`);
assert.match(fs.readFileSync(path.join(root, "site/robots.txt"), "utf8"), /Sitemap: https:\/\/sandeepkomal\.github\.io\/Shell\/sitemap\.xml/);
const sitemap = fs.readFileSync(path.join(root, "site/sitemap.xml"), "utf8");
assert.ok(sitemap.includes("/Shell/</loc>") && sitemap.includes("/Shell/problems.html</loc>"), "sitemap lists the pages");
for (const f of fs.readdirSync(path.join(root, "site")).filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(root, "site", f), "utf8");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|fetch\(|XMLHttpRequest|new Function/, `${f}: no HTML injection, eval or network calls`);
}

console.log(`site data ok: ${Q.levels.length} levels, ${total} quiz questions, ${Q.doctor.length} Troubleshoot entries, ${Q.cheats.length} cheat sheet rows (${tries} Try), ${Q.architecture.length} architecture steps`);
