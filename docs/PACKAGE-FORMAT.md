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
The same `type + slug + version` cannot silently change bytes; use `--replace` explicitly when that is intentional.

## Configuration export ZIP

The exporter produces a ZIP containing:

```text
starter-config.json
export-manifest.json
```

`starter-config.json` is portable configuration data.

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
