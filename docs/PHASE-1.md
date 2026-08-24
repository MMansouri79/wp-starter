# Phase 1: Core Build System

## Objective

Produce a complete WordPress distribution ZIP from local inputs only.

## Package-library workflow

WordPress core, themes, and plugins are first registered in a local package library. The CLI automatically inspects normal WordPress ZIP packages, stores their original bytes, records metadata and SHA-256, and permits multiple versions to coexist.

Examples:

```bash
wp-starter package add C:\Packages\wordpress-7.1.zip
wp-starter package add C:\Packages\hello-elementor.zip
wp-starter package add C:\Packages\elementor-pro.zip
wp-starter package list
```

The profile references `slug + version`; it does not care where the original ZIP came from or what the ZIP was named.

After a reference configuration snapshot has `Missing: 0`, the CLI can generate the initial build profile automatically:

```bash
wp-starter profile create snapshot-20260824050124 --name ecommerce-fa --output C:\WP-Starter\profiles\ecommerce-fa.json
wp-starter profile check C:\WP-Starter\profiles\ecommerce-fa.json
```

Generation is strict: it refuses to produce a build-ready profile while any exact package required by the snapshot is absent.

## Inputs

- exact WordPress package selected from the local library
- one exact theme package selected from the local library
- zero or more exact plugin packages selected from the local library
- exported starter configuration ZIP
- optional language archive ZIPs
- build profile JSON

## Output

A normal WordPress tree with:

- plugins already present under `wp-content/plugins`
- theme already present under `wp-content/themes`
- translations already present under `wp-content/languages` when provided
- `wp-content/starter-package/starter-config.json`
- `wp-content/starter-package/starter-build.json`
- `wp-content/mu-plugins/site-starter-bootstrap.php`

The database is deliberately not bundled.

## Database/admin boundary

The new host still uses the normal WordPress installation flow to collect:

- DB name
- DB user
- DB password
- DB host
- table prefix
- site title
- admin username
- admin password
- admin email

The bootstrap starts only after WordPress is installed and an administrator loads wp-admin.

## Phase 1 supported portable configuration

- reviewed WordPress options and permalink structure
- blank starter page definitions
- reviewed Elementor options
- portable Elementor Site Kit settings
- reviewed WooCommerce options
- reviewed Persian WooCommerce options
- theme/plugin activation

Arbitrary plugin binaries are supported generically. Portable settings are not: configuration adapters remain explicit and plugin-specific.

FilterX object-ID remapping and Elementor layout/template transport belong to Phase 2.
