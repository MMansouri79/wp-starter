# Reference Audit Workflow

## Audit v3

1. Install/update Site Starter on the fully configured reference site.
2. Open **Site Starter → Reference Audit**.
3. Click **Download Reference Audit JSON**.
4. Review/share that JSON for baseline extraction.
5. Do not run Initial Setup on the reference site.

Audit v3 contains two plugin-setting layers:

### Discovery layer

- candidate `wp_options` names for known plugins
- candidate value lengths
- autoload metadata
- **no arbitrary candidate values**

### Reviewed-value layer

`config/starter.php` contains `reference_value_whitelist`. Only option names explicitly listed there may have their current values exported under `reviewed_plugin_option_values`.

The whitelist intentionally avoids:

- license keys / connection keys
- payment gateway settings
- store/client email, address and phone data
- WooCommerce page IDs
- Elementor Theme Builder conditions that contain template IDs
- logs, diagnostics, install history and onboarding/runtime state
- generated IDs and version/schema markers

Exporting a value does not automatically make it a starter default. The value is reviewed first, then explicitly copied into `plugin_option_defaults` if it is genuinely reusable.

## Why staged plugin-setting extraction?

Plugin settings frequently live beside API tokens, account identifiers, email addresses, domain-specific configuration and runtime data. Copying complete option arrays would turn a clean starter into a tiny credential migration utility, which is precisely the sort of efficiency nobody asked for.

The workflow is therefore:

1. discover option names safely;
2. review candidates;
3. whitelist reusable option names;
4. export only those reviewed values;
5. review the values;
6. explicitly promote approved values into starter defaults.
