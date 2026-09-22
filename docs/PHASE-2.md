# Phase 2 — Portable Configuration Engine

**Status: IN PROGRESS as of v0.1.0-alpha.32.**

Phase 2 moves WP Starter from a reliable offline package installer to a portable configuration system. The rule is strict: configuration is transported only when an adapter can define what is reusable, what must be remapped, and what must be excluded.

## Milestone 2.1 — Configuration Inspector ✅

The read-only Inspector exposes:

- source WordPress/PHP/locale/theme/plugin versions,
- exact package-library availability,
- portable WordPress options, permalink behavior, cleanup policy, and starter pages,
- adapter payloads and counts,
- deferred adapter reasons,
- exporter safety/exclusion flags.

The GUI now separates this into Overview, Packages, WordPress, Structures, Adapters, and Safety tabs so larger snapshots remain readable.

## Milestone 2.2 — Snapshot Comparison ✅

Two imported snapshots can now be compared as baseline → target. The comparison deliberately separates four categories:

1. **Binary changes** — WordPress version/locale, theme version, plugin additions/removals/version changes.
2. **Configuration changes** — portable WordPress values, permalink/cleanup behavior, and adapter option/settings values.
3. **Structural changes** — starter pages and adapter capability/status changes. Source-aware Elementor template inventory and composition now live in the Builder flow; comparison of template collections remains a future diff enhancement.
4. **Safety-boundary changes** — changes to what the exporter includes or deliberately excludes.

The comparison engine is available both through the GUI and the CLI `config compare` command.

## Milestone 2.3 — Sample Content Library ✅

Build profiles can install Builder-authored sample content through profile schema v9 (`sampleContentIds`). Sample content is authored in the Builder and never derived from exported site data, so it stays inside the same allowlist boundary as the rest of the architecture.

- Classic posts and WooCommerce simple, variable, grouped, and external products with the standard editorial and catalog fields.
- Terms are installed with their real taxonomy, slug, and hierarchy; global attributes become real `pa_*` taxonomies with terms.
- Assets are imported offline only (JPEG/PNG/GIF/WebP images up to 20 MiB, PDF/plain-text downloads up to 50 MiB), signature-checked, checksum-verified, and capped at 500 MiB per build.
- Selections close over linked products (upsells, cross-sells, grouped children), term ancestors, and referenced assets. Selecting any product requires an explicitly version-selected WooCommerce package for the profile locale.
- Builds bundle `starter-sample-content.json` plus only the selected assets, and record `sampleContentPayload` provenance in manifest v4.
- Bootstrap installs samples in resumable phases (attributes, terms, assets, content, relationships, publish, verify) under an installation lock, stages content as drafts, remaps logical references, and verifies slugs, statuses, and term assignments before completing setup. Conflicting destination slugs, SKUs, or terms stop with an actionable error; unrelated destination content is never overwritten.
- Content previews never execute sample HTML, and inline images use logical placeholders remapped to attachment URLs at install time.

## Next milestones

1. **Adapter contracts and remapping** — formalize export/import/validate/remap hooks for Elementor, WooCommerce, FilterX, and future plugins.
2. **Portable structures/layouts** — Elementor templates are inventoried per source snapshot, selected across snapshots, dependency-closed, namespaced during composition, and remapped at bootstrap without copying destination-specific database IDs. FilterX definitions remain deferred.
3. **Larger-site validation** — compare reference and reproduced sites using the inspection/diff engine and turn every unexplained difference into an adapter requirement.

Raw database cloning, credential migration, and arbitrary `wp_options` copying remain outside the architecture.
