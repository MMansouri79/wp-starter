# Changelog

## 0.4.1 - 2026-08-23

### Fixed
- Replaced the single long-running Initial Setup request with a staged, resumable setup queue to prevent common 504 Gateway Timeout failures on managed/shared hosting.
- Theme installation and every plugin installation now execute in separate HTTP requests.
- A timed-out step remains pending, so revisiting Initial Setup safely retries that step instead of restarting the whole installation.

### Added
- Setup progress UI with completed/total step count and current task.
- Persistent per-user setup state for up to six hours.
- Cancel Setup action that preserves already completed idempotent work.

## 0.4.0 - 2026-08-23

### Added
- Promoted approved Audit v3 Elementor, WooCommerce and Persian WooCommerce values into the real setup baseline.
- Added `docs/PLUGIN-DEFAULTS.md` documenting applied values and the safety boundary.
- Added the audited Hello Elementor footer copyright setting to portable Site Kit defaults.

### Changed
- Initial Setup now applies 66 reviewed plugin option values when the corresponding plugins are active.
- WooCommerce behavior now reproduces the confirmed core-site defaults for currency, checkout, inventory, downloads, reviews, shipping display, price formatting, tax display and product image widths.

### Safety
- FilterX `filterx_automatic_setup` is not copied raw because the audited value contains the site-specific manual filter-set ID `162`.
- Elementor Pro license/connect values remain excluded.
- Payment, store identity/contact data, page IDs, logs, generated IDs and onboarding/runtime state remain excluded.

## 0.3.0 - 2026-08-23

### Added
- Reference Audit v3 with an explicit reviewed plugin-option value whitelist.
- Safe `reviewed_plugin_option_values` section for final plugin-default extraction.
- Confirmed real-core starter page manifest: Home, About, Contact, Blog.

### Changed
- Locked the WordPress baseline to the real core site exactly as audited.
- Renamed starter pages from About Us / Contact Us to About / Contact.
- Kept Home and Blog intentionally unassigned because the core site uses latest posts.
- Documented that WooCommerce default store pages are not custom starter pages.
- Updated reference-audit documentation and roadmap for the staged settings workflow.

### Safety
- Audit v3 still never exports arbitrary plugin option values.
- Credentials, license keys, payment settings, page IDs, client identity/contact values, logs and runtime state remain excluded from the reviewed-value whitelist.
- Exported reviewed values are not applied automatically; they require a second explicit promotion into `plugin_option_defaults`.

## 0.2.0 - 2026-08-23

### Added
- Hello Elementor theme installer/activator based on the reference audit.
- Real plugin manifest based on the first reference-site audit.
- Classic Editor and Persian WooCommerce WordPress.org installers.
- Bundled/private package support for Elementor Pro and FilterX.
- `packages/` convention with ZIP files excluded from Git.
- Safe page title/slug/status/template inventory in reference audit v2.
- Theme-mod key inventory without theme-mod values.
- Plugin option candidate discovery that exports option names, sizes and autoload metadata only.
- Reviewed plugin-settings runner framework for future whitelisted defaults.
- Bundled-package status on the Site Starter dashboard.

### Changed
- Corrected the plugin version header/constant so WordPress reports the real release version.
- Replaced placeholder ACF/Code Snippets manifest entries with the actual reference-site plugin stack.
- Aligned the WordPress baseline with the first safe reference audit.
- Added portable Elementor kit defaults from the reference site while excluding site name and WooCommerce page IDs.
- Starter pages are no longer automatically assigned as Home/Blog because the reference site currently uses latest posts.
- Reference Audit now reports `audit_version: 2`.

### Safety
- Private/premium ZIPs remain outside Git by default.
- Plugin option candidate values are never exported by the audit.
- Site-specific Elementor identity/page-ID settings are excluded from portable kit settings.

## 0.1.1 - 2026-08-23

### Changed
- Promoted Site Starter to its own top-level WordPress admin menu.
- Split Dashboard, Reference Audit, and Initial Setup into dedicated admin screens.
- Added clearer reference-site safety guidance and direct dashboard actions.

## 0.1.0 - 2026-08-23

### Added
- Initial plugin architecture.
- Reference Site Audit JSON export.
- Elementor and WooCommerce setup profiles.
- WordPress.org plugin installer/activator.
- WordPress baseline settings runner.
- Default-content cleanup.
- Idempotent starter page creation.
- Static homepage/posts page assignment.
- Elementor options and active-kit settings framework.
- Setup run state and admin result reporting.
