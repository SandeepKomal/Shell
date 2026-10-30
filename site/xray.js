// Script X-ray: explains every line of a shell script and flags risky ones
// with rules written for this site. It reads lines with simple scanners, not
// a full parser, and never runs anything. No DOM access, so
// tests/check_xray.js runs it under Node.
"use strict";

(function (root) {
  // Unquoted $name, ${...}, $(...) or `...` outside quotes, [[ ]], (( )) and assignment values.
  function scan(line) {
    const found = [];
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { i++; continue; }
      if (q === "'") { if (c === "'") q = null; continue; }
      if (c === "'" && !q) { q = "'"; continue; }
      if (c === '"') { q = q ? null : '"'; continue; }
      if (c === "#" && !q && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (c === "$" && !q) {
        const m = /^\$(\{[^}]*\}|\([^)]*\)?|[A-Za-z_]\w*|[@*])/.exec(line.slice(i));
        if (m) { found.push({ at: i, text: m[0] }); i += m[0].length - 1; }
      }
    }
    return found;
  }
  // The line with quoted text, comments and [[ ]] / (( )) blanked out, for keyword checks.
  function bare(line) {
    let out = "";
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { out += "  "; i++; continue; }
      if (q) { if (c === q) q = null; out += " "; continue; }
      if (c === "'" || c === '"') { q = c; out += " "; continue; }
      if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
      out += c;
    }
    return out;
  }
  const SAFE_SPECIALS = new Set(["$#", "$?", "$$", "$!", "$-", "${#}", "${?}"]);

  const SECRET_NAME = /^(?:export\s+)?([A-Z0-9_]*(?:PASS(?:WORD)?|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*)=(['"]?)([^'"$\s][^'"]{3,})\2\s*$/i;

  // Each rule: id, sev ("bad" or "warn"), test(line, ctx) returning a message or null, and a fix.
  const RULES = [
    { id: "unquoted", sev: "warn", fix: "Quote it: \"$var\". Unquoted, the value is split on spaces and globbed.",
      test(l, ctx) {
        const b = bare(l);
        if (/^\s*(\[\[|\(\(|case\b|for\s+\w+\s+in\b|local\s|export\s|declare\s|readonly\s)/.test(b)) return null;
        const hits = scan(l).filter((h) => !SAFE_SPECIALS.has(h.text) && !h.text.startsWith("$((") && !/^\$\{#/.test(h.text));
        const outside = hits.filter((h) => {
          const before = l.slice(0, h.at);
          if (/\[\[[^\]]*$/.test(before) || /\(\([^)]*$/.test(before)) return false;
          if (/(^|[\s;])[A-Za-z_]\w*(\[[^\]]*\])?\+?=$/.test(before)) return false;
          return true;
        });
        if (!outside.length || ctx.inHeredoc) return null;
        return `${outside.map((h) => h.text).slice(0, 3).join(", ")} ${outside.length === 1 ? "is" : "are"} not quoted.`;
      } },
    { id: "cd-unchecked", sev: "warn", fix: "cd \"$dir\" || exit 1 (or set -e). If cd fails, the next commands run in the wrong directory.",
      test: (l, ctx) => (/(^|[;&|]\s*|then\s+|do\s+)cd\s+[^|&;]*\s*($|;)/.test(bare(l)) && !/\|\||&&/.test(bare(l)) && !ctx.errexit ? "cd is not checked." : null) },
    { id: "rm-var", sev: "bad", fix: "Guard the variable: rm -rf -- \"${DIR:?}\"/*. If DIR is empty this deletes from /.",
      test: (l) => {
        const b = bare(l);
        if (!/(^|[;&|]\s*|then\s+|do\s+|sudo\s+)rm\s+(-\w*[rRf]\w*\s+)+/.test(b)) return null;
        const args = l.slice(l.search(/\brm\s/));
        return /\$\{?\w+\}?/.test(args) && !/\$\{\w+:\?/.test(args) ? "rm -rf with a variable that may be empty." : null;
      } },
    { id: "parse-ls", sev: "warn", fix: "Use a glob: for f in /dir/*; do ... done. ls output breaks on spaces and newlines in names.",
      test: (l) => (/\$\(\s*ls\b|`\s*ls\b|\bls\b[^|]*\|\s*(while|xargs|for)\b/.test(l) ? "Parses the output of ls." : null) },
    { id: "for-cmdsub", sev: "warn", fix: "Read lines with while IFS= read -r line; do ...; done < <(cmd), or loop over a glob.",
      test: (l) => (/^\s*for\s+\w+\s+in\s+(\$\(|`)/.test(l) && !/\$\(\s*ls\b|`\s*ls\b/.test(l) ? "for over $(command) splits its output on every space." : null) },
    { id: "useless-cat", sev: "warn", fix: "Give the file to the command: grep x file, or < file. One process fewer.",
      test: (l) => (/(^|[;&|]\s*)cat\s+[^|<>$-][^|<>]*\|\s*(grep|awk|sed|wc|head|tail|sort|cut|tr|while)\b/.test(bare(l)) || /\bcat\s+"?\$\w+"?\s*\|\s*(grep|awk|sed|wc|head|tail|while)\b/.test(l) ? "cat piped into a command that can read the file itself." : null) },
    { id: "grep-wc", sev: "warn", fix: "grep -c counts matching lines in one process.",
      test: (l) => (/\bgrep\b[^|]*\|\s*wc\s+-l\b/.test(l) ? "grep | wc -l." : null) },
    { id: "single-bracket", sev: "warn", fix: "In bash, [[ ]] does not split or glob variables and supports && and ||. Keep [ ] only for POSIX sh.",
      test: (l, ctx) => (!ctx.posix && /(^|[\s;!])\[\s/.test(bare(l)) && scan(l).some((h) => { const before = l.slice(0, h.at); return /\[\s[^\]]*$/.test(before) && (before.split('"').length % 2 === 1); }) ? "[ ] with an unquoted variable: empty or spaced values break the test." : null) },
    { id: "double-equals-sh", sev: "warn", fix: "Use = inside [ ]; == is a bash extension and fails in sh (\"unexpected operator\").",
      test: (l) => (/(^|[\s;!])\[\s[^\]]*\s==\s/.test(l) && !/\[\[/.test(l) ? "== inside [ ]." : null) },
    { id: "read-no-r", sev: "warn", fix: "read -r keeps backslashes; IFS= read -r line keeps leading spaces too.",
      test: (l) => (/(^|[;&|]\s*|while\s+(IFS=\S*\s+)?)read\b(?![^;|&]*\s-\w*r)/.test(bare(l)) ? "read without -r mangles backslashes." : null) },
    { id: "read-unchecked", sev: "warn", fix: "Check what came back: read -r answer || exit 1, then validate it before use.",
      test: (l) => (/^\s*read\b/.test(bare(l)) && !/\|\||&&|^\s*while/.test(bare(l)) ? "The result of read is not checked." : null) },
    { id: "backticks", sev: "warn", fix: "Use $(command): it nests and reads more clearly.",
      test: (l) => (/`[^`]+`/.test(l.replace(/'[^']*'/g, "")) ? "Backticks for command substitution." : null) },
    { id: "eval", sev: "bad", fix: "Avoid eval: it runs its text as code, so data can become commands. Use arrays and quoted variables.",
      test: (l) => (/(^|[;&|]\s*|then\s+|do\s+)eval\s/.test(bare(l)) ? "eval runs text as code." : null) },
    { id: "curl-pipe-shell", sev: "bad", fix: "Download to a file, read it, check its checksum, then run it.",
      test: (l) => (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(l) ? "Runs a script straight from the network." : null) },
    { id: "secret", sev: "bad", fix: "Do not keep secrets in scripts. Read them from the environment or a secrets manager at run time.",
      test: (l) => (SECRET_NAME.test(l.trim()) ? "A secret written into the script." : null) },
    { id: "dollar-star", sev: "warn", fix: "Use \"$@\" to pass arguments on unchanged.",
      test: (l) => (/(^|[^\\])\$\*|\$\{\*\}/.test(l) || scan(l).some((h) => h.text === "$@") ? "$* or unquoted $@ loses the original arguments." : null) },
    { id: "local-mask", sev: "warn", fix: "local x; x=$(cmd): on one line, local's own status hides cmd's failure.",
      test: (l) => (/^\s*(local|export|declare|readonly)\s+\w+=\S*\$\(/.test(l) ? "This hides the command's exit status." : null) },
    { id: "no-local", sev: "warn", fix: "Declare it local inside the function, or it changes the caller's variable.",
      test: (l, ctx) => {
        if (!ctx.inFunction) return null;
        const m = /^\s*([A-Za-z_]\w*)(\[[^\]]*\])?\+?=/.exec(l);
        if (!m || ctx.locals.has(m[1]) || /^[A-Z_]+$/.test(m[1])) return null;
        return `${m[1]} is not local to this function.`;
      } },
    { id: "set-x", sev: "warn", fix: "Turn tracing off around secrets (set +x), and never leave set -x in CI scripts that handle tokens.",
      test: (l) => (/^\s*set\s+-\w*x/.test(l) || /^#!.*\s-\w*x/.test(l) ? "set -x prints every command, secrets included." : null) },
    { id: "sudo-redirect", sev: "warn", fix: "The redirection runs as you, not root. Use: echo x | sudo tee /etc/file > /dev/null",
      test: (l) => (/\bsudo\s+(echo|printf|cat)\b[^|]*\s>>?\s*\//.test(l) ? "sudo does not apply to the redirection." : null) },
    { id: "chmod-777", sev: "bad", fix: "Grant only what is needed: 755 for programs, 644 for files, 700 or 600 for private ones.",
      test: (l) => (/\bchmod\s+(-R\s+)?(0?777|a\+rwx|o\+w)\b/.test(l) ? "World-writable permissions." : null) },
    { id: "curl-no-fail", sev: "warn", fix: "curl -fsS: -f turns HTTP errors into a failing exit status instead of saving the error page.",
      test: (l) => (/\bcurl\s/.test(bare(l)) && !/\bcurl\b[^|;]*\s-(\w*f\w*)\b|--fail\b/.test(l) ? "curl without -f treats HTTP errors as success." : null) },
    { id: "tmp-predictable", sev: "warn", fix: "tmp=$(mktemp) creates a unique file another user cannot plant or race.",
      test: (l) => (/[>\s]\/tmp\/[\w.-]+/.test(l) && !/mktemp/.test(l) ? "A fixed name in /tmp." : null) },
    { id: "which", sev: "warn", fix: "command -v name is built in and works the same everywhere.",
      test: (l) => (/(^|[;&|(]\s*|if\s+|!\s+)which\s/.test(bare(l)) ? "which is an external program with varying behaviour." : null) },
    { id: "exit-range", sev: "bad", fix: "Exit codes are 0 to 255; use 1 or 2 for failures.",
      test: (l) => { const m = /\bexit\s+(-?\d+)\b/.exec(bare(l)); return m && (Number(m[1]) < 0 || Number(m[1]) > 255) ? `exit ${m[1]} wraps around modulo 256.` : null; } },
    { id: "status-late", sev: "warn", fix: "$? belongs to the command right before. Test the command itself: if ! cmd; then ...",
      test: (l, ctx) => (/\$\?/.test(l) && /^\s*(if|\[|\[\[|test)\b/.test(l) && ctx.prevEcho ? "$? here is the status of the echo above." : null) },
    { id: "let-increment", sev: "warn", fix: "With set -e, ((n++)) and let n++ stop the script when n is 0. Use n=$((n + 1)).",
      test: (l, ctx) => (ctx.errexit && /^\s*(\(\(\s*\w+\+\+\s*\)\)|let\s+\w+\+\+)/.test(l) ? "Returns 1 when the value was 0." : null) },
    { id: "find-glob", sev: "warn", fix: "Quote the pattern: -name '*.log', so find matches it rather than the shell.",
      test: (l) => (/\bfind\b.*\s-i?name\s+[^'"\s]*[*?][^'"\s]*/.test(l) ? "Unquoted pattern after -name." : null) },
    { id: "pipe-while", sev: "warn", fix: "Variables set and exit called inside a piped loop are lost. Use done < file or done < <(cmd).",
      test: (l) => (/\|\s*while\s/.test(bare(l)) ? "The loop runs in a subshell." : null) }
  ];

  // What a line does, in plain words.
  const EXPLAIN = [
    [/^#!.*\b(bash)\b/, "The interpreter line: the kernel runs this file with bash."],
    [/^#!.*\bsh\b/, "The interpreter line: the kernel runs this file with sh, which may be dash and lacks bash features."],
    [/^#!/, "The interpreter line: which program runs this file."],
    [/^#/, "A comment. Bash ignores it."],
    [/^set\s+-\w*e\w*u\w*o\s+pipefail|^set\s+-euo\s+pipefail/, "Strict mode: exit on a failed command (-e), on an unset variable (-u), and when any command in a pipeline fails (pipefail)."],
    [/^set\s+-\w*x/, "Turns on tracing: every command is printed after expansion."],
    [/^set\s/, "Changes shell options."],
    [/^shopt\s/, "Changes a bash option, such as nullglob."],
    [/^trap\s/, "Registers commands to run when the script exits or gets a signal."],
    [/^(source|\.)\s/, "Runs another file in this shell, so its functions and variables become available here."],
    [/^export\s/, "Marks a variable for the environment of programs this script starts."],
    [/^local\s/, "Declares a variable that belongs to the current function."],
    [/^readonly\s|^declare\s+-r/, "Declares a variable that cannot be changed."],
    [/^declare\s|^typeset\s/, "Declares a variable with attributes (array, integer, exported)."],
    [/^[A-Za-z_]\w*=\(/, "Assigns an array."],
    [/^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/, "Assigns a variable. No spaces around =; the value is not split, so quotes are optional here."],
    [/^(function\s+\w+|\w+\s*\(\s*\))/, "Defines a function. It runs when called by name, with its own $1, $2 ..."],
    [/^if\s/, "Runs the condition command and takes the then branch if its exit status is 0."],
    [/^elif\s/, "Another condition, tried when the ones above failed."],
    [/^else\b/, "Runs when no condition above succeeded."],
    [/^fi\b/, "Ends the if."],
    [/^for\s+\(\(/, "A counted loop, C style."],
    [/^for\s/, "Loops over a list of words, one at a time."],
    [/^while\s+.*\bread\b/, "Reads input one line at a time until it ends."],
    [/^while\s/, "Repeats while the condition command succeeds."],
    [/^until\s/, "Repeats until the condition command succeeds."],
    [/^do\b/, "Starts the loop body."],
    [/^done\b/, "Ends the loop. A redirection here feeds the whole loop."],
    [/^case\s/, "Matches a value against patterns."],
    [/^esac\b/, "Ends the case."],
    [/^[^()]*\)\s*$|^[^()]*\)\s.*;;\s*$/, "A case branch: the patterns before ) and the commands up to ;;."],
    [/^;;/, "Ends a case branch."],
    [/^\{\s*$/, "Starts a group of commands."],
    [/^\}/, "Ends a group or function body."],
    [/^\[\[/, "A bash test: no word splitting or globbing inside, and supports patterns and =~."],
    [/^\[\s/, "The test command: compares strings or numbers, or checks files."],
    [/^\(\(/, "Arithmetic: succeeds when the result is not 0."],
    [/^echo\s|^echo$/, "Prints its arguments."],
    [/^printf\s/, "Prints formatted text: printf FORMAT ARGS, more predictable than echo."],
    [/^read\s/, "Reads a line of input into variables."],
    [/^cd\s|^cd$/, "Changes the working directory for the rest of the script."],
    [/^rm\s/, "Deletes files. There is no undo."],
    [/^cp\s/, "Copies files."],
    [/^mv\s/, "Moves or renames files."],
    [/^mkdir\s/, "Creates directories; -p creates parents and does not fail if it exists."],
    [/^chmod\s/, "Changes permissions."],
    [/^curl\s/, "Makes an HTTP request."],
    [/^tar\s/, "Creates or extracts an archive."],
    [/^grep\s/, "Searches for lines matching a pattern; exit status 1 means no match."],
    [/^sed\s/, "Edits text line by line; -i changes the file in place."],
    [/^awk\s/, "Processes text by fields: $1, $2 ... and NR, NF."],
    [/^find\s/, "Walks directories and acts on the files that match."],
    [/^sleep\s/, "Waits."],
    [/^exit\b/, "Ends the script with this exit status."],
    [/^return\b/, "Ends the function with this exit status."],
    [/^eval\s/, "Parses its arguments as shell code and runs them."],
    [/^exec\s/, "Replaces the shell with a program, or with only redirections, changes the script's own file descriptors."],
    [/^sudo\s/, "Runs the command as root."],
    [/^cat\s.*<</, "Prints a here-document."]
  ];

  function describe(line) {
    const t = line.trim().replace(/^(then|do|else)\s+/, "");
    for (const [re, text] of EXPLAIN) if (re.test(t)) return text;
    const cmd = /^[\w./-]+/.exec(t);
    return cmd ? `Runs ${cmd[0]}${/\|/.test(bare(t)) ? ", piping its output into the next command" : ""}.` : "Part of a longer command.";
  }

  function explain(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    const crlf = /\r\n/.test(text);
    const body = lines.join("\n");
    const ctx = {
      posix: /^#!\s*\S*\/sh\b/.test(lines[0] || ""),
      errexit: /^\s*set\s+-\w*e|^#!.*\s-\w*e/m.test(body),
      inFunction: false, locals: new Set(), depth: 0, inHeredoc: null, prevEcho: false
    };
    const rows = lines.map((line) => {
      const t = line.trim();
      if (ctx.inHeredoc) {
        if (t === ctx.inHeredoc) { ctx.inHeredoc = null; return { line, note: "Ends the here-document.", warns: [] }; }
        return { line, note: "Text of the here-document.", warns: [] };
      }
      if (!t) return { line, note: null, warns: [] };
      if (/^(function\s+\w+|\w+\s*\(\s*\))/.test(t)) { ctx.inFunction = true; ctx.locals = new Set(); ctx.depth = 0; }
      if (ctx.inFunction) for (const m of t.matchAll(/\blocal\s+((?:-\w+\s+)?[\w\s=$"'(){}:-]+)/g)) for (const v of m[1].split(/\s+/)) { const n = /^[A-Za-z_]\w*/.exec(v); if (n) ctx.locals.add(n[0]); }
      const warns = t.startsWith("#") && !t.startsWith("#!") ? [] : RULES.map((r) => { const msg = r.test(line, ctx); return msg ? { id: r.id, sev: r.sev, msg, fix: r.fix } : null; }).filter(Boolean);
      const hd = !/<<</.test(line) && /<<-?\s*(['"]?)(\w+)\1/.exec(line);
      if (hd) ctx.inHeredoc = hd[2];
      if (ctx.inFunction) {
        ctx.depth += (bare(line).match(/\{/g) || []).length - (bare(line).match(/\}/g) || []).length;
        if (ctx.depth <= 0 && /\}/.test(line)) ctx.inFunction = false;
      }
      ctx.prevEcho = /^\s*(echo|printf)\b/.test(line);
      return { line, note: describe(line), warns };
    });
    const review = [];
    if (!/^#!/.test(lines[0] || "")) review.push({ sev: "bad", msg: "No #! line. The file runs in whatever shell calls it: bash from your terminal, sh (dash) from cron.", fix: "Start with #!/usr/bin/env bash." });
    if (!/^\s*set\s+-\w*e/m.test(body) && !/^#!.*\s-\w*e/.test(lines[0] || "")) review.push({ sev: "warn", msg: "No set -e: the script carries on after a failed command.", fix: "Add set -euo pipefail near the top, and handle expected failures with || true." });
    else {
      if (!/pipefail/.test(body)) review.push({ sev: "warn", msg: "No set -o pipefail: a failure early in a pipeline is ignored.", fix: "Use set -euo pipefail." });
      if (!/^\s*set\s+-\w*u|nounset/m.test(body)) review.push({ sev: "warn", msg: "No set -u: a mistyped variable name silently expands to nothing.", fix: "Use set -euo pipefail, with ${VAR:-default} for optional variables." });
    }
    if (/\bmktemp\b/.test(body) && !/\btrap\b/.test(body)) review.push({ sev: "warn", msg: "mktemp without a trap: temporary files are left behind when the script fails.", fix: "trap 'rm -f \"$tmp\"' EXIT right after mktemp." });
    if (crlf) review.push({ sev: "bad", msg: "Windows line endings (CRLF). The #! line will fail with \"cannot execute: required file not found\".", fix: "sed -i 's/\\r$//' script.sh, and *.sh text eol=lf in .gitattributes." });
    if (/\$1\b|\$\{1/.test(body) && !/\$#|\$\{1:\?|usage/i.test(body)) review.push({ sev: "warn", msg: "Arguments are used but never checked.", fix: "Check them: [[ $# -eq 1 ]] || { echo \"usage: $0 DIR\" >&2; exit 2; }" });
    return { lines: rows, review, flagged: rows.filter((r) => r.warns.length).length };
  }

  root.SQXray = { explain, RULES };
})(typeof window !== "undefined" ? window : globalThis);
