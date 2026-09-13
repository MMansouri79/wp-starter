import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildStarter, createZip, extractZip, loadProfile } from "../dist/index.js";
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function zipDir(source, destination) {
  await createZip(source, destination);
}

test("builds a self-contained WordPress distribution from local artifacts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-test-"));

  try {
    const core = path.join(temp, "core/wordpress");
    await mkdir(path.join(core, "wp-admin"), { recursive: true });
    await mkdir(path.join(core, "wp-includes"), { recursive: true });
    await mkdir(path.join(core, "wp-content"), { recursive: true });
    await writeFile(path.join(core, "index.php"), "<?php\n");
    const wpZip = path.join(temp, "wordpress.zip");
    await zipDir(path.dirname(core), wpZip);

    const theme = path.join(temp, "theme/downloaded-theme-folder");
    await mkdir(theme, { recursive: true });
    await writeFile(path.join(theme, "style.css"), "Theme Name: Hello Elementor\nVersion: 1.0.0\n");
    const themeZip = path.join(temp, "theme.zip");
    await zipDir(path.join(temp, "theme"), themeZip);

    const plugin = path.join(temp, "plugin/example-plugin");
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(plugin, "example-plugin.php"), "<?php\n/* Plugin Name: Example */\n");
    const pluginZip = path.join(temp, "plugin.zip");
    await zipDir(path.join(temp, "plugin"), pluginZip);

    const configDir = path.join(temp, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "starter-config.json"), JSON.stringify({
      schema_version: 1,
      wordpress: { options: {}, pages: [] },
      adapters: {}
    }));
    await writeFile(path.join(configDir, "export-manifest.json"), "{}");
    const configZip = path.join(temp, "config.zip");
    await zipDir(configDir, configZip);

    const profilePath = path.join(temp, "profile.json");
    await writeFile(profilePath, JSON.stringify({
      schemaVersion: 1,
      name: "test",
      locale: "en_US",
      wordpress: { version: "1.0.0", zip: wpZip },
      theme: { slug: "hello-elementor", version: "1.0.0", zip: themeZip },
      plugins: [
        {
          slug: "example-plugin",
          file: "example-plugin/example-plugin.php",
          version: "1.0.0",
          zip: pluginZip,
          required: true
        },
        {
          slug: "persian-only-plugin",
          file: "persian-only-plugin/plugin.php",
          version: "1.0.0",
          zip: path.join(temp, "intentionally-missing.zip"),
          required: true,
          locales: ["fa_IR"]
        }
      ],
      configExport: configZip,
      languageArchives: []
    }, null, 2));

    const profile = await loadProfile(profilePath);
    const output = path.join(temp, "starter.zip");
    const result = await buildStarter({
      profile,
      outputZip: output,
      bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"),
      builderVersion: "test"
    });

    assert.equal(result.manifest.profile, "test");
    assert.match(result.sha256, /^[a-f0-9]{64}$/);

    const unpack = path.join(temp, "unpacked");
    await extractZip(output, unpack);

    const bootstrap = await readFile(path.join(unpack, "wp-content/mu-plugins/site-starter-bootstrap.php"), "utf8");
    assert.match(bootstrap, /WP Starter Bootstrap/);

    const payloadName = (await readdir(path.join(unpack, "wp-content"))).find((name) => name.startsWith(".wp-starter-"));
    assert.ok(payloadName, "randomized starter payload should exist");
    const payload = path.join(unpack, "wp-content", payloadName);
    const build = JSON.parse(await readFile(path.join(payload, "starter-build.json"), "utf8"));
    assert.equal(build.schemaVersion, 4);
    assert.equal(build.plugins[0].file, "example-plugin/example-plugin.php");
    assert.equal(build.plugins[0].zip, "packages/plugins/example-plugin-1.0.0.zip");

    const bundledPlugin = path.join(payload, "packages/plugins/example-plugin-1.0.0.zip");
    const bundledTheme = path.join(payload, "packages/themes/hello-elementor-1.0.0.zip");
    await readFile(bundledPlugin);
    await readFile(bundledTheme);

    const themeUnpack = path.join(temp, "theme-unpacked");
    const pluginUnpack = path.join(temp, "plugin-unpacked");
    await extractZip(bundledTheme, themeUnpack);
    await extractZip(bundledPlugin, pluginUnpack);
    assert.ok(await readFile(path.join(themeUnpack, "hello-elementor/style.css")));
    assert.ok(await readFile(path.join(pluginUnpack, "example-plugin/example-plugin.php")));

    await assert.rejects(() => readFile(path.join(unpack, "wp-content/plugins/example-plugin/example-plugin.php")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("builds a package-only profile without a configuration snapshot or custom theme", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-package-only-"));
  try {
    const { PackageRegistry, createProfileFromPackages } = await import("../dist/index.js");
    const library = path.join(temp, "library");

    const core = path.join(temp, "core/wordpress");
    await mkdir(path.join(core, "wp-admin"), { recursive: true });
    await mkdir(path.join(core, "wp-includes"), { recursive: true });
    await mkdir(path.join(core, "wp-content", "themes", "twentytwentyfive"), { recursive: true });
    await writeFile(path.join(core, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    await writeFile(path.join(core, "wp-content", "themes", "twentytwentyfive", "style.css"), "Theme Name: Twenty Twenty-Five\n");
    const wpZip = path.join(temp, "wordpress.zip");
    await zipDir(path.dirname(core), wpZip);

    const plugin = path.join(temp, "plugin/example-plugin");
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(plugin, "example-plugin.php"), "<?php\n/*\nPlugin Name: Example Plugin\nVersion: 2.0.0\n*/\n");
    const pluginZip = path.join(temp, "plugin.zip");
    await zipDir(path.join(temp, "plugin"), pluginZip);

    const registry = new PackageRegistry(library);
    await registry.add(wpZip);
    await registry.add(pluginZip);

    const profileDocument = await createProfileFromPackages({
      libraryDir: library,
      name: "packages-only",
      locale: "en_US",
      wordpressVersion: "7.1",
      wordpressVariant: "en_US",
      themeSlug: null,
      themeVersion: null,
      plugins: { "example-plugin": "2.0.0" }
    });
    assert.equal(profileDocument.schemaVersion, 6);
    assert.equal(profileDocument.config, null);
    assert.equal(profileDocument.theme, null);

    const profilePath = path.join(temp, "profile.json");
    await writeFile(profilePath, JSON.stringify(profileDocument, null, 2));
    const profile = await loadProfile(profilePath, { libraryDir: library });
    assert.equal(profile.configExport, null);
    assert.equal(profile.theme, null);

    const progress = [];
    const output = path.join(temp, "package-only.zip");
    const result = await buildStarter({
      profile,
      outputZip: output,
      bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"),
      builderVersion: "test",
      onProgress: (entry) => progress.push(entry)
    });

    assert.equal(result.manifest.schemaVersion, 4);
    assert.equal(result.manifest.configurationEnabled, false);
    assert.equal(result.manifest.configExport, null);
    assert.equal(result.manifest.theme, null);
    assert.equal(progress.at(-1)?.percent, 100);

    const unpack = path.join(temp, "unpacked");
    await mkdir(unpack, { recursive: true });
    await extractZip(output, unpack);
    const payloadName = (await readdir(path.join(unpack, "wp-content"))).find((name) => name.startsWith(".wp-starter-"));
    assert.ok(payloadName);
    const payload = path.join(unpack, "wp-content", payloadName);
    await assert.rejects(() => readFile(path.join(payload, "starter-config.json")));
    await readFile(path.join(payload, "packages/plugins/example-plugin-2.0.0.zip"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
