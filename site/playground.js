// The playground's page: a terminal over the simulated server, an editor for
// the scenario's script, and a live check of whether the script now works.
// The shell itself is in bash.js, builtins.js and coreutils.js.
"use strict";

(function () {
  const { SCENARIOS, GROUPS, start } = window.ShellScenarios;
  const { h } = window.SQUI;
  const $ = (sel) => document.querySelector(sel);
  const out = $("#pg-out");
  const input = $("#pg-input");
  const picker = $("#pg-scenarios");
  const editor = $("#pg-editor");
  const editText = $("#pg-editor-text");

  const SOLVED = "dq-shell:pg-solved";
  const solved = {
    get() { try { return JSON.parse(localStorage.getItem(SOLVED)) || []; } catch { return []; } },
    add(id) { try { localStorage.setItem(SOLVED, JSON.stringify([...new Set([...solved.get(), id])])); } catch { /* storage blocked */ } }
  };

  const HELP = [
    "This is bash 5.2 over a small simulated server. What it supports:",
    "  variables, quoting, ${x:-d} ${x:?msg} ${#x} ${x%.*} ${x##*/} ${x/a/b}, arrays, $(( )), $( ), <( ), globs, {a,b} {1..5}",
    "  if/elif/else, [ ] and [[ ]], for, for ((;;)), while, until, case, functions with local, return and $?",
    "  set -e -u -x -o pipefail, shopt nullglob, trap ... EXIT/ERR, exit, source, eval, getopts, read, printf",
    "  pipes, > >> < 2>&1 &> <<EOF <<'EOF' <<<, subshells ( ), exec 9>file",
    "  programs: cat ls grep sed awk cut sort uniq wc head tail tr find xargs cp mv rm mkdir touch chmod",
    "            basename dirname date sleep env printenv mktemp tee seq curl gzip tar flock file dos2unix bash sh",
    "Not here: job control (& runs to completion first), aliases, >( ), interactive programs.",
    "Playground commands: edit FILE (or nano, vi) · hint · reset · next · clear · history"
  ];

  let scenario = SCENARIOS[0];
  let sys;
  let won = false;
  let hintLevel = 0;
  let lastOk = null;
  const history = [];
  let historyPos = 0;

  function print(text, cls) {
    out.append(h("div.pg-line" + (cls ? "." + cls : ""), null, text));
    out.scrollTop = out.scrollHeight;
  }

  function renderPicker() {
    const done = new Set(solved.get());
    picker.replaceChildren(...GROUPS.map(([group, ids]) => {
      const n = ids.filter((id) => done.has(id)).length;
      return h("div.pg-group", null,
        h("span.pg-group-name", null, group, h("span.count" + (n === ids.length ? ".done" : ""), null, `${n}/${ids.length}`)),
        h("div.pg-group-items", null, ids.map((id) => {
          const s = SCENARIOS.find((x) => x.id === id);
          return h("button.pg-scn", { type: "button", "aria-pressed": String(s === scenario), title: done.has(id) ? `${s.title} (solved)` : s.title, onclick: () => { location.hash = "play/" + id; } },
            done.has(id) ? h("span.pg-scn-done", { "aria-hidden": "true" }, "✓") : null, s.title);
        })));
    }));
  }

  // The live check: the scenario's script, run in a fresh copy of the server.
  function renderCheck() {
    const r = scenario.check(sys);
    const box = $("#pg-check");
    box.className = "pg-check " + (r.ok ? "ok" : "bad") + (r.ok && lastOk === false ? " is-healed" : "");
    lastOk = r.ok;
    box.replaceChildren(h("span.lbl", null, `Live check · ${r.label}`), h("span.val", null, h("span.dot", { "aria-hidden": "true" }, r.ok ? "✓" : "!"), r.text));
    return r.ok;
  }

  function renderFiles() {
    const fs = sys.fs;
    const cwd = sys.term.cwd;
    const names = fs.list(cwd).filter((n) => n[0] !== ".");
    const rel = (p) => (p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p);
    const main = rel(scenario.file);
    const rows = names.filter((n) => n !== main).slice(0, 8).map((n) => {
      const p = (cwd === "/" ? "" : cwd) + "/" + n;
      const dir = fs.isDir(p);
      return h("div.pg-file", null, h("span", null, n + (dir ? "/" : "")),
        h("span.acts", null, dir ? null : h("button.copy", { type: "button", onclick: () => { run(`cat -A ${quote(n)}`); input.focus(); } }, "cat")));
    });
    $("#pg-files").replaceChildren(h("h3", null, cwd),
      h("div.pg-file.main", null, h("span", null, main),
        h("span.acts", null, h("button.copy", { type: "button", onclick: () => openEditor(scenario.file) }, "Edit"), h("button.copy", { type: "button", onclick: () => { run(`cat -n ${quote(main)}`); input.focus(); } }, "cat"))),
      ...rows);
  }
  const quote = (s) => (/^[\w./~-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

  function renderTries() {
    $("#pg-try").replaceChildren(h("span.muted.small", null, "Try"), ...[...scenario.tries, "hint", "reset"].map((cmd) =>
      h("button.chip", { type: "button", onclick: () => { run(cmd); input.focus(); } }, cmd)));
  }

  function openEditor(path) {
    const n = sys.fs.get(path);
    if (n && n.type === "dir") { print(`edit: ${path}: Is a directory`, "err"); return; }
    editor.hidden = false;
    editor.dataset.path = path;
    $("#pg-editor-name").textContent = path;
    // A textarea drops carriage returns, so show them as ^M, the way vim does, and keep them on save.
    editText.value = n ? n.text.replace(/\r/g, "^M") : "";
    editText.focus();
  }
  function saveEditor() {
    const path = editor.dataset.path;
    const e = sys.fs.write(path, editText.value.replace(/\^M/g, "\r"), false);
    if (e) { print(`edit: cannot write ${path}`, "err"); return; }
    print(`saved ${path}`, "dim");
    after();
  }
  function closeEditor() { editor.hidden = true; input.focus(); }

  function load(id) {
    scenario = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    sys = start(scenario);
    sys.onEdit = (path) => openEditor(path);
    won = false;
    hintLevel = 0;
    lastOk = null;
    editor.hidden = true;
    out.replaceChildren();
    print(`${scenario.title}. ${scenario.story}`, "dim");
    print("Run the script, read what bash says, then edit it. 'hint' if stuck, 'help' for what works here.", "dim");
    print("");
    $("#pg-goal").textContent = "Goal: " + scenario.goal;
    $("#pg-goal").className = "pg-goal";
    $("#pg-story").replaceChildren(h("p", null, h("strong", null, scenario.title + ". "), scenario.story, h("span.muted", null, ` ${scenario.group} · Level ${scenario.level}.`)),
      h("button.copy", { type: "button", onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(location.href.split("#")[0] + "#play/" + scenario.id); b.textContent = "Link copied"; } catch { b.textContent = "Select it"; }
        setTimeout(() => { b.textContent = "Copy link"; }, 1400);
      } }, "Copy link"));
    input.placeholder = scenario.tries[0];
    renderPicker();
    renderTries();
    renderFiles();
    renderCheck();
    const current = picker.querySelector('[aria-pressed="true"]');
    if (current && picker.scrollWidth > picker.clientWidth) picker.scrollLeft = current.offsetLeft - 48;
  }

  function after() {
    renderFiles();
    $("#pg-prompt-label").textContent = `dev@web-01:${sys.term.cwd.replace(/^\/home\/dev/, "~")} · bash`;
    if (renderCheck() && !won) {
      won = true;
      solved.add(scenario.id);
      renderPicker();
      const b = picker.querySelector('.pg-scn[aria-pressed="true"]');
      if (b) b.classList.add("just-solved");
      $("#pg-goal").textContent = "Fixed. " + scenario.done;
      $("#pg-goal").className = "pg-goal done";
      print("");
      print("✓ Fixed. " + scenario.lesson, "ok");
      const next = SCENARIOS.find((s) => !solved.get().includes(s.id));
      print(next ? `  Next: ${next.title}. Pick it above, or type 'next'.` : "  You solved every scenario.", "dim");
    }
  }

  function run(raw) {
    const line = raw.trim();
    print("$ " + line, "cmd");
    if (!line) return;
    if (line === "help") { HELP.forEach((t) => print(t, "dim")); return; }
    if (line === "clear") { out.replaceChildren(); return; }
    if (line === "reset") { load(scenario.id); return; }
    if (line === "history") { history.forEach((c, i) => print(`${String(i + 1).padStart(5)}  ${c}`)); return; }
    if (line === "hint") { print(`Hint ${Math.min(hintLevel + 1, 3)} of 3: ${scenario.hints[Math.min(hintLevel++, 2)]}`, "dim"); return; }
    if (line === "next") {
      const next = SCENARIOS.find((s) => !solved.get().includes(s.id) && s !== scenario) || SCENARIOS[(SCENARIOS.indexOf(scenario) + 1) % SCENARIOS.length];
      location.hash = "play/" + next.id;
      return;
    }
    let lines;
    try { lines = sys.run(line); } catch {
      lines = [["playground: that command hit a limit of this simulation; check its quoting, or type 'help'", "err"]];
    }
    for (const [text, cls] of lines) print(text, cls === "err" ? "err" : null);
    after();
  }

  // Tab completes file names in the current directory and command names.
  function complete() {
    const v = input.value;
    const at = v.lastIndexOf(" ") + 1;
    const word = v.slice(at);
    const slash = word.lastIndexOf("/");
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : "";
    const stem = word.slice(slash + 1);
    const { FS } = window.ShellSim;
    const dir = FS.norm(sys.term.cwd, dirPart.replace(/^~/, "/home/dev") || ".");
    let names = sys.fs.isDir(dir) ? sys.fs.list(dir).map((n) => n + (sys.fs.isDir((dir === "/" ? "" : dir) + "/" + n) ? "/" : "")) : [];
    if (at === 0 && !dirPart) names = names.concat(Object.keys(window.ShellSim.Shell.builtins), sys.fs.list("/usr/bin"));
    const hits = [...new Set(names)].filter((n) => n.startsWith(stem) && (stem || n[0] !== "."));
    if (hits.length === 1) input.value = v.slice(0, at) + dirPart + hits[0] + (hits[0].endsWith("/") ? "" : " ");
    else if (hits.length > 1) {
      let common = hits[0];
      for (const x of hits) while (!x.startsWith(common)) common = common.slice(0, -1);
      if (common.length > stem.length) input.value = v.slice(0, at) + dirPart + common;
      else print(hits.slice(0, 40).join("  "), "dim");
    }
  }

  $("#pg-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value;
    if (value.trim()) { history.push(value); historyPos = history.length; }
    input.value = "";
    run(value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historyPos > 0) { historyPos--; input.value = history[historyPos]; e.preventDefault(); }
    if (e.key === "ArrowDown") { historyPos = Math.min(history.length, historyPos + 1); input.value = history[historyPos] || ""; e.preventDefault(); }
    if (e.key === "Tab" && input.value.trim()) { e.preventDefault(); complete(); }
    if (e.key === "l" && e.ctrlKey) { e.preventDefault(); out.replaceChildren(); }
  });
  out.addEventListener("click", () => { if (!window.getSelection().toString()) input.focus(); });
  $("#pg-editor-save").addEventListener("click", saveEditor);
  $("#pg-editor-cancel").addEventListener("click", closeEditor);
  editText.addEventListener("keydown", (e) => {
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); }
    if (e.key === "Escape") closeEditor();
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); editText.setRangeText("  ", editText.selectionStart, editText.selectionEnd, "end"); }
  });

  const reveal = () => { $("#pg-term").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); input.focus({ preventScroll: true }); };
  window.SQPlayground = {
    scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title, group: s.group })),
    load: (id) => { if (id !== scenario.id || !sys) load(id); reveal(); },
    // From the cheat sheet: open the scenario a command needs and run it there.
    prefill: (cmd, where) => {
      if (where !== "any" && where !== scenario.id) { location.hash = "play/" + where; load(where); }
      else if (location.hash.slice(1).split("/")[0] !== "path" && !location.hash.startsWith("#play")) location.hash = "path";
      reveal();
      run(cmd.replace(/<script>/g, scenario.file.replace(/^\/home\/dev\//, "")));
    }
  };
  load(SCENARIOS[0].id);
})();
