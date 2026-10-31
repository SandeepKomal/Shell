// The Troubleshoot search gives an answer only when it can stand behind it.
// Every pasted error in tests/search_corpus.json is run through the search the
// site uses: on-topic errors must open their entry (or nothing, when no entry
// fits), and errors from other tools must open nothing and match nothing. Each
// case also runs with its line breaks removed or turned into spaces, as a
// one-line search box does to a pasted log.
// Run with: node tests/check_search.js
"use strict";
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
global.window = {};
for (const f of ["data", "search"]) require(path.join(root, `site/${f}.js`));
const Q = window.TRACK;
const { find } = window.SQSearch;
const corpus = require("./search_corpus.json");
const ids = new Set(Q.doctor.map((d) => d.id));
const id = (i) => (i === null ? null : Q.doctor[i].id);
const forms = (text) => [...new Set([text, text.replace(/\n/g, " "), text.replace(/\n/g, "")])];
const fails = [];

assert.ok(corpus.onTopic.length >= 40 && corpus.offTopic.length >= 15, "the corpus has at least 40 on-topic and 15 off-topic errors");
for (const d of Q.doctor) {
  assert.ok(Array.isArray(d.match) && d.match.length, `doctor ${d.id}: match patterns`);
  for (const m of d.match) {
    const re = Array.isArray(m) ? m[0] : m;
    assert.ok(re instanceof RegExp && !re.global && !/[A-Z]/.test(re.source.replace(/\\[A-Za-z]/g, "")), `doctor ${d.id}: ${re} is a lower-case RegExp without the g flag (the paste is lower-cased)`);
  }
}

// Each entry's own error line finds it, except the few that show a situation rather than a message.
const SITUATIONS = new Set(["background-status-lost", "ifs-changed", "terraform-exit-2", "personal-data-in-logs", "test-data-from-production", "no-retention-limit"]);
for (const d of Q.doctor) {
  if (d.error.startsWith("(") || SITUATIONS.has(d.id)) continue;
  const got = id(find(Q.doctor, d.error).answer);
  if (got !== d.id) fails.push(`entry ${d.id}: its own error opens ${got}`);
}

let onRight = 0, wrongOpened = 0;
for (const { text, expect } of corpus.onTopic) {
  assert.ok(expect === null || ids.has(expect), `corpus: ${expect} is an entry`);
  let right = true;
  for (const t of forms(text)) {
    const got = id(find(Q.doctor, t).answer);
    if (got !== expect) { right = false; fails.push(`on-topic ${JSON.stringify(t.slice(0, 90))}: opens ${got}, expected ${expect}`); }
    if (got !== null && got !== expect) wrongOpened++;
  }
  if (right) onRight++;
}
let offOpened = 0, offMatched = 0, offRelated = 0;
for (const text of corpus.offTopic) {
  for (const t of forms(text)) {
    const r = find(Q.doctor, t);
    if (r.answer !== null) { offOpened++; fails.push(`off-topic ${JSON.stringify(t.slice(0, 90))}: opens ${id(r.answer)}`); }
    if (r.strong.length || r.keyword.length) { offMatched++; fails.push(`off-topic ${JSON.stringify(t.slice(0, 90))}: matches ${[...r.strong, ...r.keyword].map(id).join(", ")}`); }
    if (r.related.length) offRelated++;
  }
}

console.log(`search: on-topic right ${onRight}/${corpus.onTopic.length}, wrong answers opened ${wrongOpened}, off-topic opened ${offOpened}, off-topic shown as a match ${offMatched}, off-topic with related chips ${offRelated} (${corpus.offTopic.length} off-topic errors, each in up to 3 forms)`);
assert.deepStrictEqual(fails, [], fails.join("\n"));
