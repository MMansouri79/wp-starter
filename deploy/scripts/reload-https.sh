#!/usr/bin/env bash
# Certbot deploy hook: reload only WP Starter when its certificate changes.
set -euo pipefail
[[ "${RENEWED_LINEAGE:-}" == /etc/letsencrypt/live/wp.mediasanat.ir ]] || exit 0
docker exec wp-starter-proxy-1 nginx -t
docker exec wp-starter-proxy-1 nginx -s reload
