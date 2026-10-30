// Throws thousands of random and malformed command lines and scripts at the
// playground's bash, and random scripts at the X-ray. Any JavaScript
// exception fails the run; every result must be printable lines.
// Run with: node tests/fuzz_playground.js [rounds] [seed]
"use strict";
const path = require("path");
const assert = require("assert");

for (const f of ["bash", "builtins", "coreutils", "scenarios", "xray"]) require(path.resolve(__dirname, `../site/${f}.js`));
const { SCENARIOS, start } = globalThis.ShellScenarios;
const { explain } = globalThis.SQXray;

let seed = Number(process.argv[3]) || 20261030;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = (list) => list[rand(list.length)];

const WORDS = ["echo", "printf", "'%s\\n'", "%d", "cat", "ls", "-la", "-l", "grep", "-c", "-v", "-E", "-F", "ERROR", "sed", "'s/a/b/g'", "s|x|y|", "-i", "awk", "'{print $1}'", "'{s+=$1} END {print s}'",
  "-F:", "cut", "-d:", "-f1", "sort", "-n", "-r", "uniq", "-c", "wc", "-l", "head", "-n", "2", "tail", "+2", "tr", "a-z", "A-Z", "-d", "find", ".", "-name", "'*.sh'", "-type", "f", "-mtime", "+7", "-delete",
  "-exec", "{}", "\;", "xargs", "mkdir", "-p", "rm", "-rf", "cp", "mv", "touch", "chmod", "+x", "755", "basename", "dirname", "date", "+%F", "sleep", "1", "env", "-i", "export", "X=1", "unset", "local",
  "read", "-r", "line", "cd", "/tmp", "..", "~", "pwd", "test", "[", "]", "[[", "]]", "-z", "-n", "==", "=", "!=", "-eq", "-gt", "if", "then", "else", "fi", "for", "in", "do", "done", "while", "until",
  "case", "esac", ";;", "function", "f()", "{", "}", "(", ")", "((", "))", "$((1+2))", "$((1/0))", "$((x++))", "$(echo hi)", "`date`", "$x", "${x:-d}", "${x:?no}", "${#x}", "${x%.*}", "${x##*/}",
  "${x/a/b}", "${x^^}", "${a[@]}", "\"$@\"", "$*", "$?", "$#", "$1", "\"", "'", "\\", "|", "||", "&&", ";", "&", ">", ">>", "<", "2>&1", "&>", "<<<", "<<EOF", "<(ls)", "set", "-e", "-u", "-x",
  "-o", "pipefail", "shopt", "-s", "nullglob", "trap", "'echo bye'", "EXIT", "ERR", "exit", "3", "return", "break", "continue", "source", ".", "eval", "exec", "9>/tmp/l", "flock", "-n", "9", "getopts",
  "ab:", "opt", "mapfile", "-t", "arr", "arr=(a b c)", "declare", "-a", "readonly", "let", "i=i+1", "true", "false", ":", "bash", "-c", "sh", "./report.sh", "./deploy.sh", "/home/dev/backup.sh",
  "curl", "-fsS", "https://api.internal/deploys", "http://localhost:8080/health", "gzip", "tar", "-czf", "x.tgz", "seq", "10", "tee", "mktemp", "file", "dos2unix", "sudo", "kill", "ps", "aux", "which",
  "type", "command", "-v", "wait", "-n", "jobs", "-l", "disown", "kill", "%1", "%2", "$!", "$$", "-TERM", "INT", "TERM", "HUP", "timeout", "0.5", "nohup", "setsid", "-P", "4", "sleep 2 &", "printenv", "PATH", "HOME", "IFS=,", "*", "?", "[a-z]*", "{a,b}", "{1..5}", "~/x", "*.log", "/etc/passwd", "hosts.txt", "\r", "\t", "#comment", "nano", "edit", "time", "expr"];

const rounds = Number(process.argv[2]) || 4000;
let n = 0;
const check = (out, s, line) => {
  assert.ok(Array.isArray(out), "lines");
  for (const l of out) assert.ok(Array.isArray(l) && typeof l[0] === "string", `each line is [text, class] (${s.id}: ${JSON.stringify(line)})`);
};
for (let i = 0; i < rounds; i++) {
  const s = SCENARIOS[i % SCENARIOS.length];
  const sys = start(s);
  for (let j = 0; j < 3; j++) {
    let line;
    const kind = rand(8);
    if (kind === 0) line = String.fromCharCode(...Array.from({ length: rand(50) }, () => 9 + rand(118)));
    else if (kind === 1) {
      // A random script written to the scenario's file, then run.
      const script = Array.from({ length: 1 + rand(8) }, () => Array.from({ length: 1 + rand(7) }, () => pick(WORDS)).join(" ")).join(pick(["\n", "\r\n", "; "]));
      sys.fs.write(s.file, (rand(2) ? "#!/usr/bin/env bash\n" : "") + script + "\n");
      line = pick([`bash ${s.file}`, `sh ${s.file}`, `bash -n ${s.file}`, s.file]);
    } else line = Array.from({ length: 1 + rand(10) }, () => pick(WORDS)).join(pick([" ", " ", "", ";"]));
    try {
      check(sys.run(line), s, line);
      s.check(sys);
      if (rand(10) === 0) explain(line + "\n" + (sys.fs.get(s.file) || { text: "" }).text);
    } catch (err) {
      console.error(`scenario ${s.id}, command: ${JSON.stringify(line)}\nscript: ${JSON.stringify((sys.fs.get(s.file) || {}).text)}`);
      throw err;
    }
    n++;
  }
}
console.log(`fuzz ok: ${n} command lines and scripts across ${SCENARIOS.length} scenarios, 0 exceptions`);
