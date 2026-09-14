# Changelog

## 0.1.0-alpha.26

- Applied design-system custom colors to Elementor Custom Colors and applied typography roles to the matching Elementor Theme Style controls for body, links, headings, buttons, and form fields.
- Kept only the global typography aliases needed by portable template references and bumped the bootstrap configuration revision so updated builds rerun the design-system phase.

## 0.1.0-alpha.25

- Added source-post-aware Elementor template replacement across re-imported snapshots, automatic migration of legacy library entries, stronger Kit filtering, and GUI deletion for configuration snapshots.
- Bumped the paired Exporter release to `0.2.0-alpha.9` so the installed exporter can be matched unambiguously to Builder alpha.25.

## 0.1.0-alpha.24

- Fixed the Exporter treating empty Elementor `template_id` fields as missing templates, automatically includes real template dependencies, excludes the structural Default Kit, and bumped the paired Exporter release to `0.2.0-alpha.8`.

## Unreleased

### Elementor design systems

- Added backward-compatible build profile schema v8 with a reusable `designSystem` reference and source-aware Elementor template selections.
- Added canonical responsive typography dimensions with explicit units, strict color/font-role/face validation, resource CRUD, dependency-aware deletion protection, and legacy value normalization.
- Added structured GUI resource editors, a mutually exclusive Build-page design-system selector, CLI JSON resource commands, and `--design-system` / repeatable `--elementor-template` profile options.
- Builds now compile checksum-addressed design-system payloads, record resource provenance, and bundle multiple WOFF2 Font Profiles once per unique file hash.
- Redesigned Typography as persistent Body/Links/H1–H6/Buttons/Form Fields rows with a Desktop/Tablet/Mobile switch, canonical numeric/unit controls, draft memory, breakpoint clearing, custom rows, and friendly font slots.
- Redesigned Colors and Design Systems around user-facing names, generated hidden IDs, stable custom-color tokens, automatic slot discovery, visible face availability, and guided readiness errors.
- Bootstrap installs all bound fonts, writes deterministic Elementor global colors and typography, supports logical and exporter reference forms, preserves structural Kit settings, and reruns from the font phase at configuration revision 9.

### Independent Elementor template library

- Configuration imports now copy Elementor template documents into durable checksum-protected library storage with stable source-based IDs, provenance, dependencies, and safe global-reference labels.
- New v8 profiles select template library IDs independently of snapshots, support package-only template builds, lock Elementor, close dependencies, and block unresolved global mappings.
- Added Build-page search/source/type filters, dependency locking, friendly unresolved-reference mapping, and empty-by-default selection.
- Dependency rows remain selectable after automatic closure, and omitted Elementor-template references now identify the source snapshot/reference, explicitly distinguish templates from plugins/settings, explain the re-import fix, and block profile saving until resolved.
- Builds emit a separate `starter-elementor-templates.json`; Bootstrap imports it after Design Systems in a two-pass, idempotent flow and applies structural snapshots afterward. Legacy v7 and interim v8 selections remain readable.

### Stabilization and vNext foundation

- Added a committed npm lockfile and CI coverage for Node 20/22 across Windows, macOS, and Linux.
- Replaced shell-dependent ZIP creation/extraction with an in-process implementation that validates paths, compression, sizes, and entry checksums.
- Added atomic JSON persistence for package registries, snapshots, fonts, profiles, and build metadata.
- Added the published known-good compatibility matrix and default build-time rejection of unsupported configuration combinations.
- Added isolated vNext Typography Profile, Color Profile, Design System, Font Asset, and Portable Template APIs with semantic validation and logical-reference remapping.
- Added optional vNext design-system transport and Elementor bootstrap application with deterministic global IDs, template remapping, verification errors, and revision-based reruns.

### Source-aware Elementor template library

- Added a snapshot-derived Elementor template inventory with source hostname, snapshot metadata, export date, document location, and lightweight dependency summaries; full Elementor documents remain outside GUI state.
- Added schema-v2 `source.site_domain` provenance from the exporter using only the `home_url()` hostname, with a legacy fallback of `Unknown — legacy export`.
- Added profile schema v7 selections across imported snapshots, dependency closure and locking, Elementor inclusion requirements, checksum validation, and exact edit/duplicate restoration.
- Builds now compose selected templates from multiple snapshots with source-namespaced IDs and same-source reference rewriting, and record the selection in the build manifest. Profiles v1–v6 retain base-snapshot template behavior.
- Added the GUI Elementor Templates library tab and source-grouped Builder checklist, with regression coverage for validation, aggregation, dependencies, collisions, selective composition, and legacy compatibility.

## 0.1.0-alpha.22

- Fix first-login provisioning races by running real plugin activation hooks instead of silent activation.
- Prevent AJAX, cron and REST requests from advancing the Bootstrap state machine.
- Activate dependency-sensitive plugins in a deterministic order: Elementor, WooCommerce, Elementor Pro, then dependants.
- Prepare a valid Elementor Kit before WooCommerce/Elementor Pro activation.
- Guard WooCommerce activation with a temporary maintenance barrier and verify its required database tables before continuing.

## 0.1.0-alpha.21 - 2026-08-26

- Fixed Elementor Pro Custom Fonts provisioning so each installed WOFF2 face is registered as a real WordPress Media attachment.
- Elementor `elementor_font_files` rows now store both the attachment `id` and `url`, so WOFF2 files appear inside Elementor's Edit Font interface instead of only existing in generated CSS.
- Font attachment registration is idempotent by uploads-relative path and records starter font metadata for traceability.
- Raised the bootstrap configuration revision so an alpha.20-provisioned site can rerun from the Fonts phase when alpha.21 is overlaid for repair.

## 0.1.0-alpha.20 - 2026-08-26

### Visible font weight mapping

- Added an explicit per-face mapping table to every Font Profile card in the Builder GUI.
- Each WOFF2 face now shows its exact stored filename, numeric CSS weight, human-readable weight label, and detected style.
- Standard CSS weights are labeled Thin, Extra Light, Light, Regular, Medium, Semi Bold, Bold, Extra Bold, and Black.
- Kept the numeric weight visible because that is the value ultimately registered with Elementor Pro.
- Added GUI regression coverage verifying that imported font filenames remain paired with their detected weights/styles.

## 0.1.0-alpha.19 - 2026-08-26

### WOFF2-only font profiles

- Reworked Font Systems into one-family Font Profiles in the Builder GUI.
- Font ZIP imports now inspect WOFF2 files only; WOFF, TTF, OTF, and other formats are ignored.
- A single ZIP can create multiple profiles automatically, one per detected font family.
- Font profile names are derived from matching family folders/filenames, including common variants such as `FaNum` and `NoEn`.
- Duplicate family/weight/style WOFF2 slots are collapsed deterministically.
- Re-importing the same archive through the GUI replaces profiles created from that archive, including legacy alpha.18 multi-format imports.
- Legacy profiles containing non-WOFF2 faces are visible but blocked from new builds until re-imported.
- Elementor Pro font installation in Bootstrap is now WOFF2-only.
- Added Builder Core and GUI regression tests for multi-family profile splitting and duplicate-face handling.

## 0.1.0-alpha.18 - 2026-08-26

### Security hardening, target selection, Code Snippets restore, and Font Systems

- Separated source-site plugin inventory from explicit starter target packages.
- Added schema-v2 snapshot validation with strict allowlists for WordPress and supported adapters.
- Added logical front-page/posts-page roles instead of copying source database IDs.
- Added hardened ZIP validation for traversal, absolute paths, symlinks, encryption, excessive expansion, and suspicious archives.
- Added per-process GUI API authentication, Host/Origin validation, and browser security headers while retaining localhost-only binding.
- Randomized bundled staging paths and added verified post-provision cleanup of package payloads and the one-time Bootstrap MU plugin.
- Added idempotent Code Snippets restoration using the plugin public API and logical snippet identity.
- Added reusable Font Systems to the local Builder library, profile selection, automatic static face detection, and offline Elementor Pro Custom Fonts installation.
- Font Systems detect common 100-900 weights plus normal/italic/oblique styles; variable fonts are currently skipped with a warning.
- Font-enabled profiles require both Elementor and Elementor Pro.

## Exporter 0.2.0-alpha.4 - 2026-08-26

### Real-site starter targeting and safer structural export

- Added explicit starter-package selection separate from source plugin inventory.
- Added Code Snippets selection with active reusable snippets selected by default and inactive/sample snippets excluded by default.
- Added logical WordPress front/posts page roles and removed raw page IDs from the portable model.
- Kept Elementor export structural-only: widths, padding, gaps, breakpoints, page-title selector, stretched-section target, and default page layout.
- Kept Elementor colors, typography, fonts, visual styling, site identity, licenses/connections, Theme Builder conditions, and arbitrary Kit fields excluded.
- Tightened temporary export permissions and schema-v2 safety metadata.

## Exporter 0.2.0-alpha.2 - 2026-08-25

### Structural Elementor baseline only

- Narrowed Elementor export to reusable structural/layout settings only.
- Removed Elementor colors, custom/system typography, generic fonts, body/link/heading/button/form/lightbox styles, and global lightbox settings from the portable snapshot.
- Removed standalone Elementor behavior/editor options from export; Elementor now contributes only approved Kit layout primitives.
- Preserved content/container width, responsive container width, container padding, responsive padding, widget gaps, breakpoints, page-title selector, stretched-section target, and default page layout.
- Added explicit safety flags stating that Elementor design-system and visual-style data are not exported.
- Updated the Exporter admin screen to describe the narrower structural-only policy.

## Exporter 0.2.0-alpha.1 - 2026-08-25

### Strict portable baseline + Code Snippets

- Switched Elementor Kit export from a denylist to an explicit general-settings allowlist.
- Elementor site identity, logo/favicon, WooCommerce page IDs, arbitrary Kit fields, license/connection state, Theme Builder conditions, beta/experiment state, and custom CSS are not exported.
- Expanded the safe WordPress baseline while continuing to exclude site identity, URLs, admin email, taxonomy IDs, and raw destination-specific page IDs.
- Added logical front-page/posts-page slug references instead of exporting destination-specific numeric IDs.
- Added Code Snippets export using the plugin API when available.
- Code Snippets export includes reusable general/editor preferences and non-trashed snippet name, description, code, tags, scope, priority, active/locked state and derived type.
- Code Snippets database IDs, cloud IDs, conditions, revision/error/runtime state, modified timestamps, network-sharing state and trashed snippets are excluded.
- Added an explicit warning that snippet code may itself contain hardcoded secrets and must be reviewed before reuse.
- Excluded WP Starter infrastructure plugins from source plugin requirements.
- Hardened temporary export permissions and download headers.

## 0.1.0-alpha.16 - 2026-08-24

### Phase 2: Snapshot Comparison

- Added a Builder Core snapshot-comparison engine that separates binary, portable configuration, structural, and safety-boundary changes.
- Binary comparison detects WordPress locale/version changes, theme changes, plugin additions/removals, and plugin version changes.
- Configuration comparison detects added/removed/changed WordPress options, permalink/cleanup behavior, and portable adapter values.
- Structural comparison currently covers starter pages plus adapter availability/status changes and is designed to accept templates/layouts/object sets later in Phase 2.
- Added a GUI Compare Snapshots workflow with baseline/target selectors, category summaries, before/after values, and direction-aware diffs.
- Added a CLI `config compare <left-id> <right-id>` debugging command.
- Split the Configuration Inspector into Overview, Packages, WordPress, Structures, Adapters, and Safety tabs.
- Added regression coverage for the comparison engine and GUI comparison API.

## 0.1.0-alpha.15 - 2026-08-24

### Phase 2: Configuration Inspector

- Started Phase 2 with a read-only Configuration Inspector in the local GUI.
- Added a Builder Core snapshot inspection API that reads the safe exported `starter-config.json` without mutating the snapshot.
- Inspector summarizes source WordPress/PHP/locale/theme/plugins, package availability, WordPress options/pages/permalink behavior, adapter payloads, and exporter safety boundaries.
- Adapter inspection is generic and future-facing: option/settings sections are discovered from the exported adapter payload instead of hardcoding only Elementor/WooCommerce.
- Deferred adapters such as FilterX are surfaced explicitly with their portability reason rather than being silently ignored.
- Added snapshot-inspection API regression coverage and verified the inspector against the real reference export.

## 0.1.0-alpha.14 - 2026-08-24

- Marked Phase 1 core build/deployment validation complete after clean snapshot and package-only Plesk installs both passed.
- Added a dedicated Profiles workspace to the local GUI.
- Added profile Edit, Duplicate, Build, and Delete actions without hand-editing JSON.
- Profile renames now replace the previous saved profile file instead of leaving stale copies.
- Added persistent build-history metadata sidecars with source profile, locale, configuration mode, SHA-256, and timestamps.
- Added a dedicated Build History workspace with Download, Build Again, and Delete actions.
- Added regression coverage for profile retrieval/deletion and persisted build history.

## 0.1.0-alpha.13 - 2026-08-24

- Added real asynchronous build jobs to the local GUI with stage-by-stage progress reporting and a visible progress bar.
- Added profile schema v5, allowing configuration snapshots to be optional and custom themes to be optional.
- Added package-only builds that install selected WordPress/plugin/theme packages without applying exported WordPress/plugin settings.
- Added a GUI “No snapshot — packages only” mode that can select arbitrary plugins directly from the local library.
- Added “Use WordPress default theme” for package-only profiles.
- Added manifest schema v3 with explicit `configurationEnabled`, nullable theme, and nullable config metadata.
- Bootstrap now skips configuration cleanly when a build intentionally has no snapshot.
- Hardened theme discovery after extraction by clearing WordPress/stat caches and retrying briefly, avoiding transient first-refresh theme errors seen on Plesk.
- Infrastructure packages such as WP Starter Bootstrap/Exporter are hidden from the normal GUI package library.
- Added regression tests for package-only builds and GUI build-progress jobs.

## 0.1.0-alpha.10

### Verified configuration and deterministic default-page ownership

- Removed the Bootstrap call to `WC_Install::create_pages()` so WooCommerce alone owns Shop/Cart/Checkout/My Account creation.
- Added a conservative repair pass that removes duplicate WooCommerce default pages while preserving the page IDs WooCommerce currently owns.
- Added Elementor default-kit repair/creation before importing Site Settings, fixing the editor error that no default kit exists.
- Clears Elementor generated-file cache after applying imported kit settings.
- Added post-import verification of WordPress, Elementor, WooCommerce, locale, permalink, and active Elementor kit state. Bootstrap now fails instead of claiming success when stored settings do not match the snapshot.
- Added a configuration revision so existing alpha.9 test installs automatically rerun only the configuration phase and repair themselves without reinstalling WordPress or packages.
- Expanded the Exporter baseline whitelist with `page_on_front`, `page_for_posts`, and `large_size_h`.
- Added repeatable Exporter release packaging.

## 0.1.0-alpha.9

### Direct local package extraction on WordPress hosts

- Replaced bundled theme/plugin extraction through WordPress `unzip_file()` with a direct, path-safe `ZipArchive` extractor when the PHP extension is available.
- Fixes Plesk-style environments where `unzip_file()` could report success but the expected theme/plugin files never appeared in the real `wp-content` destination.
- Keeps a WordPress Filesystem/PclZip fallback for servers without `ZipArchive`.
- Adds archive-entry and destination diagnostics if a normalized payload still cannot be discovered after extraction.
- Preserves checksum verification before extraction and rejects absolute or traversal paths inside bundled archives.

## 0.1.0-alpha.8

### Canonical plugin/theme payloads

- Normalizes every bundled plugin and theme ZIP during build instead of copying arbitrary source ZIP bytes unchanged.
- Repackages each payload with exactly one canonical top-level install directory matching the detected registry install directory.
- Forces ZIP-standard forward-slash entry names for inner plugin/theme archives as well as the outer deployment archive.
- Fixes Bootstrap failures where an archive reported successful extraction but WordPress could not find the expected theme/plugin path afterward.
- Covers single-file plugins by wrapping them in their canonical plugin directory before deployment.
- Adds post-extraction theme-directory diagnostics if a theme still cannot be discovered.

## 0.1.0-alpha.7

### Linux-portable deployment ZIPs

- Fixed Windows-built starter distributions using backslashes inside ZIP entry names.
- Windows ZIP creation now writes every archive entry explicitly with ZIP-standard forward slashes.
- Fixes Plesk/File Manager extraction failures reporting `appears to use backslashes as path separators`.
- Added a regression check that generated deployment archives contain no backslash entry names.
- Kept the alpha.6 compact payload design: WordPress core is expanded in the outer archive while plugins/themes remain bundled ZIPs for staged offline installation.

## 0.1.0-alpha.6

### Compact hosting-panel deployment bundles

- Changed generated distributions so plugin/theme binaries remain as local ZIP payloads under `wp-content/starter-package/packages/` instead of being expanded into the outer deployment ZIP.
- Reduced outer archive entry count dramatically for Plesk/cPanel-style File Manager extraction.
- Bootstrap now installs the bundled theme and one plugin package at a time after the normal WordPress database/admin installation.
- Added checksum verification before any bundled package is extracted.
- Added staged plugin installation and dependency-tolerant activation retries.
- Bundled language archives are now installed by Bootstrap instead of being expanded by the Builder.
- Bumped starter build manifest to schema v2 for bundled package paths.
- Kept the entire deployment offline; Bootstrap only reads package files shipped inside the starter distribution.

## 0.1.0-alpha.5

### Profile locale overrides and selective plugin builds

- Added `--locale <locale>` to `profile create` so destination language is independent from the reference snapshot locale.
- Added repeatable `--exclude-plugin <slug>` to generate test or alternate profiles without selected reference-site plugins.
- Excluded plugins no longer block profile generation if their exact package is absent from the local library.
- Bootstrap now applies Elementor, WooCommerce, and Persian WooCommerce adapter options only when the corresponding plugin is actually active.
- Updated bootstrap version and tests for locale override and plugin exclusion behavior.

## 0.1.0-alpha.4

### Snapshot-to-profile generation

- Added `profile create` to generate a schema v3 build profile directly from an imported configuration snapshot.
- Profile generation refuses to continue until every exact WordPress/theme/plugin requirement from the snapshot exists in the local package library.
- Generated profiles pin the reference WordPress version, theme version, active plugin versions, locale, and configuration snapshot ID while remaining editable for deliberate later upgrades.
- Added `profile check` to resolve and validate every profile input before a build starts.
- Added overwrite protection for generated profile files.
- Added tests proving profile generation fails when packages are missing and succeeds when the package library is complete.

## 0.1.0-alpha.3

### Configuration snapshot registry

- Added a local registry for exported `starter-config.zip` snapshots.
- Added `config add`, `config list`, `config check`, and `config remove` CLI commands.
- Added exact requirement matching between a reference snapshot and the local WordPress/theme/plugin package library.
- Infrastructure plugins such as WP Starter Exporter and legacy Site Starter are excluded from target requirements.
- Added schema v3 profiles that reference a configuration snapshot by stable ID instead of a raw ZIP path.
- Verified the real `starter-config-20260824-050124.zip` export imports successfully and yields the expected WordPress 7.1, Hello Elementor 3.4.9, and six target plugin requirements.
- Added UTF-8 console setup to Windows launchers for Persian/non-ASCII plugin names.
- Added tests for snapshot import, requirement matching, infrastructure exclusion, and schema v3 profile resolution.

## 0.1.0-alpha.2

### Generic package registry

- Added a local package library for arbitrary WordPress core, plugin, and theme ZIPs.
- Added automatic package inspection for plugin/theme headers and WordPress core versions.
- Added `package add`, `package inspect`, `package list`, and `package remove` CLI commands.
- Added exact SHA-256 integrity tracking and explicit conflict handling.
- Added multi-version package storage.
- Added schema v2 profiles that reference exact `slug + version` package coordinates instead of ZIP paths.
- Preserved schema v1 profile compatibility during Phase 1 migration.
- Added end-to-end tests proving a schema v2 profile resolves and builds entirely from the local registry.
- Preserved original plugin/theme installation directory names when assembling arbitrary packages.
- Added repeatable standalone Builder release packaging with the correct bootstrap directory layout.
- Added `wp-starter.cmd` and `wp-starter.ps1` Windows command launchers.

## 0.1.0-alpha.1

### Architecture reset

- Split the old monolithic Site Starter concept into Exporter, Builder, and Bootstrap.
- Added the first offline local build pipeline.
- Added a versioned profile format and build manifest.
- Added local-only package extraction for WordPress, themes, plugins, and language archives.
- Added a WordPress configuration exporter with explicit portable-setting whitelists.
- Added an MU-plugin bootstrap that stages activation and configuration after normal WordPress installation.
- Added synthetic end-to-end builder tests.
- Preserved the earlier Site Starter Git history before the architecture reset.

## 0.1.0-alpha.11 - 2026-08-24

- Added the first local GUI preview on top of the existing builder-core APIs.
- Added browser-based package ZIP import with drag-and-drop.
- Added configuration snapshot import and requirement checking.
- Added profile creation with locale and plugin inclusion controls.
- Added one-click offline build creation and browser download.
- Added Windows GUI launchers that reuse the existing local package library.
- Kept the CLI as the debugging/automation interface; no builder logic was duplicated into the GUI.

## 0.1.0-alpha.12 - 2026-08-24

- Group package-library rows by package slug in the GUI so multiple installed versions appear as versions of one package rather than duplicate packages.
- Add per-version remove actions in the GUI while preserving version pinning for existing profiles.
- Add WordPress package variants keyed by locale, allowing the same WordPress version to coexist as `en_US`, `fa_IR`, and other localized distributions without checksum conflicts.
- Detect localized WordPress packages from `$wp_local_package` or bundled core language files.
- Add profile schema v4 with an explicit WordPress package variant.
- Add GUI package-version selectors for WordPress, theme, and every plugin in a configuration snapshot.
- Allow profiles to pin newer plugin/theme/core package versions independently from the reference snapshot while continuing to use the same exported configuration.
- Migrate existing schema-v1 package registries transparently, treating legacy WordPress core entries as `en_US`.
