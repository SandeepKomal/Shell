// Shell Quest site: tabs, path, quiz, X-ray, troubleshooting, cheat sheet.
// No dependencies, no network requests.
"use strict";

(function () {
  const Q = window.QUEST;
  const $ = (sel) => document.querySelector(sel);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToEl = (el) => el && el.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });

  // h("tag.class", {attr: value}, ...children): build DOM from elements and text nodes only.
  function h(spec, attrs, ...kids) {
    const [tag, ...classes] = spec.split(".");
    const el = document.createElement(tag);
    if (classes.length) el.className = classes.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  // Text with `code` spans.
  const rich = (text) => text.split(/(`[^`]+`)/).map((part) => (part.startsWith("`") && part.length > 1 ? h("code", null, part.slice(1, -1)) : part));

  const PREFIX = "dq-shell:";
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked */ } }
  };
  function forgetEverything() {
    if (!confirm("Clear your progress, quiz scores and solved scenarios from this browser?")) return;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* storage blocked */ }
    location.reload();
  }

  const repoUrl = (p) => `${Q.repo}/blob/main/${p.split("/").map(encodeURIComponent).join("/")}`;
  const pageUrl = (hash) => location.href.split("#")[0] + "#" + hash;
  function copyButton(text, label = "Copy", done = "Copied") {
    return h("button.copy", {
      type: "button",
      onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(text); b.textContent = done; } catch { b.textContent = "Select it"; }
        setTimeout(() => { b.textContent = label; }, 1400);
      }
    }, label);
  }
  $("#gh-link").href = Q.repo;
  document.querySelectorAll("[data-repo]").forEach((a) => { a.href = Q.repo + a.dataset.repo; });

  const scenarios = () => (window.SQPlayground ? window.SQPlayground.scenarios : []);
  const scenarioTitle = (id) => (scenarios().find((s) => s.id === id) || {}).title;
  function practise(id) {
    if (location.hash === "#play/" + id) window.SQPlayground.load(id); else location.hash = "play/" + id;
  }

  // --- tabs and deep links ---------------------------------------------------
  // #path, #quiz, #xray, #doctor, #cheats, #arch; #play/<scenario> and #fix/<problem> open one item.

  const tabs = ["path", "quiz", "xray", "doctor", "cheats", "arch"];
  let current = null;
  function show() {
    const [want, sub] = location.hash.slice(1).split("/");
    const tab = want === "play" ? "path" : want === "fix" ? "doctor" : tabs.includes(want) ? want : "path";
    if (tab !== current) {
      const page = $("#tab-" + tab);
      page.classList.remove("tab-in");
      void page.offsetWidth;
      page.classList.add("tab-in");
    }
    current = tab;
    for (const t of tabs) $("#tab-" + t).hidden = t !== tab;
    document.querySelectorAll(".top nav a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (want === "fix" && sub) { const i = Q.doctor.findIndex((d) => d.id === sub); if (i >= 0) { renderDoctor(i); requestAnimationFrame(() => scrollToEl($("#doctor-out"))); } }
    if (want === "play" && sub && window.SQPlayground) window.SQPlayground.load(sub);
    return { want, sub };
  }
  window.addEventListener("hashchange", () => {
    const before = current;
    const { want, sub } = show();
    if (sub || ["path-title", "pg-title"].includes(want)) return;
    if (current !== before) window.scrollTo(0, 0);
  });

  // --- hero: deploy.sh under the X-ray ----------------------------------------

  function drawSignature(fixed) {
    $("#stage-code").replaceChildren(...Q.signature.map(([raw, fix, note], i) => {
      const [kind, text] = note ? note.split(/:(.*)/s) : [];
      const shown = fixed && fix ? fix : raw;
      const noteEl = note && (!fixed || !fix) ? h("span.snote." + kind, null, text) : fixed && fix ? h("span.snote.ok", null, "Fixed.") : null;
      return h("div", null, h("span.n", null, String(i + 1)), h("span.src" + (fixed && fix ? ".changed" : ""), null, shown), noteEl);
    }));
  }
  $("#stage-toggle").addEventListener("click", (e) => {
    const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
    e.currentTarget.setAttribute("aria-pressed", String(on));
    e.currentTarget.textContent = on ? "Show the original" : "Apply the fixes";
    drawSignature(on);
  });

  function renderLanding() {
    const n = scenarios().length;
    const rules = window.SQXray ? window.SQXray.RULES.length : 0;
    $("#stats").replaceChildren(...[[n, "incidents to fix in the playground"], [Q.levels.length, "levels, first script to production"], [Q.doctor.length, "bash errors, explained"]]
      .map(([v, l]) => h("div", null, h("b", null, String(v)), h("span", null, l))));
    const tiles = [
      ["#xray", "Script X-ray", "Every risky line, flagged.", `${rules} checks: unquoted variables, swallowed errors, cd without a check, rm -rf with an empty variable.`, "wide"],
      ["#pg-title", "Playground", "Run it, break it, fix it.", "A bash shell over a small server, with real error messages and real incidents.", "wide"],
      ["#quiz", "Quiz", "Read code like a reviewer.", "Predict what bash does."],
      ["#arch", "How bash runs", "How a line runs.", "Tokens, expansions, fork and exec."],
      ["#cheats", "Cheat sheet", "Copy, fill, run.", "The idioms scripts use every day, each one runnable."],
      [Q.repo + "/tree/main/scripts", "Scripts", "Tested tools, ready to use.", "Retries, backups, deploys, audits: the repository's scripts, each used in a level.", "wide"],
      ["#doctor", "Stuck on an error?", "Learn why it happens, then practise the fix.", "Paste the error: cause, confirm, fix, prevent.", "wide"]
    ];
    $("#bento").replaceChildren(...tiles.map(([href, k, title, text, size]) => h("a.tile" + (size ? "." + size : ""), { href }, h("div", null, h("div.k", null, k), h("h3", null, title)), h("p", null, text))));
  }

  // --- path ------------------------------------------------------------------

  const stageId = (s) => "stage-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  function practiseRow(ids, label) {
    const known = ids.filter((id) => scenarioTitle(id));
    if (!known.length) return null;
    return h("div.practise", null, h("span.muted.small", null, label), known.map((id) => h("button.chip", { type: "button", onclick: () => practise(id) }, scenarioTitle(id))));
  }
  function renderPath() {
    const done = new Set(store.get("done", []));
    const scores = store.get("quiz", {});
    const box = $("#levels");
    box.replaceChildren();
    let stage = "";
    let list;
    for (const lv of Q.levels) {
      if (lv.stage !== stage) {
        stage = lv.stage;
        list = h("ol.levels");
        box.append(h("h3.stage-h", { id: stageId(stage) }, stage), list);
      }
      const isDone = done.has(lv.id);
      list.append(h("li.level" + (isDone ? ".done" : ""), { id: "level-" + lv.id },
        h("input", {
          type: "checkbox", checked: isDone, "aria-label": `Mark level ${lv.id} complete`,
          onchange: (e) => { if (e.target.checked) done.add(lv.id); else done.delete(lv.id); store.set("done", [...done]); renderPath(); }
        }),
        h("span.num", null, lv.id),
        h("details", null,
          h("summary", null, h("span.title", null, lv.title), h("span.topic", null, lv.topic)),
          h("div.level-body", null,
            h("div", null, h("h4", null, "What you learn"), h("ul", null, lv.learn.map((t) => h("li", null, ...rich(t))))),
            h("div", null, h("h4", null, "Lab in a real shell"), h("pre", null, h("code", null, lv.lab.join("\n")))),
            h("div.level-links", null, h("span.muted", null, "Scripts:"), lv.scripts.map((p) => h("a.chip", { href: repoUrl(p) }, p))),
            h("div.level-links", null, practiseRow(lv.practise, "Practise:")))),
        h("span.actions", null, h("a.small", { href: "#quiz", onclick: () => { $("#quiz-level").value = lv.id; renderQuiz(); } }, lv.id in scores ? `Quiz ${scores[lv.id]}%` : "Quiz"))));
    }
    const stages = [];
    for (const lv of Q.levels) {
      let st = stages.find((x) => x.name === lv.stage);
      if (!st) stages.push(st = { name: lv.stage, levels: [] });
      st.levels.push(lv);
    }
    $("#stages").replaceChildren(...stages.map((st, i) => {
      const n = st.levels.filter((l) => done.has(l.id)).length;
      const ring = h("span.ring", { "aria-hidden": "true" });
      ring.style.setProperty("--p", Math.round(n / st.levels.length * 100));
      return h("a.stage-card" + (n === st.levels.length ? ".complete" : ""), {
        role: "listitem", href: "#" + stageId(st.name), onclick: (e) => { e.preventDefault(); scrollToEl(document.getElementById(stageId(st.name))); }
      }, ring, h("span.stage-num", null, `Stage ${i + 1}`), h("strong", null, st.name), h("span.muted", null, `${n} of ${st.levels.length} levels`));
    }));
    $("#bar-fill").style.width = (done.size / Q.levels.length * 100) + "%";
    $("#bar").setAttribute("aria-valuenow", String(done.size));
    $("#bar-text").textContent = `${done.size} of ${Q.levels.length} levels complete`;
  }

  // --- quiz ------------------------------------------------------------------

  const EXAM_SIZE = 20;
  const questionsFor = (id) => (window.QUEST_QUIZ[id] || []).map((item) => ({ ...item, level: id }));
  function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function renderQuiz() {
    const mode = $("#quiz-level").value;
    const exam = mode === "exam";
    const items = exam ? shuffle(Q.levels.flatMap((l) => questionsFor(l.id))).slice(0, EXAM_SIZE) : questionsFor(mode);
    const out = $("#quiz-list");
    out.replaceChildren();
    let answered = 0;
    let correct = 0;
    const score = h("div.score", { "aria-live": "polite" });
    const fill = h("span.fill");
    const update = () => {
      score.replaceChildren(h("span", null, h("strong", null, String(correct)), ` correct of ${answered} answered · ${items.length} questions`),
        h("span.meter", { role: "progressbar", "aria-label": "Answered", "aria-valuemin": "0", "aria-valuemax": String(items.length), "aria-valuenow": String(answered) }, fill));
      fill.style.width = (answered / items.length * 100) + "%";
      if (answered < items.length) return;
      const pct = Math.round(correct / items.length * 100);
      if (!exam) { const all = store.get("quiz", {}); all[mode] = Math.max(all[mode] || 0, pct); store.set("quiz", all); renderPath(); }
      score.append(h("p.result", null, h("strong", null, `${pct}%. `),
        pct === 100 ? "Perfect score." : pct >= 75 ? "Strong. Review the explanations you missed." : "Read the explanations, practise the level, and try again.",
        " ", h("button.linkish", { type: "button", onclick: renderQuiz }, exam ? "New exam" : "Try again")));
    };
    items.forEach((item, qi) => {
      const fb = h("p.feedback", { "aria-live": "polite" });
      const opts = h("div.options", { role: "group", "aria-label": `Question ${qi + 1}` });
      shuffle(item.options.map((text, index) => ({ text, index }))).forEach((opt) => {
        opts.append(h("button.opt", {
          type: "button", "data-right": opt.index === item.answer ? "1" : null,
          onclick: (e) => {
            const right = opt.index === item.answer;
            opts.querySelectorAll("button").forEach((b) => { b.disabled = true; if (b.dataset.right) b.classList.add("right"); });
            if (!right) e.currentTarget.classList.add("wrong");
            fb.replaceChildren(h("strong", null, right ? "Correct. " : "Not quite. "), ...rich(item.why));
            fb.className = "feedback " + (right ? "ok" : "bad");
            answered++;
            if (right) correct++;
            update();
          }
        }, ...rich(opt.text)));
      });
      const from = exam ? Q.levels.find((l) => l.id === item.level) : null;
      out.append(h("div.card.question", null, from ? h("p.tag", null, `Level ${from.id} · ${from.title}`) : null,
        h("h3", null, `${qi + 1}. `, ...rich(item.q)), item.code ? h("pre", null, h("code", null, item.code)) : null, opts, fb));
    });
    out.prepend(score);
    update();
  }

  // --- Script X-ray ------------------------------------------------------------

  const narrow = () => matchMedia("(max-width: 760px)").matches;
  function placeNote(li) {
    const note = $("#xray-note");
    if (li && narrow()) {
      const slot = $("#xray-lines .note-slot") || h("li.note-slot");
      li.after(slot);
      slot.append(note);
    } else if (note.parentElement !== $("#xray-view")) {
      $("#xray-view").append(note);
      const slot = $("#xray-lines .note-slot");
      if (slot) slot.remove();
    }
  }
  let pasted = null;
  function showXray() {
    $("#xray-edit").hidden = !!pasted;
    $("#xray-result").hidden = !pasted;
    $("#xray-view").hidden = !pasted;
    if (!pasted) return;
    const rows = pasted.lines;
    const bad = rows.filter((r) => r.warns.some((w) => w.sev === "bad")).length;
    $("#xray-summary").textContent = [`${rows.filter((r) => r.note).length} lines explained`, `${pasted.flagged} flagged${bad ? `, ${bad} dangerous` : ""}`, `${pasted.review.length} missing essential${pasted.review.length === 1 ? "" : "s"}`].join(" · ");
    $("#xray-review").replaceChildren(...(pasted.review.length ? [h("ul.xray-review", null, pasted.review.map((r) => h("li", null, h("span." + (r.sev === "bad" ? "xray-bad" : "xray-warn"), null, r.msg), " ", h("span.muted", null, r.fix))))] : []));
    const lines = $("#xray-lines");
    placeNote(null);
    lines.replaceChildren();
    rows.forEach(({ line, note, warns }, i) => {
      if (!note) { lines.append(h("li", null, h("span.line.blank", null, line || " "))); return; }
      const sev = warns.some((w) => w.sev === "bad") ? ".bad" : warns.length ? ".warn" : "";
      lines.append(h("li", null, h("button.line" + sev, {
        type: "button",
        onclick: (e) => {
          lines.querySelectorAll(".line").forEach((b) => b.classList.remove("on"));
          e.currentTarget.classList.add("on");
          placeNote(e.currentTarget.parentElement);
          $("#xray-note").replaceChildren(h("pre", null, h("code", null, line.trim())), h("p", null, note),
            ...warns.flatMap((w) => [h("p." + (w.sev === "bad" ? "xray-bad" : "xray-warn"), null, w.msg), h("p.xray-fix", null, w.fix)]),
            h("p.muted.small", null, `Line ${i + 1} of ${rows.length}`));
        }
      }, line)));
    });
    $("#xray-note").replaceChildren(h("p.muted", null, "Select any line to see what it does."));
    const first = $("#xray-lines .line.bad") || $("#xray-lines .line.warn");
    if (first && !narrow()) first.click();
  }
  function explainPasted() {
    const text = $("#xray-input").value;
    const error = $("#xray-error");
    if (!text.trim()) { error.textContent = "Paste a script first, or choose Load an example."; error.hidden = false; return; }
    error.hidden = true;
    pasted = window.SQXray.explain(text);
    showXray();
    scrollToEl($("#xray-result"));
  }

  // --- Troubleshoot --------------------------------------------------------------

  const scoreDoctor = (d, query) => window.SQSearch.score(d, query);
  function buildDoctorList() {
    const index = new Map(Q.doctor.map((d, i) => [d.id, i]));
    $("#doctor-list").replaceChildren(...Q.doctorGroups.map(([name, ids]) => h("div.doctor-group", null,
      h("div.doctor-group-name", null, name, h("span.count", null, String(ids.length))),
      h("div.doctor-group-items", null, ids.map((id) => h("button.chip", { type: "button", "data-index": index.get(id), "aria-pressed": "false", onclick: () => { location.hash = "fix/" + id; } }, Q.doctor[index.get(id)].title))))));
  }
  function filterDoctor() {
    const query = $("#doctor-q").value.trim();
    let best = null;
    let shown = 0;
    for (const group of document.querySelectorAll(".doctor-group")) {
      let n = 0;
      for (const b of group.querySelectorAll("button")) {
        const i = Number(b.dataset.index);
        const s = scoreDoctor(Q.doctor[i], query);
        b.hidden = query !== "" && s < 0.5;
        if (!b.hidden) n++;
        if (query && (!best || s > best.s)) best = { i, s };
      }
      group.hidden = !n;
      group.querySelector(".count").textContent = String(n);
      shown += n;
    }
    $("#doctor-none").hidden = shown > 0;
    // A pasted error that clearly matches one entry opens it.
    if (best && best.s >= 2.4) renderDoctor(best.i);
  }
  function renderDoctor(index) {
    const d = Q.doctor[index];
    document.querySelectorAll("#doctor-list button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.index) === index)));
    const lv = Q.levels.find((l) => l.id === d.level);
    const section = (title, ...kids) => [h("h4", null, title), ...kids];
    const practice = practiseRow(d.scenarios, "Practise:");
    $("#doctor-out").replaceChildren(h("article.card.problem", { id: "fix-" + d.id },
      h("div.problem-head", null, h("div", null, h("h3", null, d.title), h("p.muted.small", null, d.group)), copyButton(pageUrl("fix/" + d.id), "Copy link", "Link copied")),
      ...section("Error", h("pre.err-line", null, h("code", null, d.error))),
      ...section("Symptom", h("p", null, ...rich(d.symptom))),
      ...section("Why it happens", h("p", null, ...rich(d.meaning)), h("ul", null, d.causes.map((c) => h("li", null, ...rich(c))))),
      ...section("Confirm", h("pre", null, h("code", null, d.confirm.join("\n")))),
      ...section("Fix", h("p", null, ...rich(d.fix))),
      ...section("Prevent", h("p", null, ...rich(d.prevent))),
      // Fixing is the way in; the point is to learn it, so every answer ends in practice.
      h("div.learn-it", null,
        ...section("Now learn it", practice ? h("p", null, "Break this yourself in a safe playground and fix it. Doing it once is what makes you recognise it next time.") : null),
        practice,
        lv ? h("p.note", null, practice ? "Then the level that teaches it: " : "The level that teaches it: ", h("a", { href: "#level-" + lv.id, onclick: () => { location.hash = "path"; setTimeout(() => scrollToEl(document.getElementById("level-" + lv.id)), 0); } }, `Level ${lv.id} · ${lv.title}`)) : null)));
  }

  // --- cheat sheet -----------------------------------------------------------------

  function renderCheats() {
    const q = $("#cheat-q").value.trim().toLowerCase();
    const out = $("#cheat-out");
    out.replaceChildren();
    const groups = new Map();
    for (const [cmd, what, group, where] of Q.cheats) {
      if (q && !(cmd + " " + what + " " + group).toLowerCase().includes(q)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([cmd, what, where]);
    }
    if (!groups.size) { out.append(h("p.muted", null, "No match. Try a word like quote, trap, find or cron.")); return; }
    for (const [group, rows] of groups) {
      out.append(h("h3.group", null, group), h("ul.cheats", null, rows.map(([cmd, what, where]) => h("li", null,
        h("div", null, h("code", null, cmd), h("span.muted", null, what)),
        h("div.cheat-actions", null,
          where ? h("button.copy", { type: "button", title: where === "any" ? "Run it in the playground" : `Run it in the scenario "${scenarioTitle(where)}"`, onclick: () => window.SQPlayground.prefill(cmd, where) }, "Try")
            : h("a.copy.lab", { href: Q.repo, title: "Needs a real system: run it in your own shell" }, "Lab"),
          copyButton(cmd))))));
    }
  }

  // --- page guides ---------------------------------------------------------------

  const CLOSED = ["playground", "path", "doctor", "xray"];
  function renderGuides() {
    const state = store.get("guides", {});
    document.querySelectorAll(".guide-slot").forEach((slot) => {
      const key = slot.dataset.guide;
      const g = Q.guides[key];
      const box = h("details.guide", { open: state[key] ?? !CLOSED.includes(key) },
        h("summary", null, "How to use this"),
        h("div.guide-body", null, h("p", null, ...rich(g.what)),
          h("div.guide-cols", null,
            h("div", null, h("h3", null, "How to use it"), h("ol", null, g.steps.map((t) => h("li", null, ...rich(t))))),
            h("div", null, h("h3", null, "What it is for"), h("ul", null, g.uses.map((t) => h("li", null, ...rich(t)))),
              h("h3", null, "Tips"), h("ul", null, g.tips.map((t) => h("li", null, ...rich(t))))))));
      let open = box.open;
      box.addEventListener("toggle", () => { if (box.open === open) return; open = box.open; store.set("guides", { ...store.get("guides", {}), [key]: open }); });
      slot.replaceChildren(box);
    });
  }

  // --- command palette (Ctrl+K, Cmd+K or /) --------------------------------------

  const palette = $("#palette");
  const paletteInput = $("#palette-input");
  const paletteList = $("#palette-list");
  let items = [];
  let active = 0;
  const go = (hash, then) => { location.hash = hash; if (then) setTimeout(then, 0); };
  function actions() {
    return [
      { label: "Playground: fix a broken script", kind: "Section", run: () => go("path", () => scrollToEl($(".playground"))) },
      { label: "Your path", kind: "Section", run: () => go("path", () => scrollToEl($("#path-title"))) },
      { label: "Exam: random questions from every level", kind: "Quiz", run: () => go("quiz", () => { $("#quiz-level").value = "exam"; renderQuiz(); }) },
      { label: "Script X-ray", kind: "Section", run: () => go("xray") },
      { label: "Fix: troubleshoot an error", kind: "Section", run: () => go("doctor", () => $("#doctor-q").focus()) },
      { label: "Cheat sheet", kind: "Section", run: () => go("cheats", () => $("#cheat-q").focus()) },
      { label: "How bash runs a command", kind: "Section", run: () => go("arch") },
      ...Q.levels.map((lv) => ({ label: `${lv.id} · ${lv.title}`, hint: lv.topic, kind: "Level", run: () => go("path", () => { const el = document.getElementById("level-" + lv.id); el.querySelector("details").open = true; scrollToEl(el); }) })),
      ...Q.levels.map((lv) => ({ label: `Quiz: ${lv.id} · ${lv.title}`, kind: "Quiz", run: () => go("quiz", () => { $("#quiz-level").value = lv.id; renderQuiz(); }) })),
      ...Q.doctor.map((d) => ({ label: `Error: ${d.title}`, hint: d.error, kind: "Troubleshoot", run: () => go("fix/" + d.id) })),
      ...scenarios().map((s) => ({ label: `Scenario: ${s.title}`, hint: s.group, kind: "Playground", run: () => go("play/" + s.id) }))
    ];
  }
  function renderPalette() {
    const ws = paletteInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    items = actions().filter((a) => { const t = `${a.label} ${a.hint || ""} ${a.kind}`.toLowerCase(); return ws.every((w) => t.includes(w)); }).slice(0, 9);
    active = Math.min(active, Math.max(0, items.length - 1));
    paletteList.replaceChildren(...items.map((a, i) => h("li", {
      role: "option", id: "pal-" + i, "aria-selected": String(i === active),
      onclick: () => choose(i), onmousemove: () => { if (active !== i) { active = i; renderPalette(); } }
    }, h("span.pal-label", null, a.label), h("span.pal-kind", null, a.kind))));
    if (!items.length) paletteList.append(h("li.pal-empty", null, "Nothing matches. Try quoting, cron or unbound."));
    paletteInput.setAttribute("aria-activedescendant", items.length ? "pal-" + active : "");
  }
  function openPalette() {
    if (palette.open) return;
    paletteInput.value = "";
    active = 0;
    renderPalette();
    palette.showModal();
    paletteInput.focus();
  }
  function choose(i) { const a = items[i]; if (!a) return; palette.close(); a.run(); }
  paletteInput.addEventListener("input", () => { active = 0; renderPalette(); });
  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      if (n) active = (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      renderPalette();
    } else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  });
  palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });
  $("#palette-open").addEventListener("click", openPalette);
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $("#palette-key").textContent = "⌘K";
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); openPalette(); }
  });

  // --- init --------------------------------------------------------------------

  $("#quiz-level").append(h("option", { value: "exam" }, `Exam: ${EXAM_SIZE} random questions from every level`));
  for (const lv of Q.levels) $("#quiz-level").append(h("option", { value: lv.id }, `${lv.id} · ${lv.title} (${questionsFor(lv.id).length} questions)`));
  $("#quiz-level").value = "00";
  $("#quiz-level").addEventListener("change", renderQuiz);
  $("#quiz-again").addEventListener("click", () => { renderQuiz(); scrollToEl($("#quiz-list")); });
  $("#xray-go").addEventListener("click", explainPasted);
  $("#xray-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) explainPasted(); });
  $("#xray-example").addEventListener("click", () => { $("#xray-input").value = Q.xrayExample; explainPasted(); });
  $("#xray-edit-btn").addEventListener("click", () => { pasted = null; showXray(); $("#xray-input").focus(); });
  $("#xray-clear").addEventListener("click", () => { pasted = null; $("#xray-input").value = ""; showXray(); $("#xray-input").focus(); });
  buildDoctorList();
  $("#doctor-list").after(h("p.muted", { id: "doctor-none", hidden: true }, "No entry matches. Try fewer words, or one word from the error, such as unbound or operand."));
  $("#doctor-q").addEventListener("input", filterDoctor);
  // The home page's "Something broken?" box hands the pasted error to Troubleshoot.
  const doorGo = () => { $("#doctor-q").value = $("#door-q").value; go("doctor", () => { filterDoctor(); $("#doctor-q").focus(); }); };
  $("#door-go").addEventListener("click", doorGo);
  $("#door-q").addEventListener("keydown", (e) => { if (e.key === "Enter") doorGo(); });
  $("#cheat-q").addEventListener("input", renderCheats);
  $("#forget").addEventListener("click", forgetEverything);

  window.SQUI = { h, rich, practise };
  drawSignature(false);
  renderGuides();
  renderPath();
  renderQuiz();
  show();
  // The scenario chips and Try buttons need the playground, which loads after this script.
  window.addEventListener("DOMContentLoaded", () => {
    renderLanding();
    renderPath();
    renderCheats();
    const { want, sub } = show();
    if (want === "play" && sub) setTimeout(() => window.SQPlayground.load(sub), 0);
  });
})();
