import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertValidReport,
  createZip,
  extractZip,
  remapPortableTemplate,
  validateColorProfile,
  validateDesignSystem,
  validateTypographyProfile
} from "../dist/index.js";

test("vNext typography and color resources validate semantic fields", () => {
  const typography = {
    schemaVersion: 1,
    id: "persian-commerce",
    name: "Persian Commerce",
    roles: {
      body: { fontRole: "primary", weight: 400, size: { desktop: "15px", mobile: "14px" }, lineHeight: { desktop: 1.8 } },
      h1: { fontRole: "primary", weight: 800, size: { desktop: "40px" } }
    }
  };
  const colors = {
    schemaVersion: 1,
    id: "industrial-light",
    name: "Industrial Light",
    elementor: { primary: "#4F6866", secondary: "#A0B0AF", text: "#222828", accent: "#B48A4A" },
    semantic: { surface: "#F1F7F6" }
  };
  assertValidReport(validateTypographyProfile(typography));
  assertValidReport(validateColorProfile(colors));
  const report = validateDesignSystem({ schemaVersion: 1, id: "store", name: "Store", fontBindings: { primary: "yekan" }, typographyProfileId: typography.id, colorProfileId: colors.id }, typography, colors, [{ schemaVersion: 1, id: "yekan", name: "Yekan", family: "Yekan", faces: [{ family: "Yekan", weight: 400, style: "normal", format: "woff2", filename: "regular.woff2", file: "regular.woff2", sha256: "" }] }]);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((entry) => entry.code === "font_weight_missing"));
});

test("portable template references are remapped and unresolved references fail", () => {
  const template = { schemaVersion: 1, id: "header", name: "Header", provider: "elementor", type: "header", document: { settings: { color: { $wpStarterRef: "color:accent" } }, child: [{ typography: { $wpStarterRef: "typography:button" } }] } };
  const remapped = remapPortableTemplate(template, { "color:accent": "global-color-1", "typography:button": 42 });
  assert.equal(remapped.document.settings.color, "global-color-1");
  assert.equal(remapped.document.child[0].typography, 42);
  assert.throws(() => remapPortableTemplate(template, { "color:accent": "global-color-1" }), /unresolved references/);
});

test("in-process ZIP implementation round-trips files without shell utilities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-vnext-zip-"));
  try {
    const source = path.join(root, "source");
    const output = path.join(root, "archive.zip");
    const destination = path.join(root, "destination");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await writeFile(path.join(source, "nested", "file.txt"), "portable archive");
    await createZip(source, output);
    await extractZip(output, destination);
    assert.equal(await readFile(path.join(destination, "nested", "file.txt"), "utf8"), "portable archive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
