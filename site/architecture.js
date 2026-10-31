// The "How bash runs" tab: the steps bash takes to run a command line. Type a
// line and each step shows what it made of it, computed by the playground's
// own bash in a throwaway copy of the server.
"use strict";

(function () {
  const { h, rich } = window.SQUI;
  const S = window.ShellSim;
  const steps = window.QUEST.architecture;
  const root = document.getElementById("arch");
  const EXAMPLES = ['cp $SRC ~/backup/{a,b}.txt > log 2>&1', 'echo "Files: $(ls *.log | wc -l)" $((2 ** 8))', 'grep -c ERROR app.log | tee count.txt', 'NAME=web ./deploy.sh "$@"'];

  // A small server for tracing: a few files and variables to expand.
  function sandbox() {
    const sys = new S.System({ files: { "/home/dev/a.log": "ERROR one\nok\n", "/home/dev/b.log": "ERROR two\n", "/home/dev/app.log": "ERROR x\nERROR y\n", "/home/dev/deploy.sh": "#!/usr/bin/env bash\necho deploying\n", "/home/dev/My Reports/q3.csv": "x\n" }, dirs: ["/home/dev/backup"] });
    sys.run('SRC="My Reports/q3.csv"; set -- one "two words"');
    return sys;
  }
  const show = (list) => (list.length ? list.map((w) => `[${w}]`).join(" ") : "(nothing)");

  // What each step makes of the line. Returns {id: text}.
  function trace(line) {
    const r = {};
    let node;
    try {
      const p = new S.Parser(line);
      node = p.next();
      const toks = [];
      const lx = new S.Lexer(line);
      for (let t = lx.token(); t.t !== "eof" && toks.length < 40; t = lx.token()) toks.push(t.t === "word" ? `[${t.v}]` : t.t === "redir" ? `${t.fd ?? ""}${t.op}` : t.t === "arith" ? `((${t.v}))` : t.v === "\n" ? "newline" : t.v);
      r.read = "One complete command.";
      r.tokens = toks.join("  ");
    } catch (e) {
      r.read = e.token ? `syntax error near unexpected token \`${e.token}'` : e.msg || "could not read this line";
      return r;
    }
    if (!node) return { read: "Nothing to run." };
    const andor = node.items[0].node;
    const pipe = andor.parts[0];
    const cmd = pipe.cmds[0];
    r.parse = `${node.items.length > 1 ? `${node.items.length} commands in a list; the first ` : ""}${andor.parts.length > 1 ? `an and-or list (${andor.ops.join(" ")}); the first ` : ""}${pipe.cmds.length > 1 ? `a pipeline of ${pipe.cmds.length} commands; the first ` : ""}${cmd.type === "simple" ? `a simple command: ${cmd.assigns.length ? `assignments ${cmd.assigns.join(" ")}, ` : ""}words ${show(cmd.words)}${cmd.redirs.length ? `, ${cmd.redirs.length} redirection${cmd.redirs.length > 1 ? "s" : ""}` : ""}` : `a compound command (${cmd.type})`}.`;
    r.subshell = pipe.cmds.length > 1 ? `Each of the ${pipe.cmds.length} commands of the pipeline runs in its own subshell; variables they set are lost.` : /\$\(|`/.test(line) ? "Each $( ) runs in a subshell." : "None for this line.";
    if (cmd.type !== "simple") return r;
    const sys = sandbox();
    const sh = sys.term;
    sh.io = sys.termIO;
    const braced = cmd.words.flatMap((w) => S.braceExpand(w));
    r.brace = show(braced);
    const parts = braced.map((w) => S.wordParts(w));
    const found = (kinds) => {
      const out = [];
      const walk = (ps) => ps.forEach((p) => { if (kinds.includes(p.k)) out.push(p); if (p.parts) walk(p.parts); });
      parts.forEach(walk);
      return out;
    };
    const tildes = braced.filter((w) => /^~/.test(w));
    r.tilde = tildes.length ? tildes.map((w) => `${w} → ${sh.expandString(w)}`).join("   ") : "No ~ at the start of a word.";
    const safely = (fn) => { try { return fn(); } catch { return "(error: see the status step)"; } };
    const params = found(["param"]);
    r.param = params.length ? params.slice(0, 6).map((p) => `$${p.name}${p.index !== undefined ? `[${p.index}]` : ""}${p.op ? ` with ${p.op}` : ""} → ${safely(() => JSON.stringify(sh.scalar(p.name, p.index) ?? ""))}`).join("   ") : "No $variables.";
    const ariths = found(["arith"]);
    r.arith = ariths.length ? ariths.map((p) => `$((${p.src})) → ${safely(() => sh.arith(sh.expandString(p.src)))}`).join("   ") : "No $(( )).";
    const subs = found(["cmd"]);
    r.cmdsub = subs.length ? subs.map((p) => `$(${p.src}) → ${safely(() => JSON.stringify(sh.cmdSub(p.src)))}`).join("   ") : "No $( ).";
    const noglob = safely(() => { sh.opts.f = true; const f = braced.flatMap((w) => sh.fields(sh.pieces(S.wordParts(w), false))); sh.opts.f = false; return f; });
    r.split = Array.isArray(noglob) ? show(noglob) : noglob;
    const argv = safely(() => sh.expandWords(cmd.words));
    r.glob = Array.isArray(argv) ? show(argv) : argv;
    r.quotes = Array.isArray(argv) ? `argv: ${show(argv)}` : argv;
    r.redir = cmd.redirs.length ? cmd.redirs.map((x) => `${x.fd ?? ""}${x.op}${/&$/.test(x.op) ? "" : " "}${x.op.startsWith("<<") ? x.delim + " (here-document)" : x.target}`).join("   ") : "None: stdin, stdout and stderr stay on the terminal.";
    const name = Array.isArray(argv) ? argv[0] : null;
    const d = name ? S.describe(sh, name) : null;
    r.lookup = name ? d ? d.text : `${name}: not found (exit status 127)` : cmd.assigns.length ? "No command: only assignments, which change this shell." : "No command.";
    r.exec = !d ? "Nothing to start." : d.kind === "file" ? `fork a child, then exec ${d.path}${cmd.assigns.length ? ` with ${cmd.assigns.join(" ")} in its environment` : ""}.` : `Runs inside this shell: no new process (${d.kind}).`;
    r.env = `The child gets ${Object.keys(sh.exportedEnv()).length} exported variables${cmd.assigns.length ? ` plus ${cmd.assigns.map((a) => a.split("=")[0]).join(", ")}` : ""}. Shell-only variables such as SRC are not passed.`;
    const lines = sys.run(line);
    r.status = `${lines.slice(0, 4).map(([t]) => t).join("\n")}${lines.length > 4 ? "\n…" : ""}${lines.length ? "\n" : ""}$? = ${sys.term.status}`;
    return r;
  }

  const input = h("input", { type: "text", value: EXAMPLES[0], spellcheck: "false", autocapitalize: "off", "aria-label": "A command line to trace" });
  const flow = h("ol.arch-flow", { "aria-label": "Steps" });
  let on = -1;
  let timer = null;
  function select(i) {
    on = i;
    [...flow.children].forEach((li, k) => {
      li.classList.toggle("on", k === i);
      li.classList.toggle("past", k < i);
      li.querySelector(".arch-dot").setAttribute("aria-expanded", String(k === i));
    });
  }
  function render() {
    const r = trace(input.value);
    flow.replaceChildren(...steps.map((s, i) => h("li.arch-step", null,
      h("button.arch-dot", { type: "button", "aria-expanded": "false", "aria-label": `Step ${i + 1}: ${s.name}`, onclick: () => { stop(); select(on === i ? -1 : i); } }, String(i + 1)),
      h("div.arch-card", { onclick: () => { stop(); select(on === i ? -1 : i); } },
        h("h3", null, s.name, h("code", null, s.short)),
        r[s.id] !== undefined ? h("p.arch-out", null, r[s.id]) : null,
        h("div.arch-detail", null, h("p", null, ...rich(s.text)), h("p.arch-breaks", null, "When it breaks: ", ...rich(s.breaks)), h("pre", null, h("code", null, s.look.join("\n")))))))
    );
    if (on >= 0) select(on);
  }
  const play = h("button.pill.small-pill", { type: "button", onclick: () => (timer ? stop() : tour()) }, "Step through");
  function stop() { clearInterval(timer); timer = null; play.textContent = "Step through"; }
  function tour() {
    select(0);
    play.textContent = "Pause";
    timer = setInterval(() => { if (on + 1 >= steps.length) { stop(); return; } select(on + 1); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 2600 : 2200);
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") render(); });
  root.append(
    h("div.arch-trace", null, input, h("button.pill.primary.small-pill", { type: "button", onclick: render }, "Trace")),
    h("div.arch-controls", null, play, ...EXAMPLES.slice(1).map((x) => h("button.chip.mono", { type: "button", onclick: () => { input.value = x; render(); } }, x))),
    flow);
  render();
})();
