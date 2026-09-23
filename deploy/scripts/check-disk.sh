#!/usr/bin/env bash
#
# Disk-space check for the WP Starter shared builder.
#
# Install:
#   sudo install -m 755 -o root -g root deploy/scripts/check-disk.sh /usr/local/bin/wp-starter-check-disk
#   # root's crontab — warn when free space drops under 5 GiB:
#   # */15 * * * * /usr/local/bin/wp-starter-check-disk 5 /var/lib/wp-starter
#
# Exits non-zero when free space is below the threshold or when the server
# reports itself as degraded, so cron mails the operator and monitoring can
# scrape the exit code. The server refuses writes under
# WP_STARTER_MIN_FREE_BYTES (default 2 GiB), so a warning here fires first.

set -euo pipefail

THRESHOLD_GIB="${1:-5}"
TARGET_DIR="${2:-/var/lib/wp-starter}"
HEALTH_URL="${WP_STARTER_HEALTH_URL:-http://127.0.0.1:47900/api/health}"

status=0

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "check-disk: $TARGET_DIR does not exist" >&2
  exit 2
fi

# df -Pk prints POSIX-portable 1K blocks; column 4 is available space.
available_kib="$(df -Pk "$TARGET_DIR" | awk 'NR==2 {print $4}')"
threshold_kib=$(( THRESHOLD_GIB * 1024 * 1024 ))

if (( available_kib < threshold_kib )); then
  echo "check-disk: CRITICAL $TARGET_DIR has $(( available_kib / 1024 / 1024 )) GiB free (threshold ${THRESHOLD_GIB} GiB)" >&2
  status=1
else
  echo "check-disk: ok — $TARGET_DIR has $(( available_kib / 1024 / 1024 )) GiB free"
fi

if command -v curl >/dev/null 2>&1; then
  if ! health="$(curl --fail --silent --show-error --max-time 10 "$HEALTH_URL")"; then
    echo "check-disk: CRITICAL $HEALTH_URL did not answer" >&2
    status=1
  elif ! grep -q '"status":"ok"' <<<"$health"; then
    echo "check-disk: CRITICAL server reports degraded health: $health" >&2
    status=1
  else
    echo "check-disk: server health ok"
  fi
fi

exit "$status"
