# WP Starter System

A self-contained WordPress starter build system for offline or restricted hosting.

The project is intentionally split into three responsibilities:

1. **Starter Exporter** runs on the reference WordPress site and exports only approved portable configuration. The Exporter is versioned independently from the Builder. Exporter 0.2 adds strict Elementor general-settings allowlists and Code Snippets support.
2. **Builder CLI** runs on a developer machine and combines packages from a local package library, a configuration export, and the bootstrap runtime.
3. **Starter Bootstrap** ships inside the generated WordPress distribution as an MU plugin and applies the exported configuration after the normal WordPress database/admin installer finishes.

No part of the generated starter distribution needs WordPress.org or internet access. Plugin/theme ZIPs are carried inside the distribution and installed locally after WordPress itself is installed.

## Phase 1 status

**Phase 1 is complete as of v0.1.0-alpha.14.** The build pipeline was validated with clean snapshot-based and package-only deployments on a real Plesk-hosted WordPress installation.

The Phase 1 build pipeline provides:

- generic local package registry for arbitrary WordPress/plugin/theme ZIPs
- automatic package inspection and version detection
- multiple package versions side by side
- SHA-256 integrity tracking
- schema v5 profiles with exact package coordinates and optional configuration snapshots
- automatic profile generation from a satisfied configuration snapshot or directly from package selections
- compact local ZIP payload bundling for plugins/themes to keep hosting-panel extraction small
- configuration snapshot registry with source requirement matching
- offline distribution builder
- build manifest + SHA-256 hashes
- MU-plugin bootstrap with staged provisioning
- WordPress exporter with explicit setting whitelists
- synthetic end-to-end package-library and builder tests

## Phase 2 status

**Phase 2 is in progress as of v0.1.0-alpha.18.** Configuration inspection/comparison, security hardening, explicit starter targeting, Code Snippets restoration, and reusable Font Systems are now implemented.

In the GUI, open **Configurations → Inspect** to review a snapshot through Overview, Packages, WordPress, Structures, Adapters, and Safety tabs. Use **Configurations → Compare Snapshots** to compare a baseline export against a target export. The diff keeps software/package changes separate from portable setting changes and object/structure changes.

The comparison model currently covers WordPress/theme/plugin coordinates, WordPress options and permalink behavior, adapter values, starter pages, adapter status, and exporter safety boundaries. Builder alpha.18 also separates source inventory from starter targets, restores selected Code Snippets idempotently, hardens local/build-time archive handling and installer cleanup, and can bundle reusable static Font Systems into Elementor Pro Custom Fonts. Phase 2 continues with formal adapter remapping and portable object-backed structures such as Elementor templates and FilterX definitions.

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
node apps/cli/dist/index.js config compare snapshot-old snapshot-new
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

## Local GUI profile editor (alpha.12)

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
- creating profiles with locale, exact WordPress locale variant, theme version, plugin-version selection, and plugin exclusions,
- building the complete offline WordPress ZIP with live progress,
- creating package-only builds with no configuration snapshot,
- downloading previous builds.

The CLI remains supported for diagnostics, scripting, and CI.

## Versioned packages and localized WordPress core

The package library keeps multiple versions of the same plugin or theme. The GUI groups those versions under one package row, and Build profiles choose the exact version to use. Older versions are retained until explicitly removed so existing profiles stay reproducible.

WordPress core additionally has a locale variant. `WordPress 7.1 (en_US)` and `WordPress 7.1 (fa_IR)` are separate valid packages even though the core version is identical. Localized distributions are detected from WordPress package metadata/language files and can coexist in the same library.

The Build screen is a profile editor: choose the configuration snapshot, destination locale, exact WordPress package, theme version, and the version of each included plugin before saving/building the profile.


## Alpha.13: package-only builds and progress

The Build screen now allows **No snapshot — packages only**. In this mode the profile is assembled directly from the local package library and the generated starter installs the selected packages without applying reference-site settings. A custom theme is optional; choosing **Use WordPress default theme** leaves the theme shipped with the selected WordPress distribution untouched.

Builds now run as local asynchronous jobs. The GUI polls the same Builder Core job and shows actual stage progress while WordPress core, theme, plugins, configuration, manifest and final ZIP are processed.


## Alpha.14: profile management and build history

The local GUI now treats profiles as first-class reusable objects instead of burying them below the Build form. Saved profiles can be edited, duplicated, built directly, renamed, or deleted. Generated builds now persist sidecar metadata so Build History can show the source profile, locale, snapshot/package-only mode, SHA-256, timestamp, and provide Download / Build Again / Delete actions.
