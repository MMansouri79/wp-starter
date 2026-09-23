# Server deployment

`apps/server/` is the hosted, multi-user version of the Builder. It runs one canonical shared library directory plus a database for accounts, ownership, and item metadata, and it serves the same Builder UI the local GUI uses.

This document covers a single-VPS deployment: PostgreSQL, the Node server behind nginx with Let's Encrypt HTTPS, systemd supervision, backups, and disk monitoring.

## What is shared, and what is not

Shared through the server:

- package ZIPs, configuration snapshots, build profiles, design-system resources, portable templates, sample content, and built starter ZIPs
- ownership metadata: who uploaded or created each item

Not changed by hosting:

- Configuration snapshots still contain only exporter-whitelisted portable data. Sharing them does not widen the security boundary.
- Private production packages, credentials, and non-portable plugin state stay excluded, exactly as in the offline workflow.
- The CLI and the local GUI are untouched and keep working against a local library.

Everyone signed in can read the whole shared library. Only the account that created an item may edit, replace, or delete it. Administrators manage people and invitations; they gain no rights over another account's items. Items imported through the CLI have no owner and can only be cleaned up by an administrator.

## 1. Prerequisites

- A Linux VPS with sudo (Debian/Ubuntu commands below)
- Node.js 20 or newer
- PostgreSQL 14 or newer
- nginx
- A DNS record for the subdomain, e.g. `builder.example.com` → the server IP

```bash
sudo apt update
sudo apt install -y postgresql nginx certbot python3-certbot-nginx git curl
# Install Node 20+ from your distribution or nodesource, then verify:
node --version
```

## 2. Database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE wp_starter LOGIN PASSWORD 'replace-with-a-long-random-password';
CREATE DATABASE wp_starter OWNER wp_starter;
SQL
```

SQLite is supported instead of PostgreSQL for a small single-user setup by setting `WP_STARTER_DATABASE_URL=sqlite:/var/lib/wp-starter/server.sqlite`. PostgreSQL is recommended for anything shared: it handles concurrent sessions and build workers properly.

## 3. Service account and shared file store

```bash
sudo useradd --system --home /var/lib/wp-starter --shell /usr/sbin/nologin wpstarter
sudo install -d -o wpstarter -g wpstarter -m 750 /var/lib/wp-starter
```

The shared file store holds every package, snapshot, and build artifact. Budget disk space for it and see step 8 for monitoring.

## 4. Deploy the application

```bash
sudo install -d -o "$USER" -g "$USER" /opt/wp-starter-system
git clone <your-repository-url> /opt/wp-starter-system
cd /opt/wp-starter-system
npm ci
npm run build      # compiles builder-core, the CLI, and apps/server
npm test           # 49+ server tests plus builder-core and GUI suites
```

`apps/server/dist` must exist before the service starts. Re-run `npm ci && npm run build` after every deploy.

## 5. Configuration

```bash
sudo install -d -o root -g root -m 755 /etc/wp-starter
sudo install -m 640 -o root -g wpstarter apps/server/.env.example /etc/wp-starter/server.env
sudo -e /etc/wp-starter/server.env
```

Set at minimum:

| Variable | Value |
|---|---|
| `WP_STARTER_SESSION_SECRET` | at least 32 characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `WP_STARTER_DATABASE_URL` | `postgres://wp_starter:...@127.0.0.1:5432/wp_starter` |
| `WP_STARTER_DATA_DIR` | `/var/lib/wp-starter` |
| `WP_STARTER_BASE_URL` | `https://builder.example.com` |
| `WP_STARTER_TRUST_PROXY` | `true` (nginx is in front) |
| `WP_STARTER_ADMIN_EMAIL` / `WP_STARTER_ADMIN_PASSWORD` | the first administrator, created once on first boot |

`WP_STARTER_BASE_URL` starting with `https://` enables `Secure` cookies and HSTS automatically. Keep `WP_STARTER_SERVER_HOST=127.0.0.1` so only nginx can reach the app.

Registration is invite-only by default (`WP_STARTER_ALLOW_OPEN_REGISTRATION=false`). Leave it that way for a client-facing deployment; open registration only ever grants the least-privileged `client` role.

## 6. systemd

```bash
sudo cp deploy/systemd/wp-starter-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wp-starter-server
sudo systemctl status wp-starter-server
journalctl -u wp-starter-server -f
```

Migrations run automatically on start and are recorded in `schema_migrations`; the log shows `Applied migration N (name)` for each one applied. To run them without starting the server:

```bash
sudo -u wpstarter env $(grep -v '^#' /etc/wp-starter/server.env | xargs) \
  node /opt/wp-starter-system/apps/server/dist/index.js migrate
```

Health check:

```bash
curl -fsS http://127.0.0.1:47900/api/health
```

It returns `200` with `{"status":"ok",...}` when the database answers and free disk space is above the reserve, and `503` with `"degraded"` otherwise.

## 7. nginx and HTTPS

```bash
sudo cp deploy/nginx/wp-starter.conf /etc/nginx/sites-available/wp-starter.conf
sudo sed -i 's/builder.example.com/your-real-subdomain/g' /etc/nginx/sites-available/wp-starter.conf
sudo ln -s /etc/nginx/sites-available/wp-starter.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

Obtain the certificate after the HTTP server block is live:

```bash
sudo certbot --nginx -d builder.example.com --agree-tos -m you@example.com --redirect
sudo systemctl list-timers | grep certbot   # renewal is automatic
```

Two settings in the server block matter for this app:

- `client_max_body_size 1100m` must stay above `WP_STARTER_MAX_UPLOAD_BYTES` (default 1024 MiB), or nginx rejects large package archives before Node sees them.
- `proxy_request_buffering off` streams uploads straight to Node instead of buffering whole ZIPs to a temporary file first.

Builds are asynchronous: the client POSTs a job, receives an id immediately, and polls for staged progress, so the proxy read timeout only needs to cover a normal API round trip.

If the VPS also runs Plesk, add this as an additional server block and keep its own port; do not edit Plesk's own configuration files.

## 8. Backups and disk monitoring

Database (accounts, ownership, item metadata):

```bash
sudo install -m 750 -o root -g root deploy/scripts/backup-database.sh /usr/local/bin/wp-starter-backup
sudo install -d -o root -g root -m 750 /var/backups/wp-starter
sudo crontab -e
# add:
# 15 3 * * * /usr/local/bin/wp-starter-backup >> /var/log/wp-starter-backup.log 2>&1
```

Set `WP_STARTER_BACKUP_DIR` and `WP_STARTER_BACKUP_RETENTION_DAYS` to override the defaults (14 days). Verify a dump is readable before trusting it:

```bash
zcat /var/backups/wp-starter/wp-starter-*.sql.gz | head -20
```

Shared file store (packages, snapshots, build artifacts) — back up `/var/lib/wp-starter` with your usual filesystem snapshot or `rsync` job. `pg_dump` alone is not a complete backup.

Disk space:

```bash
sudo install -m 755 -o root -g root deploy/scripts/check-disk.sh /usr/local/bin/wp-starter-check-disk
sudo crontab -e
# add:
# */15 * * * * /usr/local/bin/wp-starter-check-disk 5 /var/lib/wp-starter
```

The script exits non-zero when free space drops below the threshold or when `/api/health` reports degraded, so cron mails the operator. The server itself refuses new uploads and builds with `507 disk_full` once free space falls under `WP_STARTER_MIN_FREE_BYTES` (default 2 GiB), which means the warning above fires first.

Build artifacts are pruned automatically after `WP_STARTER_BUILD_RETENTION_HOURS` (default 720 hours = 30 days), so the file store does not grow without bound.

## 9. First run and acceptance

1. Open `https://builder.example.com` — you are redirected to the login page.
2. Sign in with `WP_STARTER_ADMIN_EMAIL` / `WP_STARTER_ADMIN_PASSWORD`, then change that password immediately.
3. Open **Admin** and create an invite code for each client, or create team accounts directly.
4. Have a client register with the invite code and sign in.
5. Verify cross-visibility: upload a package as user A, sign in as user B in a second browser, confirm the item is visible with a **Shared by** badge and that its controls are read-only.
6. Confirm user B cannot delete user A's item (the API answers `403 read_only`).
7. Queue a build and watch staged progress until the artifact is downloadable.

## 10. Upgrade

```bash
cd /opt/wp-starter-system
git pull
npm ci
npm run build
npm test
sudo systemctl restart wp-starter-server
```

Migrations apply on start. An in-flight build cannot be resumed across a restart, so it is marked failed with an actionable message; re-queue it from the Build History screen.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `WP_STARTER_SESSION_SECRET must be set to at least 32 characters` | the secret is missing or too short in `/etc/wp-starter/server.env` |
| Health returns `503` with `"database":"unavailable"` | wrong `WP_STARTER_DATABASE_URL`, or PostgreSQL is not running |
| Health returns `503` with `"disk":{"ok":false}` | free space is under `WP_STARTER_MIN_FREE_BYTES`; prune build artifacts or grow the volume |
| Uploads fail at ~1 MiB | nginx `client_max_body_size` is below `WP_STARTER_MAX_UPLOAD_BYTES` |
| `403 csrf_failed` on a write | the `wp_starter_csrf` cookie is missing or stale; reload the page to refresh it |
| Login succeeds but every request redirects to the login page | the session cookie is not being sent; check that `WP_STARTER_BASE_URL` matches the public URL and that `Secure` cookies are not required over plain HTTP |
| Builds stay queued forever | `WP_STARTER_BUILD_WORKERS` is 0, or the service is not running; check `journalctl -u wp-starter-server` |
