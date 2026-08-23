# Reference Audit Workflow

## Audit v2

1. Install/update Site Starter on the fully configured reference site.
2. Open **Site Starter → Reference Audit**.
3. Click **Download Reference Audit JSON**.
4. Review/share that JSON for baseline extraction.
5. Do not run Initial Setup on the reference site.

Audit v2 adds safe discovery data needed to finish the baseline:

- page titles/slugs/status/template without page bodies
- theme-mod keys without values
- candidate `wp_options` names for known plugins
- candidate option value lengths and autoload metadata

It still does **not** export candidate option values. This gives enough information to build an explicit whitelist before any plugin-setting value is copied.

## Why two-stage plugin settings discovery?

Plugin settings frequently live beside API tokens, account identifiers, email addresses, domain-specific configuration and transient/runtime data. Copying whole option arrays before review would defeat the point of a clean starter.

The workflow therefore remains:

1. discover option names safely;
2. review the candidates;
3. add an explicit whitelist;
4. export/apply only reviewed reusable values.
