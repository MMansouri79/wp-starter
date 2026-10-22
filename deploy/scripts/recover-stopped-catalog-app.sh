#!/bin/sh
set -eu
docker stop wp-starter-app-1 >/dev/null
test "$(docker inspect wp-starter-app-1 --format '{{.State.Running}}')" = false
lock=/var/lib/wp-starter/server-running.lock
if test -f "$lock"; then
    mkdir -p /var/backups/wp-starter/releases/catalog-20261014-6720ad1f
    mv -- "$lock" /var/backups/wp-starter/releases/catalog-20261014-6720ad1f/stale-server-running.lock
fi
docker start wp-starter-app-1 >/dev/null
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 5 http://192.168.100.140:47901/api/health; then exit 0; fi
    sleep 2
done
exit 1
