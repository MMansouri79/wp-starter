# Reviewed Plugin Defaults

## v0.4.0

The values in `plugin_option_defaults` come from Reference Audit v3 of the confirmed real core site.

### Applied

#### Elementor

Only ordinary, portable options are applied:

- beta channel: `no`
- inspector: disabled/empty
- font display: `swap`
- landing pages activation: `0`

Site Kit values such as system colors, typography, container width/padding and breakpoints remain managed separately through `elementor_kit_settings`.

#### WooCommerce

The reviewed reusable baseline includes store behavior such as:

- allowed countries
- taxes toggle
- checkout field visibility
- currency and currency position
- units
- downloadable-product behavior
- AJAX add to cart and coupon behavior
- guest/account behavior
- reviews and ratings
- shipping display behavior
- inventory/stock behavior and thresholds
- price separators/decimals
- tax display behavior
- product image widths

No account, payment, address, email, key, page-ID, or generated runtime data is included.

#### Persian WooCommerce

The reviewed empty translation override array is preserved.

### Intentionally not applied

#### FilterX

`filterx_automatic_setup` is **not** copied raw even though it passed the safe-value audit. The reference value contains a `referenced_manual.filter_set_id` database ID (`162`) and therefore cannot be portable between sites as-is.

A later FilterX adapter should reconstruct the desired automatic setup from portable data instead of transplanting a database ID.

#### Elementor Pro

No Elementor Pro option values are copied. License/connect data, version/install history and Theme Builder conditions are intentionally excluded.

### Safety rule

Absence is meaningful. If a reviewed option does not exist on the core site, Site Starter does not manufacture a value for it merely to make the configuration look busier.
