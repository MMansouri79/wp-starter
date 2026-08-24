# Phase 2 — Portable Configuration Engine

**Status: IN PROGRESS as of v0.1.0-alpha.15.**

Phase 2 moves WP Starter from a reliable offline package installer to a portable configuration system. The rule is strict: configuration is transported only when an adapter can define what is reusable, what must be remapped, and what must be excluded.

## Milestone 2.1 — Configuration Inspector

The first Phase 2 milestone is read-only visibility. Before adding more migration behavior, the Builder must make each snapshot understandable.

The inspector exposes:

- source WordPress/PHP/locale/theme/plugin versions,
- exact package-library availability,
- portable WordPress options, permalink behavior, cleanup policy, and starter pages,
- adapter payloads and counts,
- deferred adapter reasons,
- exporter safety/exclusion flags.

This gives larger-site testing a concrete diff surface. Missing portability is visible instead of being inferred from a failed build.

## Next milestones

1. **Snapshot comparison and diagnostics** — compare two exports and show added/removed/changed portable values.
2. **Adapter contracts and remapping** — formalize export/import/validate/remap hooks for Elementor, WooCommerce, FilterX, and future plugins.
3. **Portable structures/layouts** — move object-backed structures such as Elementor templates and FilterX definitions without copying destination-specific database IDs.

Raw database cloning, credential migration, and arbitrary `wp_options` copying remain outside the architecture.
