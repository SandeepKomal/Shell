// Search over the Troubleshoot entries with pasted error text: the file and
// line prefix and quotes are dropped, then each entry is scored by the words
// it shares with the query, its own error text and known variants weighing most.
"use strict";

(function (root) {
  const words = (s) => s.toLowerCase().replace(/^[^:\n]*:\s*(line\s+)?\d+:\s*/, "").replace(/[`'"‘’]/g, " ").split(/[^a-z0-9_$\\^-]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const flat = (s) => s.toLowerCase().replace(/[`'"‘’]/g, "");
  function score(d, query) {
    const q = words(query);
    if (!q.length) return 1;
    const head = new Set(words(d.title + " " + d.error));
    const body = (d.symptom + " " + d.meaning + " " + d.causes.join(" ") + " " + d.group + " " + d.id).toLowerCase();
    let s = 0;
    for (const w of q) { if (head.has(w)) s += 3; else if (body.includes(w)) s += 1; }
    const text = flat(query);
    if (text.includes(flat(d.title))) s += 20 + d.title.length / 10;
    if ((d.also || []).some((a) => text.includes(flat(a)))) s += 40;
    return s / q.length;
  }
  // Entries in order of relevance, with their scores.
  const rank = (doctor, query) => doctor.map((d, i) => ({ i, s: score(d, query) })).sort((a, b) => b.s - a.s);
  root.SQSearch = { score, rank };
})(typeof window !== "undefined" ? window : globalThis);
