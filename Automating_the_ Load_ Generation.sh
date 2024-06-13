#!/bin/bash

# Generate CPU load
stress --cpu 8 --timeout 300 &

# Generate Memory load
stress --vm 2 --vm-bytes 256M --timeout 300 &

# Generate Disk I/O load
dd if=/dev/zero of=/tmp/testfile bs=1M count=1024 oflag=direct &

# Generate Network load (requires iperf3 server)
iperf3 -c <server-ip> -t 300 &
