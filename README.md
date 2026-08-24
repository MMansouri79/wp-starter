# WP Starter System

A self-contained WordPress starter build system for offline or restricted hosting.

The project is intentionally split into three responsibilities:

1. **Starter Exporter** runs on the reference WordPress site and exports only approved portable configuration.
2. **Builder CLI** runs on a developer machine and combines a local WordPress ZIP, local plugin/theme ZIPs, a configuration export, and the bootstrap runtime.
3. **Starter Bootstrap** ships inside the generated WordPress distribution as an MU plugin and applies the exported configuration after the normal WordPress database/admin installer finishes.

No part of the generated starter distribution needs WordPress.org or internet access.

## Phase 1 status

This repository currently implements the Phase 1 build pipeline:

- versioned JSON profile
- local ZIP-only WordPress/plugin/theme inputs
- configuration-export ZIP
- offline distribution builder
- build manifest + SHA-256 hashes
- MU-plugin bootstrap with staged provisioning
- WordPress exporter with explicit whitelists
- synthetic end-to-end builder test

## Quick start

1. Install `wordpress/exporter` on the reference site.
2. Export `starter-config.zip`.
3. Put your local ZIP packages outside Git.
4. Copy `profiles/ecommerce-fa.example.json` to a private profile and update its paths.
5. Run:

```bash
npm install
npm run build
node apps/cli/dist/index.js build --profile /path/to/profile.json --output /path/to/starter.zip
```

On an offline new server:

1. Create an empty database and database user.
2. Extract the generated starter ZIP into the document root.
3. Run the normal WordPress installer and create the admin account.
4. Open wp-admin. The bundled MU-plugin activates the selected theme/plugins and applies the starter configuration.

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
