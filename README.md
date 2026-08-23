# Site Starter

A private WordPress starter plugin for reproducing a reviewed development baseline on clean WordPress installs without cloning media, users, client content, orders, or an entire old database.

## Current baseline: v0.2.0

The first real reference audit established **Hello Elementor** as the reference theme and the following plugin stack:

### Elementor profile
- Classic Editor
- Elementor
- Elementor Pro (bundled/private ZIP)

### Elementor + WooCommerce profile
- Classic Editor
- Elementor
- Elementor Pro (bundled/private ZIP)
- WooCommerce
- Persian WooCommerce
- FilterX (bundled/private ZIP)

Site Starter itself is the installer and is not part of its own target manifest.

## Install

1. Build or download the `site-starter` ZIP.
2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Activate **Site Starter**.
4. Use the dedicated **Site Starter** admin menu.

## Reference-site workflow

Do **not** run Initial Setup on the existing reference site.

Use **Site Starter → Reference Audit → Download Reference Audit JSON**.

Audit v2 includes:
- installed plugin inventory
- selected WordPress settings
- page titles/slugs/status/template, but not page content
- portable Elementor Site Kit settings
- Code Snippets inventory without code
- theme-mod keys without values
- candidate plugin option names, lengths and autoload metadata without option values

It intentionally excludes:
- uploads/media
- users
- post/page bodies
- products/orders/customers
- arbitrary plugin option values
- Code Snippets source code
- passwords, API keys and credentials

## New-site workflow

Open **Site Starter → Initial Setup**, choose a profile, select components, and run **Initial Setup**.

Current components:
- install/activate Hello Elementor
- install/activate profile plugins
- apply WordPress baseline
- apply reviewed plugin settings
- remove Hello World / Sample Page
- create starter pages
- apply reviewed Elementor defaults

## Private / premium plugins

Private plugin packages use the bundled-package convention:

```text
packages/
├── elementor-pro.zip
└── filterx.zip
```

Those ZIP files are ignored by Git and are not included in the source repository. Add your legally obtained/current package files before building your personal deployment ZIP.

License activation remains site-specific and is never stored in this repository.

## Safety principles

1. Whitelist setting values. Never clone arbitrary database rows.
2. Candidate discovery may export option names, never unreviewed option values.
3. Never store credentials, license keys or client identifiers.
4. Setup tasks should be safe to run more than once.
5. One-time setup and permanent runtime behavior stay separate.
6. Reference-site extraction is reviewed before it becomes a default.
