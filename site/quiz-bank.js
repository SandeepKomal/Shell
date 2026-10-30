// Quiz questions per level: q, optional code, four options, answer (index), why.
"use strict";

window.QUEST_QUIZ = {
  "00": [
    { q: "You run `./backup.sh` and get `Permission denied`. `bash backup.sh` works. What is missing?", options: ["The execute bit on the file", "A `#!/bin/bash` line", "sudo", "A `.sh` extension in PATH"], answer: 0,
      why: "Running a file by its path needs the execute permission; `bash file` only needs read permission because bash is the program being run. `chmod +x backup.sh` fixes it." },
    { q: "What does the `#!/usr/bin/env bash` line do?", options: ["Tells the kernel which interpreter runs the file", "Marks the file as executable", "Loads your .bashrc first", "Is a comment that documents the shell, nothing more"], answer: 0,
      why: "When an executable file starts with `#!`, the kernel runs the program named there with the file as its argument. `env bash` finds bash on PATH." },
    { q: "A script's last command is `grep -q ok status.txt` and the word is not in the file. What is the script's exit status?", options: ["1", "0", "2", "127"], answer: 0,
      why: "Without an explicit `exit`, a script exits with the status of its last command. grep returns 1 when nothing matched." },
    { q: "What does exit status 127 mean?", options: ["Command not found", "Permission denied", "Killed by a signal", "A syntax error"], answer: 0,
      why: "127 is command not found; 126 is found but not executable; 128+n is killed by signal n; 2 is often a syntax error or bad usage." }
  ],
  "01": [
    { q: "What does this print?", code: "NAME = web\necho \"[$NAME]\"", options: ["`NAME: command not found`, then `[]`", "`[web]`", "`[ = web]`", "A syntax error"], answer: 0,
      why: "With spaces, bash runs a command called `NAME` with arguments `=` and `web`. The variable is never set." },
    { q: "`dir=\"My Reports\"`. Which command passes the path to ls as one argument?", options: ["`ls \"$dir\"`", "`ls $dir`", "`ls '$dir'`", "`ls ${dir}`"], answer: 0,
      why: "Only double quotes prevent word splitting while still expanding the variable. `${dir}` without quotes is split just like `$dir`; single quotes pass the literal text `$dir`." },
    { q: "What does `echo 'Cost: $5'` print?", options: ["Cost: $5", "Cost: ", "Cost: 5", "An error about $5"], answer: 0,
      why: "Single quotes keep everything literal, so `$5` is not expanded." },
    { q: "`MSG=\"90% * check\"` then `echo $MSG` in a directory with files a.txt and b.txt. What is printed?", options: ["`90% a.txt b.txt check`", "`90% * check`", "`90%`", "An error"], answer: 0,
      why: "An unquoted expansion is split and then globbed; the `*` matches the files. `echo \"$MSG\"` prints it literally." }
  ],
  "02": [
    { q: "What does this print when tests fail?", code: "run-tests\necho done\nif [ $? -ne 0 ]; then echo FAILED; fi", options: ["done", "done and FAILED", "FAILED", "Nothing"], answer: 0,
      why: "`$?` is the status of the last command, which is `echo done`: 0. Test the command itself: `if ! run-tests; then`." },
    { q: "`x=` (empty). What does `[ $x = yes ]` print?", options: ["`[: =: unary operator expected`", "Nothing; it is false", "`[: too many arguments`", "Nothing; it is true"], answer: 0,
      why: "The empty unquoted variable vanishes, leaving `[ = yes ]`. Quote it, or use `[[ $x = yes ]]`." },
    { q: "Which test checks that a file exists and is a regular file?", options: ["`[[ -f $path ]]`", "`[[ -e $path ]]`", "`[[ -d $path ]]`", "`[[ -s $path ]]`"], answer: 0,
      why: "-f is a regular file; -e anything that exists; -d a directory; -s a non-empty file." },
    { q: "`cmd1 && cmd2 || cmd3` — when does cmd3 run?", options: ["When cmd1 fails, or cmd1 succeeds and cmd2 fails", "Only when cmd1 fails", "Only when cmd2 fails", "Never if cmd1 succeeds"], answer: 0,
      why: "It is not if/else: `||` runs after whatever came before it failed, which includes cmd2. Use `if cmd1; then cmd2; else cmd3; fi` when you mean if/else." }
  ],
  "03": [
    { q: "`usage=\"95%\"`. What does `[ \"$usage\" -gt 90 ]` do?", options: ["Errors: integer expression expected", "Succeeds", "Fails quietly", "Compares as text"], answer: 0,
      why: "-gt needs integers. Strip the sign first: `usage=${usage%\\%}`." },
    { q: "Why is `[[ $usage > 90 ]]` wrong for numbers?", options: ["It compares as text, so 100 sorts before 90", "It creates a file called 90", "It needs quotes", "> is not allowed in [[ ]]"], answer: 0,
      why: "In `[[ ]]`, `<` and `>` compare strings. Inside `[ ]` the `>` would even be a redirection creating a file named 90. Use -gt or `(( usage > 90 ))`." },
    { q: "Which matches host names web-01, web-02 and app-01 in one case branch?", options: ["`web-*|app-*)`", "`web-* || app-*)`", "`[web|app]-*)`", "`\"web-*\"|\"app-*\")`"], answer: 0,
      why: "case patterns are globs separated by `|`. Quoting the pattern would make the `*` literal." },
    { q: "What does `(( count > 3 ))` return when count is 5?", options: ["Status 0", "Status 1", "The number 1 printed", "Nothing; it only assigns"], answer: 0,
      why: "`(( ))` evaluates arithmetic and returns 0 (success) when the result is non-zero, so it works directly in `if`." }
  ],
  "04": [
    { q: "Files: `a.txt` and `Q3 Sales.txt`. How many times does this loop run?", code: "for f in $(ls); do echo \"$f\"; done", options: ["3", "2", "1", "It errors"], answer: 0,
      why: "The output of ls is split on spaces: a.txt, Q3, Sales.txt. Use `for f in *` instead." },
    { q: "What does this print?", code: "count=0\nprintf 'a\\nb\\n' | while read -r l; do count=$((count+1)); done\necho $count", options: ["0", "2", "1", "An error"], answer: 0,
      why: "The loop is part of a pipeline and runs in a subshell; its count disappears. Use `done < file` or `done < <(cmd)`." },
    { q: "hosts.txt has three lines and no newline at the end. `while read -r h; do echo $h; done < hosts.txt` prints how many lines?", options: ["2", "3", "0", "It loops forever"], answer: 0,
      why: "read returns 1 at the last, unterminated line, so the loop ends before using it. Add `|| [[ -n $h ]]`." },
    { q: "No .log files exist. What does `for f in *.log; do echo \"$f\"; done` print?", options: ["`*.log`", "Nothing", "An error", "`.log`"], answer: 0,
      why: "An unmatched glob stays literal. `shopt -s nullglob` makes it expand to nothing." }
  ],
  "05": [
    { q: "`f=backup.2026-10-30.tar.gz`. What is `${f%.*}`?", options: ["backup.2026-10-30.tar", "backup", "gz", "backup.2026-10-30"], answer: 0,
      why: "% removes the shortest matching suffix: `.gz`. `%%` would remove the longest, leaving `backup`." },
    { q: "With `set -u`, which line is safe when DEBUG is unset?", options: ["`[ \"${DEBUG:-0}\" = 1 ]`", "`[ \"$DEBUG\" = 1 ]`", "`[ \"${DEBUG}\" = 1 ]`", "`[ -n $DEBUG ]`"], answer: 0,
      why: "`${DEBUG:-0}` supplies a default, so nothing unset is read. The others read DEBUG directly and stop the script." },
    { q: "`p=/var/log/app/api.log`. Which gives `api.log`?", options: ["`${p##*/}`", "`${p#*/}`", "`${p%/*}`", "`${p%%/*}`"], answer: 0,
      why: "## removes the longest prefix matching `*/`, which is everything up to the last slash." },
    { q: "What does `: \"${TARGET:?TARGET is not set}\"` do when TARGET is empty?", options: ["Prints the message and stops a script with status 1", "Sets TARGET to the message", "Nothing", "Prints the message and carries on"], answer: 0,
      why: "`${VAR:?msg}` is a guard: empty or unset is an error that ends a non-interactive shell." }
  ],
  "06": [
    { q: "Where do errors go with `cmd 2>&1 > out.txt`?", options: ["To the terminal", "To out.txt", "Nowhere", "To both"], answer: 0,
      why: "Redirections apply left to right: stderr is pointed at the current stdout (the terminal), then stdout moves to the file. Write `> out.txt 2>&1` to send both." },
    { q: "Which here-document writes `$HOME` literally into the file?", options: ["`cat > f <<'EOF'`", "`cat > f <<EOF`", "`cat > f <<-EOF`", "`cat > f <<<EOF`"], answer: 0,
      why: "Quoting the delimiter turns off all expansion in the body." },
    { q: "What happens here when app.conf has a bad line?", code: "cat app.conf | while read -r l; do\n  [ -z \"$l\" ] && exit 1\ndone\necho deploying", options: ["It still prints deploying", "The script exits 1", "A syntax error", "It loops forever"], answer: 0,
      why: "exit ends only the subshell running the piped loop. Redirect instead: `done < app.conf`." },
    { q: "What does `tee -a log.txt` do?", options: ["Copies its input to stdout and appends it to log.txt", "Only appends to log.txt", "Truncates log.txt", "Reads log.txt aloud"], answer: 0,
      why: "tee writes its input both to stdout and to files; -a appends instead of truncating." }
  ],
  "07": [
    { q: "Why does `cut -d' ' -f1 access.log | uniq -c` give wrong counts?", options: ["uniq only merges adjacent lines; sort first", "cut cannot use spaces", "uniq -c needs -n", "The log must be gzipped"], answer: 0,
      why: "`sort | uniq -c | sort -rn` is the counting idiom." },
    { q: "`grep -c 10.0.0.1 access.log` also counts 10.0.0.15. The fix?", options: ["`grep -cFw 10.0.0.1`", "`grep -ci 10.0.0.1`", "`grep -c \"10.0.0.1\"`", "`grep -cv 10.0.0.1`"], answer: 0,
      why: "-F takes the text literally (the dots stop meaning any character) and -w requires whole words." },
    { q: "`NEW=/srv/www`. Why does `sed \"s/ROOT/$NEW/\" f` fail?", options: ["The slashes in the value end the s command", "sed cannot use variables", "Double quotes are not allowed", "-i is required"], answer: 0,
      why: "Use another delimiter: `sed \"s|ROOT|$NEW|\"`." },
    { q: "Which prints the 5th column of `df -P` output reliably?", options: ["`awk '{print $5}'`", "`cut -d' ' -f5`", "`cut -f5`", "`tr ' ' | cut -f5`"], answer: 0,
      why: "awk splits on runs of blanks; cut treats every single space as a separator, and df pads its columns." }
  ],
  "08": [
    { q: "`get() { return \"prod\"; }` — what happens?", options: ["`return: prod: numeric argument required`", "It returns the string", "It prints prod", "Nothing; return is ignored"], answer: 0,
      why: "return sets a status from 0 to 255. Print data instead: `get() { echo prod; }` and `v=$(get)`." },
    { q: "With `set -e`, why does `local v=$(failing-cmd)` not stop the script?", options: ["The status is local's, which is 0", "set -e is off in functions", "Command substitution never fails", "local runs in a subshell"], answer: 0,
      why: "Declare and assign separately: `local v; v=$(failing-cmd)`. The same applies to export, declare and readonly." },
    { q: "A function sets `i=5` without `local`. After it returns, the caller's `i` is…", options: ["5", "Its old value", "Unset", "An error"], answer: 0,
      why: "Variables are global unless declared local." },
    { q: "How do you capture both a function's output and its exit status?", options: ["`out=$(f); rc=$?`", "`rc=$(f)`", "`out=$(f; echo $?)`", "`f > out; rc=$out`"], answer: 0,
      why: "A plain assignment's status is the command substitution's status, so `$?` right after it is f's." }
  ],
  "09": [
    { q: "`./notify.sh \"Deploy done\" \"#ops\"` calls `send $*`. How many arguments does send get?", options: ["3", "2", "1", "0"], answer: 0,
      why: "Unquoted `$*` is split on spaces. `\"$@\"` passes exactly the two original arguments." },
    { q: "In `getopts \"ve:\" opt`, what does the colon mean?", options: ["-e takes a value, in $OPTARG", "-e is optional", "Errors are silent", "-v and -e are exclusive"], answer: 0,
      why: "A colon after a letter means that option takes an argument. A leading colon (`\":ve:\"`) makes getopts report errors quietly." },
    { q: "After the getopts loop, how do you make `$1` the first non-option argument?", options: ["`shift $((OPTIND - 1))`", "`shift`", "`shift $#`", "`unset OPTIND`"], answer: 0,
      why: "OPTIND is the index of the next argument to process; shifting OPTIND-1 drops the options." },
    { q: "Which exit status is conventional for a usage error?", options: ["2", "0", "127", "255"], answer: 0,
      why: "2 means misuse, as many tools do; 1 is a general failure." }
  ],
  "10": [
    { q: "With only `set -e`, what does this print?", code: "set -e\nfalse | true\necho still here", options: ["still here", "Nothing; it exits", "An error", "true"], answer: 0,
      why: "A pipeline's status is its last command's. `set -o pipefail` makes it fail." },
    { q: "With `set -e`, which line ends the script when count is 0?", options: ["`((count++))`", "`count=$((count + 1))`", "`((++count))`", "`count=$((count++))`"], answer: 0,
      why: "count++ evaluates to the old value, 0, so `(( ))` returns 1. Note `count=$((count++))` assigns the old value back and never increments." },
    { q: "When does `trap 'rm -f \"$tmp\"' EXIT` run?", options: ["Whenever the script exits, success or failure", "Only on success", "Only on Ctrl+C", "Only when exit is called"], answer: 0,
      why: "The EXIT trap runs on every exit of the shell, including set -e failures and exit 1." },
    { q: "`cd /missing; rm -rf *` without set -e. What happens?", options: ["cd fails and rm deletes the current directory's contents", "The script stops at cd", "rm refuses to run", "Nothing is deleted"], answer: 0,
      why: "A failed cd only prints an error. Always `cd /dir || exit 1`." }
  ],
  "11": [
    { q: "Which command checks a script's syntax without running it?", options: ["`bash -n script.sh`", "`bash -x script.sh`", "`bash -e script.sh`", "`bash -c script.sh`"], answer: 0,
      why: "-n reads the script and reports syntax errors but executes nothing." },
    { q: "What does `bash -x` print for `name=\"a b\"; echo $name`?", options: ["`+ name='a b'` and `+ echo a b`", "`echo $name`", "Nothing extra", "Only the output"], answer: 0,
      why: "xtrace prints each command after expansion, which is exactly what you need to see splitting and empty variables." },
    { q: "An error says `deploy.sh: line 14: syntax error near unexpected token fi`. Where is the mistake usually?", options: ["On line 14 or just before it", "On line 1", "At the end of the file", "In a sourced file"], answer: 0,
      why: "Bash reports where it noticed the problem; a missing `then` or `;` is often a line or two earlier." },
    { q: "Why is `set -x` risky in CI?", options: ["It prints secrets in commands into the log", "It slows builds", "It disables set -e", "It changes PATH"], answer: 0,
      why: "Tracing shows every expanded word, including tokens in headers and URLs." }
  ],
  "12": [
    { q: "A script works in your terminal and fails from cron with `aws: command not found`. Why?", options: ["Cron's PATH is /usr/bin:/bin", "Cron runs as root", "Cron has no network", "aws needs a TTY"], answer: 0,
      why: "Cron uses a minimal environment. Set PATH in the script or use full paths." },
    { q: "How do you reproduce cron's environment in a terminal?", options: ["`env -i HOME=$HOME PATH=/usr/bin:/bin ./job.sh`", "`sudo ./job.sh`", "`bash -l ./job.sh`", "`crontab -e`"], answer: 0,
      why: "env -i starts with an empty environment; add only what cron provides." },
    { q: "`./run.sh: cannot execute: required file not found`, and `cat -A run.sh` shows `^M$`. Fix?", options: ["`sed -i 's/\\r$//' run.sh`", "`chmod +x run.sh`", "Reinstall bash", "Add sudo"], answer: 0,
      why: "The carriage return makes the interpreter `/bin/bash\\r`, which does not exist." },
    { q: "`DEPLOY_ENV=staging` then `./migrate.sh`. Why does migrate.sh not see it?", options: ["It was not exported", "Variables need quotes", "migrate.sh needs source", "Child scripts never see variables"], answer: 0,
      why: "Only exported variables are copied into a child process's environment." }
  ],
  "13": [
    { q: "`STAGING` is unset. What does `rm -rf \"$STAGING\"/*` delete?", options: ["Everything under /", "Nothing", "The current directory", "It errors because of the quotes"], answer: 0,
      why: "It becomes `rm -rf /*`. Guard it: `\"${STAGING:?}\"/*`." },
    { q: "What should you run before `find ... -delete`?", options: ["The same find with -print", "find with -exec rm", "ls -R", "find with -maxdepth 0"], answer: 0,
      why: "A dry run lists exactly what would be deleted." },
    { q: "Why use `mktemp` instead of `/tmp/report.tmp`?", options: ["A unique name another user cannot pre-create or race", "It is faster", "It deletes itself", "It works without /tmp"], answer: 0,
      why: "Fixed names in shared /tmp can be planted as symlinks; mktemp creates a fresh file with safe permissions." },
    { q: "Why `rm -rf -- \"$dir\"`?", options: ["`--` stops a name starting with - being read as an option", "It forces deletion", "It is required by rm", "It adds verbosity"], answer: 0,
      why: "A file named `-rf` or `--no-preserve-root` would otherwise be an option." }
  ],
  "14": [
    { q: "Why is `[ -e /var/lock/job.lock ] && exit` a weak lock?", options: ["The file can be left behind after a crash, and two runs can pass the test at once", "Lock files cannot be in /var/lock", "-e is not allowed in [ ]", "It needs sudo"], answer: 0,
      why: "flock locks are released by the kernel when the process ends, and acquiring one is atomic." },
    { q: "What does `flock -n 9 || exit 0` do after `exec 9>/var/lock/job.lock`?", options: ["Exits at once if another run holds the lock", "Waits for the lock", "Deletes the lock", "Creates a new lock file each run"], answer: 0,
      why: "-n is non-blocking: if the lock is taken, flock fails immediately." },
    { q: "A good retry loop for a flaky download has…", options: ["A limit and waits that grow", "No limit until it works", "No waits, to finish sooner", "A single retry"], answer: 0,
      why: "Unbounded retries hang deploys during real outages; no waits hammer a struggling server." },
    { q: "What does idempotent mean for a script?", options: ["Running it twice leaves the same result as once", "It never fails", "It runs in parallel", "It has no side effects"], answer: 0,
      why: "mkdir -p, ln -sfn and checking before creating make scripts safe to re-run." }
  ],
  "15": [
    { q: "Why is `eval \"ls $DIR\"` dangerous?", options: ["DIR can contain ; or $( ) that run as commands", "eval is slow", "ls cannot be evaluated", "It ignores DIR"], answer: 0,
      why: "eval parses its text as code. Use `ls -- \"$DIR\"`." },
    { q: "Which is the safer way to install a tool than `curl https://x/install.sh | bash`?", options: ["Download it, read it, check its checksum, then run it", "Use wget instead", "Add sudo", "Use sh instead of bash"], answer: 0,
      why: "Piping runs whatever the server sends, even a half-downloaded file." },
    { q: "Where should a script get its API token?", options: ["From the environment or a secrets manager at run time", "A variable at the top of the script", "A comment", "The command line, visible in ps"], answer: 0,
      why: "Secrets in files end up in git; on the command line they show in ps and shell history." },
    { q: "`sudo echo x > /etc/app.conf` fails with Permission denied. Why?", options: ["The redirection is done by your shell, not by sudo", "echo cannot run as root", "/etc is read-only", "sudo needs -E"], answer: 0,
      why: "Use `echo x | sudo tee /etc/app.conf > /dev/null`." }
  ],
  "16": [
    { q: "Why is `while read l; do echo \"$l\" | cut -d' ' -f1; done < big.log` slow?", options: ["It starts processes for every line", "read is slow", "cut is slow on big files", "echo buffers output"], answer: 0,
      why: "Each line costs a subshell and a cut. `awk '{print $1}' big.log` does it in one process." },
    { q: "Which is the fastest way to count lines matching ERROR?", options: ["`grep -c ERROR file`", "`cat file | grep ERROR | wc -l`", "A while loop with [[ ]]", "`awk` with a loop over every field"], answer: 0,
      why: "One process that reads the file once, with no extra pipes or processes." },
    { q: "When should a bash script become another language?", options: ["When it needs data structures, error handling and tests beyond what bash does well", "When it has more than 10 lines", "Never", "When it uses awk"], answer: 0,
      why: "Bash is excellent glue; complex logic is easier to test and maintain in Python or Go." },
    { q: "`find . -name '*.log' -exec gzip {} +` versus `\\;` — what does `+` do?", options: ["Passes many files to one gzip", "Runs gzip in parallel", "Recurses deeper", "Nothing different"], answer: 0,
      why: "`+` batches arguments like xargs; `\\;` starts one gzip per file." }
  ],
  "17": [
    { q: "A cron job wiped a server. What is the first thing to do?", options: ["Capture the state and logs before changing anything", "Re-run the job to see the error", "Reboot", "Delete the crontab"], answer: 0,
      why: "Evidence disappears quickly; scripts/incident_snapshot.sh collects it read-only." },
    { q: "How do you find out what environment the job really ran with?", options: ["Reproduce it with env -i and the cron PATH", "Run it from your terminal", "Check ~/.bashrc", "Ask cron"], answer: 0,
      why: "Most cron incidents come from the difference between your login shell and cron's environment." },
    { q: "The fix is in. What stops it happening again?", options: ["A guard in the script and a test or check in CI", "A note in the wiki", "Running it by hand from now on", "Removing set -u"], answer: 0,
      why: "`${VAR:?}`, ShellCheck in CI and a test with an empty environment turn the lesson into a check." },
    { q: "df shows the disk 100% full, du finds far less. A likely cause?", options: ["A deleted log still held open by a process", "du is broken", "Inodes are full", "Swap is full"], answer: 0,
      why: "The space is freed only when the process closes the file or restarts; scripts/deleted_open_files.sh finds them." }
  ]
};
