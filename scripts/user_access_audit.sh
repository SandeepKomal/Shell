#!/usr/bin/env bash
# Audit who can log in to this host and who has root, for access reviews and
# hardening checks: accounts with a login shell, UID 0 accounts other than
# root, members of sudo/wheel, sudoers entries without a password, accounts
# with no password, and each account's last login. Read-only.
#
# Usage: sudo user_access_audit.sh     (without root, password checks are skipped)
# Exit:  0 nothing risky found, 1 findings that need a look.
set -euo pipefail

[[ "${1:-}" == "-h" ]] && { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }
findings=0
flag() { echo "  ! $*"; findings=1; }

echo "Accounts with a login shell:"
while IFS=: read -r user _ uid _ _ home shell; do
  case "$shell" in */nologin|*/false|"") continue ;; esac
  last="$(lastlog -u "$user" 2>/dev/null | awk 'NR==2 { $1=""; print }' | sed 's/^ *//')"
  printf '  %-16s uid=%-6s %-22s last login: %s\n' "$user" "$uid" "$shell" "${last:-unknown}"
  [[ "$uid" == 0 && "$user" != root ]] && flag "$user has UID 0: a second root account"
  [[ -d "$home/.ssh" && -f "$home/.ssh/authorized_keys" ]] && echo "      $(grep -cv '^\s*#' "$home/.ssh/authorized_keys" 2>/dev/null || echo 0) SSH key(s) authorised"
done < /etc/passwd

echo
echo "Members of sudo / wheel / admin:"
for g in sudo wheel admin; do
  members="$(getent group "$g" | cut -d: -f4)"
  [[ -n "$members" ]] && echo "  $g: $members"
done

echo
echo "Sudo rules without a password (NOPASSWD):"
if [[ -r /etc/sudoers ]]; then
  nopass="$(grep -rhs 'NOPASSWD' /etc/sudoers /etc/sudoers.d 2>/dev/null | grep -v '^\s*#' || true)"
  if [[ -n "$nopass" ]]; then while IFS= read -r l; do flag "$l"; done <<< "$nopass"; else echo "  none"; fi
else
  echo "  skipped: run as root to read /etc/sudoers"
fi

echo
echo "Accounts with an empty password:"
if [[ -r /etc/shadow ]]; then
  empty="$(awk -F: '$2 == "" { print $1 }' /etc/shadow)"
  if [[ -n "$empty" ]]; then while IFS= read -r u; do flag "$u has no password"; done <<< "$empty"; else echo "  none"; fi
else
  echo "  skipped: run as root to read /etc/shadow"
fi

exit "$findings"
