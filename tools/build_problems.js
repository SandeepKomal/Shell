// Writes site/problems.html: every Troubleshoot entry as plain HTML that
// reads without JavaScript, for search engines and for people who prefer it.
// Also writes site/scenario-index.js: the scenario list and X-ray rule count the
// first screen needs, so it can be drawn before the simulator loads.
// Run with: node tools/build_problems.js   (tests/check_site_data.js checks both are up to date)
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
global.window = global.window || {};
for (const f of ["data", "bash", "builtins", "coreutils", "scenarios", "xray"]) require(path.join(root, `site/${f}.js`));
const Q = window.TRACK;
const titles = Object.fromEntries(window.ShellScenarios.SCENARIOS.map((s) => [s.id, s.title]));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rich = (s) => s.split(/(`[^`]+`)/).map((p) => (p.startsWith("`") && p.length > 1 ? `<code>${esc(p.slice(1, -1))}</code>` : esc(p))).join("");

function build() {
  const sections = Q.doctorGroups.map(([group, ids]) => {
    const items = ids.map((id) => {
      const d = Q.doctor.find((x) => x.id === id);
      const lv = Q.levels.find((l) => l.id === d.level);
      const practise = d.scenarios.filter((s) => titles[s]).map((s) => `<a href="index.html#play/${s}">${esc(titles[s])}</a>`).join(" · ");
      return `    <section class="card problem" id="${d.id}">
      <h3>${esc(d.title)}</h3>
      <pre class="err-line"><code>${esc(d.error)}</code></pre>
      <h4>What it means</h4>
      <p>${rich(d.meaning)}</p>
      <h4>What you see</h4>
      <p>${rich(d.symptom)}</p>
      <h4>${d.causes.length > 1 ? "Causes, most likely first" : "Cause"}</h4>
      <ol class="causes">
${d.causes.map((c) => `        <li class="cause">
          <p class="cause-why">${rich(c.why)}</p>
          <p class="cause-label">Check</p>
          <pre><code>${esc(c.check.join("\n"))}</code></pre>
          <p class="cause-label">Fix</p>
          <p>${rich(c.fix)}</p>
        </li>`).join("\n")}
      </ol>
      <h4>Prevent</h4>
      <p>${rich(d.prevent)}</p>
      <p class="note"><strong>Now learn it:</strong> ${practise ? `break and fix it yourself in ${practise}, then take` : "take"} <a href="index.html#path">Level ${lv.id} · ${esc(lv.title)}</a>. <a href="index.html#fix/${d.id}">Open in Troubleshoot</a></p>
    </section>`;
    }).join("\n");
    return `    <h2 class="stage-h">${esc(group)}</h2>\n${items}`;
  }).join("\n");
  const toc = Q.doctorGroups.map(([group, ids]) => `      <li>${esc(group)}: ${ids.map((id) => `<a href="#${id}">${esc(Q.doctor.find((d) => d.id === id).title)}</a>`).join(", ")}</li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="description" content="Every common bash error explained: what it means, each cause that prints it, the check that tells them apart, the fix for that cause and how to prevent it. ${Q.doctor.length} entries, from command not found to unbound variable.">
  <meta property="og:type" content="article">
  <meta property="og:title" content="Bash errors, explained">
  <meta property="og:description" content="Meaning, causes, checks, fixes and prevention for ${Q.doctor.length} common bash errors.">
  <meta property="og:url" content="${Q.site}problems.html">
  <link rel="canonical" href="${Q.site}problems.html">
  <title>Bash errors explained</title>
  <link rel="stylesheet" href="style.css">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
</head>
<body>
  <header class="top">
    <div class="wrap top-inner">
      <a class="brand" href="index.html" aria-label="DevOps Nimbus Bash, home"><img class="mark" src="nimbus.svg" alt="" width="37" height="22"> DevOps Nimbus <span class="brand-track">Bash</span></a>
    </div>
  </header>
  <main class="wrap">
    <h1 class="big-title">Bash errors, explained</h1>
    <p class="lede">What each error means, the causes that print it, a check that tells you which one you have, the fix for that cause and how to prevent it. Then learn it for good: break and fix each one yourself in the <a href="index.html#pg-title">browser playground</a>, or search them in <a href="index.html#doctor">Troubleshoot</a>.</p>
    <ul class="note">
${toc}
    </ul>
${sections}
  </main>
  <footer class="foot">
    <div class="wrap foot-base">
      <p>© 2024–2026 Sandeep Komal Pothu and contributors. Open source under the MIT License.</p>
      <p class="foot-tm">Bash is a GNU project of the Free Software Foundation. This project is independent and not affiliated with the FSF or the GNU project.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function scenarioIndex() {
  const rows = window.ShellScenarios.SCENARIOS.map(({ id, group, level, title, story, goal }) => "  " + JSON.stringify({ id, group, level, title, story, goal }));
  return `// Generated by tools/build_problems.js from site/scenarios.js and site/xray.js: do not edit.
// What the first screen needs from them; the simulator and the X-ray load later.
"use strict";
window.TRACK_XRAY_RULES = ${window.SQXray.RULES.length};
window.TRACK_SCENARIOS = [
${rows.join(",\n")}
];
`;
}

module.exports = { build, scenarioIndex };
if (require.main === module) {
  fs.writeFileSync(path.join(root, "site/problems.html"), build());
  fs.writeFileSync(path.join(root, "site/scenario-index.js"), scenarioIndex());
  console.log(`wrote site/problems.html: ${Q.doctor.length} problems, and site/scenario-index.js`);
}
