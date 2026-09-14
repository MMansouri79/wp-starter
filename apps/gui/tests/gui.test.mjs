import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";


async function localSession(base) {
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  const setCookie = root.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert.match(cookie, /^wp_starter_session=/);
  return (url, options = {}) => fetch(url, { ...options, headers: { ...(options.headers || {}), Cookie: cookie } });
}

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
    const authFetch = await localSession(base);
    const stateResponse = await authFetch(`${base}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.packages.length, 0);
    assert.equal(state.configs.length, 0);
    assert.deepEqual(state.elementorTemplates, []);
    assert.equal(path.resolve(state.library), path.resolve(library));

    const htmlResponse = await authFetch(`${base}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /WP Starter Builder/);
    assert.match(html, /Package Library/);
    assert.match(html, /Font Profiles/);
    assert.match(html, /Typography Profiles/);
    assert.match(html, /Color Profiles/);
    assert.match(html, /Design Systems/);
    assert.match(html, /Elementor Templates/);
    assert.match(html, /id="elementor-templates-body"/);
    assert.match(html, /id="build-elementor-templates"/);
    assert.match(html, /Saved Profiles/);
    assert.match(html, /Build History/);
    assert.match(html, /Configuration Inspector/);
    assert.match(html, /<select id="build-locale"/);
    assert.doesNotMatch(html, /<input id="build-locale"/);
    const appJs = await (await authFetch(`${base}/app.js`)).text();
    assert.match(appJs, /Exporter:/);
    assert.match(appJs, /Newer version/);
    assert.match(appJs, /build-theme-meta/);
    assert.match(appJs, /build-wordpress-meta/);
    assert.match(appJs, /Exported settings will be preserved/);
    assert.match(appJs, /populateProfileEditor/);
    assert.match(appJs, /Unknown — legacy export/);
    assert.match(appJs, /Required dependency · locked/);
    assert.match(appJs, /elementorTemplates/);
    assert.match(appJs, /profile-select"\)\.onchange/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME;
    else process.env.WP_STARTER_HOME = previous;
    await rm(library, { recursive: true, force: true });
  }
});

test("GUI server supports a dynamic port and clean shutdown", async () => {
  const library = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-server-"));
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { startGuiServer } = await import(`../index.mjs?server-test=${Date.now()}`);
  const gui = await startGuiServer({ port: 0, openBrowser: false, log: false });
  try {
    assert.notEqual(gui.port, 0);
    assert.match(gui.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal((await fetch(gui.url)).status, 200);
  } finally {
    await new Promise((resolve) => gui.server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME;
    else process.env.WP_STARTER_HOME = previous;
    await rm(library, { recursive: true, force: true });
  }
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createZip } from "../../../packages/builder-core/dist/index.js";
async function zipDir(source, destination) { await createZip(source, destination); }

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
    const authFetch = await localSession(baseUrl);
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

    const upload = async (file) => authFetch(`${baseUrl}/api/packages?filename=${encodeURIComponent(path.basename(file))}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(file) });
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
    const configRes = await authFetch(`${baseUrl}/api/configs?filename=config.zip`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(configZip) });
    assert.equal(configRes.status, 200);
    const inspectRes = await authFetch(`${baseUrl}/api/configs/snapshot-20260824050124/inspect`);
    assert.equal(inspectRes.status, 200);
    const inspectData = await inspectRes.json();
    assert.equal(inspectData.inspection.source.wordpressVersion, "7.1");
    assert.equal(inspectData.inspection.source.locale, "fa_IR");
    assert.equal(inspectData.inspection.source.plugins.length, 1);

    const profileRes = await authFetch(`${baseUrl}/api/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      configId: "snapshot-20260824050124", name: "english-new-elementor", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", themeVersion: "3.4.9", pluginVersions: { elementor: "4.2.1" }
    }) });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.profile.schemaVersion, 7);
    assert.equal(profileData.profile.wordpress.variant, "en_US");
    assert.equal(profileData.profile.plugins[0].version, "4.2.1");
    assert.equal(profileData.compatibility.status, "unsupported");

    const renamedRes = await authFetch(`${baseUrl}/api/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      configId: "snapshot-20260824050124", name: "renamed-profile", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", themeVersion: "3.4.9", pluginVersions: { elementor: "4.2.1" }, sourceFile: profileData.file
    }) });
    assert.equal(renamedRes.status, 200);
    const renamedData = await renamedRes.json();
    assert.equal(renamedData.file, "renamed-profile.json");
    const renamedState = await (await authFetch(`${baseUrl}/api/state`)).json();
    assert.equal(renamedState.profiles.length, 1);
    assert.equal(renamedState.profiles[0].file, "renamed-profile.json");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME; else process.env.WP_STARTER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("GUI can create a package-only profile and expose build progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-package-only-"));
  const library = path.join(root, "library");
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?package-only-test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authFetch = await localSession(baseUrl);

    const wp = path.join(root, "wp", "wordpress");
    await mkdir(path.join(wp, "wp-admin"), { recursive: true });
    await mkdir(path.join(wp, "wp-includes"), { recursive: true });
    await mkdir(path.join(wp, "wp-content", "themes", "twentytwentyfive"), { recursive: true });
    await writeFile(path.join(wp, "wp-includes/version.php"), "<?php\n$wp_version = '7.1';\n");
    await writeFile(path.join(wp, "wp-content", "themes", "twentytwentyfive", "style.css"), "Theme Name: Twenty Twenty-Five\n");
    const wpZip = path.join(root, "wordpress.zip");
    await zipDir(path.join(root, "wp"), wpZip);

    const pluginDir = path.join(root, "plugin", "simple-plugin");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(path.join(pluginDir, "simple-plugin.php"), "<?php\n/*\nPlugin Name: Simple Plugin\nVersion: 1.2.3\n*/\n");
    const pluginZip = path.join(root, "plugin.zip");
    await zipDir(path.join(root, "plugin"), pluginZip);

    const upload = async (file) => authFetch(`${baseUrl}/api/packages?filename=${encodeURIComponent(path.basename(file))}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(file) });
    assert.equal((await upload(wpZip)).status, 200);
    assert.equal((await upload(pluginZip)).status, 200);

    const profileRes = await authFetch(`${baseUrl}/api/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        configId: "",
        name: "packages-only",
        locale: "en_US",
        wordpressVersion: "7.1",
        wordpressVariant: "en_US",
        themeSlug: "",
        themeVersion: "",
        pluginVersions: { "simple-plugin": "1.2.3" }
      })
    });
    assert.equal(profileRes.status, 200);
    const profileData = await profileRes.json();
    assert.equal(profileData.profile.schemaVersion, 7);
    assert.equal(profileData.profile.config, null);
    assert.equal(profileData.profile.theme, null);

    const jobRes = await authFetch(`${baseUrl}/api/build-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileFile: profileData.file })
    });
    assert.equal(jobRes.status, 202);
    const { id } = await jobRes.json();

    let job;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const statusRes = await authFetch(`${baseUrl}/api/build-jobs/${id}`);
      assert.equal(statusRes.status, 200);
      job = await statusRes.json();
      if (job.status === "complete" || job.status === "failed") break;
    }
    assert.equal(job.status, "complete", job.error?.message || job.message);
    assert.equal(job.percent, 100);
    assert.equal(job.result.manifest.configurationEnabled, false);
    assert.equal(job.result.manifest.theme, null);

    const profileGet = await authFetch(`${baseUrl}/api/profiles/${encodeURIComponent(profileData.file)}`);
    assert.equal(profileGet.status, 200);
    const rawProfile = await profileGet.json();
    assert.equal(rawProfile.profile.name, "packages-only");
    assert.equal(rawProfile.profile.config, null);

    const stateAfterBuild = await (await authFetch(`${baseUrl}/api/state`)).json();
    assert.equal(stateAfterBuild.builds.length, 1);
    assert.equal(stateAfterBuild.builds[0].profile, "packages-only");
    assert.equal(stateAfterBuild.builds[0].profileFile, profileData.file);
    assert.equal(stateAfterBuild.builds[0].configurationEnabled, false);
    assert.match(stateAfterBuild.builds[0].sha256, /^[a-f0-9]{64}$/);

    const deleteBuild = await authFetch(`${baseUrl}/api/builds?file=${encodeURIComponent(stateAfterBuild.builds[0].file)}`, { method: "DELETE" });
    assert.equal(deleteBuild.status, 200);
    const deleteProfile = await authFetch(`${baseUrl}/api/profiles/${encodeURIComponent(profileData.file)}`, { method: "DELETE" });
    assert.equal(deleteProfile.status, 200);
    const finalState = await (await authFetch(`${baseUrl}/api/state`)).json();
    assert.equal(finalState.builds.length, 0);
    assert.equal(finalState.profiles.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME; else process.env.WP_STARTER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});


test("GUI font import splits a multi-family ZIP into WOFF2-only named profiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-fonts-"));
  const library = path.join(root, "library");
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?font-test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authFetch = await localSession(baseUrl);
    const a = path.join(root, "font-src", "Yekan Bakh", "WOFF2");
    const b = path.join(root, "font-src", "Yekan Bakh FaNum", "WOFF2");
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true });
    await writeFile(path.join(a, "YekanBakh-Regular.woff2"), "a400");
    await writeFile(path.join(a, "YekanBakh-Bold.woff2"), "a700");
    await writeFile(path.join(a, "YekanBakh-Bold.ttf"), "ignored");
    await writeFile(path.join(b, "YekanBakhFaNum-Regular.woff2"), "b400");
    await writeFile(path.join(b, "YekanBakhFaNum-ExtraBold.woff2"), "b800");
    const zip = path.join(root, "font1403.zip"); await zipDir(path.join(root, "font-src"), zip);
    const upload = await authFetch(`${baseUrl}/api/fonts?filename=font1403.zip`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(zip) });
    assert.equal(upload.status, 200);
    const imported = await upload.json();
    assert.deepEqual(imported.map((profile) => profile.name), ["Yekan Bakh", "Yekan Bakh FaNum"]);
    const state = await (await authFetch(`${baseUrl}/api/state`)).json();
    assert.deepEqual(state.fonts.map((profile) => profile.name), ["Yekan Bakh", "Yekan Bakh FaNum"]);
    assert(state.fonts.every((profile) => profile.faces.every((face) => face.format === "woff2")));
    const yekan = state.fonts.find((profile) => profile.name === "Yekan Bakh");
    assert.deepEqual(yekan.faces.map((face) => [face.filename, face.weight, face.style]), [
      ["YekanBakh-Regular.woff2", 400, "normal"],
      ["YekanBakh-Bold.woff2", 700, "normal"]
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME; else process.env.WP_STARTER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("GUI compares two configuration snapshots through the Phase 2 comparison API", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-compare-"));
  const library = path.join(root, "library");
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?compare-test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authFetch = await localSession(baseUrl);
    const makeConfig = async (name, generatedAt, elementorVersion, containerWidth) => {
      const dir = path.join(root, name); await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "starter-config.json"), JSON.stringify({
        schema_version: 1, exporter_version: "gui-compare", generated_at: generatedAt,
        source: {
          wordpress_version: "7.1", php_version: "8.3.33", locale: "en_US",
          theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" },
          plugins: [{ file: "elementor/elementor.php", name: "Elementor", version: elementorVersion, active: true }]
        },
        wordpress: { options: { blog_public: 1 }, pages: [{ title: "Home", slug: "home" }] },
        adapters: { elementor: { kit_settings: { container_width: containerWidth } } },
        safety: { users_exported: false }
      }));
      await writeFile(path.join(dir, "export-manifest.json"), "{}");
      const zip = path.join(root, `${name}.zip`); await zipDir(dir, zip); return zip;
    };
    const leftZip = await makeConfig("compare-left", "2026-08-24T05:00:00+00:00", "4.0.8", 1400);
    const rightZip = await makeConfig("compare-right", "2026-08-24T06:00:00+00:00", "4.2.1", 1280);
    const uploadConfig = async (file) => authFetch(`${baseUrl}/api/configs?filename=${encodeURIComponent(path.basename(file))}`, { method: "POST", headers: { "Content-Type": "application/zip" }, body: await readFile(file) });
    assert.equal((await uploadConfig(leftZip)).status, 200);
    assert.equal((await uploadConfig(rightZip)).status, 200);

    const compareRes = await authFetch(`${baseUrl}/api/configs/compare?left=snapshot-20260824050000&right=snapshot-20260824060000`);
    assert.equal(compareRes.status, 200);
    const comparison = await compareRes.json();
    assert.equal(comparison.summary.binary, 1);
    assert.equal(comparison.summary.configuration, 1);
    assert.equal(comparison.binary.changes[0].key, "elementor");
    assert.equal(comparison.configuration.changes[0].path, "kit_settings.container_width");

    const html = await (await authFetch(`${baseUrl}/`)).text();
    assert.match(html, /Compare Snapshots/);
    assert.match(html, /Snapshot Comparison/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME; else process.env.WP_STARTER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
