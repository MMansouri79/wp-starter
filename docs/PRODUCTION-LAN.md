# Ubuntu production deployment

## Automatic plugin library updates — 2026-10-20

Production runs `plugin-updates-20261020-4eff6b92` on top of `catalog-20261014-364d5ae5`. The scoped feature-branch patch SHA-256 is `4eff6b927eefd7206f328ea86ec17f95c7fb6c091665e7994e77e07f98089298`. Existing production source hashes were checked before preparation and activation; only the updater service, its API/lifecycle integration, hosted UI controls, tests, and deployment documentation/scripts were overlaid. No unrelated staging changes were deployed. This is a checksummed source release, not a Git commit.

- All **182 tests passed** on Linux against disposable PostgreSQL, with zero failures or skips. PHP lint and builder/exporter artifact verification passed.
- Paired backup: `set-20261020T074331Z-AO8ygc`. Previous source/image/configuration and the backup pointer are retained under `/var/backups/wp-starter/releases/plugin-updates-20261020-4eff6b92/`. Only the WP Starter app was recreated; the existing proxy was reloaded.
- Migration 6 adds team-scoped update settings and source confirmations. Existing profiles, package ZIPs, identities, memberships, and deployment configuration were retained. No updater policy is enabled by deployment.
- Authenticated smoke testing with `mohammadmns1379@gmail.com` confirmed its existing **Team A owner** role, updater GET/settings-write access, CSRF enforcement, hosted script/styles, 11 listed plugin slugs, and 19 existing profiles. The settings-write check saved the disabled policy with no confirmed sources; automatic updates remain **off** for the owner to enable deliberately. The server can reach the WordPress.org plugin information API. No credentials were logged or copied out of production.
- Deployment preparation/activation and smoke-test logs are in `/home/adminuser/wp-starter-deploy/plugin-updates/`. The preparation uses disposable PostgreSQL, and the production database is never used as the integration-test target.

## LAN address change — 2026-10-18

Ubuntu now uses `192.168.200.140/24`, gateway `192.168.200.1`; SSH is
`adminuser@192.168.200.140`. Updated `WP_STARTER_LAN_IP` in
`/etc/wp-starter/compose.env` and recreated only the `wp-starter` proxy with
both Compose files. Ports 2053 and 47901 now bind to the new address. Updated
`/etc/cron.d/wp-starter-health` to use the new HTTP health address. Protected
copies of both previous configurations are in `/etc/wp-starter/` with the
suffix `before-ip-change-20261018`.

Verified certificate-valid HTTPS health through the domain and directly to the
new LAN address, public login HTTP 200, healthy app/database containers, and
the disk/health monitor. Older IP addresses below describe historical deployments.

## Catalog/setup release — 2026-10-14

Production runs `catalog-20261014-364d5ae5`, the memory correction on top of `catalog-20261014-6720ad1f` and `exporter-20261013-c3251a57`. The correction patch SHA-256 is `364d5ae574942b950477fce23e9f70a81c2b5bc2cee9a2cfe6653c6c5bfed6c1`; the initial catalog patch is `6720ad1fd0a81a58f6691fa82a8e3490a5e03c6a0923943b864493af05e47692`.

- Deployed shared catalog/profile support, stable-ID creation fixes, the updated Builder controls, Exporter `0.2.0-alpha.10`, and the paired bootstrap/catalog runtimes. Setup can persistently skip images or stop the remaining catalog without configuration restarting the import.
- Resolving the large catalog initially exhausted the app's 1 GiB Node.js heap because every image reparsed the complete library concurrently. The corrected resolver reuses one parsed catalog and verifies assets sequentially. All 171 products and 719 images resolved under a 128 MiB heap limit, using about 12 MiB of JavaScript heap at completion. After stopping the failed app, its stale lock was preserved in the initial release's backup directory before restart.
- Linux verification passed all **171 tests**, including disposable PostgreSQL, with zero failures or skips. PHP lint and builder/exporter artifact verification passed. A website-queue regression downloads a generated ZIP and verifies its native setup controls and installer checksum.
- Latest paired backup: `set-20261014T083857Z-uUVmJN`; initial backup: `set-20261014T082211Z-v5461T`. Previous source, image/configuration and backup pointers are under `/var/backups/wp-starter/releases/catalog-20261014-364d5ae5/` and `/var/backups/wp-starter/releases/catalog-20261014-6720ad1f/`.
- Activation required an idle queue. Public HTTPS health and runtime SHA-256 checks passed after the switch. Existing team membership, identity, library data and unrelated CRM services were preserved.
- Recreated **Nikbakht Farsi Catalog** through the authenticated hosted build queue: job `6ad9c426-89f0-42f0-8721-f38fe717a7cd`, 153,437,599 bytes, SHA-256 `2ebbe1b0dd6e259d3460d5753177c2fb72c7769bfe3c3cbf45e2b407a74b29c5`. Download verification matched 171 products, 188 variations, 47 global attributes, 789 terms, 719 images, plugin versions, nine font files, payload/resource hashes and the paired native setup runtimes. WordPress's actual sanitizer accepted all 960 content/term slugs. The ZIP contains Farsi WordPress 7.1 and no temporary helper plugins. Public health remained healthy after the build; the app used about 36 MiB of container memory at the final check.

## Current release — 2026-10-13

Production now runs `exporter-20261013-c3251a57`, a scoped exporter/download update
on top of the team release below. The 11-file patch archive SHA-256 is
`c3251a572c2239b59fecbb59ff17b8e0f3e0d1ce86e8ad85f9a375e7f51b3edc`.

- Public download: `https://wp.mediasanat.ir:2053/downloads/wp-starter-exporter.zip`.
  Exporter version `0.2.0-alpha.9`, 13,872 bytes; anonymous public HTTPS returned
  `200 application/zip` with an attachment filename. The sign-in page and builder
  account panel link to it. Server builds refresh this artifact automatically.
- Linux verification passed all **161 tests**, including disposable PostgreSQL,
  with zero failures/skips, PHP lint, and builder/exporter artifact verification.
- Coordinated backup: `set-20261013T130141Z-w9whld`. Previous image, source,
  configuration and backup pointer are under
  `/var/backups/wp-starter/releases/exporter-20261013-c3251a57/`.
- The first activation rolled back after a startup lock remained when stopping
  an app that had just restarted from backup. The sole app container was stopped
  before removing that stale lock. Activation now waits for health after backup
  and retries proxy reload before checking the new service. Public HTTPS and
  database/disk health passed after the successful retry.

## Team workspaces release — 2026-10-13

Production runs `team-20261013-17852ac9`, a source snapshot of the authorized current working tree (archive SHA-256 `17852ac9a77de55110ea9c341370c9ed9a0d76fde87c61f52af2fea48d2a0b94`). It includes private team workspaces and the Post name permalink bootstrap fix. This deployment was not a Git commit.

- There is exactly one active team, **Team A**, ID `00000000-0000-4000-8000-000000000001`. The old shared library's 114 files and all content/build metadata were migrated with checksum verification. Payloads now live under `/var/lib/wp-starter/teams/<team ID>/`; operational files remain outside it.
- `mohammadmns1379@gmail.com` is an active platform administrator and Team A owner. The original `admin@mediasanat.ir` account and its owner membership were preserved. Local demo accounts and Team B were not deployed.
- The initial new-account credentials are root-readable at `/etc/wp-starter/mohammad-initial-admin.json`. Change the password through the account UI after first login. No password was embedded in source or deployment logs.
- Legacy sessions/invitations were revoked by migration. Sign in again at `https://wp.mediasanat.ir:2053/login.html`.
- Before migration, paired backup `set-20261013T072316Z-evYHVD` was restored into temporary file storage and isolated PostgreSQL. Restored library bytes and database counts matched production.
- Linux verification passed all **159 tests**, with zero failures/skips, PHP lint, and artifact verification against disposable PostgreSQL. Production login verified platform administration, Team A ownership, team library/member access, CSRF enforcement, and denial of old shared endpoints. Public HTTPS health and direct-origin TLS checks passed.
- Rollback source/image/configuration and the paired-backup pointer are under `/var/backups/wp-starter/releases/team-20261013-17852ac9/`. Restore the matching database **and** library before returning to the previous application; it cannot run against the team schema.
- The Fieldwork Store test profile/resources are transferred separately through authenticated Team A APIs. No other staging team or test account is copied.
- Nightly backups archive the entire `/var/lib/wp-starter` root, including every team directory. The updated backup script is installed. The CRM stack was left running.

The earlier sections below describe the initial deployment and remain as historical context.

Deployed 2026-10-12 from the current staging working tree, including uncommitted
server hardening changes. The Windows checkout remains staging; production is
the independent Ubuntu deployment. No Git release or version bump was made.

- SSH: `adminuser@192.168.100.140` using the separately authorized deployment key.
- Application: `https://wp.mediasanat.ir:2053` (HTTPS configured; public forwarding verification pending).
- DNS: `wp.mediasanat.ir` resolves to `37.255.254.229`.
- Administrator: `admin@mediasanat.ir`. Retrieve the initial password in your own
  SSH terminal with `sudo cat /etc/wp-starter/initial-admin.txt`, then change it
  through the application. The file is root-readable only; bootstrap variables
  were removed from the running configuration after the account was created.
- Source: `/opt/wp-starter-system`.
- Library: `/var/lib/wp-starter`; PostgreSQL: `/var/lib/wp-starter-postgres`.
- Protected configuration: `/etc/wp-starter/compose.env` and `server.env`.
- Compose project: `wp-starter`, separate from `mediasanat-crm`.
- Restart after reboot: Docker is enabled; all three services use `unless-stopped`.
- Database/app ports are unpublished; nginx binds `192.168.100.140:2053` for TLS
  and `192.168.100.140:47901` for HTTP health checks and HTTPS redirects.
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

On 2026-10-12, configured the separate WP Starter proxy with TLS on host port
2053, leaving CRM's 80/443 listeners unchanged. A Let's Encrypt certificate for
`wp.mediasanat.ir` expires 2027-01-10. The application base URL includes `:2053`
and secure cookies are enabled. LAN HTTP pages redirect to that URL; the private
HTTP health endpoint remains available to monitoring. TLS certificate validation,
security headers, login page and database health passed direct-origin checks.
Public port 2053 refused connections at activation; router forwarding remains
to be verified. Forward public TCP 2053 to `192.168.100.140:2053`.

The certificate uses manual DNS validation and requires renewal before expiry
using the command in `SERVER-DEPLOYMENT.md`. The scoped Certbot deploy hook
reloads WP Starter nginx when the certificate renews. It does not automate DNS
validation. Keep DNS only during initial public verification; when proxying with
Cloudflare, use Full (strict). Configuration rollback files are protected under
`/var/backups/wp-starter/https-20261012T094819Z`. Compose operations that recreate
the proxy must include `deploy/docker/compose.https.yaml` after the base file.

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
