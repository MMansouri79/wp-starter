import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("GUI serves the workspace and local API", async () => {
  const library = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-test-"));
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${address.port}`;
    const stateResponse = await fetch(`${base}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.packages.length, 0);
    assert.equal(state.configs.length, 0);
    assert.equal(path.resolve(state.library), path.resolve(library));

    const htmlResponse = await fetch(`${base}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /WP Starter Builder/);
    assert.match(html, /Package Library/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME;
    else process.env.WP_STARTER_HOME = previous;
    await rm(library, { recursive: true, force: true });
  }
});

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function zipDir(source, destination) { await execFileAsync("zip", ["-qr", destination, "."], { cwd: source }); }

test("GUI profile API can pin package versions and localized WordPress variants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-profile-"));
  const library = path.join(root, "library");
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?profile-test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const makeWp = async (folder, locale) => {
      const wp = path.join(root, folder, "wordpress");
      await mkdir(path.join(wp, "wp-admin"), { recursive: true });
      await mkdir(path.join(wp, "wp-includes"), { recursive: true });
      await mkdir(path.join(wp, "wp-content", "languages"), { recursive: true });
      await writeFile(path.join(wp, "wp-includes/version.php"), `<?php\n$wp_version = '7.1';\n$wp_local_package = '${locale === "en_US" ? "" : locale}';\n`);
      if (locale !== "en_US") await writeFile(path.join(wp, "wp-content", "languages", `${locale}.mo`), "lang");
      const out = path.join(root, `${folder}.zip`); await zipDir(path.join(root, folder), out); return out;
    };
    const themeDir = path.join(root, "theme", "hello-elementor"); await mkdir(themeDir, { recursive: true });
    await writeFile(path.join(themeDir, "style.css"), "/*\nTheme Name: Hello Elementor\nVersion: 3.4.9\n*/\n");
    const themeZip = path.join(root, "theme.zip"); await zipDir(path.join(root, "theme"), themeZip);
    const pluginDir = path.join(root, "plugin", "elementor"); await mkdir(pluginDir, { recursive: true });
    await writeFile(path.join(pluginDir, "elementor.php"), "<?php\n/*\nPlugin Name: Elementor\nVersion: 4.2.1\n*/\n");
    const pluginZip = path.join(root, "elementor.zip"); await zipDir(path.join(root, "plugin"), pluginZip);

    const upload = async (file) => fetch(`${baseUrl}/api/packages?filename=${encodeURIComponent(path.basename(file))}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(file) });
    assert.equal((await upload(await makeWp("wp-en", "en_US"))).status, 200);
    assert.equal((await upload(await makeWp("wp-fa", "fa_IR"))).status, 200);
    assert.equal((await upload(themeZip)).status, 200);
    assert.equal((await upload(pluginZip)).status, 200);

    const configDir = path.join(root, "config"); await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "starter-config.json"), JSON.stringify({
      schema_version: 1, generated_at: "2026-08-24T05:01:24+00:00",
      source: { wordpress_version: "7.1", locale: "fa_IR", theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" }, plugins: [{ file: "elementor/elementor.php", name: "Elementor", version: "4.0.8", active: true }] },
      wordpress: { options: {}, pages: [] }, adapters: {}
    }));
    await writeFile(path.join(configDir, "export-manifest.json"), "{}");
    const configZip = path.join(root, "config.zip"); await zipDir(configDir, configZip);
    const configRes = await fetch(`${baseUrl}/api/configs?filename=config.zip`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(configZip) });
    assert.equal(configRes.status, 200);

    const profileRes = await fetch(`${baseUrl}/api/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      configId: "snapshot-20260824050124", name: "english-new-elementor", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", themeVersion: "3.4.9", pluginVersions: { elementor: "4.2.1" }
    }) });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.profile.schemaVersion, 4);
    assert.equal(profileData.profile.wordpress.variant, "en_US");
    assert.equal(profileData.profile.plugins[0].version, "4.2.1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME; else process.env.WP_STARTER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
