#!/bin/sh
set -eu
umask 077
release=$1
case "$release" in plugin-updates-20261020-????????) ;; *) exit 1 ;; esac
root=/opt/wp-starter-system
source=/opt/wp-starter-releases/$release
work=/home/adminuser/wp-starter-deploy/plugin-updates
compose_env=/etc/wp-starter/compose.env
rollback=/var/backups/wp-starter/releases/$release
compose() { docker compose --env-file "$compose_env" -f "$root/deploy/docker/compose.yaml" -f "$root/deploy/docker/compose.https.yaml" "$@"; }
health() { curl -fsS --max-time 5 http://192.168.200.140:47901/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("status")=="ok" and d.get("database")=="ok" and d.get("disk",{}).get("ok") else 1)'; }
wait_health() { for attempt in $(seq 1 36); do if health >/dev/null 2>&1; then return 0; fi; sleep 3; done; return 1; }
active_jobs() { docker exec wp-starter-database-1 psql -U wp_starter -d wp_starter -tAc "SELECT count(*) FROM builds WHERE status IN ('queued','running');"; }
test "$(cat "$root/DEPLOYED-COMMIT")" = catalog-20261014-364d5ae5
(cd "$root" && sha256sum -c "$work/baseline.sha256")
test "$(active_jobs)" = 0
health >/dev/null
grep -q '^# fail 0' "$work/linux-check.log"
grep -q '^# skipped 0' "$work/linux-check.log"
docker image inspect "wp-starter-server:$release" >/dev/null
test ! -e "$rollback"
mkdir -p "$rollback"
cp -p "$compose_env" "$rollback/compose.env"
docker inspect wp-starter-app-1 --format '{{.Config.Image}}' > "$rollback/previous-image"
tar --exclude=node_modules --exclude=.git --exclude=artifacts --exclude=builds --exclude=private-packages -czf "$rollback/source.tar.gz" -C "$root" .
/usr/local/bin/wp-starter-backup-docker
wait_health
backup=$(find /var/backups/wp-starter -mindepth 1 -maxdepth 1 -type d -name 'set-*' | sort | tail -1)
test -f "$backup/complete"
printf '%s\n' "$backup" > "$rollback/paired-backup"
changed=false
stopped=false
recover() {
  result=$?
  trap - EXIT
  if test "$result" != 0; then
    echo 'Activation failed; restoring the previous starter app.'
    if test "$changed" = true; then cp -p "$rollback/compose.env" "$compose_env"; tar -xzf "$rollback/source.tar.gz" -C "$root"; fi
    if test "$stopped" = true; then compose up -d --no-deps --no-build app || true; compose exec -T proxy nginx -s reload || true; fi
  fi
  exit "$result"
}
trap recover EXIT
compose stop app
stopped=true
test "$(active_jobs)" = 0
changed=true
(cd "$root" && sha256sum -c "$work/baseline.sha256")
tar -cf - -C "$source" -T "$work/files.txt" | tar -xf - -C "$root"
sed -i "s/^WP_STARTER_RELEASE=.*/WP_STARTER_RELEASE=$release/" "$compose_env"
compose up -d --no-deps --no-build app
proxy_ready=false
for attempt in $(seq 1 36); do if compose exec -T proxy nginx -t && compose exec -T proxy nginx -s reload; then proxy_ready=true; break; fi; sleep 3; done
test "$proxy_ready" = true
wait_health
url=https://wp.mediasanat.ir:2053
curl -fsS --resolve wp.mediasanat.ir:2053:192.168.200.140 "$url/login.html" >/dev/null
printf '%s\n' "$release" > "$root/DEPLOYED-COMMIT"
trap - EXIT
echo DEPLOYED
health
