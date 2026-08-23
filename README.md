# Site Starter

A private WordPress starter plugin for reproducing a reviewed development baseline on clean WordPress installs without cloning media, users, client content, orders, or an entire old database.

## Current baseline: v0.5.0

The real core-site audit established **Hello Elementor** as the reference theme and the following plugin stack:

### Elementor profile
- Classic Editor
- Elementor
- Elementor Pro (copied from the reference site into the offline bundle)

### Elementor + WooCommerce profile
- Classic Editor
- Elementor
- Elementor Pro (copied from the reference site into the offline bundle)
- WooCommerce
- Persian WooCommerce
- FilterX (copied from the reference site into the offline bundle)

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

## Reference-site workflow

There are now two different exports, because they solve different problems:

1. **Reference Audit** exports safe configuration metadata/whitelisted values for development and review.
2. **Offline Installer** packages the actual installed code files required to deploy a new site with no internet access.

Do **not** run Initial Setup on the reference site. Instead:

1. Install/upgrade the development copy of Site Starter on the configured reference site.
2. Open **Site Starter → Offline Installer**.
3. Click **Build Complete Offline Installer**.
4. Site Starter packages one dependency per request to avoid gateway timeouts.
5. Download the generated `site-starter-offline-vX.Y.Z-....zip`.

The generated ZIP contains:

- Site Starter itself
- the actual installed Hello Elementor theme directory
- Classic Editor
- Elementor
- Elementor Pro
- WooCommerce
- Persian WooCommerce
- FilterX
- the reference site's installed `wp-content/languages` files, including Persian core/plugin/theme translations
- a bundle manifest recording source versions

The generated installer does **not** contain uploads, products, orders, users, page/post bodies, database credentials, payment settings, API keys or Elementor Pro license database values.

## Fully offline destination workflow

Start with any fresh WordPress installation. The destination server may have zero outbound internet access.

1. WordPress Admin → Plugins → Add New → Upload Plugin.
2. Upload the generated **offline installer ZIP**, not the small development/source ZIP.
3. Activate **Site Starter**.
4. Open **Site Starter → Initial Setup**.
5. Choose the site language and project profile.
6. Run setup.

Theme, plugins and Persian language files are installed only from ZIP files embedded inside Site Starter. Site Starter 0.5+ does not call WordPress.org during Initial Setup.

## Locale-aware setup

One offline installer supports both general/English and Persian sites.

- **Keep current WordPress language**: leaves the destination locale alone.
- **English (en_US)**: sets the destination to English and does not install Persian WooCommerce.
- **Persian (fa_IR)**: extracts the bundled language archive, switches WordPress to `fa_IR`, and includes Persian WooCommerce in the setup queue.

The Persian package is still present in the installer even when an English site does not use it, so one deployment ZIP can serve both workflows.

## Reference Audit

Use **Site Starter → Reference Audit** when configuration settings change and the baseline needs to be reviewed again.

Audit v3 includes installed plugin inventory, selected WordPress settings, page names, portable Elementor Site Kit values, plugin option metadata, and values only for an explicitly reviewed safe whitelist. It still excludes uploads, users, content bodies, products/orders, arbitrary option values, credentials, license keys and payment settings.

## Confirmed starter pages

Both profiles create only these reusable blank pages:

- Home (`home`)
- About (`about`)
- Contact (`contact`)
- Blog (`blog`)

The core site uses **Your latest posts**, so Site Starter intentionally does not assign Home as the front page or Blog as the posts page. WooCommerce manages its own default store pages.

## Confirmed WordPress baseline

The starter preserves the reference site's WordPress settings as-is, including:

- permalink structure: `/%year%/%monthnum%/%day%/%postname%/`
- comments: open
- pingbacks: open
- user registration: disabled
- front page mode: latest posts
- start of week: Saturday (`6`)
- image sizes: 150 / 300 / 1024

## Reviewed plugin defaults

The approved Audit v3 values remain in the setup baseline.

- Elementor: portable option values plus reviewed Site Kit defaults
- WooCommerce: reviewed currency, checkout, inventory, download, review, shipping, price, tax-display and image-size behavior
- Persian WooCommerce: reviewed translation override state
- FilterX: its plugin files are bundled, but its raw `filterx_automatic_setup` database value is still not transplanted because it contains a site-specific `filter_set_id`
- Elementor Pro: plugin files are bundled, but license/connect database values are not copied

See `docs/PLUGIN-DEFAULTS.md` for the settings safety boundary.

## Staged runners

Both major workflows are staged:

- **Offline Installer build**: packages one theme/plugin/language payload per request, then assembles the final ZIP.
- **Initial Setup**: installs one dependency or applies one configuration group per request.

This avoids one giant `admin-post.php` operation hitting common hosting gateway timeouts.

## Git and proprietary packages

The Git repository contains only Site Starter source code. Generated package ZIPs and the bundle manifest are ignored by Git.

Premium/proprietary plugin code is copied only into the private installer ZIP generated from your own reference site. Keep that installer private and use it subject to the licenses for the plugins it contains.

## Safety principles

1. Deployment dependencies come from the controlled reference site, not the public internet.
2. Whitelist database setting values; never clone arbitrary database rows.
3. Never store credentials, license keys or client identifiers in the source repository.
4. Setup tasks remain idempotent and resumable.
5. Locale-specific behavior is selected per destination site.
6. One-time provisioning stays separate from future permanent runtime functionality.
7. The reference audit remains the review mechanism for configuration changes.

