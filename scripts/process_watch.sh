#!/usr/bin/env bash
set -euo pipefail
LIMIT="${1:-80}"
echo "Top processes by CPU:"
ps -eo pid,user,comm,%cpu,%mem --sort=-%cpu | head -n 11
echo
echo "Top processes by memory:"
ps -eo pid,user,comm,%cpu,%mem --sort=-%mem | head -n 11
echo
echo "Load average:"
uptime
echo
echo "Memory:"
free -h
echo
echo "Processes over ${LIMIT}% CPU:"
ps -eo pid,user,comm,%cpu --no-headers | awk -v limit="$LIMIT" '$4 >= limit {print}'
