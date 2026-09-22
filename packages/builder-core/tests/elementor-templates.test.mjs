import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ConfigSnapshotRegistry,
  ElementorTemplateLibrary,
  FontSystemRegistry,
  PackageRegistry,
  buildStarter,
  composeElementorTemplates,
  createProfileFromSnapshot,
  createProfileFromPackages,
  createZip,
  extractZip,
  loadProfile,
  namespaceElementorTemplateId
} from "../dist/index.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function zipDir(source, destination) { await createZip(source, destination); }

function source(domain = "example.test") {
  return {
    wordpress_version: "7.1",
    php_version: "8.3",
    locale: "en_US",
    site_domain: domain,
    theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" },
    plugins: [{ file: "elementor/elementor.php", name: "Elementor", version: "4.0.8", active: true }]
  };
}

async function makeExport(root, name, domain, templates, schema = 2) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const raw = {
    schema_version: schema,
    exporter_version: "test",
    generated_at: "2026-09-14T05:01:24+00:00",
    source: source(domain),
    ...(schema === 2 ? { targets: { plugins: [{ file: "elementor/elementor.php", name: "Elementor", version: "4.0.8" }] } } : {}),
    wordpress: { options: {}, pages: [] },
    adapters: { elementor: { options: {}, kit_settings: {}, templates } },
    safety: {}
  };
  if (schema === 1) delete raw.source.site_domain;
  await writeFile(path.join(dir, "starter-config.json"), JSON.stringify(raw, null, 2));
  await writeFile(path.join(dir, "export-manifest.json"), "{}\n");
  const zip = path.join(root, `${name}.zip`);
  await zipDir(dir, zip);
  return zip;
}

async function makePackages(root, library) {
  const wp = path.join(root, "wp", "wordpress");
  await mkdir(path.join(wp, "wp-admin"), { recursive: true });
  await mkdir(path.join(wp, "wp-includes"), { recursive: true });
  await writeFile(path.join(wp, "wp-includes", "version.php"), "<?php $wp_version = '7.1';");
  const wpZip = path.join(root, "wordpress.zip"); await zipDir(path.join(root, "wp"), wpZip);
  const theme = path.join(root, "theme", "hello-elementor");
  await mkdir(theme, { recursive: true });
  await writeFile(path.join(theme, "style.css"), "/*\nTheme Name: Hello Elementor\nVersion: 3.4.9\n*/");
  const themeZip = path.join(root, "theme.zip"); await zipDir(path.join(root, "theme"), themeZip);
  const plugin = path.join(root, "plugin", "elementor");
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(plugin, "elementor.php"), "<?php\n/*\nPlugin Name: Elementor\nVersion: 4.0.8\n*/");
  const pluginZip = path.join(root, "elementor.zip"); await zipDir(path.join(root, "plugin"), pluginZip);
  const packages = new PackageRegistry(library);
  await packages.add(wpZip); await packages.add(themeZip); await packages.add(pluginZip);
}

test("Elementor inventory validates domains, preserves duplicate names, and lazily reads legacy snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-elementor-inventory-"));
  try {
    const first = await makeExport(root, "first", "zeta.example", [
      { id: "header", name: "Header", type: "header", document: [{ widget: "main" }, { ref: { $wpStarterRef: "template:footer" } }] },
      { id: "footer", name: "Footer", type: "footer", document: [{ widget: "footer" }] }
    ]);
    const second = await makeExport(root, "second", "alpha.example", [
      { id: "header", name: "Header", type: "header", document: [{ widget: "other" }] }
    ]);
    const legacy = await makeExport(root, "legacy", "ignored.example", [
      { id: "legacy-header", name: "Legacy Header", type: "header", document: [{ widget: "legacy" }] }
    ], 1);
    const registry = new ConfigSnapshotRegistry(path.join(root, "library"));
    await registry.add(first, { id: "zeta", name: "Zeta config" });
    await registry.add(second, { id: "alpha", name: "Alpha config" });
    const legacyResult = await registry.add(legacy, { id: "legacy", name: "Legacy config" });
    assert.equal(legacyResult.record.sourceDomain, undefined);
    assert.equal(legacyResult.record.elementorTemplates[0].documentLocation, "starter-config.json:adapters.elementor.templates[0].document");

    const registryPath = path.join(root, "library", "configs.json");
    const oldRegistry = JSON.parse(await readFile(registryPath, "utf8"));
    delete oldRegistry.snapshots.find(snapshot => snapshot.id === "legacy").elementorTemplates;
    await writeFile(registryPath, JSON.stringify(oldRegistry));
    const inventory = await registry.listElementorTemplates();
    assert.deepEqual(inventory.map(row => [row.sourceDomain, row.name]), [
      ["alpha.example", "Header"],
      ["Unknown — legacy export", "Legacy Header"],
      ["zeta.example", "Footer"],
      ["zeta.example", "Header"]
    ]);
    assert.equal("document" in inventory[0], false);
    assert.deepEqual(inventory.find(row => row.snapshotId === "zeta" && row.templateId === "header").dependencies, ["footer"]);
    const inspection = await registry.inspect("zeta");
    assert.equal(/"document"\s*:/.test(JSON.stringify(inspection)), false);

    const invalid = await makeExport(root, "invalid", "https://bad.example/path", [], 2);
    await assert.rejects(() => registry.add(invalid, { id: "invalid" }), error => error?.code === "invalid_config_export");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v8 template library survives snapshot deletion and builds package-only payloads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-template-library-"));
  try {
    const exportZip = await makeExport(root, "library-source", "library.example", [
      { id: "page", name: "Landing Page", type: "page", document: [{ color: { $wpStarterRef: "elementor:color:primary" }, child: { $wpStarterRef: "template:part" } }], globalReferences: [{ reference: "elementor:color:primary", kind: "color", sourceId: "primary", name: "Primary" }] },
      { id: "part", name: "Hero Part", type: "section", document: [{ widget: "heading" }] }
    ]);
    const library = path.join(root, "library"); const snapshots = new ConfigSnapshotRegistry(library);
    await snapshots.add(exportZip, { id: "source", name: "Source" });
    const templateLibrary = new ElementorTemplateLibrary(library); const first = await templateLibrary.list();
    assert.equal(first.length, 2); const page = first.find(item => item.sourceTemplateId === "page"); const part = first.find(item => item.sourceTemplateId === "part");
    assert.deepEqual(page.dependencies, [part.id]);
    await snapshots.add(exportZip, { id: "source", name: "Source", replace: true });
    assert.equal((await templateLibrary.list()).find(item => item.sourceTemplateId === "page").id, page.id, "re-import keeps immutable ID");
    await snapshots.remove("source"); assert.equal((await templateLibrary.resolve([page.id])).length, 2, "dependency closure remains after snapshot removal");
    await makePackages(root, library);
    const proPlugin = path.join(root, "plugin-pro", "elementor-pro"); await mkdir(proPlugin, { recursive: true });
    await writeFile(path.join(proPlugin, "elementor-pro.php"), "<?php\n/*\nPlugin Name: Elementor Pro\nVersion: 4.0.8\n*/");
    const proZip = path.join(root, "elementor-pro.zip"); await zipDir(path.join(root, "plugin-pro"), proZip); await new PackageRegistry(library).add(proZip);
    const fontRegistry = new FontSystemRegistry(library);
    const firstFonts = path.join(root, "font-one"); await mkdir(firstFonts, { recursive: true }); await writeFile(path.join(firstFonts, "Inter-Regular.woff2"), "inter-font");
    const firstFontZip = path.join(root, "font-one.zip"); await zipDir(firstFonts, firstFontZip); const [inter] = await fontRegistry.add(firstFontZip, { name: "Inter", replace: true });
    const secondFonts = path.join(root, "font-two"); await mkdir(secondFonts, { recursive: true }); await writeFile(path.join(secondFonts, "NotoSans-Regular.woff2"), "noto-font");
    const secondFontZip = path.join(root, "font-two.zip"); await zipDir(secondFonts, secondFontZip); const [noto] = await fontRegistry.add(secondFontZip, { name: "Noto Sans", replace: true });
    const document = await createProfileFromPackages({ libraryDir: library, name: "Package templates", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.0.8", "elementor-pro": "4.0.8" }, elementorTemplateIds: [page.id], fontSystemIds: [inter.id, noto.id] });
    assert.equal(document.schemaVersion, 8); assert.deepEqual(document.elementorTemplateIds.sort(), [page.id, part.id].sort());
    assert.deepEqual(document.fontSystems.map(font => font.id), [inter.id, noto.id]);
    const profilePath = path.join(root, "package-profile.json"); await writeFile(profilePath, JSON.stringify(document));
    const loaded = await loadProfile(profilePath, { libraryDir: library }); const output = path.join(root, "package-templates.zip");
    const build = await buildStarter({ profile: loaded, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
    assert.equal(build.manifest.configurationEnabled, false); assert.equal(build.manifest.elementorTemplates.length, 2); assert.equal(build.manifest.elementorTemplatePayload.path, "starter-elementor-templates.json");
    assert.deepEqual(build.manifest.fontSystems.map(font => font.id), [inter.id, noto.id]);
    const unpacked = path.join(root, "package-unpacked"); await extractZip(output, unpacked); const payloadName=(await readdir(path.join(unpacked,"wp-content"))).find(name=>name.startsWith(".wp-starter-"));
    const payload=JSON.parse(await readFile(path.join(unpacked,"wp-content",payloadName,"starter-elementor-templates.json"),"utf8")); assert.equal(payload.templates.length,2); assert.equal(payload.mappings["elementor:color:primary"],"elementor:color:primary");
    await assert.rejects(() => templateLibrary.remove(part.id), error => error?.code === "resource_in_use");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source-aware template imports replace renamed templates across snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-template-reimport-"));
  try {
    const first = await makeExport(root, "source-first", "stable.example", [
      { id: "portable-old-title", sourceId: "101", name: "Old title", type: "page", document: [{ widget: "old" }] }
    ]);
    const second = await makeExport(root, "source-second", "stable.example", [
      { id: "portable-new-title", sourceId: "101", name: "New title", type: "page", document: [{ widget: "new" }] }
    ]);
    const library = path.join(root, "library");
    const snapshots = new ConfigSnapshotRegistry(library);
    await snapshots.add(first, { id: "first", name: "First" });
    const templates = new ElementorTemplateLibrary(library);
    const before = (await templates.list())[0];
    await snapshots.add(second, { id: "second", name: "Second" });
    const after = await templates.list();
    assert.equal(after.length, 1);
    assert.equal(after[0].id, before.id);
    assert.equal(after[0].name, "New title");
    assert.equal(after[0].sourceTemplateId, "101");
    assert.deepEqual(after[0].dependencies, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema-v7 selections close dependencies and compose colliding source IDs selectively", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-elementor-profile-"));
  try {
    const baseZip = await makeExport(root, "base", "one.example", [
      { id: "shared", name: "Shared", type: "section", document: [{ ref: { $wpStarterRef: "template:dependency" } }, { color: { $wpStarterRef: "elementor:color:accent" } }] },
      { id: "dependency", name: "Dependency", type: "section", document: [{ widget: "dep" }] },
      { id: "not-selected", name: "Not selected", type: "section", document: [{ widget: "no" }] }
    ]);
    const otherZip = await makeExport(root, "other", "two.example", [
      { id: "shared", name: "Shared", type: "section", document: [{ widget: "other" }] }
    ]);
    const library = path.join(root, "library");
    const snapshots = new ConfigSnapshotRegistry(library);
    await snapshots.add(baseZip, { id: "base", name: "Base" });
    await snapshots.add(otherZip, { id: "other", name: "Other" });
    await makePackages(root, library);

    const document = await createProfileFromSnapshot("base", {
      libraryDir: library,
      name: "selected",
      elementorTemplates: [{ snapshotId: "base", templateId: "shared" }, { snapshotId: "other", templateId: "shared" }]
    });
    assert.equal(document.schemaVersion, 7);
    assert.deepEqual(document.elementorTemplates, [
      { snapshotId: "base", templateId: "shared" },
      { snapshotId: "other", templateId: "shared" },
      { snapshotId: "base", templateId: "dependency" }
    ]);
    assert(document.plugins.some(plugin => plugin.slug === "elementor"));

    const profilePath = path.join(root, "profile.json");
    await writeFile(profilePath, JSON.stringify(document));
    const loaded = await loadProfile(profilePath, { libraryDir: library });
    const composed = await composeElementorTemplates(loaded.elementorTemplates);
    assert.equal(composed.length, 3);
    assert.equal(new Set(composed.map(template => template.id)).size, 3);
    assert.equal(composed[0].id, namespaceElementorTemplateId("base", "shared"));
    assert.equal(composed[1].id, namespaceElementorTemplateId("other", "shared"));
    assert.equal(composed[0].document[0].ref.$wpStarterRef, `template:${namespaceElementorTemplateId("base", "dependency")}`);
    assert.equal(composed[0].document[1].color.$wpStarterRef, "elementor:color:accent");
    assert.equal(composed.some(template => template.id.includes("not-selected")), false);

    const output = path.join(root, "selective-build.zip");
    const build = await buildStarter({ profile: loaded, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test",
      compatibilityMatrix: {
        schemaVersion: 1, generatedAt: "2026-09-13T00:00:00Z",
        entries: [{ id: "synthetic-templates", status: "known-good", php: "8.3",
          wordpress: { version: "7.1", variant: "en_US" },
          theme: { slug: "hello-elementor", version: "3.4.9" },
          plugins: { elementor: "4.0.8" } }]
      }
    });
    assert.deepEqual(build.manifest.elementorTemplates.map(template => [template.snapshotId, template.templateId]), document.elementorTemplates.map(template => [template.snapshotId, template.templateId]));
    const unpacked = path.join(root, "unpacked");
    await extractZip(output, unpacked);
    const payloadName = (await readdir(path.join(unpacked, "wp-content"))).find(name => name.startsWith(".wp-starter-"));
    const payload = path.join(unpacked, "wp-content", payloadName);
    const composedConfig = JSON.parse(await readFile(path.join(payload, "starter-config.json"), "utf8"));
    assert.deepEqual(composedConfig.adapters.elementor.templates.map(template => template.id), composed.map(template => template.id));

    const missingZip = await makeExport(root, "missing-dependency", "three.example", [
      { id: "root", name: "Root", type: "section", document: [{ ref: { $wpStarterRef: "template:absent" } }] }
    ]);
    await snapshots.add(missingZip, { id: "missing", name: "Missing" });
    await assert.rejects(() => createProfileFromSnapshot("missing", { libraryDir: library, elementorTemplates: [{ snapshotId: "missing", templateId: "root" }] }), error => error?.code === "elementor_template_dependency_missing" && /Root.*source template "absent".*not included in the export.*Re-import the snapshot/.test(error.message));

    const malformedPath = path.join(root, "malformed.json");
    await writeFile(malformedPath, JSON.stringify({ ...document, elementorTemplates: [{ snapshotId: "base", templateId: "shared" }] }));
    await assert.rejects(() => loadProfile(malformedPath, { libraryDir: library }), error => error?.code === "elementor_template_dependency_unselected");

    const storedBase = path.join(library, "configs", "base", "config.zip");
    await writeFile(storedBase, "tampered");
    await assert.rejects(() => loadProfile(profilePath, { libraryDir: library }), error => error?.code === "config_checksum_mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
