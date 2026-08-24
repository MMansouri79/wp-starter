# Changelog

## 0.1.0-alpha.4

### Snapshot-to-profile generation

- Added `profile create` to generate a schema v3 build profile directly from an imported configuration snapshot.
- Profile generation refuses to continue until every exact WordPress/theme/plugin requirement from the snapshot exists in the local package library.
- Generated profiles pin the reference WordPress version, theme version, active plugin versions, locale, and configuration snapshot ID while remaining editable for deliberate later upgrades.
- Added `profile check` to resolve and validate every profile input before a build starts.
- Added overwrite protection for generated profile files.
- Added tests proving profile generation fails when packages are missing and succeeds when the package library is complete.

## 0.1.0-alpha.3

### Configuration snapshot registry

- Added a local registry for exported `starter-config.zip` snapshots.
- Added `config add`, `config list`, `config check`, and `config remove` CLI commands.
- Added exact requirement matching between a reference snapshot and the local WordPress/theme/plugin package library.
- Infrastructure plugins such as WP Starter Exporter and legacy Site Starter are excluded from target requirements.
- Added schema v3 profiles that reference a configuration snapshot by stable ID instead of a raw ZIP path.
- Verified the real `starter-config-20260824-050124.zip` export imports successfully and yields the expected WordPress 7.1, Hello Elementor 3.4.9, and six target plugin requirements.
- Added UTF-8 console setup to Windows launchers for Persian/non-ASCII plugin names.
- Added tests for snapshot import, requirement matching, infrastructure exclusion, and schema v3 profile resolution.

## 0.1.0-alpha.2

### Generic package registry

- Added a local package library for arbitrary WordPress core, plugin, and theme ZIPs.
- Added automatic package inspection for plugin/theme headers and WordPress core versions.
- Added `package add`, `package inspect`, `package list`, and `package remove` CLI commands.
- Added exact SHA-256 integrity tracking and explicit conflict handling.
- Added multi-version package storage.
- Added schema v2 profiles that reference exact `slug + version` package coordinates instead of ZIP paths.
- Preserved schema v1 profile compatibility during Phase 1 migration.
- Added end-to-end tests proving a schema v2 profile resolves and builds entirely from the local registry.
- Preserved original plugin/theme installation directory names when assembling arbitrary packages.
- Added repeatable standalone Builder release packaging with the correct bootstrap directory layout.
- Added `wp-starter.cmd` and `wp-starter.ps1` Windows command launchers.

## 0.1.0-alpha.1

### Architecture reset

- Split the old monolithic Site Starter concept into Exporter, Builder, and Bootstrap.
- Added the first offline local build pipeline.
- Added a versioned profile format and build manifest.
- Added local-only package extraction for WordPress, themes, plugins, and language archives.
- Added a WordPress configuration exporter with explicit portable-setting whitelists.
- Added an MU-plugin bootstrap that stages activation and configuration after normal WordPress installation.
- Added synthetic end-to-end builder tests.
- Preserved the earlier Site Starter Git history before the architecture reset.
