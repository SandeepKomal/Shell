// Runs each script below through real bash and through the playground's
// interpreter, and requires the same output, errors and exit status.
// This is what keeps the playground honest about being bash.
// Run with: node tests/check_bash_parity.js   (needs bash 5.2 on PATH)
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");

for (const f of ["bash", "builtins", "coreutils"]) require(path.resolve(__dirname, `../site/${f}.js`));
const { System } = globalThis.ShellSim;

const version = spawnSync("bash", ["--version"], { encoding: "utf8" }).stdout || "";
if (!/version 5\.2\./.test(version)) {
  console.log("bash parity skipped: needs bash 5.2 (the version the playground follows)");
  process.exit(0);
}

const CASES = [
  // Expansion and quoting
  `x="a b  c"; echo $x; echo "$x"; printf '[%s]' $x; echo`,
  `set -- "one two" three; for a in "$@"; do echo "<$a>"; done; for a in $@; do echo "($a)"; done; echo "$*"; echo $#`,
  `f="report.final.tar.gz"; echo "\${f%.*} \${f%%.*} \${f#*.} \${f##*.}"; p=/var/log/app/x.log; echo "\${p##*/} \${p%/*}"`,
  `s="Hello World"; echo "\${s/o/0} \${s//o/0} \${s^^} \${s,,} \${#s} \${s:6} \${s:0:5} \${s: -3}"`,
  `unset v; echo "[\${v:-default}] [\${v-dash}] [\${v:+set}]"; v=""; echo "[\${v:-default}] [\${v-dash}] [\${v:+set}]"; : "\${w:=assigned}"; echo "$w"`,
  `echo '$HOME' "\\$HOME" \\$HOME; echo "a\\"b" 'it'\\''s'; echo $'tab\\there'`,
  `a=(alpha beta "gamma delta"); echo \${#a[@]} "\${a[2]}" "\${a[@]:1}"; a+=(eps); for x in "\${a[@]}"; do echo "-$x"; done; echo "\${!a[@]}" 2>/dev/null || true`,
  `echo {a,b,c}.txt {1..5} {05..10..2} x{,y}`,
  `i=5; echo $((i * 2 + 3)) $((i / 2)) $((i % 3)) $((2 ** 8)) $((i > 3 ? 1 : 0)); ((i++)); echo $i; let "j = i << 2"; echo $j`,
  `echo $((08))`,
  `h=07; echo $((h * 60)); m=08; echo $((m + 1)); echo after`,
  `h=08; echo $((10#$h * 60)) $((-5 + 2))`,
  `echo $((1/0)); echo after`,
  `v="91%"; echo $(( v + 1 )); echo after`,
  `echo "\${x!}"; echo after`,
  `IFS=, read -r a b c <<< "1,2,3,4"; echo "$a|$b|$c"; IFS=: read -ra parts <<< "x:y:z"; echo \${#parts[@]} \${parts[1]}`,
  `printf '%s=%d\\n' a 1 b 2; printf '%5.1f|%-4s|%x|%o|%e\\n' 3.14159 ab 255 8 1234.5; printf '%q\\n' "a b'c"; printf 'no args: %s %d|\\n'`,
  `echo -n "no newline"; echo; echo -e "a\\tb\\nc"; echo -e "stop\\cnever"; echo; echo -E "raw\\n"`,
  // Exit status and errors
  `ehco hi; echo "status $?"`,
  `NAME = web; echo "status $?"`,
  `x=; [ $x = y ]; echo "status $?"`,
  `[ grep -q a ]; echo $?; [ grep -q a b ]; echo $?; [ a b = c ]; echo $?; [ 1 -eq ]; echo $?`,
  `v="91%"; [ "$v" -gt 80 ]; echo $?; [[ $v -gt 80 ]]; echo $?`,
  `[ 1 -lt 2 ] && echo lt; [ abc \\< abd ] && echo less; [ -z "" ] && echo empty; [ -n "x" -a 1 = 1 ] && echo both; [ ! -e /nope ] && echo missing`,
  `[[ abc == a* ]] && echo glob; [[ abc == "a*" ]] || echo literal; [[ 2026-10 =~ ^([0-9]+)-([0-9]+)$ ]] && echo "\${BASH_REMATCH[2]}"; [[ -z $nothing && 3 -gt 2 ]] && echo and`,
  `return 3; echo after`,
  `f() { return abc; }; f; echo "status $?"`,
  `cd /nonexistent-dir; echo "status $?"; cd; echo back`,
  `set -u; echo start; echo "$undefined_var"; echo never`,
  `: "\${1:?usage: deploy.sh <dir>}"; echo never`,
  `set -e; false || echo "rescued"; if false; then :; fi; ! true; echo "still here"; false; echo never`,
  `set -e; f() { local out=$(false); echo "local hid the failure"; }; f; out=$(false); echo never`,
  `set -e; count=0; ((count++)); echo never`,
  `set -o pipefail; false | true; echo "\${PIPESTATUS[@]} $?"; true | false | true; echo $?`,
  `false | true; echo $?; true | false; echo $?`,
  `x=1; readonly x; x=2; echo "status $? x=$x"`,
  `exit 300`,
  `trap 'echo cleanup' EXIT; echo working; exit 4`,
  `(exit 7); echo "subshell $?"; ( echo in; exit 2 ); echo "status $?"`,
  `echo hi > /no/such/dir/file; echo "status $?"; v=; echo x > $v; echo "status $?"; w="a b"; echo x > $w; echo "status $?"`,
  `if true; then echo a; fi fi`,
  `echo "unterminated`,
  `for i in 1 2 3; do if [ $i = 2 ]; then continue; fi; echo $i; done; while true; do break; done; echo done`,
  `break; echo after`,
  `n=0; until [ $n -ge 3 ]; do n=$((n+1)); done; echo $n; for ((k=0; k<3; k++)); do printf '%d ' $k; done; echo`,
  `case "web-01" in db-*) echo db;; web-*|app-*) echo web;;& *-01) echo first;; *) echo other;; esac`,
  // Subshells, pipes and scope
  `count=0; printf 'a\\nb\\nc\\n' | while read -r l; do count=$((count+1)); done; echo "count=$count"; while read -r l; do count=$((count+1)); done <<< $'a\\nb\\nc'; echo "count=$count"`,
  `printf 'one\\ntwo' > f.txt; while read -r l; do echo "[$l]"; done < f.txt; while read -r l || [[ -n $l ]]; do echo "<$l>"; done < f.txt`,
  `i=10; f() { i=1; }; f; echo $i; g() { local i=2; echo "in $i"; }; g; echo $i`,
  `x=outer; f() { local x=inner; g; }; g() { echo "g sees $x"; }; f; echo $x`,
  `f() { echo "args: $# $1 \${2:-none}"; shift; echo "after shift: $1"; }; f a b c`,
  `v=$(echo "  padded  "); echo "[$v]"; w=\`echo back\`; echo $w; echo "$(printf 'a\\n\\n\\n')|"`,
  `export A=1; B=2; bash -c 'echo "A=$A B=\${B:-unset}"'; C=3 bash -c 'echo "C=$C"'; echo "C after: \${C:-unset}"`,
  `cat <<EOF
home is $HOME-ish \\$literal $(echo sub)
EOF
cat <<'EOF'
nothing $HOME $(echo here)
EOF
cat <<-EOF
	tabs stripped
	EOF`,
  `echo stdout; echo stderr >&2; { echo grouped; echo also; } > out.txt; cat out.txt; ls nope 2>&1 | head -1; echo hi &> both.txt; cat both.txt`,
  `getopts_demo() { local OPTIND opt; while getopts ":vn:" opt; do case $opt in v) echo verbose;; n) echo "name=$OPTARG";; :) echo "missing arg for -$OPTARG";; \\?) echo "bad -$OPTARG";; esac; done; shift $((OPTIND-1)); echo "rest: $*"; }; getopts_demo -v -n web x y; getopts_demo -z -n`,
  `while getopts "ab:" o; do echo "$o \${OPTARG:-}"; done; echo end`,
  `mapfile -t lines <<< $'l1\\nl2\\nl3'; echo "\${#lines[@]} \${lines[1]}"`,
  `shopt -s nullglob; for f in *.nomatch; do echo "never $f"; done; shopt -u nullglob; for f in *.nomatch; do echo "got $f"; done`,
  `touch b.log a.log "c d.log"; for f in *.log; do echo "[$f]"; done; for f in $(ls *.log); do echo "<$f>"; done; echo *.log`,
  `x="*"; touch q1 q2; echo $x | head -c 40; echo; echo "$x"`,
  `eval 'y=5; echo "eval $y"'; type cd; type -t ls; command -v nonexistent || echo "not found $?"`,
  // Utilities
  `printf 'b 2\\na 10\\nc 1\\na 10\\n' > d.txt; sort d.txt; sort -k2 -n d.txt; sort -u d.txt | wc -l; sort d.txt | uniq -c; cut -d' ' -f2 d.txt | sort -n | tail -1`,
  `printf '10.0.0.1 GET\\n10.0.0.15 POST\\n10.0.0.1 GET\\n' > a.log; grep -c "10.0.0.1" a.log; grep -cw "10.0.0.1" a.log; grep -F -x "10.0.0.1 GET" a.log | wc -l; grep -v GET a.log; grep -n POST a.log; grep -q nothing a.log; echo $?; grep x nofile; echo $?`,
  `printf 'root:x:0\\ndev:x:1000\\n' | awk -F: '$3 >= 1000 {print $1, $3}'; printf '5\\n7\\n' | awk '{s += $1} END {print "sum", s, NR}'; echo "a b c" | awk '{print $NF; print NF}'; printf 'x 1\\ny 2\\nx 3\\n' | awk '{c[$1]+=$2} END {print c["x"], c["y"]}'`,
  `echo "path/to/file" | sed 's/\\//_/g'; echo "a.b.c" | sed 's/\\./-/2'; echo "hello" | sed -n 's/l/L/p'; printf '1\\n2\\n3\\n' | sed '2d'; printf 'x\\ny\\n' | sed -E 's/(x|y)/[\\1]/'; echo abc | sed 's/b/&&/'`,
  `sed 's/a/b/c/' /dev/null; echo $?; sed 's/a/b' /dev/null; echo $?; echo x | sed 's|/a|/b|'`,
  `printf 'line1\\r\\nline2\\r\\n' > crlf.txt; cat -A crlf.txt; sed -i 's/\\r$//' crlf.txt; cat -A crlf.txt; tr -d '\\r' < crlf.txt | wc -c`,
  `echo "Hello World" | tr 'a-z' 'A-Z'; echo "a  b   c" | tr -s ' '; echo "hello" | tr -d 'l'; echo "  trim me " | xargs; printf 'a\\nb\\nc\\n' | xargs -n 2 echo; printf 'x\\ny\\n' | xargs -I{} echo "item {}"`,
  `seq 3; seq 2 2 6; seq -s, 4; seq -w 8 10; seq x`,
  `mkdir -p d/e/f; touch d/e/f/g.txt d/top.txt; find d -name "*.txt" | sort; find d -type d | sort; find d -maxdepth 1 -type f; find nope; mkdir d; echo $?`,
  `touch keep.txt; rm keep.txt; ls keep.txt; rm keep.txt; rm -f keep.txt; echo "f: $?"; mkdir dd; rm dd; rmdir dd; cp nope x; cp a b c`,
  `echo "one two three" > w.txt; wc -l w.txt; wc -w < w.txt; wc w.txt; head -c 3 w.txt; echo; printf '1\\n2\\n3\\n4\\n5\\n' | tail -n 2; printf '1\\n2\\n3\\n' | head -n -1; printf '1\\n2\\n3\\n' | tail -n +2`,
  `basename /var/log/app.log .log; basename /srv/app/; dirname /var/log/app.log; dirname file; dirname /`,
  `echo "status" | tee t1.txt > /dev/null; cat t1.txt; date -d @0 +%F; date -d "2026-01-02" "+%Y/%m/%d %a"`,
  `x=$(expr 3 + 4); echo $x; expr 10 / 3; expr length "hello"`,
  `echo data > in.txt; cat < in.txt; cat in.txt nope; echo "rc=$?"; cat -n in.txt`,
  `printf 'b\\na\\n' > s.txt; sort -o s.txt s.txt; cat s.txt; echo "a,b,,d" | cut -d, -f1,3-; echo "abcdef" | cut -c2-4`,
  `while read -r a b; do echo "$b:$a"; done < <(printf "1 x\\n2 y\\n"); cat <(echo sub); printf .%s\\n. 3 10 2 | sort; printf '%s\\n' 3 10 2 | sort -n; printf '1K\\n2M\\n512\\n' | sort -h`
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
let failed = 0;
CASES.forEach((src, k) => {
  const dir = path.join(tmp, String(k));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "t.sh"), src + "\n");
  const real = spawnSync("bash", ["t.sh"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir } });
  const sys = new System({ files: { "/home/dev/t.sh": src + "\n" } });
  sys.run("bash t.sh");
  const sim = { stdout: sys.stdout, stderr: sys.stderr, status: sys.term.status };
  // Real paths differ; everything else must match.
  const norm = (s) => s.split(dir).join("/home/dev");
  const want = { stdout: norm(real.stdout), stderr: norm(real.stderr), status: real.status };
  for (const key of ["stdout", "stderr", "status"]) {
    if (want[key] !== sim[key]) {
      failed++;
      console.error(`case ${k}: ${key} differs\n--- script\n${src}\n--- bash\n${JSON.stringify(want[key])}\n--- playground\n${JSON.stringify(sim[key])}\n`);
    }
  }
});
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`bash parity: ${failed} differences`); process.exit(1); }
console.log(`bash parity ok: ${CASES.length} scripts give the same output, errors and status as bash ${/version (\S+)/.exec(version)[1]}`);
void execFileSync;
