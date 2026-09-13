# vNext Design System

The current alpha profile and snapshot formats remain stable. vNext resources use `schemaVersion: 1` inside the Builder Core API and are intentionally separate from the alpha schemas.

## Resource flow

```text
Font Assets ─┐
Typography ──┼─> Design System ─> Build Profile vNext ─> Bootstrap
Colors ──────┘                                      └─> Template remapping
```

Typography profiles reference logical font roles such as `primary` and `secondary`, never a font-family string. A design system binds those roles to Font Assets and validates every requested weight before a build.

Portable templates use explicit references such as:

```json
{ "$wpStarterRef": "color:accent" }
```

The destination bootstrap resolves these references to the Elementor IDs created during provisioning. Missing references fail provisioning and are written to the administrator-facing error report.

The vNext TypeScript API is currently exposed from `@wp-starter/builder-core` through `vnext.ts`. It is a foundation for the GUI resource editors and the first Elementor template adapter; it does not change the alpha build manifest or profile schemas.
