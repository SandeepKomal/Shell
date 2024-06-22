## Explanation

• DB_NAME: The name of the database to back up.

• BACKUP_DIR: The directory where the backup will be stored.

• DATE: Captures the current date and time.

• mysqldump -u root -p $DB_NAME > $BACKUP_DIR/$DB_NAME-$DATE.sql:
Dumps the database to a SQL file.

• echo "Database backup completed: $BACKUP_DIR/$DB_NAME-$DATE.sql":
Outputs a message indicating the completion of the backup.
