// Search over the Troubleshoot entries with pasted error text.
//
// An entry is the answer only when the paste contains one of its own error
// lines: each entry lists them in `match`, as patterns for the distinctive part
// of the message (`unbound variable`, `curl: (28)`, `[: missing ']'`), not the
// names, paths and numbers around it. Shared words such as error, failed,
// denied or connection never make a match on their own. When nothing matches,
// the caller says so; entries that share a few distinctive words are offered
// only as "related, may not apply".
"use strict";

(function (root) {
  // Words that appear in errors from every tool, log levels and prefixes, and plain English.
  const GENERIC = new Set(("error errors err occurred calling api failed fail fails failure fatal critical warn warning info debug notice trace main exception traceback " +
    "denied access user users permission permissions connection connect connecting connected refused reset timeout timed time out " +
    "not found such file files directory directories line lines code status exit exited command commands cannot can't unable invalid unknown " +
    "operation server host port localhost admin root app application service database data run running ran using use used please try again " +
    "see details detail message bash shell script scripts usr bin var log logs home etc opt srv tmp dev value expected allowed request requested " +
    "http https www com org net internal example production prod staging set get true false null none you your our its will would been being " +
    "after before when while what why does did doesn isn can could should must need needs yes all any some one two via per the and for with " +
    "from this that are was were has have had into onto there here then than but also only just still now new old over under is it be by or " +
    "an as at on in to of no my me we they them he she his her who which how up down off").split(" "));
  // Typed searches keep every word but these.
  const TYPED = new Set("error errors failed the and for with of in on to an is it".split(" "));
  const norm = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[`‘’]/g, "'").replace(/[“”]/g, "\"").toLowerCase();
  const words = (s) => norm(s)
    .replace(/\b\d{4}-\d\d-\d\d[t ]\d\d:\d\d(:\d\d)?(\.\d+)?(z|[+-]\d\d:?\d\d)?/g, " ")
    .split(/[^a-z0-9_$\\^-]+/)
    .map((w) => w.replace(/^[-$\\^]+|[-]+$/g, ""))
    .filter((w) => w.length > 2 && !GENERIC.has(w) && !/\d/.test(w));

  // Strong matches: the entry's own error lines found in the paste. Each pattern
  // counts once; a weight of 2 marks a line that is more specific than another
  // entry's line printed next to it (`$'\r': command not found` over `command not found`).
  function hits(d, query) {
    const text = norm(query);
    let s = 0, len = 0;
    for (const m of d.match || []) {
      const [re, weight] = Array.isArray(m) ? m : [m, 1];
      const found = re.exec(text);
      if (found) { s += weight; len += found[0].length; }
    }
    return s ? s * 1000 + len : 0;
  }

  // How many distinctive words of the query an entry shares, from its title and error text.
  const headCache = new WeakMap();
  const head = (d) => {
    if (!headCache.has(d)) headCache.set(d, new Set(words(d.title + " " + d.error)));
    return headCache.get(d);
  };
  const fullCache = new WeakMap();
  const full = (d) => {
    if (!fullCache.has(d)) fullCache.set(d, [...new Set(norm([d.id, d.title, d.error, d.group, d.symptom, d.meaning, ...d.causes].join(" ")).split(/[^a-z0-9_$\\^-]+/))]);
    return fullCache.get(d);
  };
  const shared = (d, q) => q.filter((w) => head(d).has(w)).length;

  // A few words typed in the box (`unbound`, `set -e`, `cron`) rather than a pasted error.
  const isKeywords = (query) => !/[\n:]/.test(query.trim()) && query.trim().split(/\s+/).length <= 6;

  // find(doctor, query) -> { answer, strong, keyword, related } as indexes into doctor.
  //   answer:  the entry to open, or null when no entry's error line is in the paste
  //   strong:  every entry whose error line is in the paste, best first
  //   keyword: for a few typed words, the entries that contain all of them
  //   related: for a pasted error with no answer, up to 3 entries sharing at least two
  //            distinctive words, and a third of their own
  function find(doctor, query) {
    const out = { answer: null, strong: [], keyword: [], related: [] };
    if (!query.trim()) return out;
    out.strong = doctor.map((d, i) => ({ i, s: hits(d, query) })).filter((x) => x.s).sort((a, b) => b.s - a.s).map((x) => x.i);
    if (out.strong.length) { out.answer = out.strong[0]; return out; }
    if (isKeywords(query)) {
      const k = [...new Set(norm(query).split(/[^a-z0-9_$\\^-]+/).filter((w) => w.length > 1 && !TYPED.has(w)))];
      if (k.length) out.keyword = doctor.map((d, i) => i).filter((i) => k.every((w) => full(doctor[i]).some((x) => x.startsWith(w))));
      return out;
    }
    const q = [...new Set(words(query))];
    out.related = doctor.map((d, i) => ({ i, n: shared(d, q) })).filter((x) => x.n >= 2 && x.n * 3 >= head(doctor[x.i]).size).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.i);
    return out;
  }

  // Entries in order of relevance: strong matches first, then by shared words.
  function rank(doctor, query) {
    const q = [...new Set(words(query))];
    return doctor.map((d, i) => ({ i, s: hits(d, query) + shared(d, q) })).sort((a, b) => b.s - a.s);
  }
  root.SQSearch = { find, rank, words };
})(typeof window !== "undefined" ? window : globalThis);
