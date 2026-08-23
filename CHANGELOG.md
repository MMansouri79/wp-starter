# Changelog

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
