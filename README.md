# WP Starter System

A self-contained WordPress starter build system for offline or restricted hosting.

The project is intentionally split into three responsibilities:

1. **Starter Exporter** runs on the reference WordPress site and exports only approved portable configuration.
2. **Builder CLI** runs on a developer machine and combines packages from a local package library, a configuration export, and the bootstrap runtime.
3. **Starter Bootstrap** ships inside the generated WordPress distribution as an MU plugin and applies the exported configuration after the normal WordPress database/admin installer finishes.

No part of the generated starter distribution needs WordPress.org or internet access.

## Phase 1 status

The Phase 1 build pipeline currently provides:

- generic local package registry for arbitrary WordPress/plugin/theme ZIPs
- automatic package inspection and version detection
- multiple package versions side by side
- SHA-256 integrity tracking
- schema v2 profiles referencing exact package coordinates instead of ZIP paths
- local ZIP-only WordPress/plugin/theme assembly
- configuration-export ZIP
- offline distribution builder
- build manifest + SHA-256 hashes
- MU-plugin bootstrap with staged provisioning
- WordPress exporter with explicit setting whitelists
- synthetic end-to-end package-library and builder tests

## Quick start

Install the exporter on the reference site and download `starter-config.zip`.

On your development machine, add whatever binaries you want to the local library:

```bash
node apps/cli/dist/index.js package add C:\Packages\wordpress-7.1.zip
node apps/cli/dist/index.js package add C:\Packages\hello-elementor.zip
node apps/cli/dist/index.js package add C:\Packages\elementor.zip
node apps/cli/dist/index.js package add C:\Packages\elementor-pro.zip
node apps/cli/dist/index.js package list
```

The package ZIP filename is irrelevant. The builder reads the WordPress/plugin/theme metadata from the package itself.

Create a schema v2 profile that pins exact versions and build:

```bash
node apps/cli/dist/index.js build \
  --profile /path/to/profile.json \
  --output /path/to/starter.zip
```

Use `--library <dir>` or the `WP_STARTER_HOME` environment variable when you do not want the default `~/.wp-starter` library.

On an offline new server:

1. Create an empty database and database user.
2. Extract the generated starter ZIP into the document root.
3. Run the normal WordPress installer and create the admin account.
4. Open wp-admin. The bundled MU-plugin activates the selected theme/plugins and applies the starter configuration.

## Generic binaries vs portable configuration

Any structurally valid WordPress plugin ZIP may be stored, packaged and activated by the Builder. That does **not** mean its database settings are automatically portable.

Configuration export/import remains adapter-based so site IDs, secrets, caches and non-portable plugin state are not blindly cloned.

## Security boundary

The exporter does not export:

- users
- passwords
- API keys
- payment credentials
- Elementor connection/license data
- arbitrary `wp_options`
- uploads/media
- products/orders/customers
- raw database dumps

Plugin binaries, config snapshots, profiles, and builder code are separate versioned concepts.
