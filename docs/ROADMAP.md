# Roadmap

## v0.1.0 — Foundation + reference audit
- Working admin page
- Reference audit
- Core setup runner
- Basic profiles
- WordPress.org plugin install/activate
- WordPress defaults
- Starter pages

## v0.2.0 — Reference discovery
- Real plugin manifest from the reference audit
- Hello Elementor installer
- Bundled/private package convention
- Safe page inventory
- Candidate plugin option-name discovery
- Portable Elementor kit baseline

## v0.3.0 — Lock the real core baseline
- Confirm Home / About / Contact / Blog as the only custom starter pages
- Keep the real core WordPress settings exactly as-is
- Keep Home/Blog unassigned because the core site uses latest posts
- Add audit v3 reviewed-value whitelist
- Export only approved safe plugin setting values for final review

## v0.4.0 — Apply plugin-specific defaults
- ✅ Promote approved audit-v3 Elementor, WooCommerce and Persian WooCommerce values into `plugin_option_defaults`
- ✅ Keep IDs, secrets, payment credentials and site identity excluded
- ✅ Reject raw FilterX automatic-setup migration because it contains a site-specific filter-set ID
- ⏭ Add a portable FilterX adapter in a later release
- ⏭ Add per-setting skip/reset behavior in a later release

## v0.5.0 — Deployment packages
- Improve local ZIP package workflow
- Elementor Pro package status/install flow
- FilterX package status/install flow
- Clear manual license activation status

## v0.6.0 — Permanent runtime modules
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
