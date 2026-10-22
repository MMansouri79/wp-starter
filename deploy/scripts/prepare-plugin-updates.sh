#!/bin/sh
set -eu
release=$1
expected=$2
case "$release" in plugin-updates-20261020-????????) ;; *) exit 1 ;; esac
work=/home/adminuser/wp-starter-deploy/plugin-updates
source=/opt/wp-starter-releases/$release
test "$(cat /opt/wp-starter-system/DEPLOYED-COMMIT)" = catalog-20261014-364d5ae5
(cd /opt/wp-starter-system && sha256sum -c "$work/baseline.sha256")
test "$(sha256sum "$work/patch.tar.gz" | cut -d' ' -f1)" = "$expected"
test ! -e "$source"
mkdir -p "$source"
tar --exclude=node_modules --exclude=.git --exclude=artifacts --exclude=builds --exclude=private-packages -cf - -C /opt/wp-starter-system . | tar -xf - -C "$source"
tar -xzf "$work/patch.tar.gz" -C "$source"
node_image=wp-starter-server:catalog-20261014-364d5ae5
docker run --rm --network none --user 0 --entrypoint node -v "$source:/release" -v "$work:/work:ro" "$node_image" /work/patch-overlay.mjs
docker build --target verification -f "$source/deploy/docker/Dockerfile.plugin-updates" -t "wp-starter-plugin-update-verification:$release" "$source"
network=wp-starter-plugin-update-test
cleanup() { docker rm -f "$network-db" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$network" >/dev/null
docker run -d --name "$network-db" --network "$network" --memory 512m --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=verification -e POSTGRES_DB=verification -e POSTGRES_PASSWORD=synthetic-test-password postgres:15-alpine >/dev/null
ready=false
for attempt in $(seq 1 30); do if docker exec "$network-db" pg_isready -U verification -d verification >/dev/null 2>&1; then ready=true; break; fi; sleep 1; done
test "$ready" = true
log=$work/linux-check.log
if docker run --rm --network "$network" --memory 2g --cpus 2 -e WP_STARTER_TEST_PG_URL="postgres://verification:synthetic-test-password@$network-db:5432/verification" "wp-starter-plugin-update-verification:$release" sh -c 'npm run check && npm run verify:artifacts' > "$log" 2>&1; then
  grep -E '^# (tests|pass|fail|skipped)' "$log"
  grep -q '^# fail 0' "$log"
  grep -q '^# skipped 0' "$log"
else
  tail -65 "$log"
  exit 1
fi
docker build --target runtime -f "$source/deploy/docker/Dockerfile.plugin-updates" -t "wp-starter-server:$release" "$source"
echo READY
