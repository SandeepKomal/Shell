#!/usr/bin/env bash
# Report pending package updates on this host: how many, how many are security
# fixes, and whether a reboot is needed for the running kernel or libraries.
# It only reads: apt-get -s simulates, dnf/yum/zypper use their metadata
# cache. Refresh the package lists first (apt-get update) for current results;
# this script does not, because that changes the host.
# Run it from cron or through multi_host_run.sh for a fleet view.
#
# Usage: patch_report.sh [-j] [-l]
#   -j  one line of JSON (host, manager, updates, security, reboot_required)
#   -l  also list the packages with updates
# Example: multi_host_run.sh -f all.txt -y -- /opt/scripts/patch_report.sh -j
# Exit:  0 up to date, 1 security updates pending or a reboot is required,
#        2 no supported package manager (apt, dnf, yum, zypper).
set -euo pipefail

usage() { sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p}' "$0"; }
[[ "${1:-}" == "--help" ]] && { usage; exit 0; }

json=0 list=0
while getopts ":jlh" opt; do
  case "$opt" in
    j) json=1 ;;
    l) list=1 ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

pkgs="" security=0 reboot=false
if command -v apt-get >/dev/null; then
  manager=apt
  # -s prints "Inst pkg [old] (new suite...)" lines without changing anything or taking the dpkg lock.
  sim="$(LC_ALL=C apt-get -s -o Debug::NoLocking=true dist-upgrade 2>/dev/null || true)"
  pkgs="$(awk '/^Inst / {print $2}' <<< "$sim")"
  security=$(grep -c '^Inst .*-security' <<< "$sim" || true)
  [[ -e /var/run/reboot-required ]] && reboot=true
elif command -v dnf >/dev/null || command -v yum >/dev/null; then
  manager=$(command -v dnf >/dev/null && echo dnf || echo yum)
  # check-update exits 100 when updates exist; that is not an error here.
  out="$(timeout 300 "$manager" -q check-update 2>/dev/null || true)"
  pkgs="$(awk 'NF == 3 && $1 ~ /\./ {print $1}' <<< "$out")"
  security=$(timeout 300 "$manager" -q updateinfo list --security 2>/dev/null | awk 'NF >= 3' | wc -l || true)
  if command -v needs-restarting >/dev/null; then needs-restarting -r >/dev/null 2>&1 || reboot=true; fi
elif command -v zypper >/dev/null; then
  manager=zypper
  out="$(timeout 300 zypper --non-interactive --no-refresh list-updates 2>/dev/null || true)"
  pkgs="$(awk -F'|' '$1 ~ /^v / {gsub(/ /, "", $3); print $3}' <<< "$out")"
  security=$(timeout 300 zypper --non-interactive --no-refresh list-patches --category security 2>/dev/null | grep -c '| needed' || true)
  zypper needs-rebooting >/dev/null 2>&1 || reboot=true
else
  echo "patch_report: no apt, dnf, yum or zypper on this host" >&2
  exit 2
fi
updates=$(grep -c . <<< "$pkgs" || true)

# A newer kernel installed than the one running also means a reboot is due.
running="$(uname -r)"
newest="$(find /boot -maxdepth 1 -name 'vmlinuz-*' -printf '%f\n' 2>/dev/null | sed 's/^vmlinuz-//' | sort -V | tail -1)"
[[ -n "$newest" && "$newest" != "$running" ]] && reboot=true

host="$(hostname)"
if (( json )); then
  printf '{"host":"%s","manager":"%s","updates":%d,"security":%d,"reboot_required":%s,"kernel":"%s"}\n' \
    "$host" "$manager" "$updates" "$security" "$reboot" "$running"
else
  echo "$host ($manager): $updates update(s), $security security, reboot required: $reboot (kernel $running${newest:+, newest installed $newest})"
  if (( list )) && [[ -n "$pkgs" ]]; then awk '{print "  " $0}' <<< "$pkgs"; fi
fi
if (( security > 0 )) || [[ "$reboot" == true ]]; then exit 1; fi
