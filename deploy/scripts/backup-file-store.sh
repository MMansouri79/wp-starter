#!/usr/bin/env bash
# Back up a quiescent shared library. Use backup-system.sh for a consistent DB/file pair.
set -euo pipefail
umask 077

source_dir="$(realpath -e -- "${WP_STARTER_DATA_DIR:-/var/lib/wp-starter}")"
backup_dir="${WP_STARTER_BACKUP_DIR:-/var/backups/wp-starter}"
retention_days="${WP_STARTER_BACKUP_RETENTION_DAYS:-14}"
[[ "$source_dir" != / && -d "$source_dir" && "$retention_days" =~ ^[0-9]+$ ]] || {
  echo "backup-file-store: invalid source or retention" >&2; exit 1;
}
mkdir -p -- "$backup_dir"
backup_dir="$(realpath -e -- "$backup_dir")"
[[ "$backup_dir" != "$source_dir" && "$backup_dir" != "$source_dir/"* ]] || {
  echo "backup-file-store: backup directory must be outside the shared library" >&2; exit 1;
}
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/wp-starter-files-$timestamp.tar.gz"
partial="$target.partial"
trap 'rm -f -- "$partial"' EXIT
tar -C "$source_dir" -czf "$partial" .
tar -tzf "$partial" >/dev/null
mv -- "$partial" "$target"
trap - EXIT
find "$backup_dir" -maxdepth 1 -type f -name 'wp-starter-files-*.tar.gz' -mtime "+$retention_days" -delete
echo "backup-file-store: wrote $target"
