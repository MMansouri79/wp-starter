# Roadmap

## v0.1.0 — Foundation + reference audit
- Working admin page
- Reference audit
- Core setup runner
- Basic profiles
- WordPress.org plugin install/activate
- WordPress defaults
- Starter pages

## v0.2.0 — Encode the real reference baseline
Input: JSON exported from the user's configured reference site.

- Final plugin manifest
- Classify plugins: core / WooCommerce / optional / excluded
- Review WordPress defaults
- Review Elementor options
- Review Elementor active-kit settings
- Add selected global CSS settings
- Identify snippets for migration into runtime modules

## v0.3.0 — Plugin-specific defaults
- Add whitelisted settings adapters per plugin
- Never copy complete option tables
- Secret/key denylist and validation
- Per-setting reset/skip behavior

## v0.4.0 — Premium/private packages
- Optional local ZIP package directory or upload flow
- Elementor Pro support without license-key storage
- Clear manual license activation status

## v0.5.0 — Permanent runtime modules
- Reusable WordPress hooks
- Reusable Elementor hooks
- Reusable WooCommerce hooks
- Global CSS/JS modules
- Feature toggles

## Later
- Import/export starter manifests
- Setup dry-run/diff view
- WP-CLI command
- Automated release ZIPs
- Signed/versioned configuration migrations
