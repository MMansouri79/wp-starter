import assert from "node:assert/strict";
import test from "node:test";
import { assertKnownGoodProfile, compatibilityIssues } from "../dist/index.js";

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
