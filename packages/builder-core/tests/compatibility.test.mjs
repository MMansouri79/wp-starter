import assert from "node:assert/strict";
import test from "node:test";
import { assertKnownGoodProfile, compatibilityIssues, compatibilityReport } from "../dist/index.js";

function profile(overrides = {}) {
  return {
    schemaVersion: 6,
    name: "compatibility",
    locale: "en_US",
    wordpress: { version: "7.1", variant: "en_US", zip: "wordpress.zip" },
    theme: { slug: "hello-elementor", version: "3.4.9", zip: "theme.zip" },
    plugins: [
      { slug: "classic-editor", version: "1.7.0", file: "classic-editor/classic-editor.php", zip: "classic.zip" },
      { slug: "elementor", version: "4.0.8", file: "elementor/elementor.php", zip: "elementor.zip" },
      { slug: "elementor-pro", version: "4.0.4", file: "elementor-pro/elementor-pro.php", zip: "pro.zip" }
    ],
    configExport: "config.zip",
    ...overrides
  };
}

test("known-good compatibility accepts the published Elementor baseline", () => {
  assert.deepEqual(compatibilityIssues(profile()), []);
  assert.doesNotThrow(() => assertKnownGoodProfile(profile()));
});

test("unsupported configuration combinations fail with a dedicated error", () => {
  assert.throws(() => assertKnownGoodProfile(profile({ plugins: [{ slug: "elementor", version: "9.9.9", file: "elementor/elementor.php", zip: "elementor.zip" }] })), (error) => error?.code === "unsupported_compatibility");
});

test("plugin upgrades return an additive upgrade-warning report", () => {
  const report = compatibilityReport(profile({ plugins: [
    { slug: "classic-editor", version: "1.7.0", file: "classic-editor/classic-editor.php", zip: "classic.zip" },
    { slug: "elementor", version: "4.2.1", file: "elementor/elementor.php", zip: "elementor-new.zip" },
    { slug: "elementor-pro", version: "4.2.1", file: "elementor-pro/elementor-pro.php", zip: "pro-new.zip" }
  ] }));
  assert.equal(report.status, "upgrade-warning");
  assert.equal(report.baselineId, "elementor-en-wp71");
  assert.deepEqual(report.warnings.map(({ slug, exportedVersion, selectedVersion }) => ({ slug, exportedVersion, selectedVersion })), [
    { slug: "elementor", exportedVersion: "4.0.8", selectedVersion: "4.2.1" },
    { slug: "elementor-pro", exportedVersion: "4.0.4", selectedVersion: "4.2.1" }
  ]);
  assert.deepEqual(report.errors, []);
  assert.doesNotThrow(() => assertKnownGoodProfile(profile({ plugins: [
    { slug: "classic-editor", version: "1.7.0", file: "classic-editor/classic-editor.php", zip: "classic.zip" },
    { slug: "elementor", version: "4.2.1", file: "elementor/elementor.php", zip: "elementor-new.zip" },
    { slug: "elementor-pro", version: "4.2.1", file: "elementor-pro/elementor-pro.php", zip: "pro-new.zip" }
  ] })));
});

test("newer WordPress and theme packages warn while downgrades and replacements remain unsupported", () => {
  const themeUpgrade = compatibilityReport(profile({ theme: { slug: "hello-elementor", version: "3.5.1", zip: "theme-new.zip" } }));
  assert.equal(themeUpgrade.status, "upgrade-warning");
  assert.deepEqual(themeUpgrade.warnings[0], { slug: "hello-elementor", exportedVersion: "3.4.9", selectedVersion: "3.5.1", message: "hello-elementor 3.4.9 → 3.5.1" });
  assert.equal(compatibilityReport(profile({ wordpress: { version: "7.2", variant: "en_US", zip: "wordpress-new.zip" } })).status, "upgrade-warning");
  assert.equal(compatibilityReport(profile({ plugins: [
    { slug: "classic-editor", version: "1.7.0", file: "classic-editor/classic-editor.php", zip: "classic.zip" },
    { slug: "elementor", version: "3.9.9", file: "elementor/elementor.php", zip: "elementor-old.zip" },
    { slug: "elementor-pro", version: "4.0.4", file: "elementor-pro/elementor-pro.php", zip: "pro.zip" }
  ] })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ theme: { slug: "hello-elementor", version: "3.4.8", zip: "theme-old.zip" } })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ theme: { slug: "different-theme", version: "3.5.1", zip: "theme-replacement.zip" } })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ wordpress: { version: "7.0", variant: "en_US", zip: "wordpress-old.zip" } })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ locale: "fa_IR", wordpress: { version: "7.1", variant: "fa_IR", zip: "wordpress-fa.zip" } })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ plugins: profile().plugins.slice(1) })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ plugins: [...profile().plugins, { slug: "extra", version: "1.0.0", file: "extra/extra.php", zip: "extra.zip" }] })).status, "unsupported");
});

test("plugin-set errors identify the mismatch and give a fix", () => {
  const missing = compatibilityReport(profile({ plugins: profile().plugins.slice(1) }));
  assert.match(missing.errors[0], /Missing: classic-editor\./);
  assert.match(missing.errors[0], /Solution: add or remove the listed plugins/);

  const extra = compatibilityReport(profile({ plugins: [...profile().plugins, { slug: "extra", version: "1.0.0", file: "extra/extra.php", zip: "extra.zip" }] }));
  assert.match(extra.errors[0], /Extra: extra\./);
  assert.match(extra.errors[0], /newer versions are allowed once the plugin list matches/);
});

test("unsafe versions and incompatible package dependencies are rejected", () => {
  assert.equal(compatibilityReport(profile({ plugins: [
    { slug: "classic-editor", version: "1.7.0", file: "classic-editor/classic-editor.php", zip: "classic.zip" },
    { slug: "elementor", version: "not-a-version", file: "elementor/elementor.php", zip: "elementor.zip" },
    { slug: "elementor-pro", version: "4.0.4", file: "elementor-pro/elementor-pro.php", zip: "pro.zip" }
  ] })).status, "unsupported");
  assert.equal(compatibilityReport(profile({ plugins: profile().plugins.map((plugin) => plugin.slug === "elementor" ? { ...plugin, requiresPlugins: ["woocommerce"] } : plugin) })).status, "unsupported");
  assert.doesNotThrow(() => assertKnownGoodProfile(profile({ plugins: profile().plugins.map((plugin) => plugin.slug === "elementor" ? { ...plugin, requiresWordPress: ">=6.5" } : plugin) })));
});
