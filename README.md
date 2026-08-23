# Site Starter

A private WordPress starter plugin for reproducing a reviewed development baseline on clean WordPress installs without cloning media, users, client content, orders, or an entire old database.

## Current baseline: v0.4.1

The real core-site audit established **Hello Elementor** as the reference theme and the following plugin stack:

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

## Confirmed starter pages

Both profiles create only these reusable blank pages:

- Home (`home`)
- About (`about`)
- Contact (`contact`)
- Blog (`blog`)

The core site currently uses **Your latest posts**, so Site Starter intentionally does not assign Home as the front page or Blog as the posts page. WooCommerce is allowed to create/manage its own default store pages rather than treating those as custom starter pages.

## Confirmed WordPress baseline

The starter preserves the real core site's WordPress settings as-is, including:

- permalink structure: `/%year%/%monthnum%/%day%/%postname%/`
- comments: open
- pingbacks: open
- user registration: disabled
- front page mode: latest posts
- start of week: Saturday (`6`)
- image sizes: 150 / 300 / 1024

## Install

1. Build or download the `site-starter` ZIP.
2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Activate **Site Starter**.
4. Use the dedicated **Site Starter** admin menu.

## Reference-site workflow

Do **not** run Initial Setup on the existing reference site.

Use **Site Starter → Reference Audit → Download Reference Audit JSON**.

Audit v3 includes:
- installed plugin inventory
- selected WordPress settings
- page titles/slugs/status/template, but not page content
- portable Elementor Site Kit settings
- Code Snippets inventory without code
- theme-mod keys without values
- candidate plugin option names, lengths and autoload metadata without arbitrary option values
- values only for a small, explicitly reviewed plugin-option whitelist

It intentionally excludes:
- uploads/media
- users
- post/page bodies
- products/orders/customers
- arbitrary plugin option values
- Code Snippets source code
- credentials, license keys and payment settings
- client identity/contact data

The reviewed v3 values have now been promoted into `plugin_option_defaults` where they are portable and safe. Elementor, WooCommerce and Persian WooCommerce defaults are applied by Initial Setup. FilterX raw automatic-setup data remains excluded because it contains a site-specific database ID.


## Reviewed plugin defaults

v0.4.1 retains the approved Audit v3 values in the actual setup baseline.

- Elementor: portable option values plus the already-reviewed Site Kit defaults
- WooCommerce: reviewed store behavior, inventory, checkout, price, review, tax-display, shipping-display and image-size defaults
- Persian WooCommerce: reviewed translation override state
- FilterX: installation only for now; its raw `filterx_automatic_setup` value is not transplanted because it contains a site-specific `filter_set_id`
- Elementor Pro: installed from the private package, but no license/connect values are copied

See `docs/PLUGIN-DEFAULTS.md` for the detailed safety boundary.

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

## Staged setup runner

v0.4.1 changes Initial Setup from one long `admin-post.php` request into a resumable queue. Theme installation, each plugin installation, WordPress defaults, plugin defaults, cleanup, page creation, and Elementor defaults each run as separate HTTP requests.

If hosting returns a gateway timeout during a single plugin step, revisit **Site Starter → Initial Setup**. The unfinished step remains queued and can be retried safely; already completed idempotent steps are not repeated unnecessarily.

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
2. Candidate discovery exports option names, not arbitrary values.
3. Only explicitly reviewed safe option names may export values in audit v3.
4. Never store credentials, license keys or client identifiers.
5. Setup tasks should be safe to run more than once.
6. One-time setup and permanent runtime behavior stay separate.
7. Reference-site extraction is reviewed before it becomes a default.
