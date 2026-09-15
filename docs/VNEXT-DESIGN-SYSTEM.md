# Elementor Design Systems

Design-system resources use their own `schemaVersion: 1`. Build profiles opt into them with profile schema v8; profiles v1–v7 remain readable and retain their previous behavior.

## Resource flow

```text
Font Profiles ┐
Typography ──┼─> Design System ─> Build Profile vNext ─> Bootstrap
Colors ──────┘                                      └─> Template remapping
```

Typography profiles use friendly named font slots such as Body font, Heading font, and Accent font, never a font-family string. Slot IDs remain internal for compatibility. Theme Style typography and Elementor Global Fonts are edited separately: the four system Global Fonts (Primary, Secondary, Text, Accent), named custom Global Fonts, and the fallback family are stored alongside semantic Body/Links/Heading/Button/Form rows. Older profiles derive the four system Global Fonts from their existing roles. Each style row stores weight, style, transform, decoration, and responsive size, line height, letter spacing, and word spacing. Dimensions are stored canonically as `{ "value": 16, "unit": "px" }` inside desktop/tablet/mobile objects. The registry accepts unambiguous legacy values such as `16px` and normalizes them before persistence. A design system assigns every used slot to an existing WOFF2 Font Profile and validates each requested static weight/style face.

Portable templates use explicit references such as:

```json
{ "$wpStarterRef": "color:accent" }
```

The destination bootstrap resolves these references to the Elementor IDs created during provisioning. Missing references fail provisioning and are written to the administrator-facing error report.

The GUI hides generated immutable resource IDs under Advanced details, preserves unsaved typography drafts across device/tab switches, supports custom typography rows, custom Global Fonts, and custom color tokens, and guides font assignment from every slot used by the profile. The CLI provides `resource typography|colors|design-systems add|list|remove` commands using JSON files. Referenced resources cannot be removed.

Elementor templates are copied into an independent library when a configuration is imported. Their stable IDs derive from source site and source template ID (legacy exports also include snapshot identity), and their documents no longer depend on the snapshot ZIP. Re-import updates the same asset. Profiles v8 select library IDs, may use templates without a configuration snapshot, and store explicit mappings for source global references that cannot be matched automatically. Interim v8 snapshot/template pairs remain readable while their snapshots exist; v7 behavior is unchanged.

At build time `starter-design-system.json` records compiled logical tokens, all four system Global Fonts, custom Global Fonts, fallback family, font-family bindings, resource IDs, and content hashes. A separate checksum-protected `starter-elementor-templates.json` carries selected library documents and mappings. The build manifest records both payloads and provenance. Bootstrap installs fonts, applies deterministic `wpstarter_` globals, imports templates in two passes, and only then applies structural snapshot settings without replacing Design System globals. First-login provisioning runs through a staged WordPress admin progress screen and returns to the dashboard when complete.

Both reference forms are accepted during template remapping: `color:accent` / `typography:body` and `elementor:color:accent` / `elementor:typography:body`.
