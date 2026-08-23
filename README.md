# Site Starter

A private WordPress starter plugin for reproducing a reviewed development baseline on clean WordPress installs without cloning media, users, content, orders, or an entire database.

## v0.1.0 goals

- Safe Reference Site Audit JSON
- Elementor and WooCommerce starter profiles
- Install/activate configured WordPress.org plugins
- Apply conservative WordPress defaults
- Remove default WordPress sample content
- Create starter pages without duplicates
- Assign static Home and Blog pages
- Framework for reviewed Elementor Site Settings
- Idempotent setup behavior

## Install

1. Zip the `site-starter` directory.
2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Activate **Site Starter**.
4. Open **Tools → Site Starter**.

## First use on the reference site

Do **not** run Initial Setup on the existing reference site.

Use **Download Reference Audit JSON**. The audit intentionally excludes:

- uploads/media
- users
- post/page content
- WooCommerce orders/customers
- arbitrary `wp_options`
- Code Snippets source code
- credentials and API keys by design

The audit is used to review which settings should become version-controlled starter defaults.

## First use on a new site

Open **Tools → Site Starter**, choose a profile, select components, and run **Initial Setup**.

## Premium plugins

v0.1.0 only installs plugins from WordPress.org. Premium/private package support will be added after the reference audit defines which packages belong in the baseline. License keys will never be stored in this repository.

## Safety principles

1. Whitelist settings. Never clone arbitrary database rows.
2. Never store credentials or client identifiers.
3. Setup tasks must be safe to run more than once.
4. One-time setup and permanent runtime behavior stay separate.
5. Reference-site extraction is reviewed before it becomes a default.
