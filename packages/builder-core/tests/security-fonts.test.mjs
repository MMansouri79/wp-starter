import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildStarter, ConfigSnapshotRegistry, createProfileFromPackages, FontSystemRegistry, loadProfile, PackageRegistry, validateZipArchive } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
async function zipDir(source, destination) { await execFileAsync("zip", ["-qr", destination, "."], { cwd: source }); }
async function makePlugin(root, slug, name, version) {
  const dir = path.join(root, slug, slug); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${slug}.php`), `<?php\n/*\nPlugin Name: ${name}\nVersion: ${version}\n*/\n`);
  const zip = path.join(root, `${slug}.zip`); await zipDir(path.join(root, slug), zip); return zip;
}

test("ZIP validator rejects traversal entries before extraction", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-zip-security-"));
  try {
    const zip = path.join(temp, "evil.zip");
    await execFileAsync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../escape.php','bad'); z.close()", zip]);
    await assert.rejects(() => validateZipArchive(zip), (error) => error?.code === "unsafe_archive");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("font registry detects static weights/styles and skips variable fonts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-font-registry-"));
  try {
    const source = path.join(temp, "source"); await mkdir(source, { recursive: true });
    for (const name of ["Peyda-Regular.woff2", "Peyda-SemiBold.woff2", "Peyda-Bold.woff2", "Peyda-ExtraBold.woff2", "Peyda-Italic.woff2", "Peyda-Variable.woff2"]) {
      await writeFile(path.join(source, name), `fake-${name}`);
    }
    const zip = path.join(temp, "Peyda.zip"); await zipDir(source, zip);
    const registry = new FontSystemRegistry(path.join(temp, "library"));
    const system = await registry.add(zip, { name: "Peyda" });
    assert.equal(system.faces.length, 5);
    assert.deepEqual(system.faces.map((face) => [face.weight, face.style]), [[400,"italic"],[400,"normal"],[600,"normal"],[700,"normal"],[800,"normal"]]);
    assert.equal(system.skipped.length, 1);
    assert.match(system.skipped[0].reason, /Variable font/i);
    const resolved = await registry.resolve(system.id);
    assert.equal(resolved.faces.length, 5);
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
    const fontZip = path.join(temp, "fonts.zip"); await zipDir(fonts, fontZip); const system = await new FontSystemRegistry(library).add(fontZip, { name: "Peyda" });
    await assert.rejects(() => createProfileFromPackages({ libraryDir: library, name: "bad", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1" }, fontSystemId: system.id }), (error) => error?.code === "font_dependencies_missing");
    const doc = await createProfileFromPackages({ libraryDir: library, name: "font-build", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: { elementor: "4.2.1", "elementor-pro": "4.2.1" }, fontSystemId: system.id });
    const profilePath = path.join(temp, "profile.json"); await writeFile(profilePath, JSON.stringify(doc));
    const profile = await loadProfile(profilePath, { libraryDir: library });
    const output = path.join(temp, "starter.zip");
    const result = await buildStarter({ profile, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" });
    assert.equal(result.manifest.fontSystem.id, system.id);
    assert.equal(result.manifest.fontSystem.faces[0].weight, 700);
    assert.equal(result.manifest.fontSystem.faces[0].format, "woff2");
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
        adapters: { elementor: { options: {}, kit_settings: { container_width: { size: 1300, unit: "px" } }, policy:"structural_layout_only" }, woocommerce:{options:{}}, persian_woocommerce:{options:{}}, code_snippets:{status:"portable",settings:{},snippets:[]}, filterx:{status:"deferred_to_phase_2",reason:"deferred"} },
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
