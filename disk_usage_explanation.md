• THRESHOLD: Sets the disk usage percentage threshold.
• df -H: Lists disk usage in human-readable format.
• grep -vE '^Filesystem|tmpfs|cdrom': Filters out unnecessary lines.
• awk '{ print $5 " " $1 }': Extracts the usage percentage and partition name.
• while read output: Iterates over each line of the filtered output.
• usage=$(echo $output | awk '{ print $1}' | cut -d'%' -f1): Extracts the usage
percentage.
• partition=$(echo $output | awk '{ print $2 }'): Extracts the partition name.
• if [ $usage -ge $THRESHOLD ]; then: Checks if the usage exceeds the threshold.
• echo "Warning: Disk usage on 𝑝𝑎𝑟𝑡𝑖𝑡𝑖𝑜𝑛𝑖𝑠𝑎𝑡{usage}%": Prints a warning message.
