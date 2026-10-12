#!/bin/sh
# Root-only coordinated backup of the isolated Docker deployment.
set -eu
umask 077
app_root=${WP_STARTER_DEPLOY_ROOT:-/opt/wp-starter-system}
backup_root=${WP_STARTER_BACKUP_DIR:-/var/backups/wp-starter}
retention=${WP_STARTER_BACKUP_RETENTION_DAYS:-14}
case "$retention" in ''|*[!0-9]*) echo 'Invalid retention days' >&2; exit 1;; esac
compose() {
    docker compose --env-file /etc/wp-starter/compose.env -f "$app_root/deploy/docker/compose.yaml" "$@"
}
mkdir -p "$backup_root"
chmod 700 "$backup_root"
# Avoid overlapping backups.
exec 9>"$backup_root/.backup.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target=$(mktemp -d "$backup_root/set-$stamp-XXXXXX")
was_running=$(compose ps --status running -q app)
restore_app() {
    if [ -n "$was_running" ]; then compose start app; fi
}
trap restore_app EXIT
trap 'exit 1' HUP INT TERM
if [ -n "$was_running" ]; then compose stop app; fi
compose exec -T database pg_dump -U wp_starter -d wp_starter > "$target/database.sql"
test -s "$target/database.sql"
gzip "$target/database.sql"
tar -czf "$target/library.tar.gz" -C /var/lib/wp-starter .
cp /etc/wp-starter/server.env /etc/wp-starter/compose.env "$target/"
printf '%s\n' "$stamp" > "$target/complete"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'set-*' -mtime "+$retention" -exec rm -rf -- {} +
printf 'Completed backup: %s\n' "$target"
