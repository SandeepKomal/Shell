// The programs on the playground's PATH: the GNU tools scripts use most,
// with their real options, output and error messages.
"use strict";

(function (root) {
  const { FS, System, Shell, Signal, ERRNO, byteOrder, globToRe, printf, escapes } = root.ShellSim;
  const U = System.utils;
  const lines = (text) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
  const joinLines = (list) => (list.length ? list.join("\n") + "\n" : "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const pad2 = (n) => String(n).padStart(2, "0");

  // --- dates ---

  function strftime(fmt, t) {
    const d = new Date(t * 1000);
    const map = {
      Y: d.getUTCFullYear(), m: pad2(d.getUTCMonth() + 1), d: pad2(d.getUTCDate()), H: pad2(d.getUTCHours()), M: pad2(d.getUTCMinutes()),
      S: pad2(d.getUTCSeconds()), s: t, a: DAYS[d.getUTCDay()], A: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()],
      b: MONTHS[d.getUTCMonth()], h: MONTHS[d.getUTCMonth()], e: String(d.getUTCDate()).padStart(2), j: String(Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1) / 1000) / 86400) + 1).padStart(3, "0"),
      y: pad2(d.getUTCFullYear() % 100), Z: "UTC", z: "+0000", u: d.getUTCDay() || 7, w: d.getUTCDay(), n: "\n", t: "\t", "%": "%"
    };
    map.F = `${map.Y}-${map.m}-${map.d}`;
    map.T = `${map.H}:${map.M}:${map.S}`;
    map.D = `${map.m}/${map.d}/${map.y}`;
    map.R = `${map.H}:${map.M}`;
    return fmt.replace(/%([a-zA-Z%])/g, (m, c) => (c in map ? String(map[c]) : m));
  }
  const defaultDate = (t) => strftime("%a %b %e %H:%M:%S %Z %Y", t);
  function parseDate(s, now) {
    s = s.trim();
    let m;
    if (s === "" || s === "now" || s === "today") return now;
    if (s === "yesterday") return now - 86400;
    if (s === "tomorrow") return now + 86400;
    if ((m = /^@(-?\d+)$/.exec(s))) return Number(m[1]);
    if ((m = /^(-?\d+) (second|minute|hour|day|week|month|year)s?( ago)?$/.exec(s))) {
      const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[m[2]];
      return now + Number(m[1]) * unit * (m[3] ? -1 : 1);
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
    // The form openssl and many logs print: Nov 15 12:00:00 2026 GMT
    if ((m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+(?:GMT|UTC))?$/.exec(s)) && MONTHS.includes(m[1])) return Date.UTC(+m[6], MONTHS.indexOf(m[1]), +m[2], +m[3], +m[4], +m[5]) / 1000;
    return null;
  }
  U.date = (c) => {
    let t = c.fs.now;
    let fmt = null;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-u" || a === "--utc") continue;
      if (a === "-d" || a === "--date" || a.startsWith("--date=") || a.startsWith("-d")) {
        const v = a === "-d" || a === "--date" ? c.args[++i] : a.replace(/^(--date=|-d)/, "");
        t = parseDate(v ?? "", c.fs.now);
        if (t === null) return c.fail(`invalid date '${v}'`);
      } else if (a === "-I" || a === "--iso-8601") fmt = "%F";
      else if (a === "-Iseconds") fmt = "%FT%T+00:00";
      else if (a === "-R") fmt = "%a, %d %b %Y %T +0000";
      else if (a[0] === "+") fmt = a.slice(1);
      else return c.fail(`invalid date '${a}'`);
    }
    c.out((fmt === null ? defaultDate(t) : strftime(fmt, t)) + "\n");
    return 0;
  };
  U.sleep = (c) => {
    if (!c.args.length) return c.usage("missing operand");
    let total = 0;
    for (const a of c.args) {
      const m = /^(\d+(?:\.\d+)?|\.\d+)([smhd]?)$/.exec(a);
      if (!m) return c.usage(`invalid time interval '${a}'`);
      total += Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
    }
    c.sys.slept.push(total);
    c.sys.advance(Math.ceil(total));
    return 0;
  };

  // --- files ---

  const owner = (p) => (p.startsWith("/home/dev") || p.startsWith("/tmp/") || p.startsWith("/srv") ? "dev" : "root");
  function modeString(n) {
    const t = n.type === "dir" ? "d" : n.dev ? "c" : "-";
    let s = "";
    for (let k = 6; k >= 0; k -= 3) {
      const b = (n.mode >> k) & 7;
      s += (b & 4 ? "r" : "-") + (b & 2 ? "w" : "-") + (b & 1 ? "x" : "-");
    }
    if (n.mode & 0o1000) s = s.slice(0, 8) + (s[8] === "x" ? "t" : "T");
    return t + s;
  }
  const sizeOf = (n) => (n.type === "dir" ? 4096 : n.bin ? 35328 : n.text.length);
  function human(n) {
    if (n < 1024) return String(n);
    const units = ["K", "M", "G", "T"];
    let v = n;
    let u = -1;
    while (v >= 1024 && u < 3) { v /= 1024; u++; }
    return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)) + units[u];
  }
  function lsTime(mtime, now) {
    const d = new Date(mtime * 1000);
    const recent = now - mtime < 180 * 86400 && mtime <= now + 3600;
    return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${recent ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : " " + d.getUTCFullYear()}`;
  }
  // GNU ls quotes names with spaces or shell characters when it writes to a terminal.
  const lsName = (name, tty) => (tty && /[^\w@%+=:,./-]/.test(name) ? (name.includes("'") ? `"${name}"` : `'${name}'`) : name);

  U.ls = (c) => {
    c.badCode = 2;
    const g = c.getopt("laA1trhdRSF", { all: "a", "almost-all": "A", human: "h", directory: "d" });
    if (!g) return 2;
    const { o } = g;
    const tty = !!c.io.fds[1].tty;
    const targets = g.rest.length ? g.rest : ["."];
    let st = 0;
    const order = (entries) => {
      const sorted = entries.slice().sort((a, b) => (o.t ? b.n.mtime - a.n.mtime || byteOrder(a.name, b.name) : o.S ? sizeOf(b.n) - sizeOf(a.n) : byteOrder(a.name, b.name)));
      return o.r ? sorted.reverse() : sorted;
    };
    const show = (entries, total) => {
      if (o.l) {
        if (total) c.out(`total ${entries.reduce((s, e) => s + (e.n.type === "dir" ? 4 : Math.ceil(sizeOf(e.n) / 4096) * 4), 0)}\n`);
        const w = Math.max(1, ...entries.map((e) => String(o.h ? human(sizeOf(e.n)) : sizeOf(e.n)).length));
        for (const e of entries) {
          const size = String(o.h ? human(sizeOf(e.n)) : sizeOf(e.n)).padStart(w);
          const who = e.n.owner || owner(e.p);
          c.out(`${modeString(e.n)} ${e.n.type === "dir" ? 2 : 1} ${who} ${who} ${size} ${lsTime(e.n.mtime, c.fs.now)} ${lsName(e.name, tty)}${o.F && e.n.type === "dir" ? "/" : ""}\n`);
        }
      } else if (entries.length) {
        const names = entries.map((e) => lsName(e.name, tty) + (o.F && e.n.type === "dir" ? "/" : o.F && e.n.mode & 0o111 ? "*" : ""));
        c.out(tty && !o["1"] ? names.join("  ") + "\n" : joinLines(names));
      }
    };
    const files = [];
    const dirs = [];
    for (const t of targets) {
      const p = c.path(t);
      const n = c.fs.get(p);
      if (!n) { c.err(`ls: cannot access '${t}': No such file or directory\n`); st = 2; continue; }
      if (n.type === "dir" && !o.d) dirs.push({ name: t, p, n }); else files.push({ name: t, p, n });
    }
    show(order(files), false);
    dirs.forEach((d, k) => {
      if (files.length || dirs.length > 1) c.out(`${files.length || k ? "\n" : ""}${d.name}:\n`);
      let entries = c.fs.list(d.p).map((name) => ({ name, p: (d.p === "/" ? "" : d.p) + "/" + name, n: c.fs.get((d.p === "/" ? "" : d.p) + "/" + name) }));
      if (!o.a && !o.A) entries = entries.filter((e) => e.name[0] !== ".");
      if (o.a) entries = [{ name: ".", p: d.p, n: d.n }, { name: "..", p: FS.parent(d.p), n: c.fs.get(FS.parent(d.p)) }, ...entries];
      show(order(entries), true);
    });
    return st;
  };

  U.cat = (c) => {
    const g = c.getopt("nAEvTs", { number: "n", "show-all": "A" });
    if (!g) return 1;
    const { o } = g;
    let st = 0;
    let text = "";
    for (const f of g.rest.length ? g.rest : ["-"]) {
      const n = f === "-" ? null : c.fs.get(c.path(f));
      if (n && n.bin) continue;
      const t = c.read(f);
      if (t === null) { st = 1; continue; }
      text += t;
    }
    if (o.A || o.v || o.E || o.T) {
      text = text.replace(/[\x00-\x08\x0b-\x1f\x7f]|\t/g, (ch) => (ch === "\t" ? (o.A || o.T ? "^I" : ch) : ch === "\x7f" ? "^?" : "^" + String.fromCharCode(ch.charCodeAt(0) + 64)));
      if (o.A || o.E) text = text.replace(/\n/g, "$\n");
    }
    if (o.n) {
      let k = 0;
      text = text.replace(/^(?=[\s\S])/gm, () => String(++k).padStart(6) + "\t");
    }
    c.out(text);
    return st;
  };

  U.mkdir = (c) => {
    const g = c.getopt("pvm:", { parents: "p" });
    if (!g) return 1;
    if (!g.rest.length) return c.usage("missing operand");
    let st = 0;
    for (const d of g.rest) {
      const p = c.path(d);
      if (g.o.p) {
        let q = "";
        for (const part of p.split("/").filter(Boolean)) {
          q += "/" + part;
          const n = c.fs.get(q);
          if (n && n.type !== "dir") { c.fail(`cannot create directory '${d}': Not a directory`); st = 1; break; }
          if (!n && c.denied(q, `cannot create directory '${d}'`)) { st = 1; break; }
          if (!n) c.fs.mkdir(q);
        }
        continue;
      }
      if (!c.fs.get(p) && c.denied(p, `cannot create directory '${d}'`)) { st = 1; continue; }
      const e = c.fs.mkdir(p);
      if (e) { c.fail(`cannot create directory '${d}': ${ERRNO[e]}`); st = 1; }
      else if (g.o.v) c.out(`mkdir: created directory '${d}'\n`);
    }
    return st;
  };
  U.rmdir = (c) => {
    let st = 0;
    for (const d of c.args.filter((a) => a[0] !== "-")) {
      const p = c.path(d);
      const n = c.fs.get(p);
      const why = !n ? "No such file or directory" : n.type !== "dir" ? "Not a directory" : c.fs.list(p).length ? "Directory not empty" : null;
      if (why) { c.fail(`failed to remove '${d}': ${why}`); st = 1; } else c.fs.remove(p);
    }
    return st;
  };
  U.rm = (c) => {
    const g = c.getopt("rRfivd", { recursive: "r", force: "f", verbose: "v", "no-preserve-root": "N" });
    if (!g) return 1;
    const { o } = g;
    const rec = o.r || o.R;
    if (!g.rest.length) return o.f ? 0 : c.usage("missing operand");
    let st = 0;
    for (const f of g.rest) {
      const p = c.path(f);
      if (p === "/" && rec && !o.N) { c.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); st = 1; continue; }
      if (/(^|\/)\.\.?\/?$/.test(f)) { c.fail(`refusing to remove '.' or '..' directory: skipping '${f}'`); st = 1; continue; }
      const n = c.fs.get(p);
      if (!n) { if (!o.f) { c.fail(`cannot remove '${f}': No such file or directory`); st = 1; } continue; }
      if (c.denied(p, `cannot remove '${f}'`, System.isProtected(p) ? "Permission denied" : "Operation not permitted")) { st = 1; continue; }
      if (n.type === "dir" && !rec) {
        if (o.d && !c.fs.list(p).length) { c.fs.remove(p); continue; }
        c.fail(`cannot remove '${f}': Is a directory`);
        st = 1;
        continue;
      }
      if (o.v) for (const k of c.fs.walk(p).reverse().concat(p)) c.out(`removed ${c.fs.isDir(k) ? "directory " : ""}'${k === p ? f : f.replace(/\/$/, "") + k.slice(p.length)}'\n`);
      c.fs.remove(p);
    }
    return st;
  };
  function copyOrMove(c, move) {
    const g = c.getopt(move ? "fvni" : "rRapfvni", { recursive: "r", force: "f", verbose: "v", archive: "a" });
    if (!g) return 1;
    const { o, rest } = g;
    if (!rest.length) return c.usage("missing file operand");
    if (rest.length === 1) return c.usage(`missing destination file operand after '${rest[0]}'`);
    const dest = rest[rest.length - 1];
    const dp = c.path(dest);
    const dn = c.fs.get(dp);
    const sources = rest.slice(0, -1);
    if (sources.length > 1 && (!dn || dn.type !== "dir")) return c.fail(dn ? `target '${dest}' is not a directory` : `target '${dest}': No such file or directory`);
    let st = 0;
    for (const s of sources) {
      const sp = c.path(s);
      const sn = c.fs.get(sp);
      if (!sn) { c.fail(`cannot stat '${s}': No such file or directory`); st = 1; continue; }
      const to = dn && dn.type === "dir" ? (dp === "/" ? "" : dp) + "/" + FS.base(sp) : dp;
      if (to === sp) { c.fail(`'${s}' and '${dn && dn.type === "dir" ? dest.replace(/\/$/, "") + "/" + FS.base(sp) : dest}' are the same file`); st = 1; continue; }
      if (sn.type === "dir" && !move && !(o.r || o.R || o.a)) { c.fail(`-r not specified; omitting directory '${s}'`); st = 1; continue; }
      if (sn.type === "dir" && (to + "/").startsWith(sp + "/")) { c.fail(`cannot ${move ? "move" : "copy"} a directory, '${s}', into itself, '${dest}'`); st = 1; continue; }
      const parentErr = c.fs.parentError(to);
      if (parentErr) { c.fail(move ? `cannot move '${s}' to '${dest}': ${ERRNO[parentErr]}` : `cannot create ${sn.type === "dir" ? "directory" : "regular file"} '${dest}': ${ERRNO[parentErr]}`); st = 1; continue; }
      if (c.denied(to, move ? `cannot move '${s}' to '${dest}'` : `cannot create ${sn.type === "dir" ? "directory" : "regular file"} '${dest}'`)) { st = 1; continue; }
      const tn = c.fs.get(to);
      if (o.n && tn) continue;
      if (tn && tn.type === "dir" && sn.type !== "dir") { c.fail(`cannot overwrite directory '${to}' with non-directory`); st = 1; continue; }
      if (move) { c.fs.remove(to); c.fs.move(sp, to); }
      else for (const k of [sp, ...c.fs.walk(sp)]) {
        const n = c.fs.get(k);
        c.fs.nodes.set(to + k.slice(sp.length), { ...n, mtime: o.p || o.a ? n.mtime : c.fs.now });
      }
      if (o.v) c.out(`${move ? "renamed " : ""}'${s}' -> '${to}'\n`);
    }
    return st;
  }
  U.cp = (c) => copyOrMove(c, false);
  U.mv = (c) => copyOrMove(c, true);
  U.touch = (c) => {
    let when = c.fs.now;
    const files = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-d" || a === "--date") { when = parseDate(c.args[++i] ?? "", c.fs.now); if (when === null) return c.fail(`invalid date format '${c.args[i]}'`); }
      else if (a === "-c" || a === "-m" || a === "-a") continue;
      else files.push(a);
    }
    if (!files.length) return c.usage("missing file operand");
    let st = 0;
    for (const f of files) {
      const p = c.path(f);
      const n = c.fs.get(p);
      if (c.denied(p, `cannot touch '${f}'`)) { st = 1; continue; }
      if (n) { n.mtime = when; continue; }
      const e = c.fs.write(p, "", false);
      if (e) { c.fail(`cannot touch '${f}': ${ERRNO[e]}`); st = 1; } else c.fs.get(p).mtime = when;
    }
    return st;
  };
  U.chmod = (c) => {
    const rec = c.args.includes("-R");
    const args = c.args.filter((a) => a !== "-R" && a !== "-v");
    if (args.length < 2) return c.usage(args.length ? `missing operand after '${args[0]}'` : "missing operand");
    const [mode, ...files] = args;
    const apply = (old) => {
      if (/^[0-7]{1,4}$/.test(mode)) return parseInt(mode, 8);
      let m = old;
      for (const clause of mode.split(",")) {
        const x = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(clause);
        if (!x) return null;
        const who = x[1] || "a";
        let bits = 0;
        for (const p of x[3]) bits |= p === "r" ? 4 : p === "w" ? 2 : p === "x" || p === "X" ? 1 : 0;
        let mask = 0;
        for (const w of who === "a" ? "ugo" : who) mask |= bits << { u: 6, g: 3, o: 0 }[w];
        if (x[2] === "+") m |= mask;
        else if (x[2] === "-") m &= ~mask;
        else { let clear = 0; for (const w of who === "a" ? "ugo" : who) clear |= 7 << { u: 6, g: 3, o: 0 }[w]; m = (m & ~clear) | mask; }
      }
      return m;
    };
    if (apply(0o644) === null) return c.usage(`invalid mode: '${mode}'`);
    let st = 0;
    for (const f of files) {
      const p = c.path(f);
      const n = c.fs.get(p);
      if (!n) { c.fail(`cannot access '${f}': No such file or directory`); st = 1; continue; }
      if (c.denied(p, `changing permissions of '${f}'`, "Operation not permitted")) { st = 1; continue; }
      for (const k of rec ? [p, ...c.fs.walk(p)] : [p]) { const node = c.fs.get(k); node.mode = apply(node.mode); }
    }
    return st;
  };
  U.chown = (c) => (c.args.length < 2 ? c.usage("missing operand") : 0);
  U.basename = (c) => {
    let args = c.args.filter((a) => a !== "--");
    let suffix = null;
    let multiple = false;
    if (args[0] === "-a") { multiple = true; args = args.slice(1); }
    if (args[0] === "-s") { suffix = args[1]; multiple = true; args = args.slice(2); }
    if (!args.length) return c.usage("missing operand");
    if (!multiple && args.length > 2) return c.usage(`extra operand '${args[2]}'`);
    if (!multiple) { suffix = args[1] ?? null; args = [args[0]]; }
    for (const a of args) {
      let b = a.replace(/\/+$/, "");
      b = b === "" && a ? "/" : b.slice(b.lastIndexOf("/") + 1);
      if (suffix && b !== suffix && b.endsWith(suffix)) b = b.slice(0, -suffix.length);
      c.out(b + "\n");
    }
    return 0;
  };
  U.dirname = (c) => {
    if (!c.args.length) return c.usage("missing operand");
    for (const a of c.args) {
      const s = a.replace(/\/+$/, "");
      const k = s.lastIndexOf("/");
      c.out((k < 0 ? (a.startsWith("/") ? "/" : ".") : k === 0 ? "/" : s.slice(0, k).replace(/\/+$/, "") || "/") + "\n");
    }
    return 0;
  };
  U.realpath = (c) => {
    let st = 0;
    for (const a of c.args.filter((x) => x[0] !== "-")) {
      const p = c.path(a);
      if (!c.fs.get(FS.parent(p))) { c.fail(`${a}: No such file or directory`); st = 1; continue; }
      c.out(p + "\n");
    }
    return st;
  };
  U.readlink = (c) => (c.args.includes("-f") || c.args.includes("-e") || c.args.includes("-m") ? U.realpath(c) : 1);
  U.pwd = (c) => { c.out(c.cwd + "\n"); return 0; };
  U.mktemp = (c) => {
    let dir = false;
    let base = "/tmp";
    let tpl = null;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-d" || a === "--directory") dir = true;
      else if (a === "-p" || a === "--tmpdir") base = c.args[++i];
      else if (a.startsWith("--tmpdir=")) base = a.slice(9);
      else if (a === "-t") continue;
      else tpl = a;
    }
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const t = tpl || "tmp.XXXXXXXXXX";
    if (!/X{3,}$/.test(t)) return c.fail(`too few X's in template '${t}'`);
    const name = t.replace(/X+$/, (x) => [...x].map(() => letters[c.sys.random() % letters.length]).join(""));
    const p = tpl && tpl.includes("/") ? c.path(name) : FS.norm(c.path(base), name);
    const e = dir ? c.fs.mkdir(p) : c.fs.write(p, "", false);
    if (e) return c.fail(`failed to create ${dir ? "directory" : "file"} via template '${tpl && tpl.includes("/") ? t : base.replace(/\/$/, "") + "/" + t}': ${ERRNO[e]}`);
    c.fs.get(p).mode = dir ? 0o700 : 0o600;
    c.out(p + "\n");
    return 0;
  };
  U.du = (c) => {
    const g = c.getopt("shacd:", { summarize: "s", human: "h" });
    if (!g) return 1;
    let st = 0;
    for (const t of g.rest.length ? g.rest : ["."]) {
      const p = c.path(t);
      if (!c.fs.get(p)) { c.fail(`cannot access '${t}': No such file or directory`); st = 1; continue; }
      const kb = (k) => [k, ...c.fs.walk(k)].reduce((s, x) => { const n = c.fs.get(x); return s + (n.type === "dir" ? 4 : Math.ceil((n.text.length || 0) / 4096) * 4); }, 0);
      const fmt = (k) => (g.o.h ? human(kb(k) * 1024) : String(kb(k)));
      if (!g.o.s) for (const k of c.fs.walk(p).filter((x) => c.fs.isDir(x)).reverse()) c.out(`${fmt(k)}\t${t.replace(/\/$/, "")}${k.slice(p.length)}\n`);
      c.out(`${fmt(p)}\t${t}\n`);
    }
    return st;
  };
  // The scenario decides how full each disk is; by default there is plenty of room.
  U.df = (c) => {
    const h = c.args.some((a) => /^-[a-zA-Z]*h/.test(a));
    const disks = c.sys.spec.disks || [["/dev/sda1", 41152736, 9876544, "/"]];
    const rows = disks.map(([dev, size, used, mount]) => {
      const avail = size - used;
      const pct = Math.ceil((used / size) * 100) + "%";
      return h ? [dev, human(size * 1024), human(used * 1024), human(avail * 1024), pct, mount] : [dev, String(size), String(used), String(avail), pct, mount];
    });
    const head = h ? ["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"] : ["Filesystem", "1K-blocks", "Used", "Available", "Use%", "Mounted on"];
    const w = head.map((x, k) => Math.max(x.length, ...rows.map((r) => r[k].length)));
    for (const r of [head, ...rows]) c.out(r.map((x, k) => (k === 0 || k === 5 ? x.padEnd(k === 5 ? 0 : w[k]) : x.padStart(w[k]))).join(" ").trimEnd() + "\n");
    return 0;
  };
  U.file = (c) => {
    for (const f of c.args.filter((a) => a[0] !== "-")) {
      const n = c.fs.get(c.path(f));
      let what;
      if (!n) what = "cannot open `" + f + "' (No such file or directory)";
      else if (n.type === "dir") what = "directory";
      else if (n.bin) what = "ELF 64-bit LSB pie executable, x86-64, dynamically linked, stripped";
      else if (n.text === "") what = "empty";
      else if (n.text.startsWith("\x1f\x8b")) what = "gzip compressed data";
      else {
        const sh = /^#!\s*(\/usr\/bin\/env\s+)?\S*bash/.test(n.text) ? "Bourne-Again shell script, " : /^#!\s*\S*\/sh\b/.test(n.text) ? "POSIX shell script, " : "";
        what = `${sh}ASCII text${sh && n.mode & 0o111 ? " executable" : ""}${n.text.includes("\r\n") ? ", with CRLF line terminators" : ""}${n.text.length && !n.text.endsWith("\n") ? ", with no line terminators" : ""}`;
      }
      c.out(`${f}: ${what}\n`);
    }
    return 0;
  };
  U.dos2unix = (c) => {
    let st = 0;
    for (const f of c.args.filter((a) => a[0] !== "-")) {
      const p = c.path(f);
      const n = c.fs.get(p);
      if (!n || n.type !== "file") { c.err(`dos2unix: ${f}: No such file or directory\ndos2unix: Skipping ${f}, not a regular file.\n`); st = 2; continue; }
      c.err(`dos2unix: converting file ${f} to Unix format...\n`);
      n.text = n.text.replace(/\r\n/g, "\n");
      n.mtime = c.fs.now;
    }
    return st;
  };

  // --- text ---

  // grep and sed patterns: POSIX basic or extended regular expressions, in JavaScript syntax.
  function posixRe(src, extended) {
    let out = "";
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "[") {
        let j = i + 1;
        if (src[j] === "^") j++;
        if (src[j] === "]") j++;
        while (j < src.length && src[j] !== "]") { if (src[j] === "[" && src[j + 1] === ":") { const k = src.indexOf(":]", j); if (k > 0) j = k + 1; } j++; }
        if (j >= src.length) throw new Error("Unmatched [, [^, [:, [., or [=");
        const body = src.slice(i + 1, j).replace(/\[:([a-z]+):\]/g, (m, n) => ({ alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z", space: "\\s", blank: " \\t", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f" }[n] || m)).replace(/\\/g, "\\\\");
        out += "[" + body + "]";
        i = j;
        continue;
      }
      if (ch === "\\") {
        const n = src[++i];
        if (n === undefined) throw new Error("Trailing backslash");
        if (!extended && "(){}|+?".includes(n)) out += n;
        else if (n === "<" || n === ">") out += "\\b";
        else if ("wWsSbBnt".includes(n) || /\d/.test(n)) out += "\\" + n;
        else if (n === "r") out += "\\r";
        else out += "\\" + n.replace(/[a-zA-Z]/, "") + (/[a-zA-Z]/.test(n) ? n : "");
        continue;
      }
      if (!extended && "(){}|+?".includes(ch)) { out += "\\" + ch; continue; }
      if (ch === "*" && (out === "" || out === "^")) { out += "\\*"; continue; }
      if (ch === "/") { out += "\\/"; continue; }
      out += ch;
    }
    return out;
  }
  function makeRe(c, src, o, flags = "") {
    let body;
    try { body = o.F ? src.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") : posixRe(src, o.E); } catch (e) { c.fail(e.message); return null; }
    if (o.w) body = `(?<![\\w])(?:${body})(?![\\w])`;
    if (o.x) body = `^(?:${body})$`;
    try { return new RegExp(body, (o.i ? "i" : "") + flags); } catch {
      c.fail(/\(/.test(src) ? "Unmatched ( or \\(" : "Invalid regular expression");
      return null;
    }
  }

  U.grep = (c) => {
    c.badCode = 2;
    const pats = [];
    const g = c.getopt("ivcnqsEFwxolLrRhHe:A:B:C:Pz", { "ignore-case": "i", "invert-match": "v", count: "c", quiet: "q", silent: "q", "extended-regexp": "E", "fixed-strings": "F", "word-regexp": "w", recursive: "r", regexp: "e" });
    if (!g) return 2;
    const { o } = g;
    let rest = g.rest;
    if (o.e !== undefined) {
      const raw = c.args;
      for (let i = 0; i < raw.length; i++) if (raw[i] === "-e" || raw[i] === "--regexp") pats.push(raw[++i]); else if (/^-e./.test(raw[i])) pats.push(raw[i].slice(2));
    } else {
      if (!rest.length) { c.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; }
      pats.push(rest[0]);
      rest = rest.slice(1);
    }
    const res = pats.flatMap((p) => p.split("\n")).map((p) => makeRe(c, p, o, o.o ? "g" : ""));
    if (res.includes(null)) return 2;
    let files = rest.length ? rest : [o.r || o.R ? "." : "-"];
    if (o.r || o.R) files = files.flatMap((f) => { const p = c.path(f); return c.fs.isDir(p) ? c.fs.walk(p).filter((k) => c.fs.isFile(k) && !c.fs.get(k).bin).map((k) => (f === "." ? k.slice(p.length + 1) : f.replace(/\/$/, "") + k.slice(p.length))) : [f]; });
    const multi = !o.h && (files.length > 1 || o.r || o.R || o.H);
    let matched = false;
    let st = 0;
    for (const f of files) {
      const n = f === "-" ? null : c.fs.get(c.path(f));
      if (n && n.type === "dir") { if (!o.s) c.fail(`${f}: Is a directory`); st = 2; continue; }
      const text = f === "-" ? c.stdin() : n ? n.text : (o.s ? null : c.read(f));
      if (text === null) { st = 2; continue; }
      const name = f === "-" ? "(standard input)" : f;
      let count = 0;
      for (const [k, line] of lines(text).entries()) {
        const hit = res.some((re) => { re.lastIndex = 0; return re.test(line); });
        if (hit === !!o.v) continue;
        count++;
        matched = true;
        if (o.q) return 0;
        if (o.c || o.l || o.L) continue;
        const prefix = (multi ? name + ":" : "") + (o.n ? k + 1 + ":" : "");
        if (o.o && !o.v) for (const re of res) { re.lastIndex = 0; for (const m of line.matchAll(re)) if (m[0]) c.out(prefix + m[0] + "\n"); }
        else c.out(prefix + line + "\n");
      }
      if (o.c) c.out((multi ? name + ":" : "") + count + "\n");
      if (o.l && count) c.out(name + "\n");
      if (o.L && !count) c.out(name + "\n");
    }
    return st === 2 && !(matched && o.s) ? 2 : matched ? 0 : 1;
  };
  U.egrep = (c) => { c.args = ["-E", ...c.args]; return U.grep(c); };

  // sed: addresses (N, $, /re/, ranges, !) and the commands s, d, p, q, a, i, c, y and =.
  function parseSed(c, script, n, o) {
    const cmds = [];
    let i = 0;
    const err = (msg) => { throw new Error(`-e expression #${n}, char ${Math.min(i + 1, script.length) || 1}: ${msg}`); };
    const readRe = (delim) => {
      let s = "";
      for (; i < script.length && script[i] !== delim; i++) {
        if (script[i] === "\\" && i + 1 < script.length) { i++; s += script[i] === delim ? delim : script[i] === "n" ? "\\n" : "\\" + script[i]; } else s += script[i];
        if (script[i] === "\n") err(`unterminated \`s' command`);
      }
      if (i >= script.length) return null;
      i++;
      return s;
    };
    const addr = () => {
      if (/\d/.test(script[i])) { const m = /^\d+/.exec(script.slice(i)); i += m[0].length; return { line: Number(m[0]) }; }
      if (script[i] === "$") { i++; return { last: true }; }
      if (script[i] === "/" || script[i] === "\\") {
        const d = script[i] === "\\" ? script[++i] : "/";
        i++;
        const s = readRe(d);
        if (s === null) err("unterminated address regex");
        let re;
        try { re = new RegExp(posixRe(s, o.E), script[i] === "I" ? (i++, "i") : ""); } catch { err("Invalid preceding regular expression"); }
        return { re };
      }
      return null;
    };
    while (i < script.length) {
      while (/[\s;]/.test(script[i] || "")) i++;
      if (i >= script.length) break;
      const cmd = { a1: addr(), a2: null, neg: false };
      if (cmd.a1 && script[i] === ",") { i++; cmd.a2 = addr(); if (!cmd.a2) err("unexpected `,'"); }
      while (script[i] === " ") i++;
      if (script[i] === "!") { cmd.neg = true; i++; }
      while (script[i] === " ") i++;
      cmd.op = script[i++];
      switch (cmd.op) {
        case "s": {
          const d = script[i];
          if (d === undefined || d === "\n" || d === "\\") { i = script.length - 1; err("unterminated `s' command"); }
          i++;
          const pat = readRe(d);
          if (pat === null) { i = script.length - 1; err("unterminated `s' command"); }
          let rep = "";
          for (; i < script.length && script[i] !== d; i++) {
            if (script[i] === "\\" && i + 1 < script.length) { i++; rep += script[i] === d ? d : script[i] === "n" ? "\n" : script[i] === "t" ? "\t" : script[i] === "r" ? "\r" : /\d/.test(script[i]) ? "\x00" + script[i] : script[i] === "&" ? "\x01" : "\\" + script[i]; }
            else rep += script[i];
          }
          if (i >= script.length) { i = script.length - 1; err("unterminated `s' command"); }
          i++;
          cmd.global = false;
          cmd.print = false;
          cmd.nth = 1;
          let flags = "";
          while (i < script.length && !/[;\n}]/.test(script[i])) {
            const f = script[i];
            if (f === "g") cmd.global = true;
            else if (f === "p") cmd.print = true;
            else if (f === "i" || f === "I") flags += "i";
            else if (/\d/.test(f)) cmd.nth = Number(f);
            else if (f === " ") { i++; continue; }
            else err("unknown option to `s'");
            i++;
          }
          try { cmd.re = new RegExp(posixRe(pat, o.E), "g" + flags); } catch { err("Invalid preceding regular expression"); }
          cmd.rep = rep;
          break;
        }
        case "y": {
          const d = script[i++];
          const a = readRe(d);
          const b = readRe(d);
          if (a === null || b === null) err("unterminated `y' command");
          if (a.length !== b.length) err("strings for `y' command are different lengths");
          cmd.from = a;
          cmd.to = b;
          break;
        }
        case "a": case "i": case "c": {
          let text = script.slice(i).replace(/^\\?\s*\n?/, "");
          const end = text.indexOf("\n");
          if (end >= 0) text = text.slice(0, end);
          i += script.slice(i).length - (end >= 0 ? script.slice(i).replace(/^\\?\s*\n?/, "").length - end : 0);
          cmd.text = text.replace(/\\(.)/g, "$1");
          break;
        }
        case "d": case "p": case "q": case "Q": case "=": case "n": case "N": break;
        case "{": case "}": err("unknown command: `{'"); break;
        default: i--; err(`unknown command: \`${cmd.op}'`);
      }
      cmds.push(cmd);
    }
    return cmds;
  }
  function runSed(cmds, text, quiet) {
    const all = lines(text);
    const noNewline = text !== "" && !text.endsWith("\n");
    let out = "";
    const ranges = new Map();
    const match = (a, k, line) => (a.line !== undefined ? k + 1 === a.line : a.last ? k === all.length - 1 : (a.re.lastIndex = 0, a.re.test(line)));
    for (let k = 0; k < all.length; k++) {
      let line = all[k];
      let deleted = false;
      let quit = false;
      const after = [];
      for (const cmd of cmds) {
        let hit = true;
        if (cmd.a1 && !cmd.a2) hit = match(cmd.a1, k, line);
        else if (cmd.a1) {
          const on = ranges.get(cmd);
          if (on) { hit = true; if (cmd.a2.line !== undefined ? k + 1 >= cmd.a2.line : match(cmd.a2, k, line)) ranges.delete(cmd); }
          else if (match(cmd.a1, k, line)) { hit = true; if (!(cmd.a2.line !== undefined && cmd.a2.line <= k + 1)) ranges.set(cmd, true); }
          else hit = false;
        }
        if (cmd.neg) hit = !hit;
        if (!hit) continue;
        if (cmd.op === "s") {
          let n = 0;
          let done = false;
          cmd.re.lastIndex = 0;
          const next = line.replace(cmd.re, (...m) => {
            const groups = m.slice(0, -2);
            n++;
            if (done || (!cmd.global && n !== cmd.nth) || (cmd.global && n < cmd.nth)) return m[0];
            if (!cmd.global) done = true;
            return cmd.rep.replace(/\x00(\d)|\x01|&|\\(.)/g, (r, d, e) => (d !== undefined ? groups[Number(d)] ?? "" : r === "\x01" ? "&" : r === "&" ? groups[0] : e));
          });
          if (n >= cmd.nth) { line = next; if (cmd.print) out += line + "\n"; }
        } else if (cmd.op === "y") line = [...line].map((ch) => { const j = cmd.from.indexOf(ch); return j < 0 ? ch : cmd.to[j]; }).join("");
        else if (cmd.op === "d") { deleted = true; break; }
        else if (cmd.op === "p") out += line + "\n";
        else if (cmd.op === "=") out += k + 1 + "\n";
        else if (cmd.op === "a") after.push(cmd.text);
        else if (cmd.op === "i") out += cmd.text + "\n";
        else if (cmd.op === "c") { out += cmd.text + "\n"; deleted = true; break; }
        else if (cmd.op === "q") { quit = true; break; }
        else if (cmd.op === "Q") { deleted = true; quit = true; break; }
      }
      if (!deleted && !quiet) out += line + (k === all.length - 1 && noNewline && !after.length ? "" : "\n");
      for (const a of after) out += a + "\n";
      if (quit) break;
    }
    return out;
  }
  U.sed = (c) => {
    const o = { n: false, E: false, i: null };
    const scripts = [];
    const files = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-n" || a === "--quiet") o.n = true;
      else if (a === "-E" || a === "-r") o.E = true;
      else if (a === "-e") scripts.push(c.args[++i] ?? "");
      else if (a === "-i" || a === "--in-place") o.i = "";
      else if (/^-i\S/.test(a)) o.i = a.slice(2);
      else if (/^-[nEr]+$/.test(a)) { if (a.includes("n")) o.n = true; if (/[Er]/.test(a)) o.E = true; }
      else if (a[0] === "-" && a.length > 1) return c.usage(`invalid option -- '${a[1]}'`);
      else if (!scripts.length && !c.args.includes("-e")) scripts.push(a);
      else files.push(a);
    }
    if (!scripts.length) { c.err("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n"); return 1; }
    let cmds = [];
    try { scripts.forEach((s, k) => { cmds = cmds.concat(parseSed(c, s, k + 1, o)); }); } catch (e) { return c.fail(e.message); }
    if (o.i !== null) {
      if (!files.length) return c.fail("no input files", 4);
      let st = 0;
      for (const f of files) {
        const p = c.path(f);
        const n = c.fs.get(p);
        if (!n) { c.fail(`can't read ${f}: No such file or directory`); st = 2; continue; }
        if (n.type === "dir") { c.fail(`couldn't edit ${f}: not a regular file`); st = 4; continue; }
        if (c.denied(p, `couldn't open temporary file ${FS.parent(p)}/sedAbC123`)) return 4;
        if (o.i) c.fs.nodes.set(p + o.i, { ...n });
        n.text = runSed(cmds, n.text, o.n);
        n.mtime = c.fs.now;
      }
      return st;
    }
    let text = "";
    let st = 0;
    for (const f of files.length ? files : ["-"]) {
      if (f === "-") { text += c.stdin(); continue; }
      const n = c.fs.get(c.path(f));
      if (!n) { c.fail(`can't read ${f}: No such file or directory`); st = 2; continue; }
      if (n.type === "dir") { c.fail(`read error on ${f}: Is a directory`); st = 2; continue; }
      text += n.text;
    }
    c.out(runSed(cmds, text, o.n));
    return st;
  };

  U.cut = (c) => {
    const g = c.getopt("d:f:c:b:s", { delimiter: "d", fields: "f", characters: "c", "only-delimited": "s" });
    if (!g) return 1;
    const { o } = g;
    const list = o.f ?? o.c ?? o.b;
    if (list === undefined) return c.usage("you must specify a list of bytes, characters, or fields");
    if (o.d !== undefined && o.d.length !== 1) return c.usage("the delimiter must be a single character");
    const ranges = [];
    for (const part of list.split(",")) {
      const m = /^(\d*)(-?)(\d*)$/.exec(part);
      if (!m || (!m[1] && !m[3]) || m[1] === "0") return c.usage(m && m[1] === "0" ? "fields and positions are numbered from 1" : `invalid field value '${part}'`);
      ranges.push([m[1] ? Number(m[1]) : 1, m[2] ? (m[3] ? Number(m[3]) : Infinity) : Number(m[1])]);
    }
    const want = (k) => ranges.some(([a, b]) => k >= a && k <= b);
    const d = o.d ?? "\t";
    let text = "";
    let st = 0;
    for (const f of g.rest.length ? g.rest : ["-"]) { const t = c.read(f); if (t === null) st = 1; else text += t; }
    const out = [];
    for (const line of lines(text)) {
      if (o.f !== undefined) {
        if (!line.includes(d)) { if (!o.s) out.push(line); continue; }
        out.push(line.split(d).filter((x, k) => want(k + 1)).join(d));
      } else out.push([...line].filter((x, k) => want(k + 1)).join(""));
    }
    c.out(joinLines(out));
    return st;
  };

  function sortKey(line, o) {
    if (!o.k) return line;
    const m = /^(\d+)(?:\.\d+)?[a-z]*(?:,(\d+))?/.exec(o.k);
    if (!m) return line;
    const fields = o.t !== undefined ? line.split(o.t) : line.trim().split(/\s+/);
    const from = Number(m[1]) - 1;
    const to = m[2] ? Number(m[2]) : fields.length;
    return fields.slice(from, to).join(o.t ?? " ");
  }
  const HUMAN = { K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  U.sort = (c) => {
    const g = c.getopt("nrufk:t:hVo:sbc", { numeric: "n", reverse: "r", unique: "u", "ignore-case": "f", key: "k", "field-separator": "t", "human-numeric-sort": "h" });
    if (!g) return 2;
    const { o } = g;
    if (o.k && /n/.test(o.k)) o.n = 1;
    if (o.k && /r/.test(o.k)) o.r = 1;
    let text = "";
    for (const f of g.rest.length ? g.rest : ["-"]) {
      const t = f === "-" ? c.stdin() : c.read(f, true);
      if (t === null) { c.err(`sort: cannot read: ${f}: No such file or directory\n`); return 2; }
      text += t && !t.endsWith("\n") ? t + "\n" : t;
    }
    const num = (s) => { const m = /^\s*([-+]?\d*\.?\d+)([KMGT]?)/.exec(s); return m ? Number(m[1]) * (o.h && m[2] ? HUMAN[m[2]] : 1) : 0; };
    const cmpKey = (a, b) => {
      const ka = sortKey(a, o);
      const kb = sortKey(b, o);
      if (o.n || o.h) { const d = num(ka) - num(kb); if (d) return d; if (o.k) return 0; }
      if (o.V) return ka.localeCompare(kb, "en", { numeric: true });
      const x = o.f ? ka.toUpperCase() : ka;
      const y = o.f ? kb.toUpperCase() : kb;
      return byteOrder(x, y);
    };
    let list = lines(text);
    list.sort((a, b) => { const d = cmpKey(a, b); return (o.r ? -d : d) || (o.u || o.s ? 0 : byteOrder(a, b) * (o.r ? -1 : 1)); });
    if (o.u) list = list.filter((x, k) => k === 0 || cmpKey(list[k - 1], x) !== 0);
    if (o.o) { const e = c.fs.write(c.path(o.o), joinLines(list)); if (e) return c.fail(`cannot create '${o.o}': ${ERRNO[e]}`, 2); return 0; }
    c.out(joinLines(list));
    return 0;
  };
  U.uniq = (c) => {
    const g = c.getopt("cdui", { count: "c", repeated: "d", unique: "u", "ignore-case": "i" });
    if (!g) return 1;
    const { o } = g;
    const t = c.read(g.rest[0] ?? "-");
    if (t === null) return 1;
    const groups = [];
    for (const line of lines(t)) {
      const last = groups[groups.length - 1];
      if (last && (o.i ? last[0].toLowerCase() === line.toLowerCase() : last[0] === line)) last[1]++;
      else groups.push([line, 1]);
    }
    const out = groups.filter(([, n]) => (o.d ? n > 1 : o.u ? n === 1 : true)).map(([l, n]) => (o.c ? String(n).padStart(7) + " " + l : l));
    if (g.rest[1]) c.fs.write(c.path(g.rest[1]), joinLines(out)); else c.out(joinLines(out));
    return 0;
  };
  U.wc = (c) => {
    const g = c.getopt("lwcmL", { lines: "l", words: "w", bytes: "c", chars: "m" });
    if (!g) return 1;
    let { o } = g;
    if (!o.l && !o.w && !o.c && !o.m) o = { l: 1, w: 1, c: 1 };
    const files = g.rest.length ? g.rest : ["-"];
    const rows = [];
    let st = 0;
    for (const f of files) {
      const t = c.read(f);
      if (t === null) { st = 1; continue; }
      rows.push([[o.l && (t.match(/\n/g) || []).length, o.w && t.split(/\s+/).filter(Boolean).length, o.m && [...t].length, o.c && new TextEncoder().encode(t).length].filter((x) => x !== undefined && x !== 0 || x === 0).filter((x, k) => [o.l, o.w, o.m, o.c].filter(Boolean)[k] !== undefined), f === "-" ? "" : f]);
    }
    if (rows.length > 1) rows.push([rows[0][0].map((x, k) => rows.reduce((s, r) => s + r[0][k], 0)), "total"]);
    const single = rows.length === 1 && rows[0][0].length === 1;
    const width = single ? 0 : files.includes("-") ? 7 : Math.max(1, ...rows.flatMap((r) => r[0].map((x) => String(x).length)));
    for (const [nums, name] of rows) c.out(nums.map((x) => String(x).padStart(width)).join(" ") + (name ? " " + name : "") + "\n");
    return st;
  };
  function headTail(c, tail) {
    let n = 10;
    let bytes = null;
    let fromStart = false;
    const files = [];
    let quiet = false;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      let m;
      if ((m = /^-(\d+)$/.exec(a))) n = Number(m[1]);
      else if (a === "-n" || a === "--lines" || /^-n./.test(a) || a.startsWith("--lines=")) {
        const v = a === "-n" || a === "--lines" ? c.args[++i] : a.replace(/^(-n|--lines=)/, "");
        if (v === undefined) return c.usage("option requires an argument -- 'n'");
        if (!/^[-+]?\d+$/.test(v)) return c.fail(`invalid number of lines: '${v}'`);
        fromStart = tail && v[0] === "+";
        n = Number(v);
      } else if (a === "-c") bytes = Number(c.args[++i]);
      else if (a === "-q") quiet = true;
      else if (a === "-f" || a === "-F" || a === "--follow") { if (tail) c.err("playground: tail -f would wait for new lines forever; showing the last ones instead\n"); }
      else if (a[0] === "-" && a.length > 1) return c.usage(`invalid option -- '${a[1]}'`);
      else files.push(a);
    }
    let st = 0;
    const list = files.length ? files : ["-"];
    list.forEach((f, k) => {
      const t = c.read(f);
      if (t === null) { st = 1; return; }
      if (list.length > 1 && !quiet) c.out(`${k ? "\n" : ""}==> ${f === "-" ? "standard input" : f} <==\n`);
      if (bytes !== null) { c.out(tail ? t.slice(-bytes) : t.slice(0, bytes)); return; }
      const all = lines(t);
      const keepEnd = t.endsWith("\n");
      let part;
      if (tail) part = fromStart ? all.slice(Math.max(0, n - 1)) : n === 0 ? [] : all.slice(-Math.abs(n));
      else part = n < 0 ? all.slice(0, n) : all.slice(0, n);
      const last = part.length && part[part.length - 1] === all[all.length - 1] && (tail || part.length === all.length) && !keepEnd;
      c.out(part.join("\n") + (part.length && !last ? "\n" : ""));
    });
    return st;
  }
  U.head = (c) => headTail(c, false);
  U.tail = (c) => headTail(c, true);
  U.tee = (c) => {
    const append = c.args.includes("-a");
    const text = c.stdin();
    let st = 0;
    for (const f of c.args.filter((a) => a[0] !== "-" || a === "-")) {
      if (c.denied(c.path(f), f)) { st = 1; continue; }
      const e = c.fs.write(c.path(f), text, append);
      if (e) { c.fail(`${f}: ${ERRNO[e]}`); st = 1; }
    }
    c.out(text);
    return st;
  };
  function trSet(s) {
    s = s.replace(/\[:(\w+):\]/g, (m, n) => ({ upper: "A-Z", lower: "a-z", digit: "0-9", alpha: "A-Za-z", alnum: "A-Za-z0-9", space: " \t\n\r\f\v", blank: " \t", punct: "!-/:-@[-`{-~" }[n] ?? m));
    s = s.replace(/\\(n|t|r|\\|0[0-7]*)/g, (m, e) => ({ n: "\n", t: "\t", r: "\r", "\\": "\\" }[e] ?? String.fromCharCode(parseInt(e, 8))));
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i + 1] === "-" && i + 2 < s.length) { for (let k = s.charCodeAt(i); k <= s.charCodeAt(i + 2); k++) out.push(String.fromCharCode(k)); i += 2; }
      else out.push(s[i]);
    }
    return out;
  }
  U.tr = (c) => {
    const flags = c.args.filter((a) => /^-[dsc]+$/.test(a)).join("");
    const sets = c.args.filter((a) => !/^-[dsc]+$/.test(a));
    if (!sets.length) return c.usage("missing operand");
    const del = flags.includes("d");
    const squeeze = flags.includes("s");
    if (!del && !squeeze && sets.length < 2) return c.usage(`missing operand after '${sets[0]}'\nTwo strings must be given when translating.`.split("\n")[0]);
    const a = trSet(sets[0]);
    const b = sets[1] !== undefined ? trSet(sets[1]) : [];
    const inA = (ch) => (flags.includes("c") ? !a.includes(ch) : a.includes(ch));
    let out = "";
    for (const ch of c.stdin()) {
      if (del && inA(ch)) continue;
      let t = ch;
      if (!del && b.length && inA(ch)) t = b[Math.min(a.indexOf(ch), b.length - 1)] ?? ch;
      const sq = squeeze && (del ? b : b.length ? b : a);
      if (sq && sq.includes(t) && out.endsWith(t)) continue;
      out += t;
    }
    c.out(out);
    return 0;
  };
  U.seq = (c) => {
    let sep = "\n";
    let wide = false;
    const nums = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-s") sep = c.args[++i] ?? "\n";
      else if (/^-s./.test(a)) sep = a.slice(2);
      else if (a === "-w") wide = true;
      else nums.push(a);
    }
    if (!nums.length) return c.usage("missing operand");
    for (const x of nums) if (!/^[-+]?\d*\.?\d+$/.test(x)) return c.usage(`invalid floating point argument: '${x}'`);
    const [first, step, last] = nums.length === 1 ? [1, 1, Number(nums[0])] : nums.length === 2 ? [Number(nums[0]), 1, Number(nums[1])] : nums.map(Number);
    if (step === 0) return c.usage("invalid Zero increment value: '0'");
    const out = [];
    for (let v = first; step > 0 ? v <= last : v >= last; v += step) { out.push(v); if (out.length > 100000) break; }
    const w = Math.max(...out.map((v) => String(v).length));
    if (out.length) c.out(out.map((v) => (wide ? String(v).padStart(w, "0") : String(v))).join(sep) + "\n");
    return 0;
  };
  U.rev = (c) => { c.out(joinLines(lines(c.stdin()).map((l) => [...l].reverse().join("")))); return 0; };
  U.nl = (c) => { let k = 0; c.out(joinLines(lines(c.read(c.args[0] ?? "-") ?? "").map((l) => (l ? String(++k).padStart(6) + "\t" + l : l)))); return 0; };

  // awk: patterns, actions, fields, variables, arrays, the common built-in functions.
  function awk(c, program, files, vars, fs) {
    const toks = [];
    const re = /\s*(?:(#[^\n]*)|(\n)|("(?:\\.|[^"\\])*")|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_]\w*)|(\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||!~|>>|[-+*/%^!<>=~?:;,(){}[\]$|])|(\/))/y;
    let pos = 0;
    let prevValue = false;
    while (pos < program.length) {
      re.lastIndex = pos;
      if (/^\s*$/.test(program.slice(pos))) break;
      // A slash starts a regex unless the previous token was a value.
      const ws = /^[ \t]*/.exec(program.slice(pos))[0].length;
      if (program[pos + ws] === "/" && !prevValue) {
        let j = pos + ws + 1;
        let s = "";
        for (; j < program.length && program[j] !== "/"; j++) { if (program[j] === "\\") { s += program[j] + program[j + 1]; j++; } else s += program[j]; }
        if (j >= program.length) throw new Error("runaway regular expression /" + s.slice(0, 10) + " ...");
        toks.push({ k: "re", v: s });
        pos = j + 1;
        prevValue = true;
        continue;
      }
      const m = re.exec(program);
      if (!m) throw new Error(`syntax error at or near ${program[pos + ws]}`);
      pos = re.lastIndex;
      if (m[1]) continue;
      if (m[2]) { toks.push({ k: "nl" }); prevValue = false; continue; }
      if (m[3]) toks.push({ k: "str", v: JSON.parse(m[3].replace(/\\([^"\\nt])/g, "\\\\$1").replace(/\\\\\//g, "/")) });
      else if (m[4]) toks.push({ k: "num", v: Number(m[4]) });
      else if (m[5]) toks.push({ k: "id", v: m[5] });
      else toks.push({ k: "op", v: m[6] || m[7] });
      prevValue = !!(m[3] || m[4] || m[5]) || m[6] === ")" || m[6] === "]" || m[6] === "$";
      if (m[6] === "$") prevValue = false;
    }
    let i = 0;
    const peek = () => toks[i] || { k: "eof" };
    const isOp = (v) => peek().k === "op" && peek().v === v;
    const isId = (v) => peek().k === "id" && peek().v === v;
    const fail = () => { const t = peek(); throw new Error(`syntax error at or near ${t.k === "eof" ? "end of file" : t.v ?? "newline"}`); };
    const expect = (v) => { if (!isOp(v)) fail(); i++; };
    const nl = () => { while (peek().k === "nl" || isOp(";")) i++; };
    const BUILTIN = new Set(["length", "substr", "index", "split", "sub", "gsub", "tolower", "toupper", "sprintf", "int", "match", "system"]);

    // Expressions, lowest precedence first. Each returns a function of the record state.
    function expr(noIn) { return ternary(noIn); }
    function ternary(noIn) {
      const cnd = or(noIn);
      if (isOp("?")) { i++; const a = ternary(noIn); expect(":"); const b = ternary(noIn); return (s) => (truthy(cnd(s)) ? a(s) : b(s)); }
      if (peek().k === "op" && ["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(peek().v) && cnd.lv) {
        const op = toks[i++].v;
        const rhs = ternary(noIn);
        return (s) => { const v = op === "=" ? rhs(s) : arithOp(op[0], num(cnd(s)), num(rhs(s))); cnd.lv(s, v); return v; };
      }
      return cnd;
    }
    function or(noIn) { let a = and(noIn); while (isOp("||")) { i++; nl(); const l = a; const r = and(noIn); a = (s) => +(truthy(l(s)) || truthy(r(s))); } return a; }
    function and(noIn) { let a = inExpr(noIn); while (isOp("&&")) { i++; nl(); const l = a; const r = inExpr(noIn); a = (s) => +(truthy(l(s)) && truthy(r(s))); } return a; }
    function inExpr(noIn) {
      let a = match(noIn);
      while (!noIn && isId("in")) { i++; const arr = toks[i++].v; const k = a; a = (s) => +(key(k(s)) in (s.arrays[arr] || {})); }
      return a;
    }
    function match(noIn) {
      let a = compare(noIn);
      while (isOp("~") || isOp("!~")) {
        const neg = toks[i++].v === "!~";
        const l = a;
        const r = compare(noIn);
        a = (s) => { const hit = toRe(r.re ?? r(s)).test(str(l(s))); return +(neg ? !hit : hit); };
      }
      return a;
    }
    function compare(noIn) {
      const a = concat();
      if (peek().k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(peek().v) && !(peek().v === ">" && printing)) {
        const op = toks[i++].v;
        const b = concat();
        return (s) => {
          const x = a(s);
          const y = b(s);
          const numeric = isNum(x) && isNum(y);
          const p = numeric ? num(x) : str(x);
          const q = numeric ? num(y) : str(y);
          return +{ "<": p < q, "<=": p <= q, ">": p > q, ">=": p >= q, "==": p === q, "!=": p !== q }[op];
        };
      }
      return a;
    }
    function startsValue() {
      const t = peek();
      return t.k === "num" || t.k === "str" || t.k === "re" || (t.k === "id" && t.v !== "in" && t.v !== "getline") || (t.k === "op" && ["$", "!", "(", "-", "+", "++", "--"].includes(t.v));
    }
    function concat() {
      let a = additive();
      while (startsValue() && !(peek().k === "op" && (peek().v === "-" || peek().v === "+"))) {
        const l = a;
        const r = additive();
        a = (s) => str(l(s)) + str(r(s));
      }
      return a;
    }
    function additive() {
      let a = mult();
      while (isOp("+") || isOp("-")) { const op = toks[i++].v; const l = a; const r = mult(); a = (s) => arithOp(op, num(l(s)), num(r(s))); }
      return a;
    }
    function mult() {
      let a = unary();
      while (isOp("*") || isOp("/") || isOp("%")) { const op = toks[i++].v; const l = a; const r = unary(); a = (s) => arithOp(op, num(l(s)), num(r(s))); }
      return a;
    }
    function unary() {
      if (isOp("!")) { i++; const a = unary(); return (s) => +!truthy(a(s)); }
      if (isOp("-")) { i++; const a = unary(); return (s) => -num(a(s)); }
      if (isOp("+")) { i++; const a = unary(); return (s) => num(a(s)); }
      return power();
    }
    function power() {
      const a = postfix();
      if (isOp("^")) { i++; const b = unary(); return (s) => num(a(s)) ** num(b(s)); }
      return a;
    }
    function postfix() {
      if (isOp("++") || isOp("--")) {
        const d = toks[i++].v === "++" ? 1 : -1;
        const a = primary();
        if (!a.lv) fail();
        return (s) => { const v = num(a(s)) + d; a.lv(s, v); return v; };
      }
      const a = primary();
      if (a.lv && (isOp("++") || isOp("--"))) {
        const d = toks[i++].v === "++" ? 1 : -1;
        return (s) => { const v = num(a(s)); a.lv(s, v + d); return v; };
      }
      return a;
    }
    function primary() {
      const t = toks[i++] || { k: "eof" };
      if (t.k === "num") return () => t.v;
      if (t.k === "str") return () => t.v;
      if (t.k === "re") { const f = (s) => +toRe(t.v).test(s.rec); f.re = t.v; return f; }
      if (t.k === "op" && t.v === "(") { const e = expr(); expect(")"); return e; }
      if (t.k === "op" && t.v === "$") {
        const n = primary();
        const f = (s) => field(s, num(n(s)));
        f.lv = (s, v) => setField(s, num(n(s)), v);
        return f;
      }
      if (t.k === "id") {
        if (BUILTIN.has(t.v)) {
          const args = [];
          if (isOp("(")) {
            i++;
            if (!isOp(")")) { args.push(expr()); while (isOp(",")) { i++; args.push(expr()); } }
            expect(")");
          }
          return builtin(t.v, args);
        }
        if (isOp("[")) {
          i++;
          const ks = [expr()];
          while (isOp(",")) { i++; ks.push(expr()); }
          expect("]");
          const k = (s) => ks.map((x) => key(x(s))).join("\x1c");
          const f = (s) => { const arr = (s.arrays[t.v] ||= {}); return arr[k(s)] ?? ""; };
          f.lv = (s, v) => { (s.arrays[t.v] ||= {})[k(s)] = v; };
          return f;
        }
        const f = (s) => getVar(s, t.v);
        f.lv = (s, v) => setVar(s, t.v, v);
        f.varName = t.v;
        return f;
      }
      i--;
      fail();
    }
    function builtin(name, args) {
      return (s) => {
        const a = args.map((x) => x);
        switch (name) {
          case "length": return a.length ? (a[0].varName && s.arrays[a[0].varName] ? Object.keys(s.arrays[a[0].varName]).length : str(a[0](s)).length) : s.rec.length;
          case "substr": { const x = str(a[0](s)); const m = Math.round(num(a[1](s))); const n = a[2] ? Math.round(num(a[2](s))) : Infinity; const from = Math.max(1, m); const to = Math.min(x.length + 1, m + n); return to > from ? x.slice(from - 1, to - 1) : ""; }
          case "index": return str(a[0](s)).indexOf(str(a[1](s))) + 1;
          case "split": {
            const parts = splitFields(str(a[0](s)), a[2] ? str(a[2].re ?? a[2](s)) : s.vars.FS);
            const name2 = args[1].varName;
            s.arrays[name2] = {};
            parts.forEach((p, k) => { s.arrays[name2][k + 1] = p; });
            return parts.length;
          }
          case "sub": case "gsub": {
            const target = a[2] || ((st) => st.rec);
            const r = new RegExp(posixRe(String(a[0].re ?? a[0](s)), true), name === "gsub" ? "g" : "");
            const rep = str(a[1](s));
            let n = 0;
            const out = str(target(s)).replace(r, (m) => { n++; return rep.replace(/\\&|&/g, (x) => (x === "&" ? m : "&")); });
            if (n) { if (a[2] && a[2].lv) a[2].lv(s, out); else if (!a[2]) setField(s, 0, out); }
            return n;
          }
          case "tolower": return str(a[0](s)).toLowerCase();
          case "toupper": return str(a[0](s)).toUpperCase();
          case "int": return Math.trunc(num(a[0](s)));
          case "sprintf": return printf(c.sh, a.map((x) => str(x(s))), () => {}).out;
          case "match": { const m = toRe(a[1].re ?? a[1](s)).exec(str(a[0](s))); s.vars.RSTART = m ? m.index + 1 : 0; s.vars.RLENGTH = m ? m[0].length : -1; return s.vars.RSTART; }
          case "system": return c.run(["sh", "-c", str(a[0](s))]);
        }
        return "";
      };
    }
    let printing = false;
    function statement() {
      nl();
      if (isOp("{")) { i++; const body = block(); return body; }
      if (isId("if")) {
        i++; expect("("); const cnd = expr(); expect(")");
        const a = statement();
        nl();
        let b = null;
        if (isId("else")) { i++; b = statement(); }
        return (s) => (truthy(cnd(s)) ? a(s) : b && b(s));
      }
      if (isId("while")) {
        i++; expect("("); const cnd = expr(); expect(")");
        const body = statement();
        return (s) => { let n = 0; while (truthy(cnd(s))) { if (++n > 100000) throw new Error("loop limit"); const r = body(s); if (r === "break") break; if (r === "next" || r === "exit") return r; } };
      }
      if (isId("for")) {
        i++; expect("(");
        if (peek().k === "id" && toks[i + 1] && toks[i + 1].k === "id" && toks[i + 1].v === "in") {
          const v = toks[i].v; const arr = toks[i + 2].v; i += 3; expect(")");
          const body = statement();
          return (s) => { for (const k of Object.keys(s.arrays[arr] || {})) { setVar(s, v, k); const r = body(s); if (r === "break") break; if (r === "next" || r === "exit") return r; } };
        }
        const init = isOp(";") ? () => 0 : expr(); expect(";");
        const cnd = isOp(";") ? () => 1 : expr(); expect(";");
        const step = isOp(")") ? () => 0 : expr(); expect(")");
        const body = statement();
        return (s) => { let n = 0; for (init(s); truthy(cnd(s)); step(s)) { if (++n > 100000) throw new Error("loop limit"); const r = body(s); if (r === "break") break; if (r === "next" || r === "exit") return r; } };
      }
      if (isId("next")) { i++; return () => "next"; }
      if (isId("break")) { i++; return () => "break"; }
      if (isId("exit")) { i++; const e = startsValue() ? expr() : null; return (s) => { if (e) s.code = num(e(s)); return "exit"; }; }
      if (isId("delete")) {
        i++; const name = toks[i++].v;
        if (isOp("[")) { i++; const k = expr(); expect("]"); return (s) => { delete (s.arrays[name] || {})[key(k(s))]; }; }
        return (s) => { s.arrays[name] = {}; };
      }
      if (isId("print") || isId("printf")) {
        const isPrintf = toks[i++].v === "printf";
        printing = true;
        const args = [];
        if (startsValue() && !isOp(";") && !isOp("}")) { args.push(expr(true)); while (isOp(",")) { i++; args.push(expr(true)); } }
        printing = false;
        let dest = null;
        if (isOp(">") || isOp(">>") || isOp("|")) { const how = toks[i++].v; const d = concat(); dest = { how, d }; }
        return (s) => {
          const vals = args.map((x) => x(s));
          const text = isPrintf ? printf(c.sh, vals.map(str), () => {}).out : (vals.length ? vals.map((v) => (typeof v === "number" ? fmtNum(v, s.vars.OFMT) : String(v))).join(str(s.vars.OFS)) : s.rec) + str(s.vars.ORS);
          if (!dest) { s.out += text; return; }
          const target = str(dest.d(s));
          if (dest.how === "|") { s.out += text; return; }
          const p = c.path(target);
          if (!s.opened.has(p) && dest.how === ">") { c.fs.write(p, "", false); s.opened.add(p); }
          c.fs.write(p, text, true);
        };
      }
      if (isOp(";")) { i++; return () => {}; }
      const e = expr();
      return (s) => { e(s); };
    }
    function block() {
      const list = [];
      nl();
      while (!isOp("}")) {
        if (peek().k === "eof") fail();
        list.push(statement());
        nl();
      }
      i++;
      return (s) => { for (const st of list) { const r = st(s); if (r) return r; } };
    }
    const rules = [];
    nl();
    while (peek().k !== "eof") {
      let kind = "main";
      let pat = null;
      if (isId("BEGIN") || isId("END")) kind = toks[i++].v;
      else if (!isOp("{")) pat = expr();
      let action = null;
      if (isOp("{")) { i++; action = block(); }
      else if (kind !== "main") fail();
      rules.push({ kind, pat, action });
      nl();
    }

    // Values: numbers stay numbers; strings that came from input compare as numbers when they look like them.
    function isNum(v) { return typeof v === "number" || (v instanceof Strnum); }
    function num(v) { if (typeof v === "number") return v; const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(String(v)); return m ? Number(m[0]) : 0; }
    function fmtNum(v, f) { return Number.isInteger(v) ? String(v) : printf(c.sh, [f || "%.6g", String(v)], () => {}).out; }
    function str(v) { return typeof v === "number" ? fmtNum(v, "%.6g") : String(v); }
    function key(v) { return str(v); }
    function truthy(v) { return typeof v === "number" ? v !== 0 : v instanceof Strnum ? num(v) !== 0 : v !== ""; }
    function arithOp(op, a, b) { switch (op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": if (b === 0) throw new Error("division by zero"); return a / b; case "%": if (b === 0) throw new Error("division by zero in %"); return a % b; case "^": return a ** b; } return 0; }
    function toRe(src) { try { return new RegExp(posixRe(String(src), true)); } catch { return /(?!)/; } }
    function splitFields(rec, sep) {
      if (sep === " ") return rec.trim() ? rec.trim().split(/[ \t\n]+/) : [];
      if (rec === "") return [];
      if (sep.length === 1 && sep !== "\\") return rec.split(sep);
      return rec.split(toRe(sep === "\\t" ? "\t" : sep));
    }
    function field(s, n) { if (n === 0) return new Strnum(s.rec); const v = s.fields[n - 1]; return v === undefined ? "" : new Strnum(v); }
    function setField(s, n, v) {
      if (n === 0) { s.rec = str(v); s.fields = splitFields(s.rec, str(s.vars.FS)); s.vars.NF = s.fields.length; return; }
      while (s.fields.length < n) s.fields.push("");
      s.fields[n - 1] = str(v);
      s.vars.NF = s.fields.length;
      s.rec = s.fields.join(str(s.vars.OFS));
    }
    function getVar(s, n) { if (n === "NF") return s.fields.length; return s.vars[n] ?? ""; }
    function setVar(s, n, v) { if (n === "NF") { s.fields.length = num(v); s.rec = s.fields.join(str(s.vars.OFS)); } s.vars[n] = v; }

    const s = { vars: { FS: fs ?? " ", OFS: " ", ORS: "\n", NR: 0, FNR: 0, OFMT: "%.6g", SUBSEP: "\x1c", ...vars }, arrays: {}, rec: "", fields: [], out: "", code: 0, opened: new Set() };
    const flush = () => { if (s.out) { c.out(s.out); s.out = ""; } };
    const run = (kind) => { for (const r of rules) if (r.kind === kind) { const res = r.action(s); flush(); if (res === "exit") return true; } return false; };
    if (run("BEGIN")) return s.code;
    if (rules.some((r) => r.kind !== "BEGIN")) {
      let st = 0;
      outer: for (const f of files.length ? files : ["-"]) {
        const text = c.read(f);
        if (text === null) { st = 2; continue; }
        s.vars.FILENAME = f === "-" ? "" : f;
        s.vars.FNR = 0;
        for (const line of lines(text)) {
          s.vars.NR++;
          s.vars.FNR++;
          setField(s, 0, line);
          for (const r of rules) {
            if (r.kind !== "main") continue;
            if (r.pat && !truthy(r.pat(s))) continue;
            const res = r.action ? r.action(s) : (s.out += s.rec + str(s.vars.ORS), null);
            if (res === "next") break;
            if (res === "exit") { flush(); break outer; }
          }
          flush();
        }
      }
      run("END");
      flush();
      return s.code || st;
    }
    return s.code;
  }
  class Strnum { constructor(v) { this.v = v; } toString() { return this.v; } }
  U.awk = (c) => {
    let fs;
    const vars = {};
    let program = null;
    const files = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (program === null && (a === "-F" || /^-F./.test(a))) { fs = a === "-F" ? c.args[++i] : a.slice(2); if (fs === "t" || fs === "\\t") fs = "\t"; }
      else if (program === null && (a === "-v" || /^-v./.test(a))) { const [k, ...v] = (a === "-v" ? c.args[++i] : a.slice(2)).split("="); vars[k] = escapes(v.join("="), false).out; }
      else if (program === null && a === "--") continue;
      else if (program === null) program = a;
      else if (/^[A-Za-z_]\w*=/.test(a)) { const [k, ...v] = a.split("="); vars[k] = v.join("="); }
      else files.push(a);
    }
    if (program === null) { c.err("usage: awk [-F value] [-v var=value] [--] 'program text' [file ...]\n"); return 2; }
    try { return awk(c, program, files, vars, fs); } catch (e) {
      if (e && e.message) { c.err(`awk: line 1: ${e.message}\n`); return 2; }
      throw e;
    }
  };

  // --- processes and the environment ---

  U.env = (c) => {
    const env = { ...c.env };
    let i = 0;
    for (; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-i" || a === "-" || a === "--ignore-environment") for (const k of Object.keys(env)) delete env[k];
      else if (a === "-u") delete env[c.args[++i]];
      else if (/^[A-Za-z_]\w*=/.test(a)) { const k = a.indexOf("="); env[a.slice(0, k)] = a.slice(k + 1); }
      else if (a === "--") { i++; break; }
      else break;
    }
    const cmd = c.args.slice(i);
    if (!cmd.length) { c.out(joinLines(Object.entries(env).map(([k, v]) => `${k}=${v}`))); return 0; }
    const hit = c.sys.resolve(cmd[0], env.PATH ?? "/usr/bin:/bin", c.cwd);
    if (!hit || !hit.n) { c.err(`env: '${cmd[0]}': No such file or directory\n`); return 127; }
    if (hit.n.type === "dir" || !(hit.n.mode & 0o111)) { c.err(`env: '${cmd[0]}': Permission denied\n`); return 126; }
    return c.sys.execFile(hit.n, cmd, env, c.cwd, c.io, c.sh);
  };
  U.printenv = (c) => {
    if (!c.args.length) return U.env(c);
    let st = 0;
    for (const k of c.args) { if (k in c.env) c.out(c.env[k] + "\n"); else st = 1; }
    return st;
  };
  // bash and sh as programs: a script file, -c, or -n to check the syntax only.
  function shellProgram(c, posix) {
    const flags = [];
    let i = 0;
    let cmd = null;
    let parseOnly = false;
    for (; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-c") { cmd = c.args[++i]; i++; break; }
      if (a === "-n") { parseOnly = true; continue; }
      if (a === "--") { i++; break; }
      if (/^-[euxvo]+$/.test(a)) { if (a.includes("o")) { flags.push("-o:" + c.args[++i]); continue; } flags.push(a); continue; }
      if (a === "-l" || a === "-i" || a === "--login" || a === "--norc" || a === "--noprofile") continue;
      if (a[0] === "-" && a.length > 1) { c.err(`${c.name}: ${a}: invalid option\n`); return 2; }
      break;
    }
    const shellFlags = flags.filter((f) => !f.startsWith("-o:"));
    const setOpts = (sh) => { for (const f of flags) if (f.startsWith("-o:")) { if (f === "-o:pipefail") sh.opts.pipefail = true; } };
    const name = FS.base(c.name);
    if (cmd !== null) {
      if (cmd === undefined) { c.err(`${name}: -c: option requires an argument\n`); return 2; }
      const rest = c.args.slice(i);
      return runWith(c, cmd, { argv0: rest[0] ?? name, args: rest.slice(1), file: name, posix, flags: shellFlags, setOpts, parseOnly });
    }
    const file = c.args[i];
    if (file === undefined) {
      const text = c.stdin();
      if (c.io.fds[0].tty) { c.err("playground: an interactive shell inside the terminal is not supported; run a script or use bash -c\n"); return 1; }
      return runWith(c, text, { argv0: name, args: [], file: name, posix, flags: shellFlags, setOpts, parseOnly });
    }
    const p = c.path(file);
    const n = c.fs.get(p);
    if (!n) { c.err(`${name}: ${file}: No such file or directory\n`); return 127; }
    if (n.type === "dir") { c.err(`${name}: ${file}: Is a directory\n`); return 126; }
    return runWith(c, n.text, { argv0: file, args: c.args.slice(i + 1), file, posix, flags: shellFlags, setOpts, parseOnly });
  }
  function runWith(c, text, o) {
    const sh = new Shell(c.sys, { env: c.env, cwd: c.cwd, args: o.args, arg0: o.argv0, file: o.file, posix: o.posix });
    for (const f of o.flags) for (const ch of f.slice(1)) if (ch in sh.opts) sh.opts[ch] = true;
    o.setOpts(sh);
    sh.parseOnly = o.parseOnly;
    sh.io = c.io;
    const st = sh.main(text, c.io);
    if (sh.killedBy && c.sh && c.sh.tty) c.err(sh.killedBy === "HUP" ? "Hangup\n" : "Terminated\n");
    return st;
  }
  U.bash = (c) => shellProgram(c, false);
  U.sh = (c) => shellProgram(c, true);
  U.dash = U.sh;
  U.sudo = (c) => {
    const args = c.args.filter((a, k) => !(k === 0 && a === "-E"));
    if (!args.length) { c.err("usage: sudo -h | -K | -k | -V\n"); return 1; }
    const hit = c.sys.resolve(args[0], c.env.PATH, c.cwd);
    if (!hit || !hit.n || hit.n.type === "dir" || !(hit.n.mode & 0o111)) { c.err(`sudo: ${args[0]}: command not found\n`); return 1; }
    return c.sys.execFile(hit.n, args, { ...c.env, USER: "root", HOME: "/root", LOGNAME: "root", SUDO_USER: "dev" }, c.cwd, c.io, c.sh);
  };
  U.xargs = (c) => {
    let n = Infinity;
    let rep = null;
    let noEmpty = false;
    let nul = false;
    let par = 1;
    let i = 0;
    for (; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-n") n = Number(c.args[++i]);
      else if (/^-n\d+$/.test(a)) n = Number(a.slice(2));
      else if (a === "-I") rep = c.args[++i];
      else if (/^-I./.test(a)) rep = a.slice(2);
      else if (a === "-r" || a === "--no-run-if-empty") noEmpty = true;
      else if (a === "-0" || a === "--null") nul = true;
      else if (a === "-P") par = Math.max(1, Number(c.args[++i]) || 1);
      else if (/^-P\d+$/.test(a)) par = Math.max(1, Number(a.slice(2)));
      else if (a === "-t") continue;
      else if (a[0] === "-" && a.length > 1) return c.usage(`invalid option -- '${a[1]}'`);
      else break;
    }
    const cmd = c.args.slice(i).length ? c.args.slice(i) : ["echo"];
    const text = c.stdin();
    let items;
    if (nul) items = text.split("\0").filter(Boolean);
    else if (rep !== null) items = lines(text).map((l) => l.trim()).filter(Boolean);
    else {
      items = [];
      const re = /"([^"]*)"|'([^']*)'|((?:\\.|[^\s'"])+)/g;
      for (const m of text.matchAll(re)) items.push(m[1] ?? m[2] ?? m[3].replace(/\\(.)/g, "$1"));
    }
    if (!items.length && noEmpty) return 0;
    const batches = [];
    if (rep !== null) items.forEach((x) => batches.push(cmd.map((w) => w.split(rep).join(x))));
    else if (!items.length) batches.push(cmd);
    else for (let k = 0; k < items.length; k += n) batches.push([...cmd, ...items.slice(k, k + n)]);
    let st = 0;
    // -P N runs N commands at a time: each starts when a slot is free.
    const slots = Array(par).fill(c.fs.now);
    for (const argv of batches) {
      const hit = c.sys.resolve(argv[0], c.env.PATH, c.cwd);
      if (!hit || !hit.n) { c.err(`xargs: ${argv[0]}: No such file or directory\n`); return 127; }
      const k = slots.indexOf(Math.min(...slots));
      c.fs.now = slots[k];
      const r = c.sys.execFile(hit.n, argv, c.env, c.cwd, c.io, c.sh);
      slots[k] = c.fs.now;
      if (r === 255) { c.err(`xargs: ${argv[0]}: exited with status 255; aborting\n`); return 124; }
      if (r) st = 123;
    }
    c.fs.now = Math.max(...slots);
    return st;
  };
  // timeout DURATION COMMAND: TERM when the time is up, and exit status 124.
  U.timeout = (c) => {
    const a = c.args.slice();
    let kill = false;
    let preserve = false;
    while (a.length && a[0][0] === "-") {
      const o = a.shift();
      if (o === "-s" || o === "--signal") kill = /KILL|9/.test(a.shift() || "");
      else if (o === "-k" || o === "--kill-after") a.shift();
      else if (o === "--preserve-status") preserve = true;
      else if (o === "--foreground" || o === "-v" || o === "--verbose") continue;
      else return c.usage(`invalid option -- '${o.replace(/^-+/, "")}'`, 125);
    }
    if (a.length < 2) return c.usage(a.length ? `missing operand after '${a[0]}'` : "missing operand", 125);
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(a[0]);
    if (!m) return c.usage(`invalid time interval '${a[0]}'`, 125);
    const limit = Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
    const deadline = c.fs.now + limit;
    c.sys.deadlines.push(deadline);
    try { return c.run(a.slice(1)); } catch (e) {
      if (!(e instanceof Signal) || !e.deadline || c.fs.now < deadline) throw e;
      return preserve ? 143 : kill ? 137 : 124;
    } finally { c.sys.deadlines.splice(c.sys.deadlines.indexOf(deadline), 1); }
  };
  U.time = (c) => {
    const st = c.args.length ? c.run(c.args) : 0;
    c.err("\nreal\t0m0.004s\nuser\t0m0.001s\nsys\t0m0.002s\n");
    return st;
  };
  // nohup: ignore SIGHUP, and keep output that would go to the terminal in nohup.out.
  U.nohup = (c) => {
    if (!c.args.length) return c.usage("missing operand", 125);
    const io = { fds: { ...c.io.fds } };
    if (c.io.fds[0] && c.io.fds[0].tty) io.fds[0] = new root.ShellSim.Reader("");
    if (c.io.fds[1] && c.io.fds[1].tty) {
      c.err("nohup: ignoring input and appending output to 'nohup.out'\n");
      const p = c.path("nohup.out");
      if (!c.fs.get(p)) c.fs.write(p, "");
      io.fds[1] = { write: (s) => c.fs.write(p, s, true), path: p };
      if (c.io.fds[2] && c.io.fds[2].tty) io.fds[2] = io.fds[1];
    } else if (c.io.fds[0] && c.io.fds[0].tty) c.err("nohup: ignoring input\n");
    return c.run(c.args, io);
  };
  U.setsid = (c) => (c.args.length ? c.run(c.args.filter((x, k) => !(k === 0 && x === "-f"))) : c.usage("missing operand"));
  U.true = () => 0;
  U.false = () => 1;
  U.echo = (c) => Shell.builtins.echo(c.sh, c.args, c.io);
  U.printf = (c) => Shell.builtins.printf(c.sh, c.args, c.io);
  U.test = (c) => Shell.builtins.test(c.sh, c.args, c.io);
  U["["] = (c) => Shell.builtins["["](c.sh, c.args, c.io);
  U.which = (c) => {
    let st = 0;
    for (const a of c.args.filter((x) => x[0] !== "-")) {
      const hit = c.sys.resolve(a, c.env.PATH, c.cwd);
      if (hit && hit.n) c.out(hit.p + "\n"); else st = 1;
    }
    return st;
  };
  U.whoami = (c) => { c.out((c.env.USER || "dev") + "\n"); return 0; };
  U.id = (c) => {
    const root = c.env.USER === "root";
    if (c.args.includes("-u")) { c.out(root ? "0\n" : "1000\n"); return 0; }
    if (c.args.includes("-un")) { c.out(root ? "root\n" : "dev\n"); return 0; }
    c.out(root ? "uid=0(root) gid=0(root) groups=0(root)\n" : "uid=1000(dev) gid=1000(dev) groups=1000(dev),27(sudo)\n");
    return 0;
  };
  U.hostname = (c) => { c.out(c.sys.hostname + "\n"); return 0; };
  U.uname = (c) => { c.out(c.args.includes("-a") ? `Linux ${c.sys.hostname} 6.8.0-48-generic #48-Ubuntu SMP x86_64 x86_64 x86_64 GNU/Linux\n` : c.args.includes("-r") ? "6.8.0-48-generic\n" : "Linux\n"); return 0; };
  U.nproc = (c) => { c.out("4\n"); return 0; };
  U.logger = (c) => {
    const tagAt = c.args.indexOf("-t");
    const tag = tagAt >= 0 ? c.args[tagAt + 1] : c.env.USER || "dev";
    const msg = c.args.filter((a, k) => !(a === "-t" || (tagAt >= 0 && k === tagAt + 1)) && !/^-[sp]$/.test(a)).join(" ") || c.stdin().trim();
    const d = new Date(c.fs.now * 1000);
    c.fs.write("/var/log/syslog", `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${strftime("%T", c.fs.now)} ${c.sys.hostname} ${tag}: ${msg}\n`, true);
    return 0;
  };
  U.ps = (c) => {
    const procs = [...c.sys.procs, ...c.sys.running().map((j) => ({ pid: j.pid, cmd: j.cmd, user: "dev" })), { pid: c.sh ? c.sys.rootPid(c.sh) : 4101, cmd: "-bash", user: "dev" }];
    const full = c.args.some((a) => /aux|ef/.test(a));
    c.out(full ? "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n" + procs.map((p) => `${(p.user || "dev").padEnd(8)} ${String(p.pid).padStart(7)}  0.0  0.1  ${p.cmd.length * 100 + 7000}  3400 ?        S    03:00   0:00 ${p.cmd}\n`).join("")
      : "    PID TTY          TIME CMD\n" + procs.map((p) => `${String(p.pid).padStart(7)} pts/0    00:00:00 ${p.cmd.split(" ")[0].split("/").pop()}\n`).join(""));
    return 0;
  };
  U.pgrep = (c) => {
    const f = c.args.includes("-f");
    const pat = c.args.filter((a) => a[0] !== "-")[0];
    if (!pat) return c.usage("no matching criteria specified", 2);
    let re;
    try { re = new RegExp(pat); } catch { return 2; }
    const hits = c.sys.procs.filter((p) => re.test(f ? p.cmd : p.cmd.split(" ")[0].split("/").pop()));
    for (const p of hits) c.out((c.args.includes("-a") || c.args.includes("-l") ? `${p.pid} ${p.cmd}` : p.pid) + "\n");
    return hits.length ? 0 : 1;
  };
  U.kill = (c) => {
    let st = 0;
    for (const a of c.args.filter((x) => !/^-/.test(x))) {
      const k = c.sys.procs.findIndex((p) => String(p.pid) === a);
      if (k < 0) { c.err(`kill: (${a}) - No such process\n`); st = 1; continue; }
      if (!c.args.includes("-0")) c.sys.procs.splice(k, 1);
    }
    return st;
  };
  // flock -n FILE CMD..., flock -n FD (with exec FD>FILE): a lock held by another run makes -n fail at once.
  U.flock = (c) => {
    let nb = false;
    const rest = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-n" || a === "--nonblock" || a === "-x" || a === "-e") { if (a === "-n" || a === "--nonblock") nb = true; }
      else if (a === "-w" || a === "-E") i++;
      else if (a === "-c") rest.push("-c");
      else rest.push(a);
    }
    if (!rest.length) return c.usage("not enough arguments");
    const target = rest[0];
    let path;
    if (/^\d+$/.test(target)) {
      const w = c.io.fds[target];
      if (!w || !w.path) { c.err(`flock: ${target}: Bad file descriptor\n`); return 1; }
      path = w.path;
    } else {
      path = c.path(target);
      if (!c.fs.get(path)) { const e = c.fs.write(path, "", false); if (e) return c.fail(`cannot open lock file ${target}: ${ERRNO[e]}`); }
    }
    if (c.sys.locks.has(path)) {
      if (nb) return 1;
      c.err("playground: flock would wait for the other run to finish; it holds the lock for the rest of this scenario\n");
      return 1;
    }
    if (rest.length === 1) { c.sys.locks.add(path); return 0; }
    c.sys.locks.add(path);
    try {
      return rest[1] === "-c" ? c.run(["sh", "-c", rest.slice(2).join(" ")]) : c.run(rest.slice(1));
    } finally { c.sys.locks.delete(path); }
  };

  // find PATH... [EXPRESSION]: tests, -o, !, ( ), -exec, -delete, -maxdepth.
  U.find = (c) => {
    const a = c.args;
    let k = 0;
    const starts = [];
    while (k < a.length && !/^[-!(]/.test(a[k])) starts.push(a[k++]);
    if (!starts.length) starts.push(".");
    const opt = { maxdepth: Infinity, mindepth: 0, depth: false };
    let hasAction = false;
    const execs = [];
    const fail = (msg) => { throw new Error(msg); };
    const arg = (name) => { if (k >= a.length) fail(`missing argument to \`${name}'`); return a[k++]; };
    const or = () => { let l = and(); while (a[k] === "-o" || a[k] === "-or") { k++; const r = and(); const x = l; l = (p) => x(p) || r(p); } return l; };
    const and = () => {
      let l = not();
      while (k < a.length && a[k] !== "-o" && a[k] !== "-or" && a[k] !== ")") {
        if (a[k] === "-a" || a[k] === "-and") k++;
        const r = not();
        const x = l;
        l = (p) => x(p) && r(p);
      }
      return l;
    };
    const not = () => { if (a[k] === "!" || a[k] === "-not") { k++; const x = not(); return (p) => !x(p); } return prim(); };
    const num = (s, unit) => {
      const m = /^([-+]?)(\d+)([ckMGb]?)$/.exec(s);
      if (!m) fail(`invalid argument \`${s}' to \`${unit}'`);
      return m;
    };
    const cmp = (sign, v, n) => (sign === "+" ? v > n : sign === "-" ? v < n : v === n);
    const prim = () => {
      const t = a[k++];
      if (t === "(") { const e = or(); if (a[k] !== ")") fail("invalid expression; I was expecting to find a ')' somewhere but did not see one."); k++; return e; }
      switch (t) {
        case "-name": case "-iname": { const re = globToRe(arg(t), t === "-iname" ? "i" : ""); return (p) => re.test(p.name); }
        case "-path": case "-wholename": { const re = globToRe(arg(t)); return (p) => re.test(p.shown); }
        case "-type": { const ty = arg(t); if (!"fdl".includes(ty) || ty.length !== 1) fail(`Unknown argument to -type: ${ty}`); return (p) => (ty === "d" ? p.n.type === "dir" : ty === "f" ? p.n.type === "file" : false); }
        case "-mtime": case "-mmin": { const m = num(arg(t), t); const unit = t === "-mtime" ? 86400 : 60; return (p) => cmp(m[1], Math.floor((c.fs.now - p.n.mtime) / unit), Number(m[2])); }
        case "-size": {
          const m = num(arg(t), t);
          const unit = { c: 1, k: 1024, M: 1048576, G: 1073741824, b: 512, "": 512 }[m[3]];
          return (p) => cmp(m[1], Math.ceil((p.n.type === "dir" ? 4096 : p.n.text.length) / unit), Number(m[2]));
        }
        case "-empty": return (p) => (p.n.type === "dir" ? !c.fs.list(p.path).length : p.n.text === "");
        case "-newer": { const ref = c.fs.get(c.path(arg(t))); if (!ref) fail(`'${a[k - 1]}': No such file or directory`); return (p) => p.n.mtime > ref.mtime; }
        case "-maxdepth": case "-mindepth": { const v = arg(t); if (!/^\d+$/.test(v)) fail(`Expected a positive decimal integer argument to ${t}, but got \`${v}'`); opt[t.slice(1)] = Number(v); return () => true; }
        case "-depth": opt.depth = true; return () => true;
        case "-true": return () => true;
        case "-false": return () => false;
        case "-print": case "-print0": hasAction = true; return (p) => { c.out(p.shown + (t === "-print0" ? "\0" : "\n")); return true; };
        case "-delete": hasAction = true; opt.depth = true; return (p) => {
          if (p.n.type === "dir" && c.fs.list(p.path).length) { c.err(`find: cannot delete '${p.shown}': Directory not empty\n`); status = 1; return false; }
          c.fs.remove(p.path);
          return true;
        };
        case "-exec": case "-execdir": case "-ok": {
          hasAction = true;
          const cmd = [];
          while (k < a.length && a[k] !== ";" && !(a[k] === "+" && a[k - 1] === "{}")) cmd.push(a[k++]);
          if (k >= a.length) fail(`missing argument to \`${t}'`);
          const batch = a[k++] === "+";
          if (!cmd.length) fail(`invalid argument \`${batch ? "+" : ";"}' to \`${t}'`);
          if (batch) { const e = { cmd, paths: [] }; execs.push(e); return (p) => { e.paths.push(p.shown); return true; }; }
          return (p) => c.run(cmd.map((w) => w.split("{}").join(p.shown))) === 0;
        }
        case "-prune": return () => true;
      }
      if (t && t[0] === "-") fail(`unknown predicate \`${t}'`);
      k--;
      throw new Error(`paths must precede expression: \`${t}'` + (["-name", "-iname", "-path"].includes(a[k - 2]) ? `\nfind: possible unquoted pattern after predicate \`${a[k - 2]}'?` : ""));
    };
    let status = 0;
    let test;
    try {
      test = k < a.length ? or() : () => true;
      if (k < a.length) { const t = a[k]; fail(t === ")" ? "invalid expression; you have too many ')'" : `paths must precede expression: \`${t}'`); }
    } catch (e) { c.err(`find: ${e.message}\n`); return 1; }
    for (const start of starts) {
      const root = c.path(start);
      const rn = c.fs.get(root);
      if (!rn) { c.err(`find: '${start}': No such file or directory\n`); status = 1; continue; }
      const visit = (path, shown, depth) => {
        const n = c.fs.get(path);
        if (!n) return;
        const entry = { path, shown, n, name: depth === 0 ? FS.base(start.replace(/\/+$/, "")) || start : FS.base(path) };
        const self = () => { if (depth >= opt.mindepth && test(entry) && !hasAction) c.out(shown + "\n"); };
        if (!opt.depth) self();
        if (n.type === "dir" && depth < opt.maxdepth) for (const name of c.fs.list(path)) visit((path === "/" ? "" : path) + "/" + name, shown.endsWith("/") ? shown + name : shown + "/" + name, depth + 1);
        if (opt.depth) self();
      };
      visit(root, start, 0);
    }
    for (const e of execs) if (e.paths.length) { const at = e.cmd.indexOf("{}"); if (c.run([...e.cmd.slice(0, at), ...e.paths, ...e.cmd.slice(at + 1)])) status = 1; }
    return status;
  };

  // --- archives and the network ---

  U.gzip = (c) => {
    const toOut = c.args.includes("-c") || c.args.includes("--stdout");
    const decompress = c.args.includes("-d") || c.name.endsWith("gunzip") || c.name.endsWith("zcat");
    const files = c.args.filter((a) => a[0] !== "-");
    const tool = FS.base(c.name);
    if (!files.length) {
      const t = c.stdin();
      c.out(decompress ? t.replace(/^\x1f\x8b/, "") : "\x1f\x8b" + t);
      return 0;
    }
    let st = 0;
    for (const f of files) {
      const p = c.path(f);
      const n = c.fs.get(p);
      if (!n) { c.err(`${tool}: ${f}: No such file or directory\n`); st = 1; continue; }
      if (n.type === "dir") { c.err(`${tool}: ${f} is a directory -- ignored\n`); st = 2; continue; }
      if (decompress) {
        if (!f.endsWith(".gz")) { c.err(`${tool}: ${f}: unknown suffix -- ignored\n`); st = 2; continue; }
        if (c.name.endsWith("zcat") || toOut) { c.out(n.text.replace(/^\x1f\x8b/, "")); continue; }
        c.fs.nodes.set(p.slice(0, -3), { ...n, text: n.text.replace(/^\x1f\x8b/, "") });
      } else {
        if (f.endsWith(".gz")) { c.err(`${tool}: ${f} already has .gz suffix -- unchanged\n`); st = 2; continue; }
        if (toOut) { c.out("\x1f\x8b" + n.text); continue; }
        if (c.fs.get(p + ".gz") && !c.args.includes("-f")) { c.err(`${tool}: ${f}.gz already exists; not overwritten\n`); st = 2; continue; }
        c.fs.nodes.set(p + ".gz", { ...n, text: "\x1f\x8b" + n.text });
      }
      c.fs.remove(p);
    }
    return st;
  };
  U.gunzip = U.gzip;
  U.zcat = U.gzip;
  // tar -c/-t/-x over a JSON image of the files; enough for backups that are created, listed and restored.
  U.tar = (c) => {
    const a = c.args.slice();
    if (a[0] && /^[a-zA-Z]+$/.test(a[0])) a[0] = "-" + a[0];
    let mode = null;
    let file = null;
    let dir = c.cwd;
    const names = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === "-C") { dir = c.path(a[++i]); continue; }
      if (/^-[a-zA-Z]+$/.test(x)) {
        for (const ch of x.slice(1)) { if ("ctx".includes(ch)) mode = ch; if (ch === "f") file = a[++i]; }
        continue;
      }
      names.push(x);
    }
    if (!mode) { c.err("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.\n"); return 2; }
    if (mode === "c") {
      if (!names.length) { c.err("tar: Cowardly refusing to create an empty archive\n"); return 2; }
      const files = {};
      let st = 0;
      for (const n of names) {
        const p = FS.norm(dir, n);
        if (!c.fs.get(p)) { c.err(`tar: ${n}: Cannot stat: No such file or directory\n`); st = 2; continue; }
        for (const k of [p, ...c.fs.walk(p)]) { const node = c.fs.get(k); files[n.replace(/^\//, "").replace(/\/$/, "") + k.slice(p.length)] = node.type === "dir" ? null : node.text; }
      }
      const out = "TARSIM\n" + JSON.stringify(files);
      if (!file || file === "-") c.out(out); else c.fs.write(c.path(file), out);
      if (st) c.err("tar: Exiting with failure status due to previous errors\n");
      return st;
    }
    const text = !file || file === "-" ? c.stdin() : c.read(file);
    if (text === null) return 2;
    if (!text.startsWith("TARSIM\n")) { c.err("tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n"); return 2; }
    const files = JSON.parse(text.slice(7));
    for (const [k, v] of Object.entries(files)) {
      if (mode === "t") { c.out(k + (v === null ? "/" : "") + "\n"); continue; }
      const p = FS.norm(dir, k);
      if (v === null) { if (!c.fs.get(p)) c.fs.mkdir(p); } else c.fs.write(p, v);
    }
    return 0;
  };
  // curl over the scenario's own endpoints: net[url] => {status, body} or "refused".
  U.curl = (c) => {
    const o = { f: false, s: false, S: false, out: null, write: null, retry: 0, head: false };
    let url = null;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === "-o" || a === "--output") o.out = c.args[++i];
      else if (a === "-m" || a === "--max-time") o.max = Number(c.args[++i]) || 0;
      else if (a === "-w" || a === "--write-out") o.write = c.args[++i];
      else if (a === "--retry") o.retry = Number(c.args[++i]) || 0;
      else if (["--connect-timeout", "-H", "--header", "-X", "--request", "-d", "--data", "-u", "--user", "--retry-delay", "--retry-max-time", "-A"].includes(a)) i++;
      else if (/^-[a-zA-Z]+$/.test(a)) { for (const ch of a.slice(1)) { if (ch in o) o[ch] = true; if (ch === "I") o.head = true; } }
      else if (a.startsWith("--")) { if (a === "--fail") o.f = true; if (a === "--silent") o.s = true; if (a === "--show-error") o.S = true; if (a === "--retry-all-errors") o.retry ||= 0; }
      else url = a;
    }
    if (!url) { c.err("curl: try 'curl --help' or 'curl --manual' for more information\n"); return 2; }
    const full = /^\w+:\/\//.test(url) ? url : "http://" + url;
    const host = /^\w+:\/\/([^/:]+)/.exec(full)[1];
    const net = c.sys.spec.net || {};
    const say = (code, msg) => { if (!o.s || o.S) c.err(`curl: (${code}) ${msg}\n`); return code; };
    for (let attempt = 0; ; attempt++) {
      c.sys.netHits[full] = (c.sys.netHits[full] || 0) + 1;
      const handler = net[full] ?? net[host];
      const r = typeof handler === "function" ? handler(c.sys, c.sys.netHits[full]) : handler;
      let code = 0;
      let transient = false;
      if (r === undefined) code = say(6, `Could not resolve host: ${host}`);
      else if (r === "refused") { code = say(7, `Failed to connect to ${host} port ${full.startsWith("https") ? 443 : 80} after 0 ms: Couldn't connect to server`); transient = true; }
      else if (r === "timeout") { code = say(28, `Connection timed out after 10001 milliseconds`); transient = true; }
      else if (r === "hang") {
        // The server accepts the connection and never answers. Without -m, curl waits as long as the network lets it.
        const wait = o.max || 3600;
        c.sys.advance(wait);
        code = say(28, `Operation timed out after ${wait * 1000} milliseconds with 0 bytes received`);
        transient = true;
      }
      else {
        transient = r.status >= 500 || r.status === 429 || r.status === 408;
        if (o.f && r.status >= 400) code = say(22, `The requested URL returned error: ${r.status}`);
        else {
          const body = o.head ? `HTTP/2 ${r.status}\ncontent-type: text/plain\n\n` : r.body ?? "";
          if (o.out) c.fs.write(c.path(o.out), body); else c.out(body);
        }
        if (o.write) c.out(o.write.replace(/%\{http_code\}/g, String(r.status)).replace(/\\n/g, "\n"));
      }
      if (code === 0 || !transient || attempt >= o.retry) return code;
      const wait = 2 ** attempt;
      if (!o.s) c.err(`Warning: Problem : HTTP error. Will retry in ${wait} seconds. ${o.retry - attempt} retries left.\n`);
      c.sys.slept.push(wait);
      c.sys.advance(wait);
    }
  };
  U.wget = (c) => c.fail("playground: use curl here", 1);

  // --- the playground's own commands ---

  U.edit = (c) => {
    const f = c.args[0];
    if (!f) { c.err(`usage: ${FS.base(c.name)} FILE\n`); return 1; }
    if (c.sys.onEdit) { c.sys.onEdit(c.path(f), f); return 0; }
    c.err("playground: the editor opens in the page\n");
    return 1;
  };
  for (const name of ["nano", "vi", "vim", "code"]) U[name] = U.edit;
  U.crontab = (c) => {
    if (c.args.includes("-l")) {
      const tab = c.sys.spec.crontab;
      if (!tab) { c.err("no crontab for dev\n"); return 1; }
      c.out(tab);
      return 0;
    }
    if (c.args.includes("-e")) { c.err("playground: crontab -e is not available; the scenario's crontab is shown by crontab -l\n"); return 1; }
    return c.usage("usage error: file name or - (for stdin) must be specified");
  };
  U.shellcheck = (c) => { c.err("playground: ShellCheck is not installed here; paste the script into the Script X-ray tab instead\n"); return 127; };
  U.man = (c) => { c.err(`playground: no manual pages here; try ${c.args[0] ? `${c.args[0]} --help in a real shell, or ` : ""}the Cheat sheet tab\n`); return 16; };
  U.expr = (c) => {
    const a = c.args;
    let v;
    if (a.length === 3 && /^[-+*/%<>=!]=?$|^[|&]$/.test(a[1])) {
      const [x, op, y] = a;
      const isInt = (s) => /^[-+]?\d+$/.test(s);
      if ("+-*/%".includes(op)) {
        if (!isInt(x) || !isInt(y)) return c.fail("non-integer argument", 2);
        if ((op === "/" || op === "%") && Number(y) === 0) return c.fail("division by zero", 2);
        const p = Number(x);
        const q = Number(y);
        v = String(op === "+" ? p + q : op === "-" ? p - q : op === "*" ? p * q : op === "/" ? Math.trunc(p / q) : p % q);
      } else {
        const n = isInt(x) && isInt(y);
        const p = n ? Number(x) : x;
        const q = n ? Number(y) : y;
        v = String(+({ "=": p === q, "==": p === q, "!=": p !== q, "<": p < q, ">": p > q, "<=": p <= q, ">=": p >= q, "|": x || y, "&": x && y }[op]));
      }
    } else if (a[0] === "length" && a.length === 2) v = String(a[1].length);
    else if (a.length === 1) v = a[0];
    else return c.fail(`syntax error: unexpected argument '${a[1] ?? ""}'`, 2);
    c.out(v + "\n");
    return v === "0" || v === "" ? 1 : 0;
  };
  root.ShellSim.strftime = strftime;
})(typeof window !== "undefined" ? window : globalThis);
