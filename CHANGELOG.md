# Changelog

## 0.1.0-alpha.10

### Verified configuration and deterministic default-page ownership

- Removed the Bootstrap call to `WC_Install::create_pages()` so WooCommerce alone owns Shop/Cart/Checkout/My Account creation.
- Added a conservative repair pass that removes duplicate WooCommerce default pages while preserving the page IDs WooCommerce currently owns.
- Added Elementor default-kit repair/creation before importing Site Settings, fixing the editor error that no default kit exists.
- Clears Elementor generated-file cache after applying imported kit settings.
- Added post-import verification of WordPress, Elementor, WooCommerce, locale, permalink, and active Elementor kit state. Bootstrap now fails instead of claiming success when stored settings do not match the snapshot.
- Added a configuration revision so existing alpha.9 test installs automatically rerun only the configuration phase and repair themselves without reinstalling WordPress or packages.
- Expanded the Exporter baseline whitelist with `page_on_front`, `page_for_posts`, and `large_size_h`.
- Added repeatable Exporter release packaging.

## 0.1.0-alpha.9

### Direct local package extraction on WordPress hosts

- Replaced bundled theme/plugin extraction through WordPress `unzip_file()` with a direct, path-safe `ZipArchive` extractor when the PHP extension is available.
- Fixes Plesk-style environments where `unzip_file()` could report success but the expected theme/plugin files never appeared in the real `wp-content` destination.
- Keeps a WordPress Filesystem/PclZip fallback for servers without `ZipArchive`.
- Adds archive-entry and destination diagnostics if a normalized payload still cannot be discovered after extraction.
- Preserves checksum verification before extraction and rejects absolute or traversal paths inside bundled archives.

## 0.1.0-alpha.8

### Canonical plugin/theme payloads

- Normalizes every bundled plugin and theme ZIP during build instead of copying arbitrary source ZIP bytes unchanged.
- Repackages each payload with exactly one canonical top-level install directory matching the detected registry install directory.
- Forces ZIP-standard forward-slash entry names for inner plugin/theme archives as well as the outer deployment archive.
- Fixes Bootstrap failures where an archive reported successful extraction but WordPress could not find the expected theme/plugin path afterward.
- Covers single-file plugins by wrapping them in their canonical plugin directory before deployment.
- Adds post-extraction theme-directory diagnostics if a theme still cannot be discovered.

## 0.1.0-alpha.7

### Linux-portable deployment ZIPs

- Fixed Windows-built starter distributions using backslashes inside ZIP entry names.
- Windows ZIP creation now writes every archive entry explicitly with ZIP-standard forward slashes.
- Fixes Plesk/File Manager extraction failures reporting `appears to use backslashes as path separators`.
- Added a regression check that generated deployment archives contain no backslash entry names.
- Kept the alpha.6 compact payload design: WordPress core is expanded in the outer archive while plugins/themes remain bundled ZIPs for staged offline installation.

## 0.1.0-alpha.6

### Compact hosting-panel deployment bundles

- Changed generated distributions so plugin/theme binaries remain as local ZIP payloads under `wp-content/starter-package/packages/` instead of being expanded into the outer deployment ZIP.
- Reduced outer archive entry count dramatically for Plesk/cPanel-style File Manager extraction.
- Bootstrap now installs the bundled theme and one plugin package at a time after the normal WordPress database/admin installation.
- Added checksum verification before any bundled package is extracted.
- Added staged plugin installation and dependency-tolerant activation retries.
- Bundled language archives are now installed by Bootstrap instead of being expanded by the Builder.
- Bumped starter build manifest to schema v2 for bundled package paths.
- Kept the entire deployment offline; Bootstrap only reads package files shipped inside the starter distribution.

## 0.1.0-alpha.5

### Profile locale overrides and selective plugin builds

- Added `--locale <locale>` to `profile create` so destination language is independent from the reference snapshot locale.
- Added repeatable `--exclude-plugin <slug>` to generate test or alternate profiles without selected reference-site plugins.
- Excluded plugins no longer block profile generation if their exact package is absent from the local library.
- Bootstrap now applies Elementor, WooCommerce, and Persian WooCommerce adapter options only when the corresponding plugin is actually active.
- Updated bootstrap version and tests for locale override and plugin exclusion behavior.

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
