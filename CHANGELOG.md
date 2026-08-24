# Changelog

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
