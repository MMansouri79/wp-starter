import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ConfigSnapshotRegistry, PackageRegistry, createProfileFromSnapshot, loadProfile } from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function zipDir(source, destination) {
  await execFileAsync("zip", ["-qr", destination, "."], { cwd: source });
}

test("imports a configuration snapshot, ignores exporter infrastructure, and reports exact package requirements", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-snapshot-"));
  try {
    const configDir = path.join(temp, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "starter-config.json"), JSON.stringify({
      schema_version: 1,
      exporter_version: "test",
      generated_at: "2026-08-24T05:01:24+00:00",
      source: {
        wordpress_version: "7.1",
        php_version: "8.3.33",
        locale: "fa_IR",
        theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" },
        plugins: [
          { file: "elementor/elementor.php", name: "Elementor", version: "4.0.8", active: true },
          { file: "filterx/filterx.php", name: "FilterX", version: "0.6.1", active: true },
          { file: "wp-starter-exporter/starter-exporter.php", name: "WP Starter Exporter", version: "0.1", active: true }
        ]
      },
      wordpress: { options: {}, pages: [] },
      adapters: {}
    }, null, 2));
    await writeFile(path.join(configDir, "export-manifest.json"), "{}\n");
    const configZip = path.join(temp, "starter-config.zip");
    await zipDir(configDir, configZip);

    const library = path.join(temp, "library");
    const snapshots = new ConfigSnapshotRegistry(library);
    const imported = await snapshots.add(configZip);
    assert.equal(imported.record.id, "snapshot-20260824050124");
    assert.equal(imported.record.plugins.length, 2);
    assert.equal(imported.record.plugins.some((p) => p.slug === "wp-starter-exporter"), false);

    const wp = path.join(temp, "wp/wordpress");
    await mkdir(path.join(wp, "wp-admin"), { recursive: true });
    await mkdir(path.join(wp, "wp-includes"), { recursive: true });
    await mkdir(path.join(wp, "wp-content/languages"), { recursive: true });
    await writeFile(path.join(wp, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    await writeFile(path.join(wp, "wp-content/languages/fa_IR.mo"), "fake-language");
    const wpZip = path.join(temp, "wordpress.zip");
    await zipDir(path.join(temp, "wp"), wpZip);

    const theme = path.join(temp, "theme/hello-elementor");
    await mkdir(theme, { recursive: true });
    await writeFile(path.join(theme, "style.css"), "/*\nTheme Name: Hello Elementor\nVersion: 3.4.9\n*/\n");
    const themeZip = path.join(temp, "theme.zip");
    await zipDir(path.join(temp, "theme"), themeZip);

    const elementor = path.join(temp, "plugin/elementor");
    await mkdir(elementor, { recursive: true });
    await writeFile(path.join(elementor, "elementor.php"), "<?php\n/*\nPlugin Name: Elementor\nVersion: 4.0.8\n*/\n");
    const elementorZip = path.join(temp, "elementor.zip");
    await zipDir(path.join(temp, "plugin"), elementorZip);

    const packages = new PackageRegistry(library);
    await packages.add(wpZip);
    await packages.add(themeZip);
    await packages.add(elementorZip);

    const report = await snapshots.requirements(imported.record.id, packages);
    assert.equal(report.available, 3);
    assert.equal(report.missing, 1);
    assert.equal(report.requirements.find((r) => r.slug === "filterx")?.status, "missing");

    await assert.rejects(
      () => createProfileFromSnapshot(imported.record.id, { libraryDir: library }),
      (error) => error?.code === "missing_profile_packages"
    );

    const filterx = path.join(temp, "filterx/filterx");
    await mkdir(filterx, { recursive: true });
    await writeFile(path.join(filterx, "filterx.php"), "<?php\n/*\nPlugin Name: FilterX\nVersion: 0.6.1\n*/\n");
    const filterxZip = path.join(temp, "filterx.zip");
    await zipDir(path.join(temp, "filterx"), filterxZip);
    await packages.add(filterxZip);

    const generated = await createProfileFromSnapshot(imported.record.id, {
      libraryDir: library,
      name: "generated-from-snapshot"
    });
    assert.equal(generated.schemaVersion, 5);
    assert.equal(generated.name, "generated-from-snapshot");
    assert.equal(generated.wordpress.version, "7.1");
    assert.equal(generated.wordpress.variant, "fa_IR");
    assert.equal(generated.theme.slug, "hello-elementor");
    assert.deepEqual(generated.plugins.map((plugin) => plugin.slug).sort(), ["elementor", "filterx"]);
    assert.equal(generated.config.id, imported.record.id);

    const wpEn = path.join(temp, "wp-en/wordpress");
    await mkdir(path.join(wpEn, "wp-admin"), { recursive: true });
    await mkdir(path.join(wpEn, "wp-includes"), { recursive: true });
    await writeFile(path.join(wpEn, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    const wpEnZip = path.join(temp, "wordpress-en.zip");
    await zipDir(path.join(temp, "wp-en"), wpEnZip);
    await packages.add(wpEnZip);

    const overridden = await createProfileFromSnapshot(imported.record.id, {
      libraryDir: library,
      name: "english-test",
      locale: "en_US",
      excludePlugins: ["filterx"]
    });
    assert.equal(overridden.locale, "en_US");
    assert.deepEqual(overridden.plugins.map((plugin) => plugin.slug), ["elementor"]);

    const profilePath = path.join(temp, "profile.json");
    await writeFile(profilePath, JSON.stringify({
      schemaVersion: 4,
      name: "snapshot-build",
      locale: "fa_IR",
      wordpress: { version: "7.1", variant: "fa_IR" },
      theme: { slug: "hello-elementor", version: "3.4.9" },
      plugins: [{ slug: "elementor", version: "4.0.8" }],
      config: { id: imported.record.id },
      languageArchives: []
    }, null, 2));

    const profile = await loadProfile(profilePath, { libraryDir: library });
    assert.equal(profile.schemaVersion, 4);
    assert.equal(path.resolve(profile.configExport), path.resolve(library, imported.record.zip));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
