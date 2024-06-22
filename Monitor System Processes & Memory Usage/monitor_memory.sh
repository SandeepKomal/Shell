#!/bin/bash
# Monitor system processes and their memory usage
ps aux --sort=-%mem | head -n 10
