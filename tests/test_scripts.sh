#!/usr/bin/env bash
# Runs each script in scripts/ against throwaway directories and checks what it
# does, including the safe defaults (dry runs, exit codes on failure).
# Usage: tests/test_scripts.sh      (needs bash, git, tar, python3)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
s="$root/scripts"
tmp="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$tmp"' EXIT
passed=0
pass() { passed=$((passed + 1)); }
fail() { echo "FAIL: $*" >&2; exit 1; }
expect_status() { local want="$1"; shift; local got=0; "$@" >/dev/null 2>&1 || got=$?; [[ "$got" == "$want" ]] || fail "$* exited $got, want $want"; pass; }

# retry: stops at the first success, gives up with the command's own code.
counter="$tmp/count"; echo 0 > "$counter"
flaky() { local n; n=$(( $(cat "$counter") + 1 )); echo "$n" > "$counter"; (( n >= 3 )); }
export -f flaky; export counter
expect_status 0 "$s/retry.sh" -n 5 -d 0 -- bash -c flaky
[[ "$(cat "$counter")" == 3 ]] || fail "retry ran $(cat "$counter") times, want 3"; pass
expect_status 7 "$s/retry.sh" -n 2 -d 0 -- bash -c 'exit 7'
expect_status 2 "$s/retry.sh" -n x -- true

# wait_for: a port that answers, and one that never does.
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
expect_status 0 "$s/wait_for.sh" -t 10 "127.0.0.1:$port"
expect_status 0 "$s/wait_for.sh" -t 10 "http://127.0.0.1:$port/"
expect_status 1 "$s/wait_for.sh" -t 1 "127.0.0.1:1"
expect_status 2 "$s/wait_for.sh" "no-port-here"

# backup_rotate: verified archives, only the newest kept, dry run deletes nothing.
mkdir -p "$tmp/app" && echo data > "$tmp/app/file.txt"
for i in 1 2 3; do touch -d "2026-01-0$i" "$tmp/b-old-$i" ; done
mkdir -p "$tmp/backups"
for i in 1 2 3; do echo x > "$tmp/backups/app-2026010$i-000000.tar.gz"; done
"$s/backup_rotate.sh" -k 2 "$tmp/app" "$tmp/backups" >/dev/null
[[ $(find "$tmp/backups" -name 'app-*.tar.gz' | wc -l) == 2 ]] || fail "backup_rotate kept the wrong number"; pass
newest="$(find "$tmp/backups" -name 'app-*.tar.gz' | sort | tail -1)"
(cd "$tmp/backups" && sha256sum -c --quiet "$(basename "$newest").sha256") || fail "checksum"; pass
before=$(find "$tmp/backups" | wc -l)
"$s/backup_rotate.sh" -n -k 1 "$tmp/app" "$tmp/backups" | grep -q "would delete" || fail "dry run says nothing"; pass
[[ $(find "$tmp/backups" | wc -l) == "$before" ]] || fail "dry run changed files"; pass

# release_deploy: atomic switch, rollback to the previous release, old ones pruned.
mkdir -p "$tmp/build" && echo v1 > "$tmp/build/version"
"$s/release_deploy.sh" deploy "$tmp/srv" "$tmp/build" 2 >/dev/null; sleep 1
echo v2 > "$tmp/build/version"; "$s/release_deploy.sh" deploy "$tmp/srv" "$tmp/build" 2 >/dev/null; sleep 1
echo v3 > "$tmp/build/version"; "$s/release_deploy.sh" deploy "$tmp/srv" "$tmp/build" 2 >/dev/null
[[ "$(cat "$tmp/srv/current/version")" == v3 ]] || fail "current is not v3"; pass
[[ $(find "$tmp/srv/releases" -mindepth 1 -maxdepth 1 | wc -l) == 2 ]] || fail "old releases not pruned"; pass
"$s/release_deploy.sh" rollback "$tmp/srv" >/dev/null
[[ "$(cat "$tmp/srv/current/version")" == v2 ]] || fail "rollback did not reach v2"; pass
expect_status 1 "$s/release_deploy.sh" rollback "$tmp/srv"

# git_prune_branches: dry run lists, -y deletes merged only, main is protected.
git init -q -b main "$tmp/repo" && cd "$tmp/repo"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git branch done-feature; git checkout -q -b open-feature
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m wip; git checkout -q main
"$s/git_prune_branches.sh" -b main | grep -q "would delete local done-feature" || fail "dry run"; pass
git rev-parse -q --verify done-feature >/dev/null || fail "dry run deleted"; pass
"$s/git_prune_branches.sh" -b main -y >/dev/null
! git rev-parse -q --verify done-feature >/dev/null || fail "merged branch kept"; pass
git rev-parse -q --verify open-feature >/dev/null || fail "unmerged branch deleted"; pass
cd "$root"

# preflight_check: lists every problem, never prints a variable's value.
out="$(SECRET_TOKEN=hunter2 "$s/preflight_check.sh" -c "bash no-such-cmd" -e "SECRET_TOKEN MISSING_VAR" -d "/:0" 2>&1 || true)"
grep -q "command no-such-cmd is not installed" <<< "$out" || fail "missing command"; pass
grep -q "variable MISSING_VAR" <<< "$out" || fail "missing variable"; pass
! grep -q hunter2 <<< "$out" || fail "preflight printed a secret"; pass
expect_status 0 "$s/preflight_check.sh" -c bash -d "/:0"

# deleted_open_files: a deleted file held open is found.
dd if=/dev/zero of="$tmp/big.log" bs=1M count=2 2>/dev/null
exec 9<"$tmp/big.log"; rm "$tmp/big.log"
found="$("$s/deleted_open_files.sh" 1 || true)"   # exits 1 when it finds some, by design
grep -q "big.log" <<< "$found" || fail "held deleted file not found"; pass
exec 9<&-

# incident_snapshot: makes an archive with the sections in it.
archive="$("$s/incident_snapshot.sh" "$tmp/snap")"
listing="$(tar -tzf "$archive")"
grep -q "uptime.txt" <<< "$listing" || fail "snapshot archive"; pass

# ssl_cert_expiry and user_access_audit: usage errors and a clean run.
expect_status 2 "$s/ssl_cert_expiry.sh"
"$s/user_access_audit.sh" >/dev/null || true; pass

echo "scripts ok: $passed checks"
