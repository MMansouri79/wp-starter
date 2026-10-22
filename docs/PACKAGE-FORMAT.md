# Package and profile format

## Local package library

Builder schema v2 profiles do not contain filesystem paths to WordPress, theme, or plugin ZIPs.
They reference exact package coordinates stored in the local package library.

Default library location:

```text
~/.wp-starter/
├── registry.json
└── packages/
    ├── wordpress/
    ├── theme/
    └── plugin/
```

Add arbitrary local packages with:

```bash
wp-starter package add ./wordpress-7.1.zip
wp-starter package add ./hello-elementor.zip
wp-starter package add ./some-plugin.zip
```

The builder inspects package headers and records:

- package type
- name
- package slug
- exact version
- original install directory
- main plugin file when applicable
- text domain when declared
- WordPress/PHP requirements when declared
- plugin dependency headers when declared
- SHA-256

The original ZIP is copied into the library. Multiple versions of the same package may coexist.
For plugins/themes, the same `type + slug + version` cannot silently change bytes; use `--replace` explicitly when that is intentional. WordPress core adds a locale variant, so `wordpress@7.1 (en_US)` and `wordpress@7.1 (fa_IR)` can coexist with different bytes.

## Configuration export ZIP

The exporter produces a ZIP containing:

```text
starter-config.json
export-manifest.json
```

`starter-config.json` is portable configuration data.

Schema-v2 exports may include `source.site_domain`. This is only the lowercase
hostname from the reference site's `home_url()`; it never contains a scheme,
credentials, port, path, query, or fragment. Older exports without the field
are shown as `Unknown — legacy export` and remain importable.

`export-manifest.json` describes the source site and exporter version.

## Build profile schema v2

Schema v2 references exact versions from the package library:

```json
{
  "schemaVersion": 2,
  "name": "ecommerce-fa",
  "locale": "fa_IR",
  "wordpress": {
    "version": "7.1"
  },
  "theme": {
    "slug": "hello-elementor",
    "version": "3.4.9"
  },
  "plugins": [
    {
      "slug": "elementor",
      "version": "4.0.8",
      "required": true
    },
    {
      "slug": "persian-woocommerce",
      "version": "10.0.4",
      "required": true,
      "locales": ["fa_IR"]
    }
  ],
  "configExport": "../exports/core-config.zip",
  "languageArchives": []
}
```

Exact version pinning is deliberate. Updating a package means adding its new ZIP and changing the profile, not mutating builder code.

The hosted server can optionally download new WordPress.org plugin releases into a team's library. In **Packages → Automatic plugin updates**, a team owner or administrator confirms which existing plugin slugs came from WordPress.org and enables the team-wide switch. It is disabled by default. Private, premium, infrastructure, and unconfirmed plugins are excluded. Only stable numeric releases are compared; unusual local version strings are skipped for manual review. Each release goes through the existing ZIP inspection, package identity checks, checksum registry, and team quota checks. Older versions remain available, and exact profile pins are never changed. Downloading a newer release does not certify compatibility with a profile or snapshot.

Schema v1 path-based profiles remain readable during the Phase 1 transition but are deprecated.

## Generated distribution metadata

`wp-content/starter-package/starter-build.json` records:

- profile name
- requested locale
- WordPress/theme/plugin versions
- SHA-256 of every input artifact
- builder version
- build timestamp


## Generated distribution layout (manifest schema v2)

The outer deployment ZIP keeps WordPress core expanded but carries third-party binaries as nested local package ZIPs:

```text
wp-admin/
wp-includes/
wp-content/
  mu-plugins/
    site-starter-bootstrap.php
  starter-package/
    starter-config.json
    starter-build.json
    packages/
      themes/
        hello-elementor-3.4.9.zip
      plugins/
        elementor-4.0.8.zip
        woocommerce-10.9.4.zip
      languages/
        ...
```

`starter-build.json` schema v2 stores each bundled package path and SHA-256. Bootstrap validates the checksum before extraction, installs packages from local disk only, and processes expensive package extraction in separate admin requests.

## Archive portability

Generated deployment ZIP entry names always use `/` separators, even when the Builder runs on Windows. This is required for reliable extraction by Linux hosting panels such as Plesk. Plugin/theme payload ZIPs remain nested and are installed later by Bootstrap.


## Build profile schema v4

Schema v4 makes the selected WordPress distribution explicit and keeps configuration independent from package versions:

```json
{
  "schemaVersion": 4,
  "name": "store-test",
  "locale": "en_US",
  "wordpress": { "version": "7.1", "variant": "en_US" },
  "theme": { "slug": "hello-elementor", "version": "3.4.9" },
  "plugins": [
    { "slug": "elementor", "version": "4.2.1", "required": true },
    { "slug": "woocommerce", "version": "10.9.4", "required": true }
  ],
  "config": { "id": "snapshot-20260824050124" }
}
```

The configuration snapshot can come from a site that used older plugin versions. A profile may deliberately pin newer package versions while reusing the same portable settings snapshot; compatibility remains the developer's responsibility and is validated further in Phase 2 adapters.


## Build profile schema v5

Schema v5 makes the configuration snapshot and custom theme optional:

```json
{
  "schemaVersion": 5,
  "name": "packages-only",
  "locale": "en_US",
  "wordpress": { "version": "7.1", "variant": "en_US" },
  "theme": null,
  "plugins": [
    { "slug": "elementor", "version": "4.2.1", "required": true },
    { "slug": "woocommerce", "version": "10.9.4", "required": true }
  ],
  "config": null
}
```

When `config` is `null`, Builder does not embed `starter-config.json` and Bootstrap performs only local package installation/activation. It does not apply exported WordPress, Elementor, WooCommerce, or other adapter settings. When `theme` is `null`, Bootstrap keeps the theme provided by the WordPress distribution.

## Generated distribution layout (manifest schema v4)

Manifest schema v3 added `configurationEnabled` and nullable `theme`/`configExport`. Schema v4 adds optional design-system provenance and checksum entries for `starter-design-system.json` and `starter-elementor-templates.json`. The `elementorTemplates` inventory can now be populated in package-only builds and records a library ID plus source provenance for v8 assets.

Standalone Font Profiles remain available to v7 profiles and template-only v8
profiles. A profile may use the
legacy singular `fontSystem` reference or the optional `fontSystems` array to
select several profiles. Builds bundle each selected profile into the v4
manifest's `fontSystems` array; the legacy `fontSystem` field mirrors the first
profile for older installers. Bootstrap registers each profile's font family
and faces with Elementor Pro.

## Build profile schema v7

Schema v7 adds explicit, source-aware Elementor template selection while
keeping the base configuration snapshot separate from the template sources:

```json
{
  "schemaVersion": 7,
  "name": "composed-store",
  "locale": "en_US",
  "wordpress": { "version": "7.1", "variant": "en_US" },
  "theme": { "slug": "hello-elementor", "version": "3.4.9" },
  "plugins": [
    { "slug": "elementor", "version": "4.2.1", "required": true }
  ],
  "config": { "id": "snapshot-base" },
  "fontSystem": null,
  "elementorTemplates": [
    { "snapshotId": "snapshot-base", "templateId": "elementor-header" },
    { "snapshotId": "snapshot-store", "templateId": "elementor-footer" }
  ]
}
```

Each selected template is verified against its source snapshot and checksum.
Template dependencies expressed as `$wpStarterRef` `template:` references are
closed within the same snapshot and added automatically. During a build the
base snapshot's Elementor collection is replaced by the selected documents;
IDs are namespaced by source snapshot and same-source template references are
rewritten. The generated build manifest records selected IDs and source
snapshots without embedding full documents in profile or GUI state.

Profiles using schemas v1–v6 remain readable and continue to import every
Elementor template in their base configuration snapshot.

## Build profile schema v8

Schema v8 selects reusable Elementor design systems and independent template-library entries. When a design system is selected, it owns font selection; template-only v8 profiles can instead use the optional `fontSystems` array for standalone Font Profiles. The legacy singular `fontSystem` field is not used in v8.

```json
{
  "schemaVersion": 8,
  "name": "brand-store",
  "locale": "en_US",
  "wordpress": { "version": "7.1", "variant": "en_US" },
  "theme": { "slug": "hello-elementor", "version": "3.4.9" },
  "plugins": [
    { "slug": "elementor", "version": "4.2.1", "required": true },
    { "slug": "elementor-pro", "version": "4.2.1", "required": true }
  ],
  "config": null,
  "designSystem": { "id": "brand-system" },
  "elementorTemplateIds": ["tpl-3d4570baaf4ec0c53e18"],
  "elementorTemplateMappings": {
    "elementor:color:source_primary": "color:primary"
  }
}
```

The design system requires Elementor and Elementor Pro; templates require Elementor. A snapshot is optional. Template IDs resolve against the independent library, dependency selections are closed before persistence, and every source global reference must auto-map or have an explicit mapping. Interim v8 documents using `elementorTemplates: [{snapshotId, templateId}]` remain readable while their snapshots exist. Generated manifests retain schema v4 and add optional `designSystem` provenance with resource hashes and deduplicated staged font faces. The design-system payload includes all four Elementor system Global Fonts, custom Global Fonts, and the fallback family, even when no templates are selected. Both generated payloads are independently checksum-protected.

## Build profile schema v9 — sample content

Schema v9 extends v8 with a reusable sample-content selection. Sample content is Builder-authored. Optional reference-site content has a separate source document and selection, described below; importing a snapshot never adds source content to the sample library.

```json
{
  "schemaVersion": 9,
  "name": "store-samples",
  "locale": "en_US",
  "wordpress": { "version": "7.1", "variant": "en_US" },
  "theme": { "slug": "hello-elementor", "version": "3.4.9" },
  "plugins": [
    { "slug": "woocommerce", "version": "9.6.0", "required": true }
  ],
  "config": null,
  "designSystem": null,
  "sampleContentIds": ["post-…", "product-…"]
}
```

Selections resolve through the local sample-content library: linked products (upsells, cross-sells, grouped children), category/brand ancestors, and referenced assets are added automatically. Selecting any product requires an explicitly version-selected WooCommerce package for the profile locale. Post-only selections keep v7/v8 capabilities and do not require WooCommerce.

## Generated sample-content payload

Profiles with sample content add `wp-content/<payload>/starter-sample-content.json` (schema v1) containing `content`, `terms`, `attributes`, and `assets` with logical IDs only, plus `sample-content-installer.php`. The manifest v4 entry is optional:

```json
"sampleContentPayload": {
  "path": "starter-sample-content.json",
  "sha256": "…",
  "installerSha256": "…",
  "posts": 2,
  "products": 3,
  "assets": 5,
  "resources": [{ "id": "…", "sha256": "…" }]
}
```

Assets live under `sample-assets/` with generated names and SHA-256 hashes; images are limited to 20 MiB (JPEG/PNG/GIF/WebP) and downloads to 50 MiB (PDF/plain text), 500 MiB selected per build. Bootstrap verifies payload schema and checksums, installs terms with exact taxonomy/slug/hierarchy identity, stores images as real attachments, places downloads under WooCommerce's protected `woocommerce_uploads` area only when direct web access is denied, stages content as drafts, remaps logical references, applies final statuses, and verifies slugs, statuses, and term assignments before completing setup. Interrupted installs resume from saved checkpoints without duplicating records; conflicting slugs, SKUs, or terms stop with an actionable error. Content previews never execute sample HTML, and inline images use logical placeholders remapped to attachment URLs.

## Optional exported posts and products

Exporter v0.2.0-alpha.10 adds independent **Export all posts** and **Export all
WooCommerce products** checkboxes, both off by default. Enabling either adds
`starter-site-content.json` (schema v1: `content`, `terms`, `attributes`, `assets`)
and referenced local assets to the configuration ZIP. Draft, pending, private,
published and scheduled content is included; trash, revisions, auto-drafts,
users, comments/reviews, orders and arbitrary post metadata are excluded.
Password-protected records stop export rather than copying passwords.

Classic posts carry titles, slugs, sanitized body/excerpt, publication date,
status, comment/ping settings, sticky state, format, categories/tags and featured
images. WooCommerce simple, variable, grouped and external products carry the
standard editorial/catalog fields, prices and sale schedules, SKUs/unique IDs,
stock, tax/shipping fields, visibility, galleries, brands, relationships,
purchase notes and review settings. Variable products include global/local
attributes, terms, defaults, and enabled/disabled variations with their own
prices, stock, dimensions, images and local downloads. Products linked outside
the export or unsupported extension product types cause validation errors.

Schema v9 profiles may include:

```json
"siteContent": { "posts": true, "products": false }
```

Omitting the field includes no source posts/products, even when the snapshot
contains them. The GUI presents independent switches under **Templates &
content**. CLI profile creation accepts `--include-posts` and
`--include-products`. A configuration snapshot is required. Products require a
selected WooCommerce package for the profile locale. Empty or absent selected
collections produce an actionable error. Older profile schemas remain unchanged.

The Builder validates content and asset signatures/checksums, selects only the
enabled collections and their dependencies, and combines them with selected
samples in the checksum-protected installer payload. Source content IDs use the
`site-` namespace; source asset IDs use `asset-site-`. Original source numeric IDs
are never used as destination IDs. Samples and site content share the 500 MiB
asset limit; each image is limited to 20 MiB, each PDF/plain-text document or
download to 50 MiB. Only referenced local uploads are copied; no remote download
occurs. Inline local images, classic gallery IDs and supported image-block IDs
are remapped. Audio/video media, file blocks and unrecognized inline uploads
stop export. Existing non-media hyperlinks and shortcodes are preserved;
plugin-specific shortcode references need their own adapters.

### Setup catalog controls

During catalog provisioning, administrators can skip further image imports or keep current records and finish setup. Choices are nonce protected, serialized with the catalog mutation lock, and scoped to the payload checksum and fingerprint. Required attributes, terms and local download/document assets continue when only images are skipped. Stopping preserves existing records and unfinished drafts, records the checkpoint, and bypasses catalog reentry on later requests. The completion report distinguishes a stopped import from a verified full import.

### ACF adapter

Generated content/term slugs use WordPress's 200-character percent-encoded budget,
not a 200-character Unicode text limit. CSV catalog compilation reserves the
source identifier/hash suffix inside that budget. Existing overlong explicit
slugs must be shortened before packaging; installation still checks exact slug
identity and refuses destination conflicts.

Applicable ACF field groups with `post_type == post`/`product` locations are
exported with an allowlist of definitions/settings and their values. Supported
types: text, textarea, number, range, email, URL, WYSIWYG, select, checkbox, radio,
button group, true/false, date/time/color pickers, link, image, gallery, file,
post object, relationship, taxonomy, group, repeater, flexible content and
tab/accordion/message layout fields. File fields support local images or
PDF/plain-text attachments; WooCommerce download files remain protected, while
ACF documents become regular attachments. Taxonomy fields support the standard
post/product taxonomies. Content relationships support exported posts/products.
Cross-type relationships require both profile switches. Unsupported field
types (including password, user, clone and third-party fields), location rules,
custom taxonomies or references outside the export stop with an explicit error.
ACF options, user fields and arbitrary metadata are not copied.

Selected ACF content requires ACF in the build; gallery/repeater/flexible fields
require ACF Pro. The installer persists groups through ACF, reuses matching
existing definitions, refuses conflicting definitions, remaps IDs after all
drafts/media/terms exist, and writes values through `update_field()` before
publication. The installing administrator owns new content; source users are
not migrated. Field values are content and may include private editorial data;
only enable source content export when it is intended for the new site.
