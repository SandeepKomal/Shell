// A subset of bash that runs in the page, over a virtual file system.
// It reads a script the way bash does (one complete command at a time),
// expands words in bash's order and prints bash's own error messages.
// No DOM access, so tests/check_playground.js can drive it under Node.
"use strict";

(function (root) {
  // The playground's clock: Friday 30 October 2026, 03:00 UTC. Only sleep moves it.
  const EPOCH = Date.UTC(2026, 9, 30, 3, 0, 0) / 1000;
  const STEP_LIMIT = 40000;
  const OUTPUT_LIMIT = 200000;
  const ERRNO = { ENOENT: "No such file or directory", EISDIR: "Is a directory", ENOTDIR: "Not a directory", EEXIST: "File exists", ENOTEMPTY: "Directory not empty" };

  // --- control flow -------------------------------------------------------------

  class Exit { constructor(code) { this.code = code; } }
  class Return { constructor(code) { this.code = code; } }
  class Loop { constructor(kind, n) { this.kind = kind; this.n = n; } }
  // An expansion error: the message is printed; abort ends the whole complete command, as bash does.
  class CmdError { constructor(code, abort) { this.code = code; this.abort = abort; } }
  class AbortLine { constructor(code) { this.code = code; } } // an interactive shell drops the rest of the line
  class Limit { constructor(what) { this.what = what; } }
  // A signal to a process. deadline marks the TERM that timeout sends when time runs out.
  class Signal { constructor(sig, deadline) { this.sig = sig; this.deadline = !!deadline; } }
  const SIGNUM = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15 };
  class SyntaxErr { constructor(line, token, msg) { Object.assign(this, { line, token, msg }); } }

  // --- virtual file system ------------------------------------------------------

  class FS {
    constructor(nodes, now) { this.nodes = nodes || new Map([["/", { type: "dir", mode: 0o755, mtime: EPOCH }]]); this.now = now || EPOCH; }
    clone() { return new FS(new Map([...this.nodes].map(([k, v]) => [k, { ...v }])), this.now); }
    // An absolute path with ".", ".." and repeated slashes resolved; /bin is /usr/bin, as on current distributions.
    static norm(cwd, p) {
      const parts = [];
      for (const seg of (p.startsWith("/") ? p : cwd + "/" + p).split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") parts.pop(); else parts.push(seg);
      }
      if (parts[0] === "bin" || parts[0] === "sbin") parts.unshift("usr");
      return "/" + parts.join("/");
    }
    static parent(p) { return p === "/" ? "/" : p.slice(0, p.lastIndexOf("/")) || "/"; }
    static base(p) { return p.slice(p.lastIndexOf("/") + 1); }
    get(p) { return this.nodes.get(p); }
    isDir(p) { const n = this.get(p); return !!n && n.type === "dir"; }
    isFile(p) { const n = this.get(p); return !!n && n.type === "file"; }
    parentError(p) { const d = this.get(FS.parent(p)); return !d ? "ENOENT" : d.type !== "dir" ? "ENOTDIR" : null; }
    list(dir) {
      const pre = dir === "/" ? "/" : dir + "/";
      const out = [];
      for (const k of this.nodes.keys()) if (k !== "/" && k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k.slice(pre.length));
      return out.sort(byteOrder);
    }
    // Every path under dir, depth first, parents before children.
    walk(dir) { return [...this.nodes.keys()].filter((k) => k.startsWith(dir === "/" ? "/" : dir + "/")).sort(byteOrder); }
    write(p, text, append) {
      const n = this.get(p);
      if (n && n.dev) return null;
      if (n && n.type === "dir") return "EISDIR";
      if (!n) { const e = this.parentError(p); if (e) return e; }
      this.nodes.set(p, { type: "file", mode: n ? n.mode : 0o644, text: append && n ? n.text + text : text, mtime: this.now });
      return null;
    }
    mkdir(p) {
      if (this.get(p)) return "EEXIST";
      const e = this.parentError(p);
      if (e) return e;
      this.nodes.set(p, { type: "dir", mode: 0o755, mtime: this.now });
      return null;
    }
    remove(p) { for (const k of [...this.nodes.keys()]) if (k === p || k.startsWith(p === "/" ? "/" : p + "/")) if (k !== "/") this.nodes.delete(k); }
    move(from, to) {
      for (const k of [...this.nodes.keys()]) {
        if (k === from || k.startsWith(from + "/")) { const n = this.nodes.get(k); this.nodes.delete(k); this.nodes.set(to + k.slice(from.length), n); }
      }
    }
  }
  const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // --- writers and readers ------------------------------------------------------

  class Buf { constructor() { this.text = ""; } write(s) { this.text += s; } }
  class Term { constructor(sys, fd) { this.sys = sys; this.fd = fd; this.tty = true; } write(s) { this.sys.emit(this.fd, s); } }
  class FileOut {
    constructor(fs, path) { this.fs = fs; this.path = path; }
    write(s) { this.fs.write(this.path, s, true); }
  }
  const Null = { write() {} };
  class Reader {
    constructor(text, tty) { this.text = text; this.pos = 0; this.tty = tty; }
    // The next record up to delim: {line, ok}; ok is false when the input ended first.
    readLine(delim = "\n") {
      if (this.pos >= this.text.length) return { line: "", ok: false, eof: true };
      const j = this.text.indexOf(delim, this.pos);
      if (j < 0) { const line = this.text.slice(this.pos); this.pos = this.text.length; return { line, ok: false }; }
      const line = this.text.slice(this.pos, j);
      this.pos = j + 1;
      return { line, ok: true };
    }
    readAll() { const t = this.text.slice(this.pos); this.pos = this.text.length; return t; }
  }

  // --- lexer --------------------------------------------------------------------

  // Scanners over raw text: each starts after the opening character and
  // returns the index after the closing one, or -1 when the text ends first.
  function skipSq(s, i) { const j = s.indexOf("'", i); return j < 0 ? -1 : j + 1; }
  function skipAnsi(s, i) {
    for (; i < s.length; i++) { if (s[i] === "\\") i++; else if (s[i] === "'") return i + 1; }
    return -1;
  }
  function skipBq(s, i) {
    for (; i < s.length; i++) { if (s[i] === "\\") i++; else if (s[i] === "`") return i + 1; }
    return -1;
  }
  function skipNested(s, i) {
    if (s[i] === "\\") return i + 2;
    if (s[i] === "'") return skipSq(s, i + 1);
    if (s[i] === '"') return skipDq(s, i + 1);
    if (s[i] === "`") return skipBq(s, i + 1);
    if (s[i] === "$" && s[i + 1] === "(") return skipParen(s, i + 2);
    if (s[i] === "$" && s[i + 1] === "{") return skipBrace(s, i + 2);
    return null;
  }
  function skipDq(s, i) {
    while (i < s.length) {
      if (s[i] === '"') return i + 1;
      if (s[i] === "'") { i++; continue; }
      const j = skipNested(s, i);
      if (j === -1) return -1;
      i = j === null ? i + 1 : j;
    }
    return -1;
  }
  function skipParen(s, i) {
    let depth = 1;
    while (i < s.length) {
      const j = skipNested(s, i);
      if (j === -1) return -1;
      if (j !== null) { i = j; continue; }
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) return i + 1;
      i++;
    }
    return -1;
  }
  function skipBrace(s, i) {
    let depth = 1;
    while (i < s.length) {
      const j = skipNested(s, i);
      if (j === -1) return -1;
      if (j !== null) { i = j; continue; }
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) return i + 1;
      i++;
    }
    return -1;
  }

  const META = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
  const OPS = ["&>>", "<<-", "<<<", ";;&", "&&", "||", ";;", ";&", ">>", "<<", ">&", "<&", "&>", ">|", "<>", "|&", ";", "&", "|", "(", ")", "<", ">"];
  const REDIRS = new Set(["<", ">", ">>", "<<", "<<-", "<<<", ">&", "<&", "&>", "&>>", ">|", "<>"]);
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+?)=/;

  class Lexer {
    constructor(src) { this.s = src; this.i = 0; this.line = 1; this.heredocs = []; this.warnings = []; }
    eof(ch, line) { throw new SyntaxErr(line, null, `unexpected EOF while looking for matching \`${ch}'`); }
    blanks() {
      const s = this.s;
      for (;;) {
        const c = s[this.i];
        if (c === " " || c === "\t") this.i++;
        else if (c === "\\" && s[this.i + 1] === "\n") { this.i += 2; this.line++; }
        else if (c === "#") { while (this.i < s.length && s[this.i] !== "\n") this.i++; }
        else return;
      }
    }
    token() {
      this.blanks();
      const s = this.s;
      const line = this.line;
      if (this.i >= s.length) {
        if (this.heredocs.length) this.readHeredocs();
        return { t: "eof", line };
      }
      if (s[this.i] === "\n") {
        this.i++;
        this.line++;
        this.readHeredocs();
        return { t: "op", v: "\n", line };
      }
      if (s.startsWith("((", this.i)) {
        const end = this.arithEnd(this.i + 2);
        if (end > 0) {
          const v = s.slice(this.i + 2, end);
          this.line += (v.match(/\n/g) || []).length;
          this.i = end + 2;
          return { t: "arith", v, line };
        }
      }
      if (s[this.i] === ">" && s[this.i + 1] === "(") throw new SyntaxErr(line, null, "process substitution >(...) is not supported in the playground");
      if (s[this.i] === "<" && s[this.i + 1] === "(") return { t: "word", v: this.word(), line };
      const io = /^(\d+)(?=[<>])/.exec(s.slice(this.i, this.i + 6));
      const at = this.i + (io ? io[1].length : 0);
      const op = OPS.find((o) => s.startsWith(o, at));
      if (op && (!io || REDIRS.has(op))) {
        this.i = at + op.length;
        if (!REDIRS.has(op)) return { t: "op", v: op, line };
        const tok = { t: "redir", op, fd: io ? Number(io[1]) : null, line };
        if (op === "<<" || op === "<<-") {
          this.blanks();
          if (this.i >= s.length || META.has(s[this.i])) return tok; // the parser reports the missing word
          const raw = this.word();
          tok.quoted = /['"\\]/.test(raw);
          tok.delim = raw.replace(/\\(.)|['"]/g, "$1");
          tok.target = raw;
          tok.body = "";
          this.heredocs.push(tok);
        }
        return tok;
      }
      return { t: "word", v: this.word(), line };
    }
    // Where a (( ... )) closes, or -1 when it is really two subshells.
    arithEnd(i) {
      const s = this.s;
      let depth = 0;
      while (i < s.length) {
        const j = skipNested(s, i);
        if (j === -1) return -1;
        if (j !== null) { i = j; continue; }
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
          if (depth === 0) return s[i + 1] === ")" ? i : -1;
          depth--;
        }
        i++;
      }
      return -1;
    }
    word() {
      const s = this.s;
      const start = this.i;
      let i = this.i;
      const need = (j, ch) => { if (j < 0) this.eof(ch, this.line); return j; };
      while (i < s.length) {
        const c = s[i];
        if (c === "<" && s[i + 1] === "(" && i === start) { i = need(skipParen(s, i + 2), ")"); continue; }
        if (META.has(c)) {
          // name=( ... ) is one word: an array assignment.
          if (c === "(" && /^[A-Za-z_]\w*\+?=$/.test(s.slice(start, i))) { i = need(skipParen(s, i + 1), ")"); continue; }
          break;
        }
        if (c === "\\") i += 2;
        else if (c === "'") i = need(skipSq(s, i + 1), "'");
        else if (c === '"') i = need(skipDq(s, i + 1), '"');
        else if (c === "`") i = need(skipBq(s, i + 1), "`");
        else if (c === "$" && s[i + 1] === "'") i = need(skipAnsi(s, i + 2), "'");
        else if (c === "$" && s[i + 1] === "(") i = need(skipParen(s, i + 2), ")");
        else if (c === "$" && s[i + 1] === "{") i = need(skipBrace(s, i + 2), "}");
        else i++;
      }
      const raw = s.slice(start, Math.min(i, s.length));
      this.line += (raw.match(/\n/g) || []).length;
      this.i = Math.min(i, s.length);
      return raw.replace(/\\\n/g, "");
    }
    readHeredocs() {
      const s = this.s;
      for (const tok of this.heredocs) {
        for (;;) {
          if (this.i >= s.length) {
            this.warnings.push([this.line, `warning: here-document at line ${tok.line} delimited by end-of-file (wanted \`${tok.delim}')`]);
            break;
          }
          let end = s.indexOf("\n", this.i);
          if (end < 0) end = s.length;
          let text = s.slice(this.i, end);
          this.i = end + 1;
          this.line++;
          if (tok.op === "<<-") text = text.replace(/^\t+/, "");
          if (text === tok.delim) break;
          tok.body += text + "\n";
        }
      }
      this.heredocs = [];
    }
  }

  // --- parser -------------------------------------------------------------------

  const COND_UNARY = new Set(["-e", "-f", "-d", "-s", "-r", "-w", "-x", "-n", "-z", "-L", "-h", "-b", "-c", "-p", "-S", "-t", "-v", "-a", "-g", "-u", "-k", "-O", "-G", "-N"]);
  const COND_BINARY = new Set(["==", "=", "!=", "=~", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);

  class Parser {
    // posix: read as dash does, where [[ is an ordinary (missing) command.
    constructor(src, posix) { this.lx = new Lexer(src); this.buf = []; this.posix = posix; }
    peek(k = 0) {
      while (this.buf.length <= k) {
        this.lx.blanks();
        const at = this.lx.i;
        const t = this.lx.token();
        t.at = at;
        this.buf.push(t);
      }
      return this.buf[k];
    }
    take() { this.peek(); return this.buf.shift(); }
    isOp(t, v) { return t.t === "op" && t.v === v; }
    isWord(t, v) { return t.t === "word" && t.v === v; }
    fail(t) {
      if (t.t === "eof") throw new SyntaxErr(t.line, null, "syntax error: unexpected end of file");
      const text = t.t === "op" ? (t.v === "\n" ? "newline" : t.v) : t.t === "redir" ? t.op : t.t === "arith" ? `((${t.v}))` : t.v;
      throw new SyntaxErr(t.line, text);
    }
    newlines() { while (this.isOp(this.peek(), "\n")) this.take(); }
    expect(v) { const t = this.take(); if (!(t.t === "word" ? t.v === v : this.isOp(t, v))) this.fail(t); }
    // One complete command: what bash reads, then runs, before reading on.
    next() {
      this.newlines();
      if (this.peek().t === "eof") return null;
      const list = this.list(null);
      const t = this.peek();
      if (this.isOp(t, "\n")) this.take(); else if (t.t !== "eof") this.fail(t);
      return list;
    }
    atStop(t, stops) {
      if (t.t === "eof") return true;
      if (!stops) return this.isOp(t, "\n");
      return (t.t === "word" || t.t === "op") && stops.has(t.v);
    }
    // A sequence of and-or lists. stops: words or operators that end it (null at the top level).
    list(stops) {
      const items = [];
      for (;;) {
        if (stops) this.newlines();
        const t = this.peek();
        if (this.atStop(t, stops)) break;
        const from = t.at;
        const node = this.andOr();
        const s = this.peek();
        let bg = false;
        if (this.isOp(s, ";") || this.isOp(s, "&")) {
          this.take();
          bg = s.v === "&";
          if (bg) node.text = this.lx.s.slice(from, s.at).trim();
        } else if (!(this.isOp(s, "\n") || this.atStop(s, stops))) this.fail(s);
        items.push({ node, bg });
      }
      if (!items.length) this.fail(this.peek());
      return { type: "list", items };
    }
    andOr() {
      const parts = [this.pipeline()];
      const ops = [];
      while (this.isOp(this.peek(), "&&") || this.isOp(this.peek(), "||")) {
        ops.push(this.take().v);
        this.newlines();
        parts.push(this.pipeline());
      }
      return { type: "andor", parts, ops };
    }
    pipeline() {
      let neg = false;
      if (this.isWord(this.peek(), "!")) { this.take(); neg = true; }
      const cmds = [this.command()];
      while (this.isOp(this.peek(), "|") || this.isOp(this.peek(), "|&")) {
        if (this.take().v === "|&") cmds[cmds.length - 1].mergeErr = true;
        this.newlines();
        cmds.push(this.command());
      }
      return { type: "pipeline", neg, cmds };
    }
    redirs(node) {
      node.redirs = [];
      while (this.peek().t === "redir") node.redirs.push(this.redir());
      return node;
    }
    redir() {
      const t = this.take();
      if (t.op === "<<" || t.op === "<<-") { if (t.target === undefined) this.fail(this.peek()); return t; }
      const w = this.take();
      if (w.t !== "word") this.fail(w);
      return { op: t.op, fd: t.fd, target: w.v, line: t.line };
    }
    command() {
      const t = this.peek();
      const line = t.line;
      if (t.t === "arith") { this.take(); return this.redirs({ type: "arith", expr: t.v, line }); }
      if (this.isOp(t, "(")) {
        this.take();
        const body = this.list(new Set([")"]));
        this.expect(")");
        return this.redirs({ type: "subshell", body, line });
      }
      if (t.t === "word") {
        switch (t.v) {
          case "if": return this.ifCmd();
          case "while": case "until": {
            this.take();
            const cond = this.list(new Set(["do"]));
            this.expect("do");
            const body = this.list(new Set(["done"]));
            this.expect("done");
            return this.redirs({ type: "while", until: t.v === "until", cond, body, line });
          }
          case "for": return this.forCmd();
          case "case": return this.caseCmd();
          case "{": {
            this.take();
            const body = this.list(new Set(["}"]));
            this.expect("}");
            return this.redirs({ type: "group", body, line });
          }
          case "[[": if (!this.posix) return this.condCmd(); break;
          case "function": {
            this.take();
            const name = this.take();
            if (name.t !== "word") this.fail(name);
            if (this.isOp(this.peek(), "(")) { this.take(); this.expect(")"); }
            return this.funcBody(name.v, line);
          }
          case "select": case "coproc": throw new SyntaxErr(line, null, `${t.v} is not supported in the playground`);
          case "then": case "fi": case "do": case "done": case "elif": case "else": case "esac": case "}": case "]]": this.fail(t);
        }
        if (NAME.test(t.v) && this.isOp(this.peek(1), "(") && this.isOp(this.peek(2), ")")) {
          this.take(); this.take(); this.take();
          return this.funcBody(t.v, line);
        }
      }
      return this.simple();
    }
    funcBody(name, line) {
      this.newlines();
      const body = this.command();
      if (body.type === "simple") throw new SyntaxErr(body.line, body.words[0] || "newline");
      return { type: "func", name, body, line };
    }
    ifCmd() {
      const line = this.take().line;
      const clauses = [];
      let other = null;
      for (;;) {
        const cond = this.list(new Set(["then"]));
        this.expect("then");
        const body = this.list(new Set(["elif", "else", "fi"]));
        clauses.push([cond, body]);
        const t = this.take();
        if (t.v === "elif") continue;
        if (t.v === "else") { other = this.list(new Set(["fi"])); this.expect("fi"); }
        break;
      }
      return this.redirs({ type: "if", clauses, other, line });
    }
    forCmd() {
      const line = this.take().line;
      const v = this.take();
      if (v.t === "arith") {
        const [init, cond, step] = (v.v + ";;").split(";");
        if (this.isOp(this.peek(), ";")) this.take();
        this.newlines();
        this.expect("do");
        const body = this.list(new Set(["done"]));
        this.expect("done");
        return this.redirs({ type: "cfor", init, cond, step, body, line });
      }
      if (v.t !== "word" || !NAME.test(v.v)) this.fail(v);
      let words = null;
      this.newlines();
      if (this.isWord(this.peek(), "in")) {
        this.take();
        words = [];
        while (this.peek().t === "word") words.push(this.take().v);
        const s = this.take();
        if (!(this.isOp(s, ";") || this.isOp(s, "\n"))) this.fail(s);
      } else if (this.isOp(this.peek(), ";")) this.take();
      this.newlines();
      this.expect("do");
      const body = this.list(new Set(["done"]));
      this.expect("done");
      return this.redirs({ type: "for", name: v.v, words, body, line });
    }
    caseCmd() {
      const line = this.take().line;
      const w = this.take();
      if (w.t !== "word") this.fail(w);
      this.newlines();
      this.expect("in");
      this.newlines();
      const items = [];
      const ENDS = new Set([";;", ";&", ";;&", "esac"]);
      while (!this.isWord(this.peek(), "esac")) {
        if (this.isOp(this.peek(), "(")) this.take();
        const patterns = [];
        for (;;) {
          const p = this.take();
          if (p.t !== "word") this.fail(p);
          patterns.push(p.v);
          if (this.isOp(this.peek(), "|")) { this.take(); continue; }
          break;
        }
        this.expect(")");
        this.newlines();
        const body = this.atStop(this.peek(), ENDS) ? null : this.list(ENDS);
        let term = ";;";
        const t = this.peek();
        if (t.t === "op" && ENDS.has(t.v)) { term = this.take().v; this.newlines(); }
        else if (!this.isWord(t, "esac")) this.fail(t);
        items.push({ patterns, body, term });
      }
      this.take();
      return this.redirs({ type: "case", word: w.v, items, line });
    }
    condCmd() {
      const line = this.take().line;
      const items = [];
      for (;;) {
        const t = this.take();
        if (t.t === "eof") this.fail(t);
        if (this.isWord(t, "]]")) break;
        if (t.t === "word") items.push({ w: t.v });
        else if (t.t === "op" && ["&&", "||", "(", ")"].includes(t.v)) items.push({ op: t.v });
        else if (t.t === "redir" && (t.op === "<" || t.op === ">") && t.fd === null) items.push({ op: t.op });
        else if (!this.isOp(t, "\n")) this.fail(t);
      }
      let i = 0;
      const bad = () => { throw new SyntaxErr(line, null, "syntax error in conditional expression"); };
      const isOp = (v) => items[i] && items[i].op === v;
      const word = (x) => (x && x.w !== undefined ? x.w : null);
      const or = () => { let a = and(); while (isOp("||")) { i++; a = { k: "or", a, b: and() }; } return a; };
      const and = () => { let a = not(); while (isOp("&&")) { i++; a = { k: "and", a, b: not() }; } return a; };
      const not = () => { if (word(items[i]) === "!") { i++; return { k: "not", a: not() }; } return prim(); };
      const prim = () => {
        if (isOp("(")) { i++; const e = or(); if (!isOp(")")) bad(); i++; return e; }
        const w = word(items[i]);
        if (w === null) bad();
        const next = items[i + 1];
        const op = next && (next.op === "<" || next.op === ">" ? next.op : COND_BINARY.has(next.w) ? next.w : null);
        if (op) {
          i += 2;
          if (op === "=~") {
            // The regex runs to the next && or || at this level; ( ) and | belong to it.
            let re = "";
            let depth = 0;
            while (i < items.length && !((isOp("&&") || isOp("||") || (isOp(")") && depth === 0)))) {
              const x = items[i++];
              if (x.op === "(") depth++;
              if (x.op === ")") depth--;
              re += x.w !== undefined ? (re && !/[(|]$/.test(re) && x.w !== ")" ? "" : "") + x.w : x.op;
            }
            return { k: "bin", op, l: w, r: re };
          }
          const r = word(items[i++]);
          if (r === null) bad();
          return { k: "bin", op, l: w, r };
        }
        if (COND_UNARY.has(w) && word(next) !== null) { i += 2; return { k: "un", op: w, w: next.w }; }
        i++;
        return { k: "word", w };
      };
      if (!items.length) bad();
      const expr = or();
      if (i < items.length) bad();
      return this.redirs({ type: "cond", expr, line });
    }
    simple() {
      const node = { type: "simple", assigns: [], words: [], redirs: [], line: this.peek().line };
      for (;;) {
        const t = this.peek();
        if (t.t === "word") {
          this.take();
          if (!node.words.length && ASSIGN.test(t.v)) node.assigns.push(t.v); else node.words.push(t.v);
        } else if (t.t === "redir") node.redirs.push(this.redir());
        else break;
      }
      if (!node.assigns.length && !node.words.length && !node.redirs.length) this.fail(this.peek());
      return node;
    }
  }

  // --- words --------------------------------------------------------------------

  // A word's raw text as parts: literal text, quoted text and expansions.
  const PARTS = new Map();
  function wordParts(raw) {
    let parts = PARTS.get(raw);
    if (!parts) {
      parts = parseParts(raw, false);
      if (PARTS.size > 5000) PARTS.clear();
      PARTS.set(raw, parts);
    }
    return parts;
  }
  const ESCAPES = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
  function ansi(s) {
    return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/gs, (m, c) => {
      if (c[0] === "x") return String.fromCharCode(parseInt(c.slice(1), 16));
      if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return ESCAPES[c] ?? m;
    });
  }
  // dq: inside double quotes; heredoc: a here-document body, where " is ordinary.
  function parseParts(s, dq, heredoc) {
    const parts = [];
    let lit = "";
    const flush = () => { if (lit) parts.push({ k: dq ? "q" : "lit", v: lit }); lit = ""; };
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c === "\\") {
        const n = s[i + 1];
        if (!dq) { flush(); parts.push({ k: "q", v: n ?? "\\" }); i += 2; continue; }
        if (n !== undefined && "$`\\\n".includes(n) || (n === '"' && !heredoc)) { lit += n === "\n" ? "" : n; i += 2; continue; }
        lit += c; i++; continue;
      }
      if (!dq && c === "'") {
        const j = skipSq(s, i + 1);
        flush();
        parts.push({ k: "q", v: s.slice(i + 1, j < 0 ? s.length : j - 1) });
        i = j < 0 ? s.length : j;
        continue;
      }
      if (!dq && c === "$" && s[i + 1] === "'") {
        const j = skipAnsi(s, i + 2);
        flush();
        parts.push({ k: "q", v: ansi(s.slice(i + 2, j < 0 ? s.length : j - 1)) });
        i = j < 0 ? s.length : j;
        continue;
      }
      if (!dq && c === '"') {
        const j = skipDq(s, i + 1);
        flush();
        parts.push({ k: "dq", parts: parseParts(s.slice(i + 1, j < 0 ? s.length : j - 1), true) });
        i = j < 0 ? s.length : j;
        continue;
      }
      if (c === "`") {
        const j = skipBq(s, i + 1);
        flush();
        parts.push({ k: "cmd", src: s.slice(i + 1, j < 0 ? s.length : j - 1).replace(/\\([$`\\])/g, "$1") });
        i = j < 0 ? s.length : j;
        continue;
      }
      if (!dq && c === "<" && s[i + 1] === "(") {
        const j = skipParen(s, i + 2);
        flush();
        parts.push({ k: "procsub", src: s.slice(i + 2, j < 0 ? s.length : j - 1) });
        i = j < 0 ? s.length : j;
        continue;
      }
      if (c === "$") {
        const r = parseDollar(s, i);
        if (r) { flush(); parts.push(r[0]); i = r[1]; continue; }
      }
      lit += c;
      i++;
    }
    flush();
    return parts;
  }
  function parseDollar(s, i) {
    if (s.startsWith("$((", i)) {
      const j = skipParen(s, i + 2);
      if (j > 0 && s[j - 2] === ")") return [{ k: "arith", src: s.slice(i + 3, j - 2) }, j];
    }
    if (s[i + 1] === "(") {
      const j = skipParen(s, i + 2);
      return [{ k: "cmd", src: s.slice(i + 2, j < 0 ? s.length : j - 1) }, j < 0 ? s.length : j];
    }
    if (s[i + 1] === "{") {
      const j = skipBrace(s, i + 2);
      const end = j < 0 ? s.length : j;
      const inner = s.slice(i + 2, end - 1);
      return [parseParam(inner) || { k: "bad", text: s.slice(i, end) }, end];
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!\-])/.exec(s.slice(i + 1));
    if (m) return [{ k: "param", name: m[1] }, i + 1 + m[1].length];
    return null;
  }
  function parseParam(t) {
    let m = /^!([A-Za-z_]\w*)(\[[@*]\])?$/.exec(t);
    if (m) return { k: "param", name: m[1], index: m[2] && m[2][1], keys: !!m[2], indirect: !m[2] };
    m = /^#([A-Za-z_]\w*|\d+|[@*])(\[([^\]]*)\])?$/.exec(t);
    if (m) return { k: "param", name: m[1], index: m[3], len: true };
    m = /^([A-Za-z_]\w*|\d+|[@*#?$!\-])(\[([^\]]*)\])?/.exec(t);
    if (!m) return null;
    const p = { k: "param", name: m[1], index: m[3] };
    let rest = t.slice(m[0].length);
    if (!rest) return p;
    const op = /^(:[-=?+]|[-=?+]|##|#|%%|%|\/\/|\/#|\/%|\/|\^\^|\^|,,|,|:)/.exec(rest);
    if (!op) return null;
    p.op = op[1];
    rest = rest.slice(op[1].length);
    if (p.op[0] === "/") {
      let k = 0;
      for (; k < rest.length; k++) { if (rest[k] === "\\") k++; else if (rest[k] === "/") break; }
      p.word = rest.slice(0, k);
      p.rep = k < rest.length ? rest.slice(k + 1) : "";
    } else if (p.op === ":") {
      const k = rest.indexOf(":");
      p.word = k < 0 ? rest : rest.slice(0, k);
      p.rep = k < 0 ? null : rest.slice(k + 1);
    } else p.word = rest;
    return p;
  }
  // {a,b} and {1..5}, outside quotes and ${...}.
  function braceExpand(raw, depth = 0) {
    if (!raw.includes("{") || depth > 8) return [raw];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === "\\") { i++; continue; }
      if (c === "'" || c === '"' || c === "`" || (c === "$" && (raw[i + 1] === "(" || raw[i + 1] === "{" || raw[i + 1] === "'"))) {
        const j = c === "'" ? skipSq(raw, i + 1) : c === '"' ? skipDq(raw, i + 1) : c === "`" ? skipBq(raw, i + 1)
          : raw[i + 1] === "(" ? skipParen(raw, i + 2) : raw[i + 1] === "{" ? skipBrace(raw, i + 2) : skipAnsi(raw, i + 2);
        if (j < 0) return [raw];
        i = j - 1;
        continue;
      }
      if (c !== "{") continue;
      let depthB = 0;
      const commas = [];
      let j = i + 1;
      for (; j < raw.length; j++) {
        const d = raw[j];
        if (d === "\\") { j++; continue; }
        if (d === "'" || d === '"') { const k = d === "'" ? skipSq(raw, j + 1) : skipDq(raw, j + 1); if (k < 0) return [raw]; j = k - 1; continue; }
        if (d === "{") depthB++;
        else if (d === "}") { if (depthB-- === 0) break; }
        else if (d === "," && depthB === 0) commas.push(j);
      }
      if (j >= raw.length) return [raw];
      const pre = raw.slice(0, i);
      const post = raw.slice(j + 1);
      const body = raw.slice(i + 1, j);
      let alts = null;
      if (commas.length) {
        alts = [];
        let from = i + 1;
        for (const k of [...commas, j]) { alts.push(raw.slice(from, k)); from = k + 1; }
      } else {
        const m = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
        if (m) {
          const num = /\d/.test(m[1]);
          const a = num ? Number(m[1]) : m[1].charCodeAt(0);
          const b = num ? Number(m[2]) : m[2].charCodeAt(0);
          const step = Math.abs(Number(m[3]) || 1);
          const width = num && (/^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2])) ? Math.max(m[1].length, m[2].length) : 0;
          alts = [];
          for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) {
            alts.push(num ? String(v).padStart(width, "0") : String.fromCharCode(v));
            if (alts.length > 1000) break;
          }
        }
      }
      if (!alts) continue;
      return alts.flatMap((alt) => braceExpand(pre + alt + post, depth + 1)).slice(0, 2000);
    }
    return [raw];
  }

  // Glob pattern to a regular expression; a backslash makes the next character literal.
  const RE_CACHE = new Map();
  const CLASSES = { alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z", space: " \\t\\n\\r\\f\\v", blank: " \\t", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f", word: "\\w" };
  const escRe = (c) => c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  function classEnd(p, i) {
    let j = i + 1;
    if (p[j] === "!" || p[j] === "^") j++;
    if (p[j] === "]") j++;
    for (; j < p.length; j++) {
      if (p[j] === "[" && p[j + 1] === ":") { const k = p.indexOf(":]", j + 2); if (k > 0) { j = k + 1; continue; } }
      if (p[j] === "]") return j;
    }
    return -1;
  }
  function classRe(body) {
    let neg = false;
    if (body[0] === "!" || body[0] === "^") { neg = true; body = body.slice(1); }
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const m = /^\[:([a-z]+):\]/.exec(body.slice(i));
      if (m) { out += CLASSES[m[1]] || ""; i += m[0].length - 1; continue; }
      const c = body[i];
      if (c === "\\" && i + 1 < body.length) { out += escRe(body[++i]); continue; }
      out += c === "-" && i > 0 && i < body.length - 1 ? "-" : escRe(c);
    }
    return "[" + (neg ? "^" : "") + out + "]";
  }
  function globToRe(p, flags = "") {
    const key = flags + "\0" + p;
    let re = RE_CACHE.get(key);
    if (re) return re;
    let src = "";
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === "\\") src += escRe(p[++i] ?? "\\");
      else if (c === "*") src += "[\\s\\S]*";
      else if (c === "?") src += "[\\s\\S]";
      else if (c === "[") { const j = classEnd(p, i); if (j < 0) src += "\\["; else { src += classRe(p.slice(i + 1, j)); i = j; } }
      else src += escRe(c);
    }
    try { re = new RegExp("^(?:" + src + ")$", flags); } catch { re = /^(?!)$/; }
    if (RE_CACHE.size > 3000) RE_CACHE.clear();
    RE_CACHE.set(key, re);
    return re;
  }
  const escGlob = (s) => s.replace(/[*?[\]\\]/g, "\\$&");
  const hasGlob = (p) => /(^|[^\\])[*?[]/.test(p);

  // --- arithmetic ---------------------------------------------------------------

  class ArithErr { constructor(expr, msg, token) { Object.assign(this, { expr, msg, token }); } }
  const ARITH_TOKEN = /\s*(?:(0[xX][0-9a-fA-F]+|\d+#[0-9A-Za-z@_]+|\d[0-9A-Za-z]*)|([A-Za-z_]\w*)|(\*\*=|<<=|>>=|\*\*|<<|>>|\+\+|--|<=|>=|==|!=|&&|\|\||[-+*/%&^|]=|[-+*/%<>=!~&^|?:,()[\]]))/y;
  const BINARY_LEVELS = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];

  function evalArith(sh, src, depth = 0) {
    const toks = [];
    ARITH_TOKEN.lastIndex = 0;
    let pos = 0;
    for (;;) {
      ARITH_TOKEN.lastIndex = pos;
      const m = ARITH_TOKEN.exec(src);
      if (!m) break;
      const start = pos + m[0].length - (m[1] || m[2] || m[3]).length;
      toks.push({ v: m[1] || m[2] || m[3], kind: m[1] ? "num" : m[2] ? "id" : "op", at: start });
      pos = ARITH_TOKEN.lastIndex;
    }
    if (src.slice(pos).trim()) throw new ArithErr(src, "syntax error: invalid arithmetic operator", src.slice(pos).trim());
    if (depth > 8) throw new ArithErr(src, "expression recursion level exceeded", toks[0] ? toks[0].v : "");
    let i = 0;
    let noeval = 0;
    const peek = () => toks[i];
    const fail = (msg) => {
      const t = toks[i] || toks[i - 1];
      throw new ArithErr(src, msg, t ? src.slice(t.at) : "");
    };
    const isOp = (v) => toks[i] && toks[i].kind === "op" && toks[i].v === v;
    const num = (v) => {
      let m;
      if ((m = /^0[xX]([0-9a-fA-F]+)$/.exec(v))) return parseInt(m[1], 16);
      if ((m = /^(\d+)#([0-9A-Za-z@_]+)$/.exec(v))) {
        const base = Number(m[1]);
        const n = parseInt(m[2], base);
        if (base < 2 || base > 36 || Number.isNaN(n)) fail("invalid number");
        return n;
      }
      if (/^0[0-7]+$/.test(v)) return parseInt(v, 8);
      if (/^0\d+$/.test(v)) { i--; fail("value too great for base"); }
      if (!/^\d+$/.test(v)) { i--; fail("invalid number"); }
      return Number(v);
    };
    const value = (lv) => {
      const v = sh.scalar(lv.name, lv.index);
      if (v === undefined) {
        if (sh.opts.u && !noeval) sh.unbound(lv.index !== undefined ? `${lv.name}[${lv.index}]` : lv.name);
        return 0;
      }
      if (!v.trim()) return 0;
      if (/^\s*[-+]?([1-9]\d*|0)\s*$/.test(v)) return Number(v);
      return evalArith(sh, v, depth + 1);
    };
    const assign = (lv, n) => { if (!noeval) sh.assignScalar(lv.name, String(n), lv.index); return n; };
    const lvalue = () => {
      const t = toks[i];
      if (!t || t.kind !== "id") return null;
      const lv = { name: t.v };
      if (toks[i + 1] && toks[i + 1].v === "[") {
        let k = i + 2;
        let d = 1;
        for (; k < toks.length; k++) { if (toks[k].v === "[") d++; if (toks[k].v === "]" && --d === 0) break; }
        if (k >= toks.length) return null;
        lv.index = String(evalArith(sh, src.slice(toks[i + 2].at, toks[k].at), depth + 1));
        lv.len = k - i + 1;
      } else lv.len = 1;
      return lv;
    };
    const wrap = (n) => (Number.isFinite(n) ? Math.trunc(n) : 0);
    function binop(op, a, b) {
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": case "%":
          if (b === 0) { if (noeval) return 0; fail("division by 0"); }
          return op === "/" ? Math.trunc(a / b) : a % b;
        case "**": if (b < 0) fail("exponent less than 0"); return a ** b;
        case "<<": return a << b;
        case ">>": return a >> b;
        case "&": return a & b;
        case "|": return a | b;
        case "^": return a ^ b;
        case "<": return +(a < b);
        case ">": return +(a > b);
        case "<=": return +(a <= b);
        case ">=": return +(a >= b);
        case "==": return +(a === b);
        case "!=": return +(a !== b);
      }
      return 0;
    }
    function comma() { let v = assignment(); while (isOp(",")) { i++; v = assignment(); } return v; }
    function assignment() {
      const lv = lvalue();
      if (lv) {
        const op = toks[i + lv.len];
        if (op && op.kind === "op" && /^([-+*/%&^|]|\*\*|<<|>>)?=$/.test(op.v) && op.v !== "==") {
          i += lv.len + 1;
          const rhs = assignment();
          return assign(lv, wrap(op.v === "=" ? rhs : binop(op.v.slice(0, -1), value(lv), rhs)));
        }
      }
      return ternary();
    }
    function ternary() {
      const c = level(0);
      if (!isOp("?")) return c;
      i++;
      if (!c) noeval++;
      const a = assignment();
      if (!c) noeval--;
      if (!isOp(":")) fail("`:' expected for conditional expression");
      i++;
      if (c) noeval++;
      const b = assignment();
      if (c) noeval--;
      return c ? a : b;
    }
    function level(n) {
      if (n === BINARY_LEVELS.length) return power();
      let a = level(n + 1);
      while (peek() && peek().kind === "op" && BINARY_LEVELS[n].includes(peek().v)) {
        const op = toks[i++].v;
        if (op === "||" || op === "&&") {
          const skip = op === "||" ? !!a : !a;
          if (skip) noeval++;
          const b = level(n + 1);
          if (skip) noeval--;
          a = op === "||" ? +(!!a || !!b) : +(!!a && !!b);
        } else a = wrap(binop(op, a, level(n + 1)));
      }
      return a;
    }
    function power() {
      const a = unary();
      if (isOp("**")) { i++; return wrap(binop("**", a, power())); }
      return a;
    }
    function unary() {
      const t = peek();
      if (t && t.kind === "op") {
        if (t.v === "!") { i++; return +!unary(); }
        if (t.v === "~") { i++; return ~unary(); }
        if (t.v === "-") { i++; return -unary(); }
        if (t.v === "+") { i++; return unary(); }
        if (t.v === "++" || t.v === "--") {
          i++;
          const lv = lvalue();
          if (!lv) fail("syntax error: operand expected");
          i += lv.len;
          return assign(lv, value(lv) + (t.v === "++" ? 1 : -1));
        }
      }
      return postfix();
    }
    function postfix() {
      const t = peek();
      if (!t) fail("syntax error: operand expected");
      if (t.kind === "num") { i++; return num(t.v); }
      if (t.kind === "id") {
        const lv = lvalue();
        if (!lv) fail("syntax error: operand expected");
        i += lv.len;
        const v = value(lv);
        if (isOp("++") || isOp("--")) { assign(lv, v + (toks[i].v === "++" ? 1 : -1)); i++; }
        return v;
      }
      if (t.v === "(") {
        i++;
        const v = comma();
        if (!isOp(")")) fail("missing `)'");
        i++;
        return v;
      }
      fail("syntax error: operand expected");
    }
    if (!toks.length) return 0;
    const v = comma();
    if (i < toks.length) fail("syntax error in expression");
    return v;
  }

  // --- test and [ ] -------------------------------------------------------------

  const TEST_UNARY = new Set(["-e", "-f", "-d", "-s", "-r", "-w", "-x", "-n", "-z", "-L", "-h", "-b", "-c", "-p", "-S", "-t", "-v", "-g", "-u", "-k", "-O", "-G", "-N"]);
  const TEST_BINARY = new Set(["=", "==", "!=", "<", ">", "-eq", "-ne", "-lt", "-le", "-gt", "-ge", "-nt", "-ot", "-ef"]);
  class TestErr { constructor(msg) { this.msg = msg; } }

  function fileTest(sh, op, arg) {
    const p = FS.norm(sh.cwd, arg);
    const n = arg === "" ? undefined : sh.sys.fs.get(p);
    switch (op) {
      case "-e": case "-a": return !!n;
      case "-f": return !!n && n.type === "file" && !n.dev;
      case "-d": return !!n && n.type === "dir";
      case "-s": return !!n && (n.type === "dir" || n.text.length > 0);
      case "-r": case "-w": case "-O": case "-G": return !!n;
      case "-x": return !!n && (n.mode & 0o111) !== 0;
      case "-c": return !!n && !!n.dev;
      case "-v": return sh.isSet(arg);
      case "-n": return arg !== "";
      case "-z": return arg === "";
      default: return false;
    }
  }
  function compare(sh, l, op, r, intOf) {
    switch (op) {
      case "=": case "==": return l === r;
      case "!=": return l !== r;
      case "<": return l < r;
      case ">": return l > r;
      case "-nt": case "-ot": {
        const a = sh.sys.fs.get(FS.norm(sh.cwd, l));
        const b = sh.sys.fs.get(FS.norm(sh.cwd, r));
        return op === "-nt" ? !!a && (!b || a.mtime > b.mtime) : !!b && (!a || a.mtime < b.mtime);
      }
      case "-ef": return FS.norm(sh.cwd, l) === FS.norm(sh.cwd, r) && !!sh.sys.fs.get(FS.norm(sh.cwd, l));
    }
    const a = intOf(l);
    const b = intOf(r);
    return { "-eq": a === b, "-ne": a !== b, "-lt": a < b, "-le": a <= b, "-gt": a > b, "-ge": a >= b }[op];
  }
  // The test builtin's rules: the number of arguments decides how they are read.
  function testArgs(sh, a) {
    const intOf = (x) => {
      if (!/^\s*[-+]?\d+\s*$/.test(x)) throw new TestErr(`${x}: integer expression expected`);
      return Number(x);
    };
    const unary = (op, x) => fileTest(sh, op, x);
    const bin = (l, op, r) => compare(sh, l, op, r, intOf);
    const general = (args) => {
      let i = 0;
      const or = () => { let v = and(); while (args[i] === "-o") { i++; const r = and(); v = v || r; } return v; };
      const and = () => { let v = not(); while (args[i] === "-a") { i++; const r = not(); v = v && r; } return v; };
      const not = () => { if (args[i] === "!") { i++; return !not(); } return prim(); };
      const prim = () => {
        if (i >= args.length) throw new TestErr("argument expected");
        if (args[i] === "(" ) { i++; const v = or(); if (args[i] !== ")") throw new TestErr("`)' expected"); i++; return v; }
        if (i + 2 < args.length + 1 && TEST_BINARY.has(args[i + 1]) && i + 2 < args.length) { const v = bin(args[i], args[i + 1], args[i + 2]); i += 3; return v; }
        if (TEST_UNARY.has(args[i]) && i + 1 < args.length) { const v = unary(args[i], args[i + 1]); i += 2; return v; }
        return args[i++] !== "";
      };
      const v = or();
      if (i < args.length) throw new TestErr(/^-[a-zA-Z]$/.test(args[i]) ? `syntax error: \`${args[i]}' unexpected` : "too many arguments");
      return v;
    };
    switch (a.length) {
      case 0: return false;
      case 1: return a[0] !== "";
      case 2:
        if (a[0] === "!") return a[1] === "";
        if (TEST_UNARY.has(a[0])) return unary(a[0], a[1]);
        throw new TestErr(`${a[0]}: unary operator expected`);
      case 3:
        if (TEST_BINARY.has(a[1])) return bin(a[0], a[1], a[2]);
        if (a[1] === "-a" || a[1] === "-o") return general(a);
        if (a[0] === "!") return !testArgs(sh, a.slice(1));
        if (a[0] === "(" && a[2] === ")") return a[1] !== "";
        throw new TestErr(`${a[1]}: binary operator expected`);
      case 4:
        if (a[0] === "!") return !testArgs(sh, a.slice(1));
        if (a[0] === "(" && a[3] === ")") return testArgs(sh, a.slice(1, 3));
        return general(a);
      default: return general(a);
    }
  }
  function ereToJs(re) {
    return re.replace(/\[\[:([a-z]+):\]\]/g, (m, c) => (CLASSES[c] ? `[${CLASSES[c]}]` : m)).replace(/\[:([a-z]+):\]/g, (m, c) => CLASSES[c] || m);
  }

  // --- the shell ----------------------------------------------------------------

  const DECLARATIONS = new Set(["local", "declare", "typeset", "export", "readonly"]);
  const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until", "do", "done", "in", "function", "time", "{", "}", "!", "[[", "]]", "select"]);
  // Bash features dash does not have: in sh, these are commands it cannot find.
  const BASHISMS = new Set(["[[", "source", "declare", "typeset", "local_x", "shopt", "mapfile", "readarray", "let"]);

  class Shell {
    constructor(sys, o = {}) {
      this.sys = sys;
      this.vars = new Map();
      this.funcs = new Map();
      this.opts = { e: false, u: false, x: false, f: false, pipefail: false, nullglob: false, failglob: false, dotglob: false, nocasematch: false, inherit_errexit: false };
      this.cwd = o.cwd || "/";
      this.args = o.args || [];
      this.arg0 = o.arg0 || "bash";
      this.file = o.file || this.arg0;
      this.tty = !!o.tty;
      this.interactive = !!o.interactive;
      this.posix = !!o.posix;
      this.status = 0;
      this.traps = {};
      this.frames = [];
      this.lineno = 0;
      this.funcDepth = 0;
      this.sourceDepth = 0;
      this.loops = 0;
      this.suppress = 0;
      this.xdepth = 1;
      this.pid = o.pid || sys.newPid();
      this.io = null;
      this.optpos = 1;
      this.jobs = [];
      for (const [k, v] of Object.entries(o.env || {})) this.vars.set(k, { value: v, exported: true });
      this.vars.set("IFS", { value: " \t\n" });
      this.vars.set("OPTIND", { value: "1" });
      this.vars.set("PPID", { value: String(this.pid - 1) });
      this.vars.set("BASH_VERSION", { value: "5.2.21(1)-release" });
      this.vars.set("PWD", { value: this.cwd, exported: true });
      if (!this.vars.has("HOSTNAME")) this.vars.set("HOSTNAME", { value: sys.hostname });
      this.vars.set("BASH_SOURCE", { value: [this.file] });
    }
    // Every message bash prints about its own work starts with where it was.
    where() {
      if (this.tty) return "bash: ";
      return this.posix ? `${this.file}: ${this.lineno}: ` : `${this.file}: line ${this.lineno}: `;
    }
    complain(msg, io = this.io) { io.fds[2].write(this.where() + msg + "\n"); }
    cmdError(msg, code = 1, abort = true) { this.complain(msg); throw new CmdError(code, abort); }
    // Errors that end a script (set -u, ${x:?}): an interactive shell drops the line instead.
    fatal(msg, code = 1) {
      this.complain(msg);
      if (this.interactive) throw new AbortLine(code);
      throw new Exit(code);
    }
    unbound(name) { this.fatal(`${name}: unbound variable`); }

    // --- variables ---
    scalar(name, index) {
      const v = this.lookup(name, index);
      return Array.isArray(v) ? v.join(" ") : v;
    }
    isSet(name) {
      const m = /^([A-Za-z_]\w*)(?:\[(.*)\])?$/.exec(name);
      return !!m && this.lookup(m[1], m[2]) !== undefined;
    }
    // A parameter's value: undefined when unset, an array for $@, $* and ${a[@]}.
    lookup(name, index) {
      if (name === "@" || name === "*") return this.args.slice();
      if (/^\d+$/.test(name)) { const n = Number(name); return n === 0 ? this.arg0 : this.args[n - 1]; }
      switch (name) {
        case "#": return String(this.args.length);
        case "?": return String(this.status);
        case "$": return String(this.sys.rootPid(this));
        case "!": return this.lastBg === undefined ? undefined : String(this.lastBg);
        case "-": return Object.entries({ e: this.opts.e, u: this.opts.u, x: this.opts.x, f: this.opts.f }).filter(([, on]) => on).map(([k]) => k).join("") + "hB" + (this.interactive ? "i" : "");
        case "RANDOM": return String(this.sys.random() % 32768);
        case "LINENO": return String(this.lineno);
        case "SECONDS": return String(this.sys.fs.now - this.sys.start);
        case "EPOCHSECONDS": return String(this.sys.fs.now);
        case "BASHPID": return String(this.pid);
      }
      const v = this.vars.get(name);
      if (!v || v.value === undefined) return undefined;
      if (Array.isArray(v.value)) {
        if (index === "@" || index === "*") return v.value.filter((x) => x !== undefined);
        if (index === undefined) return v.value[0];
        const k = this.arithIndex(index);
        return v.value[k < 0 ? v.value.length + k : k];
      }
      if (index === "@" || index === "*") return [v.value];
      if (index !== undefined && this.arithIndex(index) !== 0) return undefined;
      return v.value;
    }
    arithIndex(src) { return this.arith(this.expandString(src)); }
    readonlyError(name) { this.complain(`${name}: readonly variable`); return false; }
    // name=value; index for name[index]=value. Returns false when refused.
    assignScalar(name, value, index, append) {
      let v = this.vars.get(name);
      if (v && v.readonly) return this.readonlyError(name);
      if (!v) { v = {}; this.vars.set(name, v); }
      if (v.integer) value = String(this.arith((append ? (v.value || "0") + "+" : "") + value));
      else if (append && index === undefined) value = (Array.isArray(v.value) ? v.value[0] || "" : v.value || "") + value;
      if (index !== undefined) {
        if (!Array.isArray(v.value)) v.value = v.value === undefined ? [] : [v.value];
        const k = this.arithIndex(index);
        v.value[k < 0 ? v.value.length + k : k] = append ? (v.value[k] || "") + value : value;
      } else if (Array.isArray(v.value)) v.value[0] = value;
      else v.value = value;
      if (this.opts.allexport) v.exported = true;
      return true;
    }
    assignArray(name, list, append) {
      let v = this.vars.get(name);
      if (v && v.readonly) return this.readonlyError(name);
      if (!v) { v = {}; this.vars.set(name, v); }
      const old = append ? (Array.isArray(v.value) ? v.value : v.value === undefined ? [] : [v.value]) : [];
      v.value = [...old, ...list];
      return true;
    }
    setVar(name, value) { return this.assignScalar(name, value); }
    exportedEnv() {
      const env = {};
      for (const [k, v] of this.vars) if (v.exported && v.value !== undefined && !Array.isArray(v.value)) env[k] = v.value;
      return env;
    }
    // local and declare inside a function: the old value comes back when it returns.
    makeLocal(name) {
      const frame = this.frames[this.frames.length - 1];
      if (!frame.has(name)) {
        frame.set(name, this.vars.get(name));
        this.vars.set(name, { value: undefined });
      }
    }
    restore(saved) {
      for (const [name, prev] of saved) { if (prev === undefined) this.vars.delete(name); else this.vars.set(name, prev); }
    }

    // --- running ---
    // Read and run src one complete command at a time, as bash does.
    exec(src, io) {
      const p = new Parser(src, this.posix);
      for (;;) {
        let node;
        try { node = p.next(); } catch (e) {
          if (!(e instanceof SyntaxErr)) throw e;
          this.syntaxError(e, src, io);
          this.status = 2;
          if (this.interactive) return 2;
          throw new Exit(2);
        }
        for (const [line, msg] of p.lx.warnings.splice(0)) { this.lineno = line; this.complain(msg, io); }
        if (!node) return this.status;
        if (this.parseOnly) continue;
        try { this.execList(node, io); } catch (e) {
          if (!(e instanceof CmdError)) throw e;
          this.status = e.code;
        }
      }
    }
    syntaxError(e, src, io) {
      this.lineno = e.line;
      if (!e.token) { this.complain(e.msg, io); return; }
      const show = (t) => (t.includes("\r") ? `$'${t.replace(/\r/g, "\\r")}'` : t);
      this.complain(`syntax error near unexpected token \`${show(e.token)}'`, io);
      if (!this.tty) this.complain(`\`${(src.split("\n")[e.line - 1] || "").replace(/\r/g, "\r")}'`, io);
    }
    // A whole script or `bash -c`: exit and the EXIT trap end it.
    main(src, io) {
      try { this.exec(src, io); } catch (e) { if (!(e instanceof Exit)) throw e; this.status = e.code; }
      return this.finish(io);
    }
    finish(io) {
      const trap = this.traps.EXIT;
      if (trap !== undefined) {
        delete this.traps.EXIT;
        const st = this.status;
        try { this.exec(trap, io); this.status = st; } catch (e) { if (!(e instanceof Exit)) throw e; this.status = e.code; }
      }
      return this.status;
    }
    subshell(cmdsub) {
      const s = new Shell(this.sys, { tty: this.tty, posix: this.posix, cwd: this.cwd, args: this.args, arg0: this.arg0, file: this.file });
      s.vars = new Map([...this.vars].map(([k, v]) => [k, { ...v, value: Array.isArray(v.value) ? [...v.value] : v.value }]));
      s.funcs = new Map(this.funcs);
      s.opts = { ...this.opts };
      if (cmdsub && !this.opts.inherit_errexit) s.opts.e = false;
      Object.assign(s, { lineno: this.lineno, status: this.status, suppress: this.suppress, funcDepth: this.funcDepth, sourceDepth: this.sourceDepth, parent: this, frames: this.frames.map((f) => new Map(f)) });
      s.xdepth = this.xdepth + (cmdsub ? 1 : 0);
      return s;
    }
    // Run fn in this (sub)shell; exit ends it with its status and runs its EXIT trap.
    contain(fn, io) {
      try { fn(); } catch (e) {
        if (e instanceof Exit) this.status = e.code;
        else if (e instanceof Return) this.status = e.code;
        else if (e instanceof Loop) { /* break outside its loop: ends the subshell */ }
        else throw e;
      }
      return this.finish(io);
    }
    tick() {
      if (++this.sys.steps > STEP_LIMIT) throw new Limit("steps");
    }
    execList(list, io) {
      let st = 0;
      for (const { node, bg } of list.items) {
        if (bg) st = this.background(node, io);
        else st = this.execAndOr(node, io);
      }
      return st;
    }
    // cmd &: the job runs now, on its own clock. The shell's clock does not
    // move; wait moves it to when the job finished, as if they ran side by side.
    background(node, io) {
      const sys = this.sys;
      const start = sys.fs.now;
      const pid = sys.newPid();
      const sub = this.subshell();
      sub.pid = pid;
      const first = node.parts[0].cmds[0];
      const word = first.type === "simple" ? first.words[0] : "";
      const live = this.jobs.filter((j) => !j.reaped);
      const job = { n: live.length ? live[live.length - 1].n + 1 : 1, pid, cmd: node.text || "job", start, owner: this, protected: word === "nohup" || word === "setsid", interactive: this.interactive };
      this.jobs.push(job);
      sys.bg.push(job);
      if (this.interactive) io.fds[2].write(`[${job.n}] ${pid}\n`);
      try { job.status = sub.contain(() => sub.execAndOr(node, io), io); } catch (e) {
        if (!(e instanceof Signal)) throw e;
        job.status = 128 + (SIGNUM[e.sig] || 15);
      }
      job.end = sys.fs.now;
      sys.fs.now = start;
      this.lastBg = pid;
      return (this.status = 0);
    }
    // The signal reaches this shell: run its trap, or end it.
    receive(sig, io) {
      const n = 128 + (SIGNUM[sig] || 15);
      const trap = this.traps[sig];
      if (trap === "") return n;
      if (trap !== undefined) { this.exec(trap, io); return n; }
      if (this.interactive && (sig === "TERM" || sig === "INT" || sig === "QUIT")) return 0; // an interactive shell ignores these
      this.killedBy = sig;
      throw new Exit(n);
    }
    execAndOr(node, io) {
      const last = node.parts.length - 1;
      let st = this.execPipe(node.parts[0], io, last > 0);
      for (let k = 0; k < node.ops.length; k++) {
        if ((node.ops[k] === "&&") === (st === 0)) st = this.execPipe(node.parts[k + 1], io, k + 1 < last);
      }
      return (this.status = st);
    }
    // errexit and the ERR trap act on a failed pipeline, except where bash
    // ignores them: conditions, the left side of && and ||, and after !.
    execPipe(p, io, notLast) {
      const quiet = p.neg || notLast;
      if (quiet) this.suppress++;
      let st;
      try {
        if (p.cmds.length === 1) st = this.execCmd(p.cmds[0], io);
        else st = this.pipeline(p.cmds, io);
      } finally { if (quiet) this.suppress--; }
      if (p.neg) st = st ? 0 : 1;
      this.status = st;
      if (st !== 0 && !quiet && !this.suppress) {
        if (this.traps.ERR) { const trap = this.traps.ERR; this.exec(trap, io); this.status = st; }
        if (this.opts.e) throw new Exit(st);
      }
      return st;
    }
    // Each command of a pipeline runs in its own subshell, in order; the
    // output of one is the input of the next.
    pipeline(cmds, io) {
      let input = io.fds[0];
      const codes = [];
      cmds.forEach((cmd, i) => {
        const last = i === cmds.length - 1;
        const buf = last ? null : new Buf();
        const fds = { ...io.fds, 0: input, 1: last ? io.fds[1] : buf };
        if (cmd.mergeErr) fds[2] = buf || io.fds[1];
        const sub = this.subshell();
        codes.push(sub.contain(() => { sub.status = sub.execCmd(cmd, { fds }); }, { fds }));
        if (!last) input = new Reader(buf.text);
      });
      this.vars.set("PIPESTATUS", { value: codes.map(String) });
      if (this.opts.pipefail) { const bad = codes.filter((c) => c !== 0); return bad.length ? bad[bad.length - 1] : 0; }
      return codes[codes.length - 1];
    }
    execCmd(node, io) {
      const outer = this.io;
      this.io = io;
      try {
        if (node.type === "simple") return (this.status = this.execSimple(node, io));
        if (node.line) this.lineno = node.line;
        if (node.type === "func") { this.funcs.set(node.name, node.body); return (this.status = 0); }
        const rio = this.redirect(node.redirs, io);
        if (!rio) return (this.status = 1);
        this.io = rio;
        return (this.status = this.compound(node, rio));
      } catch (e) {
        if (e instanceof CmdError && !e.abort) return (this.status = e.code);
        throw e;
      } finally { this.io = outer; }
    }
    loop(body, io) {
      try { return { st: this.execList(body, io) }; } catch (e) {
        if (!(e instanceof Loop)) throw e;
        if (e.n > 1) { e.n--; throw e; }
        return { st: 0, stop: e.kind === "break" };
      }
    }
    cond(list, io) {
      this.suppress++;
      try { return this.execList(list, io); } finally { this.suppress--; }
    }
    compound(node, io) {
      switch (node.type) {
        case "group": return this.execList(node.body, io);
        case "subshell": { const sub = this.subshell(); return sub.contain(() => sub.execList(node.body, io), io); }
        case "if":
          for (const [cond, body] of node.clauses) if (this.cond(cond, io) === 0) return this.execList(body, io);
          return node.other ? this.execList(node.other, io) : 0;
        case "while": {
          let st = 0;
          this.loops++;
          try {
            for (;;) {
              this.tick();
              const c = this.cond(node.cond, io);
              if (node.until ? c === 0 : c !== 0) break;
              const r = this.loop(node.body, io);
              st = r.st;
              if (r.stop) break;
            }
          } finally { this.loops--; }
          return st;
        }
        case "for": {
          const items = node.words ? this.expandWords(node.words) : this.args.slice();
          let st = 0;
          this.loops++;
          try {
            for (const item of items) {
              this.tick();
              if (this.opts.x) this.trace(`for ${node.name} in ${node.words ? node.words.join(" ") : '"$@"'}`);
              if (!this.assignScalar(node.name, item)) return 1;
              const r = this.loop(node.body, io);
              st = r.st;
              if (r.stop) break;
            }
          } finally { this.loops--; }
          return st;
        }
        case "cfor": {
          let st = 0;
          this.loops++;
          try {
            if (node.init.trim()) this.arith(this.expandString(node.init));
            for (;;) {
              this.tick();
              if (node.cond.trim() && !this.arith(this.expandString(node.cond))) break;
              const r = this.loop(node.body, io);
              st = r.st;
              if (r.stop) break;
              if (node.step.trim()) this.arith(this.expandString(node.step));
            }
          } finally { this.loops--; }
          return st;
        }
        case "case": {
          const word = this.expandString(node.word);
          let falling = false;
          for (let k = 0; k < node.items.length; k++) {
            const item = node.items[k];
            const hit = falling || item.patterns.some((p) => globToRe(this.expandPattern(p), this.opts.nocasematch ? "i" : "").test(word));
            if (!hit) continue;
            const st = item.body ? this.execList(item.body, io) : 0;
            if (item.term === ";;") return st;
            falling = item.term === ";&";
            if (k === node.items.length - 1) return st;
          }
          return 0;
        }
        case "cond": {
          if (this.opts.x) this.trace("[[ ... ]]");
          return this.evalCond(node.expr) ? 0 : 1;
        }
        case "arith":
          if (this.opts.x) this.trace(`(( ${node.expr.trim()} ))`);
          return this.arith(this.expandString(node.expr)) ? 0 : 1;
      }
      return 0;
    }
    evalCond(e) {
      switch (e.k) {
        case "or": return this.evalCond(e.a) || this.evalCond(e.b);
        case "and": return this.evalCond(e.a) && this.evalCond(e.b);
        case "not": return !this.evalCond(e.a);
        case "word": return this.expandString(e.w) !== "";
        case "un": return fileTest(this, e.op, this.expandString(e.w));
      }
      const l = this.expandString(e.l);
      if (e.op === "==" || e.op === "=" || e.op === "!=") {
        const hit = globToRe(this.expandPattern(e.r), this.opts.nocasematch ? "i" : "").test(l);
        return e.op === "!=" ? !hit : hit;
      }
      if (e.op === "=~") {
        let re;
        try { re = new RegExp(ereToJs(this.expandRegex(e.r)), this.opts.nocasematch ? "i" : ""); } catch { return false; }
        const m = re.exec(l);
        this.vars.set("BASH_REMATCH", { value: m ? [...m].map((x) => x ?? "") : [] });
        return !!m;
      }
      return compare(this, l, e.op, this.expandString(e.r), (x) => this.arith(x, "[[: "));
    }
    arith(src, context = "") {
      try { return evalArith(this, src); } catch (e) {
        if (!(e instanceof ArithErr)) throw e;
        this.cmdError(`${context}${e.expr}: ${e.msg} (error token is "${e.token}")`, 1, !context);
      }
    }

    // --- simple commands ---
    execSimple(node, io) {
      this.lineno = node.line;
      this.tick();
      this.lastSub = undefined;
      const assigns = node.assigns.map((a) => this.expandAssign(a));
      let argv = [];
      if (node.words.length) {
        const first = this.expandWords([node.words[0]]);
        if (first.length === 1 && DECLARATIONS.has(first[0])) {
          argv = [first[0], ...node.words.slice(1).flatMap((w) => (ASSIGN.test(w) ? [this.expandAssignWord(w)] : this.expandWords([w])))];
        } else argv = [...first, ...this.expandWords(node.words.slice(1))];
      }
      if (this.opts.x) this.trace([...assigns.map((a) => `${a.name}${a.index !== undefined ? `[${a.index}]` : ""}${a.append ? "+" : ""}=${Array.isArray(a.value) ? `(${a.value.map(quoteTrace).join(" ")})` : quoteTrace(a.value)}`), ...argv.map(quoteTrace)].join(" "));
      if (!argv.length) {
        for (const a of assigns) if (!this.applyAssign(a)) throw new CmdError(1, true);
        const rio = this.redirect(node.redirs, io);
        if (!rio) return 1;
        return this.lastSub ?? 0;
      }
      const rio = this.redirect(node.redirs, io);
      if (!rio) return 1;
      this.io = rio;
      if (argv[0] === "exec" && argv.length === 1) { Object.assign(io.fds, rio.fds); return 0; }
      return this.invoke(argv, assigns, rio);
    }
    applyAssign(a) {
      return Array.isArray(a.value) ? this.assignArray(a.name, a.value, a.append) : this.assignScalar(a.name, a.value, a.index, a.append);
    }
    trace(text) { this.io.fds[2].write("+".repeat(this.xdepth) + " " + text + "\n"); }
    // Prefix assignments last only as long as the command (and are exported to it).
    withTemp(assigns, fn) {
      if (!assigns.length) return fn();
      const saved = new Map();
      for (const a of assigns) {
        if (!saved.has(a.name)) saved.set(a.name, this.vars.get(a.name));
        const prev = this.vars.get(a.name);
        this.vars.set(a.name, { ...(prev || {}), value: undefined });
        this.applyAssign(a);
        this.vars.get(a.name).exported = true;
      }
      try { return fn(); } finally { this.restore(saved); }
    }
    invoke(argv, assigns, io) {
      const name = argv[0];
      if (this.posix && BASHISMS.has(name)) { this.complain(`${name}: not found`, io); return 127; }
      if (this.funcs.has(name)) return this.withTemp(assigns, () => this.callFunc(name, argv, io));
      const b = Shell.builtins[name];
      if (b) return this.withTemp(assigns, () => b(this, argv.slice(1), io));
      const env = this.exportedEnv();
      for (const a of assigns) if (!Array.isArray(a.value)) env[a.name] = a.value;
      return this.sys.spawn(argv, env, this.cwd, io, this);
    }
    callFunc(name, argv, io) {
      if (this.funcDepth >= 200) { this.complain(`${name}: maximum function nesting level exceeded (200)`, io); return 1; }
      const args = this.args;
      this.args = argv.slice(1);
      this.frames.push(new Map());
      this.funcDepth++;
      try { return this.execCmd(this.funcs.get(name), io); } catch (e) {
        if (e instanceof Return) return e.code;
        throw e;
      } finally {
        this.funcDepth--;
        this.restore(this.frames.pop());
        this.args = args;
      }
    }
    redirect(redirs, io) {
      if (!redirs || !redirs.length) return io;
      const fds = { ...io.fds };
      const fs = this.sys.fs;
      for (const r of redirs) {
        const fd = r.fd ?? (r.op[0] === "<" ? 0 : 1);
        if (r.op === "<<" || r.op === "<<-") { fds[fd] = new Reader(r.quoted ? r.body : this.expandHeredoc(r.body)); continue; }
        let target;
        if (r.op === "<<<") { fds[fd] = new Reader(this.expandString(r.target) + "\n"); continue; }
        const words = this.expandWords([r.target]);
        if (words.length !== 1) { this.complain(`${r.target}: ambiguous redirect`, io); return null; }
        target = words[0];
        if ((r.op === ">&" || r.op === "<&") && /^\d+$/.test(target)) {
          if (!fds[target]) { this.complain(`${target}: Bad file descriptor`, io); return null; }
          fds[fd] = fds[target];
          continue;
        }
        if ((r.op === ">&" || r.op === "<&") && target === "-") { fds[fd] = Null; continue; }
        const path = FS.norm(this.cwd, target);
        const special = { "/dev/null": null, "/dev/stdout": fds[1], "/dev/stderr": fds[2], "/dev/stdin": fds[0] };
        if (r.op === "<") {
          if (path in special) { fds[fd] = special[path] || new Reader(""); continue; }
          const n = fs.get(path);
          if (!n) { this.complain(`${target}: No such file or directory`, io); return null; }
          if (n.type === "dir") { fds[fd] = new Reader(""); continue; }
          fds[fd] = new Reader(n.text);
          continue;
        }
        let out;
        if (path in special) out = special[path] || Null;
        else {
          const append = r.op === ">>" || r.op === "&>>";
          const n = fs.get(path);
          if ((System.isProtected(path) && this.scalar("USER") !== "root" || System.othersFile(n, this.scalar("USER"))) && (!n || n.type !== "dir")) { this.complain(`${target}: Permission denied`, io); return null; }
          const e = n && n.type === "dir" ? "EISDIR" : append && n ? null : fs.write(path, "", false);
          if (e) { this.complain(`${target}: ${ERRNO[e]}`, io); return null; }
          if (!n && append) fs.write(path, "", false);
          out = new FileOut(fs, path);
        }
        if (r.op === "&>" || r.op === "&>>" || (r.op === ">&" && r.fd === null)) { fds[1] = out; fds[2] = out; }
        else fds[fd] = out;
      }
      return { fds };
    }

    // --- expansion ---
    expandWords(raws) {
      const out = [];
      for (const raw of raws) for (const b of braceExpand(raw)) out.push(...this.fields(this.pieces(wordParts(b), false)));
      return out;
    }
    expandString(raw) { return this.join(this.pieces(wordParts(raw), false), false); }
    expandPattern(raw) { return this.join(this.pieces(wordParts(raw), false), true); }
    expandRegex(raw) {
      return this.pieces(wordParts(raw), false).map((p) => (p.brk ? " " : p.q ? p.s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") : p.s)).join("");
    }
    expandHeredoc(body) { return this.join(this.pieces(parseParts(body, true, true), true), false); }
    expandAssign(raw) {
      const m = ASSIGN.exec(raw);
      const rest = raw.slice(m[0].length);
      const a = { name: m[1], index: m[2] ? m[2].slice(1, -1) : undefined, append: m[3] === "+" };
      if (rest.startsWith("(") && rest.endsWith(")") && a.index === undefined) {
        const lx = new Lexer(rest.slice(1, -1));
        const words = [];
        for (let t = lx.token(); t.t !== "eof"; t = lx.token()) if (t.t === "word") words.push(t.v);
        a.value = this.expandWords(words);
      } else a.value = this.join(this.pieces(wordParts(rest), false, true), false);
      return a;
    }
    // `local x=$(cmd)` and friends: the value is not split or globbed.
    expandAssignWord(raw) {
      const m = ASSIGN.exec(raw);
      return m[0] + this.join(this.pieces(wordParts(raw.slice(m[0].length)), false, true), false);
    }
    join(pieces, pattern) {
      return pieces.map((p) => (p.brk ? " " : pattern && p.q ? escGlob(p.s) : p.s)).join("");
    }
    tilde(user) {
      if (!user) return this.scalar("HOME") ?? "/home/dev";
      return user === "root" ? "/root" : "/home/" + user;
    }
    // Expand parts to pieces: {s, q} where q marks quoted text (never split or
    // globbed), sp marks the result of an unquoted expansion (split on IFS),
    // and brk separates the words of "$@".
    pieces(parts, quoted, assign) {
      const out = [];
      parts.forEach((p, i) => {
        switch (p.k) {
          case "lit": {
            let v = p.v;
            if (!quoted && (i === 0 || assign)) {
              const m = (assign ? /(^|:)~([A-Za-z_][\w-]*)?(?=\/|:|$)/ : /^~([A-Za-z_][\w-]*)?(?=\/|$)/).exec(v);
              if (m && (i === 0 || m.index > 0 || m[1] === ":") && (!assign || i === 0 || m[1])) {
                const pre = assign ? v.slice(0, m.index) + m[1] : "";
                if (pre) out.push({ s: pre, q: false });
                out.push({ s: this.tilde(assign ? m[2] : m[1]), q: true });
                v = v.slice(m.index + m[0].length);
              }
            }
            if (v) out.push({ s: v, q: quoted });
            break;
          }
          case "q": out.push({ s: p.v, q: true }); break;
          case "dq": {
            const atList = p.parts.some((x) => x.k === "param" && (x.name === "@" || x.index === "@") && !x.len && !x.op);
            if (!atList) out.push({ s: "", q: true });
            out.push(...this.pieces(p.parts, true));
            break;
          }
          case "param": out.push(...this.paramPieces(p, quoted)); break;
          case "cmd": out.push({ s: this.cmdSub(p.src), q: quoted, sp: !quoted }); break;
          case "arith": out.push({ s: String(this.arith(this.join(this.pieces(parseParts(p.src, true), true), false))), q: quoted, sp: !quoted }); break;
          case "procsub": out.push({ s: this.procSub(p.src), q: true }); break;
          case "bad": this.cmdError(`${p.text}: bad substitution`);
        }
      });
      return out;
    }
    paramPieces(p, quoted) {
      const r = this.param(p, quoted);
      if (typeof r === "string") return [{ s: r, q: quoted, sp: !quoted }];
      const ifs = this.scalar("IFS") ?? " \t\n";
      if (quoted && r.star) return [{ s: r.list.join(ifs[0] || ""), q: true }];
      const out = [];
      r.list.forEach((v, k) => { if (k) out.push({ brk: true }); out.push({ s: v, q: quoted, sp: !quoted }); });
      return out;
    }
    // A sub-word inside ${...}: quoted the way the whole expansion is.
    sub(word, quoted) {
      return this.join(this.pieces(quoted ? parseParts(word, true) : wordParts(word), quoted), false);
    }
    param(p, quoted) {
      const { name, index, op } = p;
      const listy = name === "@" || name === "*" || index === "@" || index === "*";
      const star = name === "*" || index === "*";
      const display = /^\d+$/.test(name) && !index ? "$" + name : index !== undefined ? `${name}[${index}]` : name;
      if (p.keys) {
        const v = this.vars.get(name);
        const keys = !v || v.value === undefined ? [] : Array.isArray(v.value) ? Object.keys(v.value).filter((k) => v.value[k] !== undefined) : ["0"];
        return { list: keys, star: index === "*" };
      }
      if (p.indirect) {
        const target = this.scalar(name);
        if (target === undefined) { if (this.opts.u) this.unbound(name); return ""; }
        const m = /^([A-Za-z_]\w*|\d+)(?:\[(.*)\])?$/.exec(target);
        if (!m) this.cmdError(`${target}: invalid variable name`);
        return this.scalar(m[1], m[2]) ?? "";
      }
      let v = this.lookup(name, index);
      if (p.len) {
        if (v === undefined && this.opts.u && !listy) this.unbound(display);
        return String(Array.isArray(v) ? v.length : (v ?? "").length);
      }
      const isList = Array.isArray(v);
      const flat = isList ? v.join(" ") : v;
      const unset = v === undefined || (isList && !v.length);
      const empty = unset || flat === "";
      if (!op || ["#", "##", "%", "%%", "/", "//", "/#", "/%", "^", "^^", ",", ",,", ":"].includes(op)) {
        if (unset && this.opts.u && !listy) this.unbound(display);
      }
      const each = (fn) => (isList ? { list: v.map(fn), star } : fn(v ?? ""));
      switch (op) {
        case undefined: return isList ? { list: v, star } : v ?? "";
        case ":-": case "-": return (op === ":-" ? empty : unset) ? this.sub(p.word, quoted) : isList ? { list: v, star } : v;
        case ":+": case "+": return (op === ":+" ? empty : unset) ? "" : this.sub(p.word, quoted);
        case ":=": case "=": {
          if (!(op === ":=" ? empty : unset)) return isList ? { list: v, star } : v;
          if (!/^[A-Za-z_]/.test(name)) this.cmdError(`$${name}: cannot assign in this way`);
          const w = this.sub(p.word, quoted);
          this.assignScalar(name, w, index);
          return w;
        }
        case ":?": case "?":
          if (op === ":?" ? empty : unset) this.fatal(`${/^\d+$/.test(name) ? name : display}: ${this.sub(p.word, quoted) || (op === ":?" ? "parameter null or not set" : "parameter not set")}`);
          return isList ? { list: v, star } : v;
        case "#": case "##": case "%": case "%%": {
          const pat = this.join(this.pieces(wordParts(p.word), false), true);
          return each((x) => trimPattern(x, pat, op));
        }
        case "/": case "//": case "/#": case "/%": {
          const pat = this.join(this.pieces(wordParts(p.word), false), true);
          const rep = this.sub(p.rep, quoted);
          return each((x) => replacePattern(x, pat, rep, op));
        }
        case "^^": return each((x) => x.toUpperCase());
        case ",,": return each((x) => x.toLowerCase());
        case "^": return each((x) => x.charAt(0).toUpperCase() + x.slice(1));
        case ",": return each((x) => x.charAt(0).toLowerCase() + x.slice(1));
        case ":": {
          const off = this.arith(this.expandString(p.word));
          const len = p.rep === null ? null : this.arith(this.expandString(p.rep));
          if (isList) {
            const from = name === "@" || name === "*" ? Math.max(0, off - 1) : off;
            const list = off === 0 && (name === "@" || name === "*") ? [this.arg0, ...v] : v;
            return { list: list.slice(off < 0 ? list.length + off : off === 0 ? 0 : name === "@" || name === "*" ? from + (off === 0 ? 0 : 0) : from, len === null ? undefined : (off < 0 ? list.length + off : from) + len), star };
          }
          const s = v ?? "";
          const start = off < 0 ? Math.max(0, s.length + off) : off;
          if (len !== null && len < 0) {
            const end = s.length + len;
            if (end < start) this.cmdError(`${len}: substring expression < 0`);
            return s.slice(start, end);
          }
          return s.substr(start, len === null ? undefined : len);
        }
      }
      return v ?? "";
    }
    fields(pieces) {
      const ifs = this.scalar("IFS") ?? " \t\n";
      const fields = [];
      let cur = null;
      const start = () => cur || (cur = { t: "", p: "", g: false });
      const end = () => { if (cur) fields.push(cur); cur = null; };
      for (const pc of pieces) {
        if (pc.brk) { end(); continue; }
        if (pc.sp) {
          for (const ch of pc.s) {
            if (ifs.includes(ch)) {
              if (" \t\n".includes(ch)) end();
              else { start(); end(); }
            } else {
              start();
              cur.t += ch;
              cur.p += ch === "\\" ? "\\\\" : ch;
              if ("*?[".includes(ch)) cur.g = true;
            }
          }
        } else {
          start();
          cur.t += pc.s;
          cur.p += pc.q ? escGlob(pc.s) : pc.s;
          if (!pc.q && /[*?[]/.test(pc.s)) cur.g = true;
        }
      }
      end();
      const out = [];
      for (const f of fields) {
        if (f.g && !this.opts.f && hasGlob(f.p)) {
          const hits = this.glob(f.p);
          if (hits.length) { out.push(...hits); continue; }
          if (this.opts.failglob) this.cmdError(`no match: ${f.t}`);
          if (this.opts.nullglob) continue;
        }
        out.push(f.t);
      }
      return out;
    }
    glob(pattern) {
      const fs = this.sys.fs;
      const segs = pattern.split("/");
      let found = [pattern.startsWith("/") ? "/" : ""];
      if (pattern.startsWith("/")) segs.shift();
      const join = (a, b) => (a === "" ? b : a.endsWith("/") ? a + b : a + "/" + b);
      segs.forEach((seg, k) => {
        const lastSeg = k === segs.length - 1;
        if (seg === "") { found = found.filter((f) => fs.isDir(FS.norm(this.cwd, f || "."))).map((f) => (f.endsWith("/") ? f : f + "/")); return; }
        const next = [];
        for (const f of found) {
          const dir = FS.norm(this.cwd, f || ".");
          if (!fs.isDir(dir)) continue;
          if (hasGlob(seg)) {
            const re = globToRe(seg);
            for (const name of fs.list(dir)) {
              if (name[0] === "." && seg[0] !== "." && !(this.opts.dotglob)) continue;
              if (re.test(name)) next.push(join(f, name));
            }
          } else {
            const lit = seg.replace(/\\(.)/g, "$1");
            const p = join(f, lit);
            if (fs.get(FS.norm(this.cwd, p)) && (lastSeg || fs.isDir(FS.norm(this.cwd, p)))) next.push(p);
          }
        }
        found = next;
      });
      return found.filter((f) => f !== "" && f !== "/").sort(byteOrder);
    }
    // <(cmd): the output, as a file the command can read.
    procSub(src) {
      const sub = this.subshell(true);
      const buf = new Buf();
      const io = { fds: { ...this.io.fds, 1: buf } };
      sub.contain(() => sub.exec(src, io), io);
      const path = `/dev/fd/${63 - (this.sys.fdN = ((this.sys.fdN || 0) + 1) % 40)}`;
      this.sys.fs.nodes.set("/dev/fd", { type: "dir", mode: 0o500, mtime: this.sys.fs.now });
      this.sys.fs.nodes.set(path, { type: "file", text: buf.text, mode: 0o500, mtime: this.sys.fs.now });
      return path;
    }
    cmdSub(src) {
      const m = /^\s*<\s*(\S+)\s*$/.exec(src);
      if (m) src = "cat " + m[1];
      const sub = this.subshell(true);
      const buf = new Buf();
      const io = { fds: { ...this.io.fds, 1: buf } };
      this.lastSub = sub.contain(() => sub.exec(src, io), io);
      return buf.text.replace(/\n+$/, "");
    }
  }

  function trimPattern(v, pat, op) {
    const re = globToRe(pat);
    const n = v.length;
    if (n > 3000) return v;
    if (op === "#") { for (let i = 0; i <= n; i++) if (re.test(v.slice(0, i))) return v.slice(i); }
    else if (op === "##") { for (let i = n; i >= 0; i--) if (re.test(v.slice(0, i))) return v.slice(i); }
    else if (op === "%") { for (let i = n; i >= 0; i--) if (re.test(v.slice(i))) return v.slice(0, i); }
    else for (let i = 0; i <= n; i++) if (re.test(v.slice(i))) return v.slice(0, i);
    return v;
  }
  function replacePattern(v, pat, rep, op) {
    const n = v.length;
    if (n > 3000) return v;
    if (pat === "") return op === "/#" ? rep + v : op === "/%" ? v + rep : v;
    const re = globToRe(pat);
    if (op === "/#") { for (let j = n; j > 0; j--) if (re.test(v.slice(0, j))) return rep + v.slice(j); return v; }
    if (op === "/%") { for (let j = 0; j < n; j++) if (re.test(v.slice(j))) return v.slice(0, j) + rep; return v; }
    let out = "";
    let i = 0;
    while (i < n) {
      let end = -1;
      for (let j = n; j > i; j--) if (re.test(v.slice(i, j))) { end = j; break; }
      if (end < 0) { out += v[i++]; continue; }
      out += rep;
      i = end;
      if (op === "/") return out + v.slice(i);
    }
    return out;
  }
  // How set -x shows a word: quoted only when it has to be.
  function quoteTrace(w) {
    if (w === "") return "''";
    if (/^[\w@%+=:,./-]+$/.test(w)) return w;
    return "'" + w.replace(/'/g, "'\\''") + "'";
  }

  // --- the system: files, processes, the terminal ---------------------------------

  const DEFAULT_PATH = "/home/dev/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  const HOME = "/home/dev";

  class System {
    // spec: { files: {path: text | {text, mode, mtime}}, dirs: [], env: {}, bins: {name: fn}, net, procs, locks, disk, cwd }
    constructor(spec = {}) {
      this.spec = spec;
      this.hostname = spec.hostname || "web-01";
      this.fs = spec.fs ? spec.fs.clone() : System.baseFS(spec);
      this.start = this.fs.now;
      this.out = [];
      this.steps = 0;
      this.pids = 4100;
      this.seed = 7;
      this.slept = [];
      this.bg = [];
      this.deadlines = [];
      this.netHits = {};
      this.locks = new Set(spec.locks || []);
      this.procs = (spec.procs || []).map((p) => ({ ...p }));
      this.bins = spec.bins || {};
      this.termIO = { fds: { 0: new Reader("", true), 1: new Term(this, 1), 2: new Term(this, 2) } };
      this.term = this.newTerminal();
    }
    static baseFS(spec) {
      const fs = new FS();
      const dir = (p) => { for (let q = "", parts = p.split("/").filter(Boolean), k = 0; k < parts.length; k++) { q += "/" + parts[k]; if (!fs.get(q)) fs.nodes.set(q, { type: "dir", mode: 0o755, mtime: EPOCH - 86400 * 30 }); } };
      ["/usr/bin", "/usr/sbin", "/usr/local/bin", "/etc/cron.d", HOME, "/root", "/tmp", "/var/log", "/var/tmp", "/var/lock", "/var/backups", "/opt", "/srv", "/dev", "/proc"].forEach(dir);
      fs.nodes.get("/tmp").mode = 0o1777;
      fs.nodes.set("/dev/null", { type: "file", text: "", mode: 0o666, mtime: EPOCH, dev: true });
      for (const name of Object.keys(System.utils)) fs.nodes.set("/usr/bin/" + name, { type: "file", text: "", mode: 0o755, mtime: EPOCH - 86400 * 90, bin: name });
      for (const name of Object.keys(spec.bins || {})) {
        const p = name.includes("/") ? name : "/usr/bin/" + name;
        dir(FS.parent(p));
        fs.nodes.set(p, { type: "file", text: "", mode: 0o755, mtime: EPOCH - 86400 * 90, bin: name });
      }
      fs.nodes.set("/etc/hostname", { type: "file", text: (spec.hostname || "web-01") + "\n", mode: 0o644, mtime: EPOCH - 86400 * 90 });
      fs.nodes.set("/etc/passwd", { type: "file", text: "root:x:0:0:root:/root:/bin/bash\ndev:x:1000:1000:dev:/home/dev:/bin/bash\n", mode: 0o644, mtime: EPOCH - 86400 * 90 });
      for (const d of spec.dirs || []) dir(d);
      for (const [p, f] of Object.entries(spec.files || {})) {
        dir(FS.parent(p));
        const o = typeof f === "string" ? { text: f } : f;
        fs.nodes.set(p, { type: "file", text: o.text, mode: o.mode ?? (o.text.startsWith("#!") ? 0o755 : 0o644), mtime: o.mtime ?? EPOCH - 3600, ...(o.owner ? { owner: o.owner } : {}) });
      }
      return fs;
    }
    env() {
      return { HOME, USER: "dev", LOGNAME: "dev", SHELL: "/bin/bash", PATH: DEFAULT_PATH, TERM: "xterm-256color", ...(this.spec.env || {}) };
    }
    newTerminal() {
      const sh = new Shell(this, { tty: true, interactive: true, env: this.env(), cwd: this.spec.cwd || HOME, arg0: "bash" });
      sh.io = this.termIO;
      return sh;
    }
    newPid() { return ++this.pids; }
    // Time passes for the running command (sleep, a slow program). timeout's deadline cuts it short.
    advance(seconds) {
      const deadline = Math.min(Infinity, ...this.deadlines);
      if (this.fs.now + seconds > deadline) { this.fs.now = deadline; throw new Signal("TERM", true); }
      this.fs.now += seconds;
    }
    // The terminal goes away (an SSH session ends): SIGHUP kills the jobs still running, unless protected.
    hangup() {
      for (const j of this.bg) if (j.end > this.fs.now && !j.protected && !j.killed) { j.killed = true; j.status = 129; }
    }
    running() { return this.bg.filter((j) => j.end > this.fs.now && !j.killed); }
    rootPid(sh) { while (sh.parent) sh = sh.parent; return sh.pid; }
    random() { this.seed = (this.seed * 1103515245 + 12345) % 2147483648; return this.seed; }
    emit(fd, s) {
      this.outLen = (this.outLen || 0) + s.length;
      if (this.outLen > OUTPUT_LIMIT) throw new Limit("output");
      this.out.push([fd, s]);
      if (fd === 1) this.stdout += s; else this.stderr += s;
    }
    // Run one line typed at the prompt. Returns [text, "out" | "err"] lines.
    run(line) {
      this.out = [];
      this.stdout = "";
      this.stderr = "";
      this.steps = 0;
      this.outLen = 0;
      try { this.term.exec(line, this.termIO); } catch (e) {
        if (e instanceof Exit) {
          this.out.push([2, "exit\n"]);
          this.term = this.newTerminal();
          this.term.status = e.code;
        } else if (e instanceof AbortLine) this.term.status = e.code;
        else if (e instanceof Limit) {
          this.out.push([2, e.what === "steps" ? `playground: stopped after ${STEP_LIMIT} commands; is there a loop that never ends?\n` : "playground: stopped: too much output\n"]);
          this.term.status = 130;
        } else if (e instanceof Return || e instanceof Loop) this.term.status = 1;
        else if (e instanceof Signal) { this.out.push([2, "Terminated\n"]); this.term.status = 143; }
        else throw e;
      }
      return this.lines();
    }
    lines() {
      const lines = [];
      let text = "";
      let cls = null;
      for (const [fd, s] of this.out) {
        const parts = s.split("\n");
        parts.forEach((part, k) => {
          text += part;
          if (part) cls = cls === "err" || fd === 2 ? "err" : "out";
          if (k < parts.length - 1) { lines.push([text, cls || (fd === 2 ? "err" : "out")]); text = ""; cls = null; }
        });
      }
      if (text) lines.push([text, cls || "out"]);
      return lines;
    }
    resolve(name, path, cwd) {
      if (name.includes("/")) return { p: FS.norm(cwd, name), n: this.fs.get(FS.norm(cwd, name)) };
      for (const dir of (path ?? "").split(":")) {
        const p = FS.norm(cwd, (dir || ".") + "/" + name);
        const n = this.fs.get(p);
        if (n && n.type === "file" && n.mode & 0o111) return { p, n };
      }
      return null;
    }
    spawn(argv, env, cwd, io, caller) {
      caller.tick();
      const name = argv[0];
      const r = name === "" ? null : this.resolve(name, env.PATH, cwd);
      if (!r || !r.n) {
        caller.complain(name.includes("/") ? `${name}: No such file or directory` : caller.posix ? `${name}: not found` : `${name}: command not found`, io);
        return 127;
      }
      if (r.n.type === "dir") { caller.complain(`${name}: Is a directory`, io); return 126; }
      if (!(r.n.mode & 0o111)) { caller.complain(`${name}: Permission denied`, io); return 126; }
      return this.execFile(r.n, argv, env, cwd, io, caller);
    }
    execFile(node, argv, env, cwd, io, caller) {
      if (node.bin) {
        const fn = this.bins[node.bin] || System.utils[node.bin];
        try { return fn(new Ctx(this, argv, env, cwd, io, caller)) | 0; } catch (e) {
          if (!(e instanceof Signal) || e.deadline) throw e;
          return caller.receive(e.sig, io);
        }
      }
      const text = node.text;
      let posix = caller.posix;
      const flags = [];
      if (text.startsWith("#!")) {
        const line = text.slice(2, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
        const [interp, ...rest] = line.replace(/^[ \t]+|[ \t]+$/g, "").split(/[ \t]+/);
        const viaEnv = interp === "/usr/bin/env" || interp === "/bin/env";
        const prog = viaEnv ? rest.shift() : interp;
        const known = { "/bin/bash": "bash", "/usr/bin/bash": "bash", "/bin/sh": "sh", "/usr/bin/sh": "sh", bash: "bash", sh: "sh" };
        const kind = known[viaEnv ? prog : interp];
        if (!kind) {
          if (viaEnv && prog && /\r$/.test(prog)) { io.fds[2].write(`/usr/bin/env: '${prog.replace(/\r/g, "\\r")}': No such file or directory\n`); return 127; }
          if (!viaEnv && /\r$/.test(interp || "")) { caller.complain(`${argv[0]}: cannot execute: required file not found`, io); return 127; }
          if (viaEnv && !this.resolve(prog || "", env.PATH, cwd) || !viaEnv && !this.fs.get(FS.norm(cwd, interp || ""))) { caller.complain(`${argv[0]}: cannot execute: required file not found`, io); return 127; }
          io.fds[2].write(`playground: only bash and sh scripts run here (this one asks for ${prog || interp})\n`);
          return 126;
        }
        posix = kind === "sh";
        flags.push(...rest.filter((f) => /^-[a-z]+$/.test(f)));
      }
      return this.runScript(text, { argv0: argv[0], args: argv.slice(1), env, cwd, io, posix, flags, caller });
    }
    runScript(text, o) {
      const sh = new Shell(this, { env: o.env, cwd: o.cwd, args: o.args, arg0: o.argv0, file: o.file || o.argv0, posix: o.posix });
      for (const f of o.flags || []) for (const c of f.slice(1)) if (c in sh.opts) sh.opts[c] = true;
      sh.parseOnly = !!o.parseOnly;
      sh.io = o.io;
      const st = sh.main(text, o.io);
      if (sh.killedBy && o.caller && o.caller.tty) o.io.fds[2].write(sh.killedBy === "HUP" ? "Hangup\n" : "Terminated\n");
      return st;
    }
  }

  // What a utility sees: its arguments, environment, working directory and file descriptors.
  class Ctx {
    constructor(sys, argv, env, cwd, io, sh) {
      Object.assign(this, { sys, argv, env, cwd, io, sh, fs: sys.fs, name: argv[0], args: argv.slice(1) });
    }
    out(s) { this.io.fds[1].write(s); }
    err(s) { this.io.fds[2].write(s); }
    fail(msg, code = 1) { this.err(`${this.name}: ${msg}\n`); return code; }
    usage(msg, code = 1) { this.err(`${this.name}: ${msg}\nTry '${this.name} --help' for more information.\n`); return code; }
    path(p) { return FS.norm(this.cwd, p); }
    // True (after the usual message) when this user may not change p.
    denied(p, msg, why = "Permission denied") {
      if (this.env.USER === "root" || !(System.isProtected(p) || System.othersFile(this.fs.get(p), this.env.USER))) return false;
      this.fail(`${msg}: ${why}`);
      return true;
    }
    stdin() { const r = this.io.fds[0]; return r && r.readAll ? r.readAll() : ""; }
    // A file's text, or null after the usual message.
    read(file, quiet) {
      if (file === "-") return this.stdin();
      const n = this.fs.get(this.path(file));
      if (!n) { if (!quiet) this.fail(`${file}: No such file or directory`); return null; }
      if (n.type === "dir") { if (!quiet) this.fail(`${file}: Is a directory`); return null; }
      return n.text;
    }
    // Short options ("-rf", "-n 5", "-n5", options after operands) and long ones mapped to short.
    getopt(spec, longs = {}) {
      const o = {};
      const rest = [];
      const a = this.args;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (x === "--") { rest.push(...a.slice(i + 1)); break; }
        if (x.startsWith("--") && x.length > 2) {
          const eq = x.indexOf("=");
          const key = longs[eq < 0 ? x.slice(2) : x.slice(2, eq)];
          if (!key) return this.usage(`unrecognized option '${x}'`, this.badCode || 1) && null;
          if (spec.includes(key + ":")) o[key] = eq < 0 ? a[++i] : x.slice(eq + 1);
          else o[key] = true;
          continue;
        }
        if (x[0] === "-" && x.length > 1) {
          for (let j = 1; j < x.length; j++) {
            const c = x[j];
            const k = spec.indexOf(c);
            if (k < 0 || c === ":") { this.usage(`invalid option -- '${c}'`, this.badCode || 1); return null; }
            if (spec[k + 1] === ":") {
              o[c] = x.slice(j + 1) || a[++i];
              if (o[c] === undefined) { this.usage(`option requires an argument -- '${c}'`, this.badCode || 1); return null; }
              break;
            }
            o[c] = (o[c] || 0) + 1;
          }
          continue;
        }
        rest.push(x);
      }
      return { o, rest };
    }
    // Run another program, as a utility like xargs or find -exec does.
    run(argv, io) { return this.sys.spawn(argv, this.env, this.cwd, io || this.io, this.sh); }
  }

  // Only root may change system directories; everything else in this world is the dev user's.
  System.isProtected = (p) => /^\/(etc|usr|root|boot)(\/|$)/.test(p);
  // A file another user owns and has not made writable for everyone.
  System.othersFile = (n, user) => !!n && !!n.owner && n.owner !== (user || "dev") && user !== "root" && !(n.mode & 0o002);

  System.utils = {};
  Shell.builtins = {};
  root.ShellSim = { FS, Shell, System, Ctx, Parser, Lexer, wordParts, Reader, Buf, Null, evalArith, testArgs, TestErr, globToRe, quoteTrace, braceExpand, ansi, EPOCH, HOME, DEFAULT_PATH, Exit, Return, Loop, CmdError, Signal, SIGNUM, ERRNO, KEYWORDS, NAME, byteOrder };
})(typeof window !== "undefined" ? window : globalThis);
