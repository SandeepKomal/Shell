#!/bin/bash
DB_NAME="mydatabase"
BACKUP_DIR="/path/to/backup"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
# Perform a database backup and save it to the backup directory
mysqldump -u root -p $DB_NAME > $BACKUP_DIR/$DB_NAME-$DATE.sql
echo "Database backup completed: $BACKUP_DIR/$DB_NAME-$DATE.sql"
