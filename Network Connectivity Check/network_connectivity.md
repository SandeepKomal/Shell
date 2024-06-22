## Explanation

• HOST: The hostname to check.

• OUTPUT_FILE: The file to write the output to.

• ping -c 1 $HOST &> /dev/null: Pings the host once, suppressing output.

• echo "$HOST is reachable" >> $OUTPUT_FILE: Writes to the output file if the host
is reachable.

• echo "$HOST is not reachable" >> $OUTPUT_FILE: Writes to the output file if the
host is not reachable.
