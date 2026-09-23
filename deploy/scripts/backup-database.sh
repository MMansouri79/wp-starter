#!/usr/bin/env bash
#
# Nightly PostgreSQL backup for the WP Starter shared builder.
#
# Install:
#   sudo install -m 750 -o root -g root deploy/scripts/backup-database.sh /usr/local/bin/wp-starter-backup
#   sudo install -d -o postgres -g postgres /var/backups/wp-starter
#   # root's crontab:
#   # 15 3 * * * /usr/local/bin/wp-starter-backup >> /var/log/wp-starter-backup.log 2>&1
#
# The database holds accounts, ownership, and item metadata only. The large
# payloads live in the shared file store, which is backed up separately (see
# docs/SERVER-DEPLOYMENT.md).

set -euo pipefail

DATABASE_URL="${WP_STARTER_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_DIR="${WP_STARTER_BACKUP_DIR:-/var/backups/wp-starter}"
RETENTION_DAYS="${WP_STARTER_BACKUP_RETENTION_DAYS:-14}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "backup-database: set WP_STARTER_DATABASE_URL or DATABASE_URL" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "backup-database: pg_dump is not installed" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/wp-starter-$timestamp.sql.gz"
partial="$target.partial"

# --format=plain keeps the dump readable with zcat/grep during an emergency.
# The trap removes a half-written file so a failed run never looks like a good backup.
trap 'rm -f "$partial"' EXIT

pg_dump --no-owner --no-privileges --format=plain "$DATABASE_URL" | gzip -9 > "$partial"
mv "$partial" "$target"
trap - EXIT

if [[ ! -s "$target" ]]; then
  echo "backup-database: $target is empty" >&2
  exit 1
fi

echo "backup-database: wrote $target ($(du -h "$target" | cut -f1))"

# Retention: delete dumps older than the window, then report what remains.
find "$BACKUP_DIR" -maxdepth 1 -name 'wp-starter-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -delete
echo "backup-database: $(find "$BACKUP_DIR" -maxdepth 1 -name 'wp-starter-*.sql.gz' -type f | wc -l) dump(s) retained"
