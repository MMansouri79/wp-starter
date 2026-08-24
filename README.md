# WP Starter System

A self-contained WordPress starter build system for offline or restricted hosting.

The project is intentionally split into three responsibilities:

1. **Starter Exporter** runs on the reference WordPress site and exports only approved portable configuration.
2. **Builder CLI** runs on a developer machine and combines packages from a local package library, a configuration export, and the bootstrap runtime.
3. **Starter Bootstrap** ships inside the generated WordPress distribution as an MU plugin and applies the exported configuration after the normal WordPress database/admin installer finishes.

No part of the generated starter distribution needs WordPress.org or internet access. Plugin/theme ZIPs are carried inside the distribution and installed locally after WordPress itself is installed.

## Phase 1 status

The Phase 1 build pipeline currently provides:

- generic local package registry for arbitrary WordPress/plugin/theme ZIPs
- automatic package inspection and version detection
- multiple package versions side by side
- SHA-256 integrity tracking
- schema v2/v3 profiles referencing exact package coordinates and configuration snapshot IDs instead of ZIP paths
- automatic schema v3 profile generation from a fully satisfied configuration snapshot
- compact local ZIP payload bundling for plugins/themes to keep hosting-panel extraction small
- configuration snapshot registry with source requirement matching
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

Import a configuration export from the reference site and immediately compare it against the local package library:

```bash
node apps/cli/dist/index.js config add C:\Exports\starter-config.zip
node apps/cli/dist/index.js config list
node apps/cli/dist/index.js config check snapshot-20260824050124
```

The requirement report marks the exact WordPress core, theme and active plugin versions as `OK` or `MISSING`. Builder/exporter infrastructure plugins are intentionally ignored.

Once `config check` reports `Missing: 0`, generate the initial schema v3 profile directly from that snapshot:

```bash
node apps/cli/dist/index.js profile create snapshot-20260824050124 \
  --name ecommerce-fa \
  --output C:\WP-Starter\profiles\ecommerce-fa.json

node apps/cli/dist/index.js profile check C:\WP-Starter\profiles\ecommerce-fa.json
```

The generated profile pins the exact WordPress, theme, and active plugin versions from the reference export. It is an ordinary JSON profile and can later be deliberately edited to move individual package versions forward.

Then build:

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
4. Open wp-admin. The bundled MU-plugin verifies and installs the local theme/plugin ZIP payloads one at a time, activates them, and applies the starter configuration.

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


## Alpha.10

Configuration verification, WooCommerce page ownership, and Elementor default-kit repair.

## Local GUI preview (alpha.11)

The Builder now includes a lightweight local GUI that runs entirely on `127.0.0.1` and calls the same builder-core APIs as the CLI. It is an interim usability layer before the final Electron shell, not a separate build engine.

On Windows, extract the Builder release and double-click:

```text
scripts\\wp-starter-gui.cmd
```

The launcher opens the local Builder UI in the default browser. Keep the terminal window open while using it. The GUI uses the same default library as the CLI (`%USERPROFILE%\\.wp-starter`), so all packages and configuration snapshots already imported through the CLI appear automatically.

The GUI currently supports:

- adding arbitrary WordPress/plugin/theme ZIPs,
- importing configuration snapshot ZIPs,
- checking missing package requirements,
- creating profiles with locale and plugin exclusions,
- building the complete offline WordPress ZIP,
- downloading previous builds.

The CLI remains supported for diagnostics, scripting, and CI.
