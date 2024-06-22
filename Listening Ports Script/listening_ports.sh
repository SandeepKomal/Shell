#!/bin/bash
# List all listening ports and the associated services
netstat -tuln | grep LISTEN
