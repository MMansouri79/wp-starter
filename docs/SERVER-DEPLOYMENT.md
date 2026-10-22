# Server deployment

The catalog/setup update must deploy the shared builder-core output, hosted profile/catalog APIs, GUI assets, and both files under `wordpress/bootstrap/` together. `deploy/docker/Dockerfile.catalog-release` builds these against the existing exporter release. `deploy/scripts/prepare-catalog-release.sh` accepts a catalog release ID and patch SHA-256, runs the full checks against disposable PostgreSQL, and builds the runtime image. `activate-catalog-release.sh` accepts the verified release ID and optional expected previous release, requires an idle queue, takes a paired backup, and preserves the previous image/source for rollback. `recover-stopped-catalog-app.sh` is the documented incident recovery: it stops the sole application, verifies it is stopped, preserves the stale lock, and restarts it. These scripts target the documented October 2026 deployment; adjust their pinned paths/base release before using them elsewhere.

`apps/server/` is the hosted, multi-user version of the Builder. It runs private team library directories plus one database for identity, memberships, and team-scoped metadata, and it serves the same Builder UI the local GUI uses.

This document covers a single-VPS deployment: PostgreSQL, the Node server behind nginx with Let's Encrypt HTTPS, systemd supervision, backups, and disk monitoring.

## What is shared, and what is not

Shared through the server:

- package ZIPs, configuration snapshots, build profiles, design-system resources, portable templates, sample content, and built starter ZIPs
- ownership metadata: who uploaded or created each item

Not changed by hosting:

- Configuration snapshots still contain only exporter-whitelisted portable data. Sharing them does not widen the security boundary.
- Private production packages, credentials, and non-portable plugin state stay excluded, exactly as in the offline workflow.
- The CLI and the local GUI are untouched and keep working against a local library.

Only members of a team can read its library. Team owners, admins, and editors can edit any team item; viewers browse and download existing builds. Platform administrators provision teams and manage accounts but need membership to access content. Creator attribution remains after a member leaves. See [team workspaces](TEAM-WORKSPACES.md) for permissions and API contracts.

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

Registration requires an email-bound team invitation. `WP_STARTER_ALLOW_OPEN_REGISTRATION` is ignored by the hosted app. Team invitations never grant platform administration.

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
3. Open **Platform administration**, create a team with its initial owner's email, and copy the invitation link.
4. Have the owner register through that link (or sign in to accept it). In **Team settings**, invite colleagues as editors/viewers. Editors collaborate on all team items; viewers receive read-only controls.
5. Provision a second team. In a second browser, confirm its members cannot see the first team's items or use its direct URLs (`404`), including downloads and build jobs. A platform administrator without membership also gets `404`.
6. Confirm viewers cannot upload, edit, delete, duplicate, or queue builds (`403 read_only`), while same-team editors can edit each other's items. Removing membership must immediately remove access.
7. Queue a build, watch staged progress, download it, and verify a member of another team cannot access its artifact. Test the team switcher in two tabs.

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

## Private-team migration

For an installation using the original shared library, complete this upgrade before starting the new server. Startup refuses pending migration or legacy payload files still at the data root. Never run migration while the server is serving requests.

1. Stop the service and take a **coordinated database and full file-store backup** using the existing backup scripts. Preserve the old application release for rollback. Verify the backup's completion marker before upgrading. The file backup covers the entire data root, including all team directories after migration.
2. Install/build the new release. With the same protected environment and service account, run:

   ```bash
   cd /opt/wp-starter-system
   node apps/server/dist/index.js migrate-teams --dry-run
   node apps/server/dist/index.js migrate-teams
   ```

   The dry run reports row counts and a checksum inventory without applying schema changes or moving files. It expects an initialized legacy database. If this is a filesystem-only import into a fresh installation, initialize the empty database with `migrate` first.
3. Migration creates the initial **Our team** workspace. Existing global administrators become its owners and keep platform administration; existing members/clients become editors. All content rows, including unowned imports, are assigned to that team. Portable IDs, attribution, ZIP bytes/checksums, relative registry references, and existing build artifacts remain intact. Legacy account invitations and sessions are revoked.
4. Only canonical payload entries are moved: registry JSON files, packages, configs, fonts, Elementor templates, sample assets, profiles, builds, and vnext. Database files, operator configuration, logs, and unrelated files stay at the data root. Symbolic links are refused. The initial team directory is `teams/00000000-0000-4000-8000-000000000001/`.
5. A durable `team-migration.checkpoint.json` records each source checksum before the first move. If interrupted, keep that checkpoint and rerun the same command. Already-moved files are verified; changed, missing, unsafe, or conflicting source/destination files cause refusal. Do not manually edit the checkpoint. The SQL migration is transactional, and startup remains blocked until file verification marks the migration complete. Empty legacy directories are retained.
6. Start the service. Sign in again, confirm memberships and resource counts, compare package checksums, download an existing artifact, queue a new build, and test isolation with a second team. Reissue invitations through Team settings.

For Docker, stop the `app` service and use the built image with the same mounted data root and database network:

```bash
docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml stop app
# Take and verify the coordinated backup before the following commands.
docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml build app
docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml run --rm --no-deps app node apps/server/dist/index.js migrate-teams --dry-run
docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml run --rm --no-deps app node apps/server/dist/index.js migrate-teams
docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml up -d app proxy
```

`server-running.lock` prevents starting a second server or migrating a running service on the same host. A clean stop removes it. After an unclean stop or a container PID change, verify the old service/container is stopped before removing a stale lock; never remove a lock to bypass a running server. This is an additional guard, not support for replicas or concurrent writers.

If verification fails, keep the service stopped. Recover through the checksum checkpoint, or restore **both** database and file-store from the same backup set and restart the previous application release. Do not run the previous release against the new team schema. A production PostgreSQL restore rehearsal still requires an actual deployment environment; tests use synthetic fixtures and optional `WP_STARTER_TEST_PG_URL`.

## Docker deployment alongside an existing application

When another application already owns ports 80/443, use `deploy/docker/compose.yaml`.
This creates a separate `wp-starter` Compose project, PostgreSQL database and networks.
Only its proxy publishes a host port; neither the app nor PostgreSQL publishes a port.
Run exactly one app container. The CRM's Compose project and database remain separate.

Copy the current source tree to `/opt/wp-starter-system` (include uncommitted changes when
deploying from staging, exclude secrets and Windows `node_modules`/compiled output).
Copy the existing builder library to `/var/lib/wp-starter` and give UID/GID 1000 ownership,
which matches the image's `node` user. Keep the original Windows library until migration
acceptance. Initialize the database and run the private-team migration above before
starting the application. Filesystem-only imports have null creator attribution and are
managed by editors in the initial team. If there were no preexisting hosted accounts,
provision its first owner through Platform administration. Offline ZIPs without database
jobs remain files; they are not synthesized into hosted build-history rows.

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

## Public exporter download

Anyone can download the installable exporter from `/downloads/wp-starter-exporter.zip`
without signing in. The sign-in page and builder account panel link to it. Install
the ZIP through WordPress **Plugins → Add New → Upload Plugin**, then activate it.

`npm run build` packages the current `wordpress/exporter/` source and copies the ZIP
to the ignored `apps/server/client/downloads/` directory. The Docker image includes
this directory with the server client assets. Run the normal build/deploy after
changing the exporter; no private team files are published by this endpoint.

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
## Optional automatic plugin library updates

For the October 20, 2026 production host, `deploy/docker/Dockerfile.plugin-updates` and the matching `prepare-plugin-updates.sh` / `activate-plugin-updates.sh` scripts build from `catalog-20261014-364d5ae5`, verify against disposable PostgreSQL, require an idle queue, and retain a paired backup and the previous image/source. They use the current `192.168.200.140` health address. Their release names and baseline are deliberately pinned; revise them before reusing for another deployment. The release is a scoped, checksummed source patch from the feature branch, with explicit overlay changes applied only to matching production file hashes. Migration 6 only adds tables, so the previous release can run with those empty, unused tables after an application rollback.

The hosted Packages page has a default-off switch per team. Team owners and administrators must explicitly confirm the WordPress.org source of each eligible existing plugin before enabling it. A matching folder name alone is not treated as evidence of origin. Newly uploaded plugins remain unconfirmed until a manager confirms them. Editors and viewers can inspect status but cannot change this policy.

The server checks due teams at startup and once per minute, and checks each enabled library every twelve hours. Enabling or changing settings makes the library due on the next scheduler pass. The scheduler runs in the existing single server process; no cron service is required. Disabled libraries make no update requests. Normal builds remain offline-capable.

Enabled deployments need outbound HTTPS access to `api.wordpress.org` and `downloads.wordpress.org`. Downloads have a sixty-second timeout and are capped at the smaller of the configured upload limit and 64 MiB to bound background memory use; metadata is limited to 2 MiB. Larger archives require manual import. Redirects are limited and restricted to these HTTPS hosts. Network errors leave existing packages usable and retry after twelve hours. The Packages page shows the last check and per-plugin results. Old versions are retained and count toward the team's quota; remove unused versions manually when appropriate.

Database migration 6 stores team settings, source confirmations, authorization attribution, and the latest check results. Include it in normal database backups; downloaded ZIPs remain in the team's canonical file store and use the existing backup procedure. There is no profile or package manifest migration. Existing installations stay disabled after migration.

Background imports revalidate current team membership, team status, disk space, quota, and the settings revision under the shared mutation lock. Updates pause if the manager who last saved settings is disabled, deleted, removed from the team, or loses their owner/admin role; another current manager can save the settings to reauthorize them. Disabling updates or changing confirmations prevents in-flight downloads from being imported. Turning off the feature retains downloaded versions. Existing builds and deployed WordPress sites are never updated by this feature.
