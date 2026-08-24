# Phase 1: Core Build System

## Objective

Produce a complete WordPress distribution ZIP from local inputs only.

### Inputs

- WordPress core ZIP
- one theme ZIP
- zero or more plugin ZIPs
- exported starter configuration ZIP
- optional language archive ZIPs
- build profile JSON

### Output

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

FilterX object-ID remapping and Elementor layout/template transport belong to Phase 2.
