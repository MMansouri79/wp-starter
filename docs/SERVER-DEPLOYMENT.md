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
- Node.js 22.13 or newer (the server imports the built-in `node:sqlite` module, which is unflagged only from 22.13)
- PostgreSQL 14 or newer
- nginx
- A DNS record for the subdomain, e.g. `builder.example.com` → the server IP

```bash
sudo apt update
sudo apt install -y postgresql nginx certbot python3-certbot-nginx git curl
# Install Node 22.13+ from your distribution or nodesource, then verify:
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

Failed sign-ins and invitation redemption are limited per client IP and normalized email. `WP_STARTER_LOGIN_MAX_ATTEMPTS` defaults to 10 and `WP_STARTER_LOGIN_LOCKOUT_SECONDS` to 900. Counters are bounded, expire in this process, and reset on restart. Trust forwarded IPs only behind the configured nginx proxy. Run one server process; API mutations and build finalization are serialized in-process. Stop the service before using the CLI to change its library; restart reconciles metadata and preserves owners.

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

Shared file store (packages, snapshots, fonts, sample assets, profiles, and builds): `pg_dump` alone is not a complete backup. Install the file-store script and the coordinated PostgreSQL backup wrapper:

```bash
sudo install -m 750 -o root -g root deploy/scripts/backup-file-store.sh /usr/local/bin/wp-starter-backup-files
sudo install -m 750 -o root -g root deploy/scripts/backup-system.sh /usr/local/bin/wp-starter-backup-system
sudo systemd-run --wait --pipe --collect --unit=wp-starter-backup \
  --property=EnvironmentFile=/etc/wp-starter/server.env /usr/local/bin/wp-starter-backup-system
```

Use this coordinated command in root's cron instead of the database-only job above. It stops the app, dumps PostgreSQL, archives the file store into one `set-*` directory, marks success with `complete`, and restarts the previously running service even on failure. Expect brief downtime; prevent CLI or other writers during the backup. Both scripts inherit the server environment through systemd, including its database URL. Completed sets and incomplete sets older than the configured retention are removed. Archive files use private permissions. PostgreSQL is required by this wrapper; for SQLite, stop the service and archive the entire store, including its database.

Restore only a set with a `complete` marker. Stop the service and restore into a fresh empty data directory and database:

```bash
sudo systemctl stop wp-starter-server
# Replace these paths with the selected matching backup set.
sudo tar -xzf /var/backups/wp-starter/set-TIMESTAMP/wp-starter-files-TIMESTAMP.tar.gz -C /var/lib/wp-starter
zcat /var/backups/wp-starter/set-TIMESTAMP/wp-starter-TIMESTAMP.sql.gz | psql "$WP_STARTER_DATABASE_URL"
sudo chown -R wpstarter:wpstarter /var/lib/wp-starter
sudo systemctl start wp-starter-server
```

Load the database URL from the protected service environment; never paste credentials into shared logs. Verify accounts, ownership, package checksums, and a downloaded build after restore. The clean-VPS backup/restore rehearsal is tracked separately in `docs/planning/V1-DEPLOYMENT-ACCEPTANCE.md`.

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

## Docker deployment alongside an existing application

When another application already owns ports 80/443, use `deploy/docker/compose.yaml`.
This creates a separate `wp-starter` Compose project, PostgreSQL database and networks.
Only its proxy publishes a host port; neither the app nor PostgreSQL publishes a port.
Run exactly one app container. The CRM's Compose project and database remain separate.

Copy the current source tree to `/opt/wp-starter-system` (include uncommitted changes when
deploying from staging, exclude secrets and Windows `node_modules`/compiled output).
Copy the existing builder library to `/var/lib/wp-starter` and give UID/GID 1000 ownership,
which matches the image's `node` user. The original Windows library should remain available
until migration acceptance. Imported library items appear without an owner and are
manageable by administrators. Old offline build ZIPs remain files; they do not become
hosted build-history jobs. Build new artifacts through the hosted UI.

Create root-only `/etc/wp-starter/compose.env`:

```dotenv
WP_STARTER_DB_PASSWORD=GENERATED_HEX_PASSWORD
WP_STARTER_LAN_IP=192.168.100.140
WP_STARTER_LAN_PORT=47901
WP_STARTER_RELEASE=YOUR_RELEASE_ID
```

Create root-only `/etc/wp-starter/server.env` with:

```dotenv
WP_STARTER_SESSION_SECRET=GENERATED_SECRET_AT_LEAST_32_CHARACTERS
WP_STARTER_BASE_URL=http://192.168.100.140:47901
WP_STARTER_SECURE_COOKIES=false
WP_STARTER_DATABASE_SSL=false
WP_STARTER_ADMIN_EMAIL=admin@mediasanat.ir
WP_STARTER_ADMIN_PASSWORD=GENERATED_INITIAL_PASSWORD
WP_STARTER_ALLOW_OPEN_REGISTRATION=false
WP_STARTER_MAX_UPLOAD_BYTES=1073741824
WP_STARTER_ACCOUNT_QUOTA_BYTES=21474836480
WP_STARTER_MIN_FREE_BYTES=5368709120
WP_STARTER_BUILD_WORKERS=1
WP_STARTER_BUILD_RETENTION_HOURS=720
WP_STARTER_LOG_LEVEL=info
```

Generate fresh secrets on the server; do not copy staging sessions/passwords. The DB
password should be hex so it is safe in the database URL. Keep both environment files
mode 600. Remove both bootstrap administrator variables after the administrator exists.

```bash
cd /opt/wp-starter-system
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml build app
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml up -d
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml ps
curl -fsS http://192.168.100.140:47901/api/health
```

Docker's restart policy brings containers back after reboot. The image builds TypeScript
on Linux and installs only production dependencies in the final image. Its build stage
has a separate `verification` target with PHP and shell utilities for the full check:

```bash
sudo docker build --target verification -t wp-starter-verification -f deploy/docker/Dockerfile .
sudo docker run --rm wp-starter-verification
```

Use a disposable PostgreSQL database and `WP_STARTER_TEST_PG_URL` to run the optional
PostgreSQL integration test. Do not target the production database for tests.
If the Alpine CDN is unreachable, select an accessible official mirror through
`--build-arg ALPINE_MIRROR=https://dl-4.alpinelinux.org/alpine` for this test-only stage.
The app has a 2 GiB memory limit and one
build worker; PostgreSQL has a 1 GiB limit. Raise these only after measuring usage.

For coordinated backups, install `deploy/scripts/backup-docker.sh` as
`/usr/local/bin/wp-starter-backup-docker` (root-owned, mode 750). Schedule it as root:

```cron
15 3 * * * root /usr/local/bin/wp-starter-backup-docker >> /var/log/wp-starter-backup-docker.log 2>&1
```

The script stops the app, archives the library, dumps its isolated database and includes
protected configuration. It restarts a previously running app on success or failure and
retains sets for 14 days. Prevent CLI writers during backup. Copies on this VM protect
against application mistakes; copy complete backup sets to another device for host/disk
failures. To restore into empty library/database locations, stop the app, extract
`library.tar.gz` into `/var/lib/wp-starter`, restore UID/GID 1000, then pipe
`gzip -dc database.sql.gz` into `docker compose ... exec -T database psql -U wp_starter -d wp_starter`.
Restore environment files as root mode 600 and start the app after verifying contents.

Install `deploy/scripts/check-disk.sh` for this layout with
`WP_STARTER_HEALTH_URL=http://192.168.100.140:47901/api/health`; use a 10 GiB
warning threshold if writes stop below 5 GiB. Record output in a root-owned log
or connect its exit status to your alerting system. The deployed instance's
details are recorded in `docs/PRODUCTION-LAN.md`.

LAN deployment uses HTTP; keep router forwarding disabled for this port. Public launch
requires the chosen domain (e.g. `wp.mediasanat.ir`) pointing to the public static IP,
an HTTPS virtual host on the existing edge proxy, router forwarding to that proxy,
`WP_STARTER_BASE_URL=https://wp.mediasanat.ir`, and secure cookies enabled. The existing
CRM proxy must preserve the visitor's forwarding headers through a trusted private
connection; the LAN proxy currently replaces them with its direct caller's address.
Do not point public port 443 directly at the plain HTTP LAN listener.

## Dedicated HTTPS port with Docker

When another service owns 443, WP Starter can publish TLS on 2053 without changing
that service. Point `wp.mediasanat.ir` to the public IP and forward public TCP
2053 to `192.168.100.140:2053`. Obtain a certificate on the server first:

```bash
sudo certbot certonly --manual --preferred-challenges dns --cert-name wp.mediasanat.ir -d wp.mediasanat.ir
```

Publish the requested TXT value at `_acme-challenge.wp.mediasanat.ir` and verify
its public resolution before continuing. Manual DNS certificates require manual
renewal unless a DNS authentication plugin/hook is configured; the deploy hook
below reloads certificates but does not automate validation.

Set `WP_STARTER_BASE_URL=https://wp.mediasanat.ir:2053` and
`WP_STARTER_SECURE_COOKIES=true` in the protected server environment. Add
`COMPOSE_FILE=/opt/wp-starter-system/deploy/docker/compose.yaml:/opt/wp-starter-system/deploy/docker/compose.https.yaml`
to `/etc/wp-starter/compose.env` so operational Compose commands retain the TLS
listener, then recreate app and proxy with both files:

```bash
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml -f deploy/docker/compose.https.yaml up -d --no-deps app proxy
sudo install -m 750 deploy/scripts/reload-https.sh /etc/letsencrypt/renewal-hooks/deploy/wp-starter-https
curl --resolve wp.mediasanat.ir:2053:192.168.100.140 https://wp.mediasanat.ir:2053/api/health
```

Update any scripts that explicitly pass only `-f compose.yaml` to include the
HTTPS override: explicit file arguments supersede `COMPOSE_FILE`. The private
HTTP health endpoint remains available; other HTTP requests redirect to HTTPS.
Only WP Starter's certificate directories are mounted into its proxy. The URL
must include `:2053`. Verify TLS and secure session cookies before enabling
Cloudflare proxy mode with Full (strict). Keep certificate expiry monitoring
enabled and renew with the same manual DNS command before expiry.

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
