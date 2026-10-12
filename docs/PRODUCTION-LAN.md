# Ubuntu production deployment

Deployed 2026-10-12 from the current staging working tree, including uncommitted
server hardening changes. The Windows checkout remains staging; production is
the independent Ubuntu deployment. No Git release or version bump was made.

- SSH: `adminuser@192.168.100.140` using the separately authorized deployment key.
- Application: `http://192.168.100.140:47901` (LAN only).
- Future domain: `wp.mediasanat.ir`; DNS, public routing and HTTPS are pending.
- Administrator: `admin@mediasanat.ir`. Retrieve the initial password in your own
  SSH terminal with `sudo cat /etc/wp-starter/initial-admin.txt`, then change it
  through the application. The file is root-readable only; bootstrap variables
  were removed from the running configuration after the account was created.
- Source: `/opt/wp-starter-system`.
- Library: `/var/lib/wp-starter`; PostgreSQL: `/var/lib/wp-starter-postgres`.
- Protected configuration: `/etc/wp-starter/compose.env` and `server.env`.
- Compose project: `wp-starter`, separate from `mediasanat-crm`.
- Restart after reboot: Docker is enabled; all three services use `unless-stopped`.
- Database/app ports are unpublished; nginx binds only `192.168.100.140:47901`.
- Node 22.23.3, PostgreSQL 15, nginx; app limited to 2 GiB / two CPUs with one worker.
- Upload limit 1 GiB; per-account quota 20 GiB; writes stop below 5 GiB free.

## Operations

```bash
cd /opt/wp-starter-system
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml ps
sudo docker compose --env-file /etc/wp-starter/compose.env -f deploy/docker/compose.yaml logs --tail 100 app
curl -fsS http://192.168.100.140:47901/api/health
sudo /usr/local/bin/wp-starter-backup-docker
```

Nightly backups run at 03:15 in the server's UTC timezone (06:45 Tehran), retain 14
days, and briefly pause only WP Starter. Complete sets live under
`/var/backups/wp-starter/set-*`. The initial complete set was restored to temporary
storage and a separate PostgreSQL container; library bytes and database counts
matched. The administrator and owned completed build were present in the restore.
An intentionally failed database dump also confirmed that the backup trap restarts
the app and returns it to healthy service.
Offsite copies remain to be configured.

Disk and health checks run every 15 minutes and log to
`/var/log/wp-starter-health.log`; disk warning threshold is 10 GiB. Alerts are
currently logs on the VM, not email/SMS notifications. Backup output goes to
`/var/log/wp-starter-backup-docker.log`.

## Migration validation

The 1.95 GB Windows library was copied with archive checksum verification.
Imported database records include 16 packages (15 displayed plus infrastructure),
15 profiles, one snapshot, two font systems, and three Elementor templates.
Unowned imported items remain administrator-managed. Original offline ZIPs are
preserved but are not hosted build-history entries.

Confirmed administrator login, authenticated GUI HTML and library API, CSRF
rejection, healthy PostgreSQL/disk status, and a real `Nikbakht.json` build. Its
93,757,190-byte downloaded ZIP matched the recorded SHA-256:
`d4bad65e421c1657027b109667da543f296c9ba55a2dd20ecf8a2fce125429e1`.
The CRM containers remained running, with healthy web/database services.

Verification passed: `npm run check` on Windows (139 passed, PostgreSQL skipped),
then the full Linux `npm run check` in a separate verification image against a
disposable PostgreSQL database (140 passed, zero skipped) plus PHP lint. The
verification image required an accessible official Alpine mirror and the PHP 8.4
executable alias; neither dependency is part of the production runtime. Scripts
passed shell syntax checks, and both healthy and low-disk monitoring paths were
exercised. Detailed Linux output is `/home/adminuser/wp-starter-deploy/linux-check.log`.

Eight existing profiles cannot build as currently saved:

- `1.json`, `test-2.json`: missing schema-v7 `elementorTemplates` arrays.
- `a13-snap.json`, `test.json`, `test23.json`: referenced snapshots are absent.
- `font-test.json`, `package-only.json`: `en_US` locale conflicts with selected
  `fa_IR` WordPress package.
- `test5.json`: missing `filterx@0.6.2-dev.5` package.

These source documents were preserved. Repair them deliberately in staging or
through the hosted editor; do not silently replace their intended configuration.

## Public launch

Before using `https://wp.mediasanat.ir`, configure the domain's DNS record to
the public static IP, router forwarding to the existing edge proxy, and a separate
HTTPS virtual host with a certificate for WP Starter. Update the app's base URL
and secure cookies. Integrate the proxy routing with the CRM; port 443 already
belongs to its nginx container. Verify trusted forwarding headers and HTTPS
session behavior before opening access. The LAN listener is plain HTTP.

Future staging changes require an explicit build/deploy; they do not automatically
alter production. Keep production library/database state out of source archives.

## Updating the application

Use a clean Git commit as the deployment source. Export it with `git archive`,
record its SHA-256, and extract it into `/opt/wp-starter-releases/<commit>`.
Build and test there while the current application keeps serving requests.
Run the verification Docker target against a disposable PostgreSQL container;
never point `WP_STARTER_TEST_PG_URL` at the production database. Require zero
failed or skipped tests, PHP lint, and artifact verification before activation.
The shared UI also has the browser checks described in
`FRONTEND-DESIGN-SYSTEM.md`.

Before activation, run `/usr/local/bin/wp-starter-backup-docker`, retain the
current image and source archive for rollback, and confirm there are no active
build jobs. Copy the tested source to `/opt/wp-starter-system`, build an image
tagged with the commit, and recreate only the Compose `app` service using the
protected environment files. Keep the existing release setting in
`/etc/wp-starter/compose.env` aligned with the new image tag so later backup and
restart operations use the same release. Do not replace production configuration,
the library, PostgreSQL storage, or the neighboring CRM stack.

Record the active revision in `/opt/wp-starter-system/DEPLOYED-COMMIT`. Verify the
LAN health endpoint, PostgreSQL and disk status, new UI assets, and the account
pages after restart. If health checks fail, restore the previous source and image
and recreate only `app`; keep database and library volumes intact.
