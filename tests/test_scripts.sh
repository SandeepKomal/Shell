#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016
# SC2015: "a && b || fail" is meant (fail unless both hold). SC2016: the stubs' bodies are single-quoted on purpose.
# Runs each script in scripts/ against throwaway directories and checks what it
# does, including the safe defaults (dry runs, exit codes on failure).
# Usage: tests/test_scripts.sh      (needs bash, git, tar, python3, flock; cloud and
# database tools are stubbed, so no account or network is used)
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

# --- Stubbed tools for the cloud, database, Kubernetes and ops scripts --------
# Fake aws, kubectl, pg_dump, mysqldump, terraform, nginx, ssh and journalctl on PATH
# record every call in $calls, so the tests can prove a dry run changes nothing.
bin="$tmp/bin" calls="$tmp/calls.log"
mkdir -p "$bin"; : > "$calls"
stub() { printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n%s\n' "$1" "$calls" "$2" > "$bin/$1"; chmod +x "$bin/$1"; }
stub aws 'while [[ "$1" == --* ]]; do shift 2; done
case "$1 $2" in
  "ec2 describe-instances") printf "i-0a1\tweb-dev-1\trunning\tt3.small\t10.0.1.5\ni-0b2\tweb-dev-2\trunning\tt3.small\t10.0.1.6\n" ;;
  "ec2 stop-instances") ;;
  "s3 sync") src="$3"; [[ " $* " == *" --dryrun "* ]] && [[ ! -e "$src/.synced" ]] && for f in "$src"/*; do echo "(dryrun) upload: $f to $4/${f##*/}"; done; [[ " $* " == *" --dryrun "* ]] || touch "$src/.synced" ;;
  "s3 cp") ;;
  "ecr describe-images") printf "sha256:aaaaaaaaaaaaaaaa\t1600000000\t52428800\t-\t-\nsha256:bbbbbbbbbbbbbbbb\t1700000000\t52428800\tv1\t-\nsha256:cccccccccccccccc\t1710000000\t52428800\tv2\t-\nsha256:dddddddddddddddd\t1720000000\t52428800\tlatest,v3\t-\n" ;;
  "ecr batch-delete-image") echo 0 ;;
  *) exit 1 ;;
esac'
stub kubectl 'args=" $* "
case "$args" in
  *" config current-context "*) echo test-cluster ;;
  *"containers[0].name"*) echo api ;;
  *"].image}"*) echo registry.example.com/api:1.0 ;;
  *" rollout status "*) [[ -e "'"$tmp"'/rollout-fails" && "$(grep -c "rollout status" "'"$calls"'")" == 1 ]] && exit 1; echo "successfully rolled out" ;;
  *" get pods "*) echo "NAMESPACE POD OWNER"; echo "shop api-1 ReplicaSet" ;;
esac; exit 0'
stub pg_dump 'for a in "$@"; do [[ "$a" == --file=* ]] && f="${a#--file=}"; done; [[ -e "'"$tmp"'/db-down" ]] && { echo "pg_dump: error: connection failed" >&2; exit 1; }; echo "PGDMP fake dump" > "$f"'
stub pg_restore 'head -c5 "$2" | grep -q PGDMP'
stub mysqldump 'echo "CREATE TABLE orders (id int);"; [[ -e "'"$tmp"'/db-down" ]] && exit 2; echo "-- Dump completed on 2026-10-31 02:00:00"'
stub terraform 'case "$1 $2" in
  *" init") exit 0 ;;
  *" plan") case "$1" in *drift*) echo "  # aws_s3_bucket.logs will be updated in-place"; exit 2 ;; *broken*) echo "Error: Invalid provider configuration"; exit 1 ;; esac ;;
esac'
stub nginx '[[ "$1" == -t && -e "'"$tmp"'/nginx-bad" ]] && { echo "nginx: [emerg] unknown directive \"proxy_passs\" in /etc/nginx/sites-enabled/shop:12" >&2; exit 1; }; exit 0'
stub systemctl 'exit 1'
stub ssh 'host="${*: -2:1}"; [[ "$host" == bad* ]] && { echo "ssh: connect to host $host port 22: Connection refused" >&2; exit 255; }; echo "ok from $host"'
cat > "$bin/journalctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "2026-10-31T09:12:01+0530 web-01 nginx[812]: upstream timed out after 3012ms while connecting to 10.0.3.7" \
  "2026-10-31T09:12:05+0530 web-01 nginx[812]: upstream timed out after 2981ms while connecting to 10.0.3.8" \
  "2026-10-31T09:13:00+0530 web-01 shop-api[1201]: payment failed for priya.sharma@example.com"
EOF
chmod +x "$bin/journalctl"
P="$bin:$PATH"
called() { grep -q -- "$1" "$calls"; }

# ec2_by_tag: lists, refuses without a tag, dry run stops nothing, -m caps the blast radius.
out="$(PATH="$P" "$s/ec2_by_tag.sh" -a stop Environment=dev 2>&1)"
grep -q "would stop i-0a1" <<< "$out" || fail "ec2 dry run"; pass
! called "stop-instances" || fail "ec2 dry run stopped instances"; pass
expect_status 2 env PATH="$P" "$s/ec2_by_tag.sh"
expect_status 2 env PATH="$P" "$s/ec2_by_tag.sh" -a stop -m 1 -y Environment=dev
! called "stop-instances" || fail "ec2 -m did not refuse"; pass
PATH="$P" "$s/ec2_by_tag.sh" -a stop -y Environment=dev >/dev/null 2>&1
called "ec2 stop-instances.*i-0a1 i-0b2" || fail "ec2 -y did not stop"; pass
PATH="$P" "$s/ec2_by_tag.sh" -j Environment=dev | python3 -c 'import json,sys; assert len(json.load(sys.stdin)) == 2' || fail "ec2 json"; pass

# s3_backup_sync: refuses an empty source, dry run uploads nothing, -y syncs and verifies.
mkdir -p "$tmp/s3src" "$tmp/s3empty" && echo dump > "$tmp/s3src/db.dump"
expect_status 2 env PATH="$P" "$s/s3_backup_sync.sh" -D -y "$tmp/s3empty" s3://acme-backups/db
PATH="$P" "$s/s3_backup_sync.sh" "$tmp/s3src" s3://acme-backups/db | grep -q "1 upload(s)" || fail "s3 dry run plan"; pass
! called "s3 sync.* --only-show-errors" || fail "s3 dry run synced"; pass
expect_status 0 env PATH="$P" "$s/s3_backup_sync.sh" -y "$tmp/s3src" s3://acme-backups/db
called "s3 sync.*--sse AES256" || fail "s3 sync without encryption"; pass

# ecr_cleanup: keeps protected tags and the newest -k, dry run deletes nothing.
out="$(PATH="$P" "$s/ecr_cleanup.sh" -k 1 shop/api 2>&1)"
grep -q "would delete.*v1" <<< "$out" && grep -q "untagged" <<< "$out" || fail "ecr plan"; pass
! grep -q "latest" <<< "$out" && ! grep -q " v2 " <<< "$out" || fail "ecr deletes a protected or kept image"; pass
! called "batch-delete-image" || fail "ecr dry run deleted"; pass
PATH="$P" "$s/ecr_cleanup.sh" -k 1 -y shop/api >/dev/null 2>&1
called "batch-delete-image.*imageDigest=sha256:aaaa" || fail "ecr -y did not delete"; pass

# pg_backup and mysql_backup: verified dumps, rotation, and a failed dump keeps the old backups.
mkdir -p "$tmp/pg" && for i in 1 2 3; do echo old > "$tmp/pg/shop-2026010${i}-000000.dump"; done
PATH="$P" "$s/pg_backup.sh" -k 2 shop "$tmp/pg" >/dev/null
[[ $(find "$tmp/pg" -name 'shop-*.dump' | wc -l) == 2 ]] || fail "pg_backup rotation"; pass
(cd "$tmp/pg" && sha256sum -c --quiet ./*.dump.sha256) || fail "pg_backup checksum"; pass
touch "$tmp/db-down"
expect_status 1 env PATH="$P" "$s/pg_backup.sh" -k 1 shop "$tmp/pg"
[[ $(find "$tmp/pg" -name 'shop-*.dump' | wc -l) == 2 && -z "$(find "$tmp/pg" -name '*.partial')" ]] || fail "failed pg dump touched old backups"; pass
expect_status 1 env PATH="$P" "$s/mysql_backup.sh" shop "$tmp/my"
[[ -z "$(find "$tmp/my" -name 'shop-*')" ]] || fail "a truncated mysql dump was kept"; pass
rm "$tmp/db-down"
expect_status 0 env PATH="$P" "$s/mysql_backup.sh" -k 3 shop "$tmp/my"
gzip -dc "$tmp"/my/shop-*.sql.gz | tail -1 | grep -q "Dump completed" || fail "mysql dump content"; pass

# k8s_rollout: dry run changes nothing; a failed rollout is undone (exit 1); a good one exits 0.
: > "$calls"
expect_status 0 env PATH="$P" "$s/k8s_rollout.sh" -n shop api registry.example.com/api:1.1
! called " set image deployment/api api=registry.example.com/api:1.1$" || fail "rollout dry run changed the image"; pass
touch "$tmp/rollout-fails"
expect_status 1 env PATH="$P" "$s/k8s_rollout.sh" -n shop -t 1m -y api registry.example.com/api:1.1
called "rollout undo deployment/api" || fail "failed rollout was not undone"; pass
rm "$tmp/rollout-fails"; : > "$calls"
expect_status 0 env PATH="$P" "$s/k8s_rollout.sh" -n shop -y api registry.example.com/api:1.1
! called "rollout undo" || fail "good rollout was undone"; pass

# k8s_node_drain: dry run is server-side only; -y cordons, drains without --force.
: > "$calls"
PATH="$P" "$s/k8s_node_drain.sh" node-1 >/dev/null
called "drain node-1 .*--dry-run=server" && ! called "cordon node-1" || fail "drain dry run"; pass
PATH="$P" "$s/k8s_node_drain.sh" -y node-1 >/dev/null
called "cordon node-1" && ! called "\-\-force" && ! called "disable-eviction" || fail "drain -y"; pass

# k8s_collect_logs: an archive readable by its owner only.
archive="$(cd "$tmp" && PATH="$P" "$s/k8s_collect_logs.sh" -n shop | awk '{print $1}')"
[[ "$(stat -c %a "$tmp/$archive")" == 600 ]] && tar -tzf "$tmp/$archive" | grep -q events.txt || fail "k8s_collect_logs archive"; pass

# with_lock: a second run is refused while the first holds the lock; -s skips quietly.
"$s/with_lock.sh" -f "$tmp/job.lock" -- sleep 3 & holder=$!; sleep 0.5
expect_status 75 "$s/with_lock.sh" -f "$tmp/job.lock" -- true
expect_status 0 "$s/with_lock.sh" -f "$tmp/job.lock" -s -- false
wait "$holder"
expect_status 3 "$s/with_lock.sh" -f "$tmp/job.lock" -- bash -c 'exit 3'
expect_status 124 "$s/with_lock.sh" -f "$tmp/job.lock" -t 1 -- sleep 5

# multi_host_run: dry run contacts no host; -y reports the failed one and exits 1.
printf 'web-01\n# comment\nbad-02\nweb-03' > "$tmp/hosts.txt"; : > "$calls"
PATH="$P" "$s/multi_host_run.sh" -f "$tmp/hosts.txt" -- uptime | grep -q "would run on web-03" || fail "multi_host dry run"; pass
! called "^ssh" || fail "multi_host dry run used ssh"; pass
out="$(PATH="$P" "$s/multi_host_run.sh" -f "$tmp/hosts.txt" -y -- uptime || true)"
grep -q "ok from web-03" <<< "$out" && grep -q "failed: bad-02 (ssh failed)" <<< "$out" || fail "multi_host -y"; pass
called "ssh -n -o BatchMode=yes" || fail "multi_host ssh options"; pass

# nginx_safe_reload: a broken config is never reloaded; a good one is reloaded and checked.
touch "$tmp/nginx-bad"; : > "$calls"
expect_status 1 env PATH="$P" "$s/nginx_safe_reload.sh" -y
! called "nginx -s reload" || fail "reloaded a broken config"; pass
rm "$tmp/nginx-bad"
expect_status 0 env PATH="$P" "$s/nginx_safe_reload.sh" -u "http://127.0.0.1:$port/" -y
called "nginx -s reload" || fail "nginx not reloaded"; pass

# journal_errors: groups messages, folds numbers, masks e-mail addresses.
out="$(PATH="$P" "$s/journal_errors.sh" || true)"
grep -q "2  nginx: upstream timed out after Nms" <<< "$out" && ! grep -q priya <<< "$out" || fail "journal_errors"; pass
expect_status 0 env PATH="$P" "$s/journal_errors.sh" -m 5

# terraform_drift_check: 0 clean, 1 drift (named), 2 when a plan cannot run.
mkdir -p "$tmp/tf/clean" "$tmp/tf/drift" "$tmp/tf/broken"
expect_status 0 env PATH="$P" "$s/terraform_drift_check.sh" "$tmp/tf/clean"
out="$(PATH="$P" "$s/terraform_drift_check.sh" "$tmp/tf/clean" "$tmp/tf/drift" || true)"
grep -q "aws_s3_bucket.logs (updated in-place)" <<< "$out" || fail "drift listed"; pass
expect_status 1 env PATH="$P" "$s/terraform_drift_check.sh" "$tmp/tf/drift"
expect_status 2 env PATH="$P" "$s/terraform_drift_check.sh" "$tmp/tf/drift" "$tmp/tf/broken"

# patch_report: runs read-only on this host and prints a JSON line.
{ "$s/patch_report.sh" -j 2>/dev/null || true; } | python3 -c 'import json,sys; json.loads(sys.stdin.readline())' || fail "patch_report json"; pass

# Personal data: synthetic values only. 234123412346 passes the Verhoeff check; ...47 does not.
mkdir -p "$tmp/pii"
cat > "$tmp/pii/app.log" <<'EOF'
signup email=priya.sharma@example.com phone=+91 9876543210
kyc aadhaar=2341 2341 2346 pan=ABCPE1234F
kyc aadhaar=2341 2341 2347
refund upi=priya.s@okicici ifsc=SBIN0001234 account=00112233445566
EOF
echo "nothing personal" > "$tmp/pii/clean.txt"
out="$("$s/pii_scan.sh" "$tmp/pii" || true)"
for k in "Aadhaar (…46)" "PAN" "Mobile" "Email" "UPI ID" "Bank a/c"; do grep -qF "$k" <<< "$out" || fail "pii_scan missed $k"; pass; done
[[ "$(grep -c Aadhaar <<< "$out")" == 2 ]] || fail "pii_scan reported an Aadhaar with a bad checksum"; pass
! grep -qE "priya|9876543210|ABCPE1234F|2346 |00112233445566" <<< "$out" || fail "pii_scan printed personal data"; pass
expect_status 1 "$s/pii_scan.sh" "$tmp/pii"
expect_status 0 "$s/pii_scan.sh" "$tmp/pii/clean.txt"
echo '^.*app\.log:' > "$tmp/pii/allow"
expect_status 0 "$s/pii_scan.sh" -a "$tmp/pii/allow" "$tmp/pii"
{ "$s/pii_scan.sh" -j "$tmp/pii" || true; } | python3 -c 'import json,sys; d=json.load(sys.stdin); assert len(d["findings"]) == 6' || fail "pii_scan json"; pass

# pii_redact: a filter, and in place only with -y.
out="$("$s/pii_redact.sh" < "$tmp/pii/app.log")"
grep -q "email=\[EMAIL\] phone=\[MOBILE\]" <<< "$out" || fail "pii_redact stream"; pass
cp "$tmp/pii/app.log" "$tmp/pii/app.log.1"; before="$(sha256sum < "$tmp/pii/app.log.1")"
expect_status 1 "$s/pii_redact.sh" "$tmp/pii/app.log.1"
[[ "$(sha256sum < "$tmp/pii/app.log.1")" == "$before" ]] || fail "pii_redact dry run changed the file"; pass
expect_status 0 "$s/pii_redact.sh" -y "$tmp/pii/app.log.1"
expect_status 0 "$s/pii_scan.sh" "$tmp/pii/app.log.1"

# retention_cleanup: dry run first, -y deletes only old matching files, refuses system folders.
mkdir -p "$tmp/exports/sub"
for f in old.csv new.csv old.txt sub/old.csv; do echo row > "$tmp/exports/$f"; done
touch -d '200 days ago' "$tmp/exports/old.csv" "$tmp/exports/old.txt" "$tmp/exports/sub/old.csv"
expect_status 1 "$s/retention_cleanup.sh" -d 180 -p '*.csv' "$tmp/exports"
[[ -e "$tmp/exports/old.csv" ]] || fail "retention dry run deleted"; pass
expect_status 0 "$s/retention_cleanup.sh" -d 180 -p '*.csv' -l "$tmp/retention.log" -y "$tmp/exports"
[[ ! -e "$tmp/exports/old.csv" && ! -e "$tmp/exports/sub/old.csv" && -e "$tmp/exports/new.csv" && -e "$tmp/exports/old.txt" ]] || fail "retention deleted the wrong files"; pass
[[ "$(grep -c deleted "$tmp/retention.log")" == 2 ]] || fail "retention log"; pass
expect_status 2 "$s/retention_cleanup.sh" -d 1 /
expect_status 2 "$s/retention_cleanup.sh" -d 1 -m 1 "$tmp"

# breach_evidence: a timeline with no visitor IPs, e-mails or query strings, and a valid manifest.
cat > "$tmp/access.log" <<'EOF'
198.51.100.4 - - [30/Oct/2026:18:05:00 +0000] "GET /account/priya.sharma@example.com/orders?token=abc HTTP/1.1" 200 512 "-" "ua"
203.0.113.7 - - [30/Oct/2026:18:10:00 +0000] "GET /api/customers/export?page=1 HTTP/1.1" 200 9000000 "-" "curl"
EOF
bundle="$("$s/breach_evidence.sh" -s "2026-10-30 18:00" -u "2026-10-30 23:00" -l "$tmp/access.log" -c "$tmp/exports" -i 203.0.113.7 -n INC-1 -o "$tmp" 2>/dev/null)"; bundle="${bundle%%$'\n'*}"
mkdir -p "$tmp/case" && tar -xzf "$bundle" -C "$tmp/case"
grep -q "IOC:203.0.113.7.*/api/customers/export.*9000000" "$tmp/case/INC-1/access-timeline.tsv" || fail "breach timeline"; pass
! grep -rqE "198\.51\.100\.4|priya|token=" "$tmp/case/INC-1" || fail "breach bundle holds personal data"; pass
(cd "$tmp/case/INC-1" && sha256sum -c --quiet manifest.sha256) || fail "breach manifest"; pass
expect_status 2 "$s/breach_evidence.sh" -s "not a date"

# Every script answers --help and -h.
for f in "$s"/*.sh; do
  grep -q -- '--help' "$f" || continue
  "$f" --help | grep -q "Usage:" || fail "$(basename "$f") --help"; pass
done

echo "scripts ok: $passed checks"
