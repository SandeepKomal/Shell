// Bash builtins for the playground: the commands that run inside the shell
// itself, because they change it (cd, export, set, read, trap, ...).
"use strict";

(function (root) {
  const { FS, Shell, Exit, Return, Loop, SIGNUM, testArgs, TestErr, ansi, quoteTrace, NAME, KEYWORDS, byteOrder } = root.ShellSim;
  const B = Shell.builtins;
  const say = (io, s) => io.fds[1].write(s);

  // echo's escapes (with -e) and printf's.
  function escapes(s, stopAtC) {
    let stop = false;
    if (stopAtC) {
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== "\\") continue;
        if (s[i + 1] === "c") { s = s.slice(0, i); stop = true; break; }
        i++;
      }
    }
    const out = s.replace(/\\(c|0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/gs, (m, c) => {
      if (stop) return "";
      if (c === "c" && stopAtC) { stop = true; return ""; }
      if (c[0] === "0" && stopAtC) return String.fromCharCode(parseInt(c.slice(1) || "0", 8));
      return ansi(m);
    });
    return { out, stop };
  }

  B.echo = (sh, args, io) => {
    let n = false;
    let e = sh.posix;
    let i = 0;
    for (; i < args.length && /^-[neE]+$/.test(args[i]) && !sh.posix; i++) {
      for (const c of args[i].slice(1)) { if (c === "n") n = true; else e = c === "e"; }
    }
    if (sh.posix && args[0] === "-n") { n = true; i = 1; }
    let text = args.slice(i).join(" ");
    if (e) { const r = escapes(text, true); text = r.out; if (r.stop) n = true; }
    say(io, text + (n ? "" : "\n"));
    return 0;
  };
  B[":"] = () => 0;
  B.true = () => 0;
  B.false = () => 1;

  // printf FORMAT [ARG...], reusing the format while arguments remain.
  function printf(sh, args, err) {
    const fmt = args[0] ?? "";
    let k = 1;
    let out = "";
    let status = 0;
    const next = () => (k < args.length ? args[k++] : undefined);
    const toNum = (v) => {
      if (v === undefined || v === "") return 0;
      if (/^\s*[-+]?\d+\s*$/.test(v)) return Number(v);
      if (/^\s*[-+]?0[xX][0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
      if (/^['"]./.test(v)) return v.charCodeAt(1);
      if (/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v)) return Number(v);
      err(`${v}: invalid number`);
      status = 1;
      const m = /^\s*[-+]?\d+/.exec(v);
      return m ? Number(m[0]) : 0;
    };
    do {
      const before = k;
      let stop = false;
      out += fmt.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([sdiuoxXfeEgGcbq%])|\\(c|x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/gs, (m, flags, width, prec, conv, esc) => {
        if (stop) return "";
        if (esc !== undefined) {
          if (esc === "c") { stop = true; return ""; }
          return ansi(m);
        }
        if (conv === "%") return "%";
        if (width === "*") width = String(toNum(next()));
        if (prec === "*") prec = String(toNum(next()));
        const arg = next();
        let s;
        switch (conv) {
          case "s": s = arg ?? ""; if (prec !== undefined) s = s.slice(0, Number(prec)); break;
          case "b": { const r = escapes(arg ?? "", true); s = r.out; if (r.stop) stop = true; break; }
          case "q": s = arg === undefined || arg === "" ? "''" : arg.replace(/[^\w@%+=:,./-]/g, "\\$&"); break;
          case "c": s = (arg ?? "").charAt(0); break;
          case "d": case "i": case "u": {
            const n = Math.trunc(toNum(arg));
            s = String(Math.abs(n));
            if (prec !== undefined) s = s.padStart(Number(prec), "0");
            s = (n < 0 ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "") + s;
            if (flags.includes("0") && !flags.includes("-") && width) s = s[0] === "-" || s[0] === "+" ? s[0] + s.slice(1).padStart(Number(width) - 1, "0") : s.padStart(Number(width), "0");
            break;
          }
          case "o": case "x": case "X": {
            s = Math.trunc(toNum(arg)).toString(conv === "o" ? 8 : 16);
            if (conv === "X") s = s.toUpperCase();
            if (flags.includes("0") && width) s = s.padStart(Number(width), "0");
            break;
          }
          default: {
            const n = toNum(arg);
            const p = prec === undefined ? 6 : Number(prec);
            s = conv === "f" ? n.toFixed(p) : /[eE]/.test(conv) ? n.toExponential(p).replace(/e([-+])(\d)$/, "e$10$2") : String(Number(n.toPrecision(p || 1)));
            if (conv === "E") s = s.toUpperCase();
            if (flags.includes("+") && n >= 0) s = "+" + s;
            if (flags.includes("0") && width) s = s.padStart(Number(width), "0");
          }
        }
        if (width) s = flags.includes("-") ? s.padEnd(Number(width)) : s.padStart(Number(width));
        return s;
      });
      if (stop || k === before) break;
    } while (k < args.length);
    return { out, status };
  }
  B.printf = (sh, args, io) => {
    let v = null;
    if (args[0] === "-v") { v = args[1]; args = args.slice(2); }
    if (args[0] === "--") args = args.slice(1);
    if (!args.length) { sh.complain("printf: usage: printf [-v var] format [arguments]", io); return 2; }
    const r = printf(sh, args, (m) => sh.complain(`printf: ${m}`, io));
    if (v) sh.assignScalar(v, r.out); else say(io, r.out);
    return r.status;
  };

  // read [-r] [-p prompt] [-a array] [-d delim] [name...]
  B.read = (sh, args, io) => {
    const o = { r: false, a: null, d: "\n", p: null };
    let i = 0;
    for (; i < args.length && args[i][0] === "-" && args[i].length > 1; i++) {
      const f = args[i];
      for (let j = 1; j < f.length; j++) {
        const c = f[j];
        if ("rs".includes(c)) { if (c === "r") o.r = true; continue; }
        if ("apdtnu".includes(c)) {
          const val = f.slice(j + 1) || args[++i];
          if (val === undefined) { sh.complain(`read: -${c}: option requires an argument`, io); return 2; }
          if (c === "a") o.a = val; else if (c === "p") o.p = val; else if (c === "d") o.d = val === "" ? "\0" : val[0];
          break;
        }
        sh.complain(`read: -${c}: invalid option`, io);
        return 2;
      }
    }
    const names = args.slice(i);
    for (const n of names) if (!NAME.test(n)) { sh.complain(`read: \`${n}': not a valid identifier`, io); return 1; }
    const input = io.fds[0];
    if (!input || !input.readLine) return 1;
    if (input.tty) {
      io.fds[2].write("playground: scripts here cannot read from the keyboard; give read its input with a here-string (read -r x <<< 'value') or a file\n");
      return 1;
    }
    let { line, ok, eof } = input.readLine(o.d);
    // Without -r a backslash joins the next line and escapes the next character.
    if (!o.r) {
      while (ok && /(^|[^\\])(\\\\)*\\$/.test(line)) {
        const more = input.readLine(o.d);
        line = line.slice(0, -1) + more.line;
        ok = more.ok;
      }
      line = line.replace(/\\(.)/g, "$1");
    }
    const ifs = sh.scalar("IFS") ?? " \t\n";
    const ws = [...ifs].filter((c) => " \t\n".includes(c)).join("");
    const trim = (s) => { let a = 0; let b = s.length; while (a < b && ws.includes(s[a])) a++; while (b > a && ws.includes(s[b - 1])) b--; return s.slice(a, b); };
    if (o.a) {
      const parts = ifs ? trim(line).split(new RegExp("[" + ifs.replace(/[\]\\^-]/g, "\\$&") + "]+")).filter((x, k, all) => x !== "" || all.length > 1) : [line];
      sh.assignArray(o.a, line === "" && !ok ? [] : parts.filter((x) => x !== "" || !ws));
    } else if (!names.length) sh.assignScalar("REPLY", line);
    else {
      let rest = trim(line);
      names.forEach((n, k) => {
        if (k === names.length - 1) { sh.assignScalar(n, rest); return; }
        let j = 0;
        while (j < rest.length && !ifs.includes(rest[j])) j++;
        sh.assignScalar(n, rest.slice(0, j));
        rest = rest.slice(j);
        let s = 0;
        while (s < rest.length && ws.includes(rest[s])) s++;
        if (s < rest.length && ifs.includes(rest[s]) && !ws.includes(rest[s])) s++;
        while (s < rest.length && ws.includes(rest[s])) s++;
        rest = rest.slice(s);
      });
    }
    return ok && !eof ? 0 : 1;
  };

  B.cd = (sh, args, io) => {
    if (args[0] === "--") args = args.slice(1);
    if (args.length > 1) { sh.complain("cd: too many arguments", io); return 1; }
    let target = args[0];
    if (target === undefined) {
      target = sh.scalar("HOME");
      if (target === undefined) { sh.complain("cd: HOME not set", io); return 1; }
    }
    if (target === "-") {
      target = sh.scalar("OLDPWD");
      if (target === undefined) { sh.complain("cd: OLDPWD not set", io); return 1; }
      say(io, target + "\n");
    }
    if (target === "") return 0;
    const p = FS.norm(sh.cwd, target);
    const n = sh.sys.fs.get(p);
    if (!n) { sh.complain(`cd: ${target}: No such file or directory`, io); return 1; }
    if (n.type !== "dir") { sh.complain(`cd: ${target}: Not a directory`, io); return 1; }
    sh.assignScalar("OLDPWD", sh.cwd);
    sh.cwd = p;
    sh.assignScalar("PWD", p);
    return 0;
  };
  B.pwd = (sh, args, io) => { say(io, sh.cwd + "\n"); return 0; };

  function declareList(sh, io, filter, prefix) {
    for (const [k, v] of [...sh.vars].sort(([a], [b]) => byteOrder(a, b))) {
      if (!filter(v) || v.value === undefined) continue;
      const flags = (Array.isArray(v.value) ? "a" : "") + (v.integer ? "i" : "") + (v.readonly ? "r" : "") + (v.exported ? "x" : "");
      const val = Array.isArray(v.value) ? "(" + v.value.map((x, i) => (x === undefined ? "" : `[${i}]="${x}"`)).filter(Boolean).join(" ") + ")" : `"${v.value.replace(/(["\\$`])/g, "\\$1")}"`;
      say(io, `${prefix || `declare -${flags || "-"}`} ${k}=${val}\n`);
    }
  }
  // NAME[=value] arguments of export, readonly, local and declare.
  function declare(sh, args, io, cmd, attrs) {
    let st = 0;
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)(\[[^\]]*\])?(\+?)(=([\s\S]*))?$/.exec(a);
      if (!m) { sh.complain(`${cmd}: \`${a}': not a valid identifier`, io); st = 1; continue; }
      const name = m[1];
      const cur = sh.vars.get(name);
      if (attrs.local) sh.makeLocal(name);
      if (m[4] !== undefined) {
        if (cur && cur.readonly && !attrs.local) { sh.complain(`${name}: readonly variable`, io); st = 1; continue; }
        let val = m[5];
        if (attrs.array && /^\(.*\)$/s.test(val)) { sh.assignArray(name, sh.expandWords(val.slice(1, -1).trim() ? val.slice(1, -1).trim().split(/\s+/) : [])); }
        else {
          if (attrs.integer) { const v = sh.vars.get(name) || {}; v.integer = true; sh.vars.set(name, v); }
          sh.assignScalar(name, val, m[2] ? m[2].slice(1, -1) : undefined, m[3] === "+");
        }
      } else if (!sh.vars.has(name)) sh.vars.set(name, { value: attrs.array ? [] : undefined });
      const v = sh.vars.get(name);
      if (attrs.export !== undefined) v.exported = attrs.export;
      if (attrs.readonly) v.readonly = true;
      if (attrs.integer) v.integer = true;
      if (attrs.array && v.value === undefined) v.value = [];
    }
    return st;
  }
  B.export = (sh, args, io) => {
    const unexport = args[0] === "-n";
    args = args.filter((a) => a !== "-n" && a !== "-p");
    if (!args.length) { declareList(sh, io, (v) => v.exported, "declare -x"); return 0; }
    return declare(sh, args, io, "export", { export: !unexport });
  };
  B.readonly = (sh, args, io) => {
    args = args.filter((a) => a !== "-p");
    if (!args.length) { declareList(sh, io, (v) => v.readonly, "declare -r"); return 0; }
    return declare(sh, args, io, "readonly", { readonly: true });
  };
  B.local = (sh, args, io) => {
    if (!sh.funcDepth) { sh.complain("local: can only be used in a function", io); return 1; }
    const attrs = { local: true };
    args = args.filter((a) => { if (/^-[airx]+$/.test(a)) { if (a.includes("a")) attrs.array = true; if (a.includes("i")) attrs.integer = true; if (a.includes("r")) attrs.readonly = true; if (a.includes("x")) attrs.export = true; return false; } return true; });
    return declare(sh, args, io, "local", attrs);
  };
  B.declare = (sh, args, io) => {
    const attrs = { local: sh.funcDepth > 0 };
    let print = false;
    args = args.filter((a) => {
      if (/^[-+][aAirxgpf]+$/.test(a)) {
        for (const c of a.slice(1)) {
          if (c === "a" || c === "A") attrs.array = true;
          if (c === "i") attrs.integer = true;
          if (c === "r") attrs.readonly = true;
          if (c === "x") attrs.export = a[0] === "-";
          if (c === "g") attrs.local = false;
          if (c === "p") print = true;
        }
        return false;
      }
      return true;
    });
    if (print || !args.length) {
      if (!args.length) { declareList(sh, io, () => true); return 0; }
      let st = 0;
      for (const n of args) {
        if (!sh.vars.has(n) || sh.vars.get(n).value === undefined) { sh.complain(`declare: ${n}: not found`, io); st = 1; continue; }
        declareList({ vars: new Map([[n, sh.vars.get(n)]]) }, io, () => true);
      }
      return st;
    }
    return declare(sh, args, io, "declare", attrs);
  };
  B.typeset = B.declare;
  B.unset = (sh, args, io) => {
    let fn = false;
    let st = 0;
    for (const a of args) {
      if (a === "-f") { fn = true; continue; }
      if (a === "-v") continue;
      if (fn) { sh.funcs.delete(a); continue; }
      const m = /^([A-Za-z_]\w*)(?:\[(.*)\])?$/.exec(a);
      if (!m) { sh.complain(`unset: \`${a}': not a valid identifier`, io); st = 1; continue; }
      const v = sh.vars.get(m[1]);
      if (v && v.readonly) { sh.complain(`unset: ${m[1]}: cannot unset: readonly variable`, io); st = 1; continue; }
      if (m[2] !== undefined && v && Array.isArray(v.value)) delete v.value[sh.arithIndex(m[2])];
      else if (v) { if (sh.frames.length && sh.frames[sh.frames.length - 1].has(m[1])) v.value = undefined; else sh.vars.delete(m[1]); }
      else sh.funcs.delete(m[1]);
    }
    return st;
  };

  const LONG_OPTS = { errexit: "e", nounset: "u", xtrace: "x", noglob: "f", pipefail: "pipefail", allexport: "allexport", noclobber: "C" };
  B.set = (sh, args, io) => {
    if (!args.length) {
      for (const [k, v] of [...sh.vars].sort(([a], [b]) => byteOrder(a, b))) {
        if (v.value === undefined) continue;
        say(io, Array.isArray(v.value) ? `${k}=(${v.value.map((x, i) => `[${i}]="${x}"`).join(" ")})\n` : `${k}=${quoteTrace(v.value)}\n`);
      }
      return 0;
    }
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--") { sh.args = args.slice(i + 1); return 0; }
      if (!/^[-+]/.test(a) || a === "-" || a === "+") { sh.args = args.slice(i); return 0; }
      const on = a[0] === "-";
      for (const c of a.slice(1)) {
        if (c === "o") {
          const name = args[++i];
          if (name === undefined) {
            for (const [long, key] of Object.entries(LONG_OPTS)) say(io, `${long.padEnd(15)}\t${sh.opts[key] ? "on" : "off"}\n`);
            break;
          }
          const key = LONG_OPTS[name];
          if (!key) { sh.complain(`set: ${name}: invalid option name`, io); return 2; }
          sh.opts[key] = on;
          continue;
        }
        if (!"euxfvhBCa".includes(c)) { sh.complain(`set: ${a[0]}${c}: invalid option`, io); io.fds[2].write("set: usage: set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]\n"); return 2; }
        if (c === "a") sh.opts.allexport = on;
        else if (c in sh.opts) sh.opts[c] = on;
      }
    }
    return 0;
  };
  const SHOPTS = ["nullglob", "failglob", "dotglob", "nocasematch", "inherit_errexit", "extglob", "globstar", "lastpipe", "expand_aliases"];
  B.shopt = (sh, args, io) => {
    let mode = null;
    const names = [];
    for (const a of args) { if (a === "-s" || a === "-u") mode = a; else if (a === "-q" || a === "-p") continue; else names.push(a); }
    for (const n of names) if (!SHOPTS.includes(n)) { sh.complain(`shopt: ${n}: invalid shell option name`, io); return 1; }
    if (!mode) {
      for (const n of names.length ? names : SHOPTS) say(io, `${n.padEnd(15)}\t${sh.opts[n] ? "on" : "off"}\n`);
      return names.every((n) => sh.opts[n]) ? 0 : 1;
    }
    for (const n of names) sh.opts[n] = mode === "-s";
    return 0;
  };
  B.shift = (sh, args, io) => {
    const n = args.length ? Number(args[0]) : 1;
    if (!/^\d+$/.test(args[0] ?? "1")) { sh.complain(`shift: ${args[0]}: numeric argument required`, io); return 1; }
    if (n > sh.args.length) return 1;
    sh.args = sh.args.slice(n);
    return 0;
  };
  const numeric = (sh, io, cmd, a, dflt) => {
    if (a === undefined) return dflt;
    if (!/^\s*[-+]?\d+\s*$/.test(a)) { sh.complain(`${cmd}: ${a}: numeric argument required`, io); return null; }
    return ((Number(a) % 256) + 256) % 256;
  };
  B.return = (sh, args, io) => {
    const code = numeric(sh, io, "return", args[0], sh.status);
    if (!sh.funcDepth && !sh.sourceDepth) { sh.complain("return: can only `return' from a function or sourced script", io); return 1; }
    throw new Return(code === null ? 2 : code);
  };
  B.exit = (sh, args, io) => {
    if (args.length > 1) { sh.complain("exit: too many arguments", io); return 1; }
    const code = numeric(sh, io, "exit", args[0], sh.status);
    throw new Exit(code === null ? 2 : code);
  };
  const loopCmd = (kind) => (sh, args, io) => {
    const n = args.length ? Number(args[0]) : 1;
    if (!Number.isInteger(n) || n < 1) { sh.complain(`${kind}: ${args[0]}: loop count out of range`, io); return 1; }
    if (!sh.loops) { sh.complain(`${kind}: only meaningful in a \`for', \`while', or \`until' loop`, io); return 0; }
    throw new Loop(kind, Math.min(n, sh.loops));
  };
  B.break = loopCmd("break");
  B.continue = loopCmd("continue");

  B.test = (sh, args, io, name = "test") => {
    // dash's test has no ==.
    if (sh.posix && args.length === 3 && args[1] === "==") { sh.complain(`${name}: ${args[0]}: unexpected operator`, io); return 2; }
    try { return testArgs(sh, args) ? 0 : 1; } catch (e) {
      if (!(e instanceof TestErr)) throw e;
      sh.complain(`${name}: ${e.msg}`, io);
      return 2;
    }
  };
  B["["] = (sh, args, io) => {
    if (args[args.length - 1] !== "]") { sh.complain("[: missing `]'", io); return 2; }
    return B.test(sh, args.slice(0, -1), io, "[");
  };

  B.source = (sh, args, io) => {
    const file = args[0];
    if (file === undefined) { sh.complain("source: filename argument required", io); io.fds[2].write("source: usage: source filename [arguments]\n"); return 2; }
    let path = null;
    if (file.includes("/")) path = FS.norm(sh.cwd, file);
    else {
      const hit = sh.sys.resolve(file, sh.scalar("PATH"), sh.cwd);
      path = hit ? hit.p : FS.norm(sh.cwd, file);
    }
    const n = sh.sys.fs.get(path);
    if (!n || n.type !== "file") { sh.complain(`${file}: ${n ? "is a directory" : "No such file or directory"}`, io); return 1; }
    const saved = { args: sh.args, file: sh.file, lineno: sh.lineno };
    if (args.length > 1) sh.args = args.slice(1);
    sh.file = file;
    const source = sh.vars.get("BASH_SOURCE");
    const sources = source.value;
    source.value = [file, ...sources];
    sh.sourceDepth++;
    try { return sh.exec(n.text, io); } catch (e) {
      if (e instanceof Return) return e.code;
      throw e;
    } finally {
      sh.sourceDepth--;
      source.value = sources;
      sh.file = saved.file;
      sh.lineno = saved.lineno;
      if (args.length > 1) sh.args = saved.args;
    }
  };
  B["."] = B.source;
  B.eval = (sh, args, io) => {
    const line = sh.lineno;
    const st = sh.exec(args.join(" "), io);
    sh.lineno = line;
    return st;
  };
  B.exec = (sh, args, io) => {
    const st = sh.invoke(args, [], io);
    throw new Exit(st);
  };

  const SIGNALS = ["EXIT", "ERR", "HUP", "INT", "QUIT", "TERM", "USR1", "USR2", "DEBUG", "RETURN"];
  B.trap = (sh, args, io) => {
    if (!args.length || args[0] === "-p") {
      for (const [sig, cmd] of Object.entries(sh.traps)) say(io, `trap -- ${quoteTrace(cmd).startsWith("'") ? quoteTrace(cmd) : `'${cmd}'`} ${["EXIT", "ERR", "DEBUG", "RETURN"].includes(sig) ? sig : "SIG" + sig}\n`);
      return 0;
    }
    if (args[0] === "-l") { say(io, SIGNALS.map((s, i) => `${i}) SIG${s}`).join(" ") + "\n"); return 0; }
    const [action, ...sigs] = args.length === 1 ? ["-", args[0]] : args;
    let st = 0;
    for (const raw of sigs) {
      const sig = raw === "0" ? "EXIT" : raw.replace(/^SIG/, "").toUpperCase();
      if (!SIGNALS.includes(sig) && !/^\d+$/.test(raw)) { sh.complain(`trap: ${raw}: invalid signal specification`, io); st = 1; continue; }
      if (action === "-") delete sh.traps[sig]; else sh.traps[sig] = action;
    }
    return st;
  };

  function describe(sh, name, path) {
    if (!path) {
      if (KEYWORDS.has(name)) return { kind: "keyword", text: `${name} is a shell keyword` };
      if (sh.funcs.has(name)) return { kind: "function", text: `${name} is a function` };
      if (B[name]) return { kind: "builtin", text: `${name} is a shell builtin` };
    }
    const hit = sh.sys.resolve(name, sh.scalar("PATH"), sh.cwd);
    if (hit && hit.n) return { kind: "file", text: `${name} is ${hit.p.replace(/^\/usr\/bin\/(?=[^/]+$)/, "/usr/bin/")}`, path: hit.p };
    return null;
  }
  B.type = (sh, args, io) => {
    let t = false;
    let st = 0;
    for (const a of args) {
      if (a === "-t") { t = true; continue; }
      if (a[0] === "-") continue;
      const d = describe(sh, a);
      if (!d) { if (!t) sh.complain(`type: ${a}: not found`, io); st = 1; continue; }
      say(io, (t ? d.kind : d.text) + "\n");
    }
    return st;
  };
  B.command = (sh, args, io) => {
    if (args[0] === "-v" || args[0] === "-V") {
      let st = 0;
      for (const a of args.slice(1)) {
        const d = describe(sh, a);
        if (!d) { if (args[0] === "-V") sh.complain(`command: ${a}: not found`, io); st = 1; continue; }
        say(io, (args[0] === "-V" ? d.text : d.path || a) + "\n");
      }
      return st;
    }
    if (!args.length) return 0;
    if (B[args[0]]) return B[args[0]](sh, args.slice(1), io);
    return sh.sys.spawn(args, sh.exportedEnv(), sh.cwd, io, sh);
  };
  // wait, wait PID, wait %N and wait -n over the shell's background jobs.
  B.wait = (sh, args, io) => {
    const live = () => sh.jobs.filter((j) => !j.reaped);
    const reap = (j) => { j.reaped = true; if (j.end > sh.sys.fs.now) sh.sys.fs.now = j.end; return j.status; };
    if (args[0] === "-n") {
      const next = live().sort((a, b) => a.end - b.end)[0];
      return next ? reap(next) : 127;
    }
    if (!args.length) { live().forEach(reap); return 0; }
    let st = 0;
    for (const a of args) {
      const j = a.startsWith("%") ? sh.jobs.find((x) => String(x.n) === a.slice(1)) : sh.jobs.find((x) => String(x.pid) === a);
      if (!j) { sh.complain(a.startsWith("%") ? `wait: ${a}: no such job` : `wait: pid ${a} is not a child of this shell`, io); st = 127; continue; }
      st = reap(j);
    }
    return st;
  };
  B.jobs = (sh, args, io) => {
    const list = sh.jobs.filter((j) => !j.reaped);
    list.forEach((j, k) => {
      if (args.includes("-p")) { say(io, j.pid + "\n"); return; }
      const state = j.killed ? "Hangup" : j.end > sh.sys.fs.now ? "Running" : j.status ? `Exit ${j.status}` : "Done";
      const mark = k === list.length - 1 ? "+" : k === list.length - 2 ? "-" : " ";
      say(io, `[${j.n}]${mark}  ${args.includes("-l") ? j.pid + " " : ""}${state.padEnd(24)}${j.cmd}${state === "Running" ? " &" : ""}\n`);
      if (state !== "Running") j.reaped = true;
    });
    return 0;
  };
  // disown: the shell forgets the job, so it does not send it SIGHUP when the session ends.
  B.disown = (sh, args, io) => {
    const ids = args.filter((a) => a !== "-h" && a !== "-a");
    const live = sh.jobs.filter((j) => !j.reaped);
    const picked = args.includes("-a") ? live : ids.length ? ids.map((a) => live.find((j) => String(j.n) === a.replace(/^%/, "") || String(j.pid) === a)) : [live[live.length - 1]];
    if (picked.some((j) => !j)) { sh.complain(`disown: ${ids[0] || "current"}: no such job`, io); return 1; }
    for (const j of picked) { j.protected = true; j.reaped = true; }
    return 0;
  };
  // kill %N and kill PID for the shell's jobs; other PIDs go to the kill program.
  B.kill = (sh, args, io) => {
    const sigArg = args.find((a) => /^-(\w+)$/.test(a) && a !== "-l");
    const sig = sigArg ? sigArg.slice(1).replace(/^SIG/, "").toUpperCase() : "TERM";
    const num = /^\d+$/.test(sig) ? Number(sig) : SIGNUM[sig] || 15;
    let st = 0;
    const rest = [];
    for (const a of args.filter((x) => x !== sigArg)) {
      if (a === String(sh.sys.rootPid(sh))) { if (num) st = sh.receive(Object.keys(SIGNUM).find((k) => SIGNUM[k] === num) || "TERM", io); continue; }
      const j = a.startsWith("%") ? sh.jobs.find((x) => String(x.n) === a.slice(1)) : sh.sys.bg.find((x) => String(x.pid) === a);
      if (!j) { if (a.startsWith("%")) { sh.complain(`kill: ${a}: no such job`, io); st = 1; } else rest.push(a); continue; }
      if (num === 0) continue;
      if (j.end > sh.sys.fs.now && !j.killed) { j.killed = true; j.status = 128 + num; j.end = sh.sys.fs.now; }
    }
    if (rest.length) st = sh.sys.spawn(["kill", ...(sigArg ? [sigArg] : []), ...rest], sh.exportedEnv(), sh.cwd, io, sh) || st;
    return st;
  };
  B.let = (sh, args, io) => {
    if (!args.length) { sh.complain("let: expression expected", io); return 1; }
    let v = 0;
    for (const a of args) v = sh.arith(a);
    return v ? 0 : 1;
  };
  B.mapfile = (sh, args, io) => {
    const trim = args.includes("-t");
    const name = args.filter((a) => a[0] !== "-").pop() || "MAPFILE";
    const text = io.fds[0] && io.fds[0].readAll ? io.fds[0].readAll() : "";
    const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n").map((l) => (trim ? l : l + "\n"));
    sh.assignArray(name, lines);
    return 0;
  };
  B.readarray = B.mapfile;
  B.alias = (sh, args, io) => { io.fds[2].write("playground: aliases are not supported here; write a function instead (and scripts never expand aliases anyway)\n"); return 1; };
  B.unalias = B.alias;

  // getopts OPTSTRING NAME [ARG...]: one option per call, as POSIX describes.
  B.getopts = (sh, args, io) => {
    if (args.length < 2) { sh.complain("getopts: usage: getopts optstring name [arg ...]", io); return 2; }
    const [spec, name] = args;
    const argv = args.length > 2 ? args.slice(2) : sh.args;
    const silent = spec[0] === ":";
    let ind = Number(sh.scalar("OPTIND")) || 1;
    if (ind !== sh.optind) { sh.optpos = 1; sh.optind = ind; }
    const word = argv[ind - 1];
    const done = () => { sh.assignScalar(name, "?"); return 1; };
    if (word === undefined || word[0] !== "-" || word === "-") return done();
    if (word === "--") { sh.assignScalar("OPTIND", String(ind + 1)); sh.optind = ind + 1; return done(); }
    const c = word[sh.optpos];
    const advance = () => { ind++; sh.optpos = 1; };
    sh.optpos++;
    if (sh.optpos >= word.length) advance();
    const k = spec.indexOf(c);
    if (k < 0 || c === ":") {
      if (silent) { sh.assignScalar(name, "?"); sh.assignScalar("OPTARG", c); }
      else { io.fds[2].write(`${sh.arg0}: illegal option -- ${c}\n`); sh.assignScalar(name, "?"); sh.vars.delete("OPTARG"); }
    } else if (spec[k + 1] === ":") {
      let arg;
      if (sh.optpos > 1 && sh.optpos < word.length && argv[ind - 1] === word) { arg = word.slice(sh.optpos); advance(); }
      else { arg = argv[ind - 1]; if (arg !== undefined) ind++; }
      if (arg === undefined) {
        if (silent) { sh.assignScalar(name, ":"); sh.assignScalar("OPTARG", c); }
        else { io.fds[2].write(`${sh.arg0}: option requires an argument -- ${c}\n`); sh.assignScalar(name, "?"); sh.vars.delete("OPTARG"); }
      } else { sh.assignScalar(name, c); sh.assignScalar("OPTARG", arg); }
    } else { sh.assignScalar(name, c); sh.vars.delete("OPTARG"); }
    sh.assignScalar("OPTIND", String(ind));
    sh.optind = ind;
    return 0;
  };

  root.ShellSim.printf = printf;
  root.ShellSim.escapes = escapes;
  root.ShellSim.describe = describe;
})(typeof window !== "undefined" ? window : globalThis);
