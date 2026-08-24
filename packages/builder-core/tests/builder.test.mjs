import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildStarter, loadProfile } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

async function zipDir(source, destination) {
  await execFileAsync("zip", ["-qr", destination, "."], { cwd: source });
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

    const theme = path.join(temp, "theme/hello-elementor");
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

    const { stdout: zipEntries } = await execFileAsync("unzip", ["-Z1", output]);
    assert.equal(zipEntries.includes("\\"), false, "deployment ZIP entries must use POSIX separators");

    const unpack = path.join(temp, "unpacked");
    await mkdir(unpack, { recursive: true });
    await execFileAsync("unzip", ["-q", output, "-d", unpack]);

    const bootstrap = await readFile(path.join(unpack, "wp-content/mu-plugins/site-starter-bootstrap.php"), "utf8");
    assert.match(bootstrap, /WP Starter Bootstrap/);

    const build = JSON.parse(await readFile(path.join(unpack, "wp-content/starter-package/starter-build.json"), "utf8"));
    assert.equal(build.schemaVersion, 2);
    assert.equal(build.plugins[0].file, "example-plugin/example-plugin.php");
    assert.equal(build.plugins[0].zip, "packages/plugins/example-plugin-1.0.0.zip");

    const bundledPlugin = path.join(unpack, "wp-content/starter-package/packages/plugins/example-plugin-1.0.0.zip");
    const bundledTheme = path.join(unpack, "wp-content/starter-package/packages/themes/hello-elementor-1.0.0.zip");
    await readFile(bundledPlugin);
    await readFile(bundledTheme);
    await assert.rejects(() => readFile(path.join(unpack, "wp-content/plugins/example-plugin/example-plugin.php")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
