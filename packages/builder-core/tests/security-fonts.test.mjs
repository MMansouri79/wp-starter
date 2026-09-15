import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildStarter, ConfigSnapshotRegistry, createProfileFromPackages, createZip, DesignSystemResourceService, extractZip, FontSystemRegistry, loadProfile, PackageRegistry, validateZipArchive } from "../dist/index.js";
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
async function zipDir(source, destination) { await createZip(source, destination); }
async function traversalZip(destination) {
  const name = Buffer.from("../escape.php");
  const data = Buffer.from("bad");
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30); data.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  await writeFile(destination, Buffer.concat([local, central, end]));
}
async function makePlugin(root, slug, name, version) {
  const dir = path.join(root, slug, slug); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${slug}.php`), `<?php\n/*\nPlugin Name: ${name}\nVersion: ${version}\n*/\n`);
  const zip = path.join(root, `${slug}.zip`); await zipDir(path.join(root, slug), zip); return zip;
}

test("ZIP validator rejects traversal entries before extraction", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-zip-security-"));
  try {
    const zip = path.join(temp, "evil.zip");
    await traversalZip(zip);
    await assert.rejects(() => validateZipArchive(zip), (error) => error?.code === "unsafe_archive");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("font registry imports WOFF2 only and creates one named profile per detected family", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-font-registry-"));
  try {
    const source = path.join(temp, "source");
    const yekan = path.join(source, "Pro", "Yekan Bakh", "WOFF2");
    const fanum = path.join(source, "Pro", "Yekan Bakh FaNum", "WOFF2");
    await mkdir(yekan, { recursive: true }); await mkdir(fanum, { recursive: true });
    for (const name of ["YekanBakh-Regular.woff2", "YekanBakh-SemiBold.woff2", "YekanBakh-Bold.woff2", "YekanBakh-ExtraBold.woff2", "YekanBakh-Italic.woff2", "YekanBakh-Variable.woff2"]) {
      await writeFile(path.join(yekan, name), `fake-${name}`);
    }
    await writeFile(path.join(fanum, "YekanBakhFaNum-Regular.woff2"), "fanum-regular");
    await writeFile(path.join(fanum, "YekanBakhFaNum-Bold.woff2"), "fanum-bold");
    // Other formats in the same archive are deliberately ignored.
    await writeFile(path.join(yekan, "YekanBakh-Bold.ttf"), "ttf");
    await writeFile(path.join(yekan, "YekanBakh-Bold.woff"), "woff");
    const zip = path.join(temp, "font1403.zip"); await zipDir(source, zip);
    const registry = new FontSystemRegistry(path.join(temp, "library"));
    const profiles = await registry.add(zip, { replace: true });
    assert.deepEqual(profiles.map((profile) => profile.name), ["Yekan Bakh", "Yekan Bakh FaNum"]);
    const system = profiles[0];
    assert.equal(system.faces.length, 5);
    assert(system.faces.every((face) => face.format === "woff2"));
    assert.deepEqual(system.faces.map((face) => [face.weight, face.style]), [[400,"italic"],[400,"normal"],[600,"normal"],[700,"normal"],[800,"normal"]]);
    assert.equal(system.skipped.length, 1);
    assert.match(system.skipped[0].reason, /Variable WOFF2/i);
    const resolved = await registry.resolve(system.id);
    assert.equal(resolved.faces.length, 5);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("font registry collapses duplicate WOFF2 weight/style slots", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-font-dedupe-"));
  try {
    const source = path.join(temp, "source");
    await mkdir(path.join(source, "Yekan Bakh", "WOFF2", "copy"), { recursive: true });
    await writeFile(path.join(source, "Yekan Bakh", "WOFF2", "YekanBakh-Black.woff2"), "black-a");
    await writeFile(path.join(source, "Yekan Bakh", "WOFF2", "copy", "YekanBakh-Black.woff2"), "black-b");
    const zip = path.join(temp, "Yekan.zip"); await zipDir(source, zip);
    const [profile] = await new FontSystemRegistry(path.join(temp, "library")).add(zip, { replace: true });
    assert.equal(profile.faces.length, 1);
    assert.equal(profile.faces[0].weight, 900);
    assert.equal(profile.skipped.length, 1);
    assert.match(profile.skipped[0].reason, /Duplicate 900 normal WOFF2 face/i);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("font-enabled profiles require Elementor Pro and bundle detected faces", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-font-build-"));
  try {
    const library = path.join(temp, "library");
    const wp = path.join(temp, "wp", "wordpress");
    await mkdir(path.join(wp, "wp-admin"), { recursive: true }); await mkdir(path.join(wp, "wp-includes"), { recursive: true }); await mkdir(path.join(wp, "wp-content"), { recursive: true });
    await writeFile(path.join(wp, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    const wpZip = path.join(temp, "wordpress.zip"); await zipDir(path.join(temp, "wp"), wpZip);
    const elementorZip = await makePlugin(temp, "elementor", "Elementor", "4.2.1");
    const proZip = await makePlugin(temp, "elementor-pro", "Elementor Pro", "4.2.1");
    const packages = new PackageRegistry(library); await packages.add(wpZip); await packages.add(elementorZip); await packages.add(proZip);
    const fonts = path.join(temp, "fonts"); await mkdir(fonts, { recursive: true }); await writeFile(path.join(fonts, "Peyda-Bold.woff2"), "font");
    const fontZip = path.join(temp, "fonts.zip"); await zipDir(fonts, fontZip); const [system] = await new FontSystemRegistry(library).add(fontZip, { name: "Peyda", replace: true });
    await assert.rejects(() => createProfileFromPackages({ libraryDir: library, name: "bad", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1" }, fontSystemId: system.id }), (error) => error?.code === "font_dependencies_missing");
    const doc = await createProfileFromPackages({ libraryDir: library, name: "font-build", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1", "elementor-pro": "4.2.1" }, fontSystemId: system.id });
    const profilePath = path.join(temp, "profile.json"); await writeFile(profilePath, JSON.stringify(doc));
    const profile = await loadProfile(profilePath, { libraryDir: library });
    const output = path.join(temp, "starter.zip");
    const result = await buildStarter({ profile, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
    assert.equal(result.manifest.fontSystem.id, system.id);
    assert.equal(result.manifest.fontSystem.faces[0].weight, 700);
    assert.equal(result.manifest.fontSystem.faces[0].format, "woff2");

    const secondFonts = path.join(temp, "fonts-second"); await mkdir(secondFonts, { recursive: true }); await writeFile(path.join(secondFonts, "Vazirmatn-Regular.woff2"), "second-font");
    const secondZip = path.join(temp, "fonts-second.zip"); await zipDir(secondFonts, secondZip);
    const [secondSystem] = await new FontSystemRegistry(library).add(secondZip, { name: "Vazirmatn", replace: true });
    const multiDoc = await createProfileFromPackages({ libraryDir: library, name: "multi-font-build", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1", "elementor-pro": "4.2.1" }, fontSystemIds: [system.id, secondSystem.id] });
    assert.equal(multiDoc.fontSystem, null);
    assert.deepEqual(multiDoc.fontSystems.map(font => font.id), [system.id, secondSystem.id]);
    const multiProfilePath = path.join(temp, "multi-font-profile.json"); await writeFile(multiProfilePath, JSON.stringify(multiDoc));
    const multiProfile = await loadProfile(multiProfilePath, { libraryDir: library });
    const multiResult = await buildStarter({ profile: multiProfile, outputZip: path.join(temp, "multi-font-starter.zip"), bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
    assert.deepEqual(multiResult.manifest.fontSystems.map(font => font.id), [system.id, secondSystem.id]);
    assert.equal(multiResult.manifest.fontSystems[0].faces[0].family, "Peyda");
    assert.equal(multiResult.manifest.fontSystems[1].faces[0].family, "Vazirmatn");
    assert.notEqual(multiResult.manifest.fontSystems[0].faces[0].file, multiResult.manifest.fontSystems[1].faces[0].file);
    assert.equal(multiResult.manifest.fontSystem.id, system.id, "legacy manifest field mirrors the first selected profile");

    const resources = new DesignSystemResourceService(library);
    await resources.saveTypography({ schemaVersion: 1, id: "brand-type", name: "Brand Type", roles: { body: { fontRole: "primary", weight: 700, size: { desktop: "16px", tablet: "15px", mobile: "14px" } } } });
    await resources.saveColors({ schemaVersion: 1, id: "brand-colors", name: "Brand Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" } });
    await resources.saveDesignSystem({ schemaVersion: 1, id: "brand", name: "Brand", typographyProfileId: "brand-type", colorProfileId: "brand-colors", fontBindings: { primary: system.id } });
    await assert.rejects(() => createProfileFromPackages({ libraryDir: library, name: "conflict", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1", "elementor-pro": "4.2.1" }, fontSystemId: system.id, designSystemId: "brand" }), error => error?.code === "profile_font_selection_conflict");
    const v8doc = await createProfileFromPackages({ libraryDir: library, name: "design-build", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1", "elementor-pro": "4.2.1" }, designSystemId: "brand" });
    assert.equal(v8doc.schemaVersion, 8);
    assert.equal("fontSystem" in v8doc, false);
    const v8path = path.join(temp, "profile-v8.json"); await writeFile(v8path, JSON.stringify(v8doc));
    const v8profile = await loadProfile(v8path, { libraryDir: library });
    const v8result = await buildStarter({ profile: v8profile, outputZip: path.join(temp, "starter-v8.zip"), bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
    assert.equal(v8result.manifest.designSystem.id, "brand");
    assert.equal(v8result.manifest.designSystem.fontProfiles[0].faces[0].file.startsWith("fonts/"), true);
    assert.equal(v8result.manifest.vnext.sha256.length, 64);
    const extracted = path.join(temp, "v8-extracted"); await extractZip(path.join(temp, "starter-v8.zip"), extracted);
    const designRelative = (await readdir(extracted, { recursive: true })).map(String).find(entry => entry.endsWith("starter-design-system.json"));
    const compiled = JSON.parse(await readFile(path.join(extracted, designRelative), "utf8"));
    assert.equal(compiled.designSystem.resources.colors.id, "brand-colors");
    assert.equal(compiled.designSystem.fontProfiles[0].faces[0].file, v8result.manifest.designSystem.fontProfiles[0].faces[0].file);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("schema-v2 snapshots separate source inventory from starter targets and reject unknown settings", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-schema2-"));
  try {
    const make = async (name, extraOption = null) => {
      const dir = path.join(temp, name); await mkdir(dir, { recursive: true });
      const options = { blog_public: 1 }; if (extraOption) options[extraOption] = "bad";
      await writeFile(path.join(dir, "starter-config.json"), JSON.stringify({
        schema_version: 2, exporter_version: "test", generated_at: "2026-08-26T05:33:15+00:00",
        source: { wordpress_version: "7.1", php_version: "8.3", locale: "en_US", theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" }, plugins: [
          { file: "elementor/elementor.php", name: "Elementor", version: "4.2.1", active: true },
          { file: "query-monitor/query-monitor.php", name: "Query Monitor", version: "3.17.2", active: true }
        ] },
        targets: { plugins: [{ file: "elementor/elementor.php", name: "Elementor", version: "4.2.1" }] },
        wordpress: { options, permalink_structure: "/%postname%/", cleanup_default_content: true, reading: { front_page_role: "home", posts_page_role: "blog" }, pages: [{ role:"home", slug:"home", title:"Home" }, { role:"blog", slug:"blog", title:"Blog" }] },
        adapters: { elementor: { options: {}, kit_settings: { container_width: { size: 1300, unit: "px" } }, policy:"structural_layout_only", templates: [{ id: "elementor-header", name: "Header", type: "header", document: [{ id: "root", elType: "section", settings: {}, elements: [] }] }] }, woocommerce:{options:{}}, persian_woocommerce:{options:{}}, code_snippets:{status:"portable",settings:{},snippets:[]}, filterx:{status:"deferred_to_phase_2",reason:"deferred"} },
        safety: { users_exported:false, uploads_exported:false, arbitrary_options_exported:false, credentials_exported:false, raw_database_exported:false, site_specific_ids_intentionally_excluded:true, source_inventory_is_target_packages:false, elementor_site_identity_exported:false, elementor_design_system_exported:false, elementor_visual_styles_exported:false, elementor_license_connection_exported:false, elementor_theme_builder_conditions_exported:false, code_snippets_code_exported:true, code_snippets_code_requires_secret_review:true }
      }));
      await writeFile(path.join(dir, "export-manifest.json"), "{}"); const zip = path.join(temp, `${name}.zip`); await zipDir(dir, zip); return zip;
    };
    const registry = new ConfigSnapshotRegistry(path.join(temp, "library"));
    const imported = await registry.add(await make("valid"));
    assert.equal(imported.record.sourcePlugins.length, 2);
    assert.equal(imported.record.plugins.length, 1);
    const inspection = await registry.inspect(imported.record.id);
    assert.equal(inspection.source.plugins.length, 2);
    assert.equal(inspection.source.targetPlugins.length, 1);
    const invalidZip = await make("invalid", "siteurl");
    await assert.rejects(() => registry.add(invalidZip), (error) => error?.code === "unsafe_config_snapshot");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
