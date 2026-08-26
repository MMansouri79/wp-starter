import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildStarter, inspectPackage, loadProfile, PackageRegistry } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

async function zipDir(source, destination) {
  await execFileAsync("zip", ["-qr", destination, "."], { cwd: source });
}

test("registers arbitrary packages and builds schema v2 profiles from exact package coordinates", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-registry-"));

  try {
    const core = path.join(temp, "wp/wordpress");
    await mkdir(path.join(core, "wp-admin"), { recursive: true });
    await mkdir(path.join(core, "wp-includes"), { recursive: true });
    await mkdir(path.join(core, "wp-content"), { recursive: true });
    await writeFile(path.join(core, "index.php"), "<?php\n");
    await writeFile(path.join(core, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    const wpZip = path.join(temp, "wordpress-7.1.zip");
    await zipDir(path.join(temp, "wp"), wpZip);

    const theme = path.join(temp, "theme/hello-elementor");
    await mkdir(theme, { recursive: true });
    await writeFile(path.join(theme, "style.css"), "/*\nTheme Name: Hello Elementor\nVersion: 3.4.9\nText Domain: hello-elementor\n*/\n");
    const themeZip = path.join(temp, "hello-elementor.zip");
    await zipDir(path.join(temp, "theme"), themeZip);

    const plugin = path.join(temp, "plugin/arbitrary-plugin");
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(plugin, "bootstrap.php"), `<?php\n/*\nPlugin Name: Arbitrary Plugin\nVersion: 2.4.1\nText Domain: arbitrary-plugin\nRequires at least: 6.5\nRequires PHP: 8.0\nRequires Plugins: woocommerce, elementor\n*/\n`);
    const pluginZip = path.join(temp, "whatever-filename.zip");
    await zipDir(path.join(temp, "plugin"), pluginZip);

    const inspection = await inspectPackage(pluginZip);
    assert.equal(inspection.kind, "plugin");
    assert.equal(inspection.slug, "arbitrary-plugin");
    assert.equal(inspection.version, "2.4.1");
    assert.equal(inspection.mainFile, "arbitrary-plugin/bootstrap.php");
    assert.deepEqual(inspection.requiresPlugins, ["woocommerce", "elementor"]);

    const library = path.join(temp, "library");
    const registry = new PackageRegistry(library);
    await registry.add(wpZip);
    await registry.add(themeZip);
    await registry.add(pluginZip);

    const packages = await registry.list();
    assert.equal(packages.length, 3);
    assert.equal((await registry.resolve("plugin", "arbitrary-plugin", "2.4.1")).mainFile, "arbitrary-plugin/bootstrap.php");

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
      schemaVersion: 2,
      name: "registry-build",
      locale: "en_US",
      wordpress: { version: "7.1" },
      theme: { slug: "hello-elementor", version: "3.4.9" },
      plugins: [
        { slug: "arbitrary-plugin", version: "2.4.1", required: true },
        { slug: "persian-missing", version: "1.0.0", required: true, locales: ["fa_IR"] }
      ],
      configExport: configZip,
      languageArchives: []
    }, null, 2));

    const profile = await loadProfile(profilePath, { libraryDir: library });
    assert.equal(profile.schemaVersion, 2);
    assert.equal(profile.plugins[0].file, "arbitrary-plugin/bootstrap.php");

    const output = path.join(temp, "starter.zip");
    const result = await buildStarter({
      profile,
      outputZip: output,
      bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"),
      builderVersion: "test"
    });

    assert.equal(result.manifest.wordpress.version, "7.1");
    assert.equal(result.manifest.plugins.length, 1);
    assert.equal(result.manifest.plugins[0].slug, "arbitrary-plugin");

    const unpack = path.join(temp, "unpacked");
    await mkdir(unpack, { recursive: true });
    await execFileAsync("unzip", ["-q", output, "-d", unpack]);
    assert.equal(result.manifest.schemaVersion, 4);
    assert.equal(result.manifest.plugins[0].zip, "packages/plugins/arbitrary-plugin-2.4.1.zip");
    const payloadName = (await readdir(path.join(unpack, "wp-content"))).find((name) => name.startsWith(".wp-starter-"));
    assert.ok(payloadName);
    await readFile(path.join(unpack, "wp-content", payloadName, "packages/plugins/arbitrary-plugin-2.4.1.zip"));
    await assert.rejects(() => readFile(path.join(unpack, "wp-content/plugins/arbitrary-plugin/bootstrap.php")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("stores localized WordPress packages as separate variants of the same version", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-wp-variants-"));
  try {
    const makeCore = async (name, locale) => {
      const base = path.join(temp, name, "wordpress");
      await mkdir(path.join(base, "wp-admin"), { recursive: true });
      await mkdir(path.join(base, "wp-includes"), { recursive: true });
      await mkdir(path.join(base, "wp-content", "languages"), { recursive: true });
      await writeFile(path.join(base, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
      if (locale !== "en_US") await writeFile(path.join(base, "wp-content", "languages", `${locale}.mo`), "language");
      const zip = path.join(temp, `${name}.zip`);
      await zipDir(path.join(temp, name), zip);
      return zip;
    };

    const library = path.join(temp, "library");
    const registry = new PackageRegistry(library);
    await registry.add(await makeCore("wordpress-en", "en_US"));
    await registry.add(await makeCore("wordpress-fa", "fa_IR"));

    const records = (await registry.list("wordpress")).sort((a, b) => a.variant.localeCompare(b.variant));
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.variant), ["en_US", "fa_IR"]);
    assert.equal((await registry.resolve("wordpress", "wordpress", "7.1", "en_US")).variant, "en_US");
    assert.equal((await registry.resolve("wordpress", "wordpress", "7.1", "fa_IR")).variant, "fa_IR");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
