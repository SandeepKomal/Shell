// Writes site/problems.html: every Troubleshoot entry as plain HTML that
// reads without JavaScript, for search engines and for people who prefer it.
// Run with: node tools/build_problems.js   (tests/check_site_data.js checks it is up to date)
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
global.window = global.window || {};
for (const f of ["data", "bash", "builtins", "coreutils", "scenarios"]) require(path.join(root, `site/${f}.js`));
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
      <h4>Symptom</h4>
      <p>${rich(d.symptom)}</p>
      <h4>Why it happens</h4>
      <p>${rich(d.meaning)}</p>
      <ul>
${d.causes.map((c) => `        <li>${rich(c)}</li>`).join("\n")}
      </ul>
      <h4>Confirm</h4>
      <pre><code>${esc(d.confirm.join("\n"))}</code></pre>
      <h4>Fix</h4>
      <p>${rich(d.fix)}</p>
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
  <meta name="description" content="Every common bash error explained: what it means, why it happens, how to confirm it, how to fix it and how to prevent it. ${Q.doctor.length} entries, from command not found to unbound variable.">
  <meta property="og:type" content="article">
  <meta property="og:title" content="Bash errors, explained">
  <meta property="og:description" content="Symptom, cause, confirm, fix and prevent for ${Q.doctor.length} common bash errors.">
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
    <p class="lede">What each error means, why it happens, the commands that confirm the cause, the fix and how to prevent it. Then learn it for good: break and fix each one yourself in the <a href="index.html#pg-title">browser playground</a>, or search them in <a href="index.html#doctor">Troubleshoot</a>.</p>
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

module.exports = { build };
if (require.main === module) {
  fs.writeFileSync(path.join(root, "site/problems.html"), build());
  console.log(`wrote site/problems.html: ${Q.doctor.length} problems`);
}
