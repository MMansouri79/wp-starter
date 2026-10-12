# Hosted server deployment acceptance

Status: LAN deployment executed on 2026-10-12; full public-release acceptance remains pending.

The current staging working tree and library were deployed to Ubuntu at
`192.168.100.140` alongside the existing CRM using the isolated Docker deployment.
See `docs/PRODUCTION-LAN.md` for configuration, migration results, verified build
checksum, backup/restore results, and existing profile problems. This is not the
clean-VPS systemd/HTTPS or cross-browser acceptance described below.

Executed: 140 Linux tests with no skips (including disposable PostgreSQL
integration), PHP lint, administrator login after restart, CSRF denial, imported
library checks, real build/download checksum verification, complete backup
restore into isolated destinations, and backup dump-failure restart recovery.
Remaining release gates include DNS/TLS/public routing, browser account/ownership
acceptance, offsite backups, and cross-platform remote CI.

Hardening is implemented in `V1-SERVER-HARDENING.md`. Local synthetic tests and CI configuration do not establish production deployment acceptance.

1. Execute every step in `docs/SERVER-DEPLOYMENT.md` on a clean VPS, including migrations, systemd supervision, nginx, HTTPS, and disk monitoring.
2. Run the real PostgreSQL integration test with `WP_STARTER_TEST_PG_URL` against a dedicated test database. The test creates and drops only its uniquely named schema. Confirm the PostgreSQL CI job passes.
3. Use two browser sessions: owner creates/edits/deletes; another member reads/builds/duplicates but receives `403 read_only` on replacement and deletion. Confirm an administrator has no rights over someone else's items. Verify CLI-created unowned items remain administrator-managed.
4. Test account creation, invite registration, invite reuse denial, login/invite lockout, password change, account disabling, and session expiry.
5. Exercise fonts, design systems, templates, sample assets, profiles, and two simultaneous builds; check quota messages, downloads, checksums, and retention.
6. Run the coordinated backup wrapper with the protected service environment. Restore the matching database/file set into an empty destination. Verify login, ownership, package checksums, sample assets, and a downloadable build. Confirm service recovery after a deliberately failed backup.
7. Record environment, commands, results, and any corrections here. Cut `0.2.0-alpha.1` only after acceptance and cross-platform CI pass; update all paired Builder versions together. Exporter version remains independent.

Pagination, invite email delivery, adapter contracts, FilterX, larger-site WordPress validation, and desktop signing remain separately planned product work.
