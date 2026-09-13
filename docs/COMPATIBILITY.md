# Compatibility Matrix

The Builder supports exact package coordinates. Configuration-enabled profiles must match a published known-good combination before a CLI or GUI build starts. Package-only profiles remain available for arbitrary exact local packages.

The initial reference combinations are stored in [`compatibility/known-good.json`](../compatibility/known-good.json):

| ID | WordPress | PHP | Theme | Scope |
| --- | --- | --- | --- | --- |
| `elementor-en-wp71` | 7.1 `en_US` | 8.2 | Hello Elementor 3.4.9 | Elementor baseline |
| `ecommerce-fa-wp71` | 7.1 `fa_IR` | 8.2 | Hello Elementor 3.4.9 | Persian commerce baseline |

An unsupported combination fails with an actionable `unsupported_compatibility` error. Add a new entry only after it has been reproduced and verified on a clean installation.
