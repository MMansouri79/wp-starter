#!/usr/bin/env bash
# Run with the same environment as the server; stop writers for a consistent pair.
set -euo pipefail
umask 077
backup_root="${WP_STARTER_BACKUP_DIR:-/var/backups/wp-starter}"
retention_days="${WP_STARTER_BACKUP_RETENTION_DAYS:-14}"
[[ "$retention_days" =~ ^[0-9]+$ ]] || { echo "Invalid backup retention" >&2; exit 1; }
[[ -n "${WP_STARTER_DATABASE_URL:-${DATABASE_URL:-}}" ]] || { echo "Database URL is required" >&2; exit 1; }
mkdir -p -- "$backup_root"
backup_root="$(realpath -e -- "$backup_root")"
source_dir="$(realpath -e -- "${WP_STARTER_DATA_DIR:-/var/lib/wp-starter}")"
[[ "$source_dir" != / && "$backup_root" != / && "$backup_root" != "$source_dir" && "$backup_root" != "$source_dir/"* ]] || {
  echo "Backup root must be outside the shared library" >&2; exit 1;
}
scripts_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
service="${WP_STARTER_BACKUP_SERVICE:-wp-starter-server}"
was_active=false
if systemctl is-active --quiet "$service"; then was_active=true; fi
# Restart even if a dump or archive fails; incomplete sets lack the completion marker.
trap 'if $was_active; then systemctl start "$service"; fi' EXIT
systemctl stop "$service"
export WP_STARTER_BACKUP_DIR="$backup_root/set-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -- "$WP_STARTER_BACKUP_DIR"
"$scripts_dir/wp-starter-backup"
"$scripts_dir/wp-starter-backup-files"
touch "$WP_STARTER_BACKUP_DIR/complete"
if $was_active; then systemctl start "$service"; fi
trap - EXIT
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'set-*' -mtime "+$retention_days" -exec rm -rf -- {} +
echo "backup-system: wrote complete set $WP_STARTER_BACKUP_DIR"
