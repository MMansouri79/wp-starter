import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ConfigSnapshotRegistry,
  PackageRegistry,
  buildStarter,
  composeElementorTemplates,
  createProfileFromSnapshot,
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
    const build = await buildStarter({ profile: loaded, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
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
    await assert.rejects(() => createProfileFromSnapshot("missing", { libraryDir: library, elementorTemplates: [{ snapshotId: "missing", templateId: "root" }] }), error => error?.code === "elementor_template_dependency_missing" && /not included in source export/.test(error.message));

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
