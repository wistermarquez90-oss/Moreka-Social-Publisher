#!/bin/sh
set -eu
PROJECT_DIR=${PROJECT_DIR:-/opt/moreka}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/moreka}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"
docker compose exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction moreka' | gzip > "$BACKUP_DIR/mysql-$STAMP.sql.gz"
docker compose exec -T app tar -C /app/var/storage -cf - . | gzip > "$BACKUP_DIR/files-$STAMP.tar.gz"
find "$BACKUP_DIR" -type f -mtime +14 -delete
printf 'Backup completed: %s\n' "$STAMP"
