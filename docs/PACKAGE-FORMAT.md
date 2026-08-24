# Package format v1

## Configuration export ZIP

The exporter produces a ZIP containing:

```text
starter-config.json
export-manifest.json
```

`starter-config.json` is portable configuration data.

`export-manifest.json` describes the source site and exporter version.

## Build profile

The CLI consumes a local JSON profile. All paths may be absolute or relative to the profile file.

```json
{
  "schemaVersion": 1,
  "name": "ecommerce-fa",
  "locale": "fa_IR",
  "wordpress": {
    "version": "7.0.2",
    "zip": "../private-packages/wordpress-7.0.2.zip"
  },
  "theme": {
    "slug": "hello-elementor",
    "version": "3.4.9",
    "zip": "../private-packages/themes/hello-elementor-3.4.9.zip"
  },
  "plugins": [],
  "configExport": "../exports/core-config.zip",
  "languageArchives": []
}
```

## Generated distribution metadata

`wp-content/starter-package/starter-build.json` records:

- profile name
- requested locale
- WordPress/theme/plugin versions
- SHA-256 of every input artifact
- builder version
- build timestamp
