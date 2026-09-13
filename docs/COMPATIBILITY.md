# Compatibility Matrix

Configuration-enabled profiles are checked against a published baseline before a CLI or GUI build starts. An exact match is `known-good`. A profile with the same locale, theme slug, and plugin slugs may select numerically higher local WordPress, theme, or plugin versions and receives an `upgrade-warning`; the exported settings are still imported unchanged. Package-only profiles remain available for arbitrary exact local packages.

The initial reference combinations are stored in [`compatibility/known-good.json`](../compatibility/known-good.json):

| ID | WordPress | PHP | Theme | Scope |
| --- | --- | --- | --- | --- |
| `elementor-en-wp71` | 7.1 `en_US` | 8.2 | Hello Elementor 3.4.9 | Elementor baseline |
| `ecommerce-fa-wp71` | 7.1 `fa_IR` | 8.2 | Hello Elementor 3.4.9 | Persian commerce baseline |

An unsupported combination fails with an actionable `unsupported_compatibility` error. Plugin downgrades, theme or WordPress changes, locale changes, plugin-set changes, missing packages, checksum failures, and incompatible package dependencies remain blocking. Add a new entry only after it has been reproduced and verified on a clean installation.

The compatibility report is also included in the build manifest and Build History metadata. Check a profile from the CLI with:

```text
wp-starter compatibility check <profile.json>
```
