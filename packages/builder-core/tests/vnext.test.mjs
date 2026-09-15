import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertValidReport,
  createZip,
  extractZip,
  DesignSystemResourceService,
  FontSystemRegistry,
  normalizeTypographyProfile,
  compileVNextPayload,
  remapPortableTemplate,
  validateColorProfile,
  validateDesignSystem,
  validateTypographyProfile
} from "../dist/index.js";

test("compiled design systems keep all four Elementor Global Fonts and custom font styles", () => {
  const token = { fontRole: "brand", weight: 400, style: "normal", size: { desktop: "16px" } };
  const typography = normalizeTypographyProfile({ schemaVersion: 1, id: "brand-type", name: "Brand Type", roles: { body: token, h1: { ...token, size: { desktop: "42px" } }, h2: { ...token, size: { desktop: "34px" } }, links: token }, globalTypography: { primary: { ...token, size: { desktop: "46px" } }, secondary: token, text: token, accent: token }, globalCustomTypography: [{ id: "eyebrow", name: "Eyebrow", token: { ...token, weight: 700, size: { desktop: "12px" } } }], fallbackFontFamily: "Arial, sans-serif", fontSlots: { brand: { name: "Brand font" } } });
  const colors = { schemaVersion: 1, id: "brand-colors", name: "Brand Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" } };
  const fonts = [{ schemaVersion: 1, id: "inter", name: "Inter", family: "Inter", faces: [{ family: "Inter", weight: 400, style: "normal", format: "woff2", filename: "regular.woff2", file: "regular.woff2", sha256: "" }, { family: "Inter", weight: 700, style: "normal", format: "woff2", filename: "bold.woff2", file: "bold.woff2", sha256: "" }] }];
  const system = { schemaVersion: 1, id: "brand", name: "Brand", typographyProfileId: typography.id, colorProfileId: colors.id, fontBindings: { brand: "inter" } };
  const payload = compileVNextPayload(system, typography, colors, fonts);
  assert.deepEqual(Object.keys(payload.designSystem.globalTypography), ["primary", "secondary", "text", "accent"]);
  assert.equal(payload.designSystem.globalTypography.primary.size.desktop.value, 46);
  assert.equal(payload.designSystem.globalCustomTypography[0].id, "eyebrow");
  assert.equal(payload.designSystem.fallbackFontFamily, "Arial, sans-serif");
});

test("legacy typography profiles receive all Elementor Global Font aliases", () => {
  const typography = normalizeTypographyProfile({ schemaVersion: 1, id: "legacy-type", name: "Legacy Type", roles: { body: { fontRole: "body", weight: 400 }, h1: { fontRole: "heading", weight: 700 } } });
  const colors = { schemaVersion: 1, id: "legacy-colors", name: "Legacy Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" } };
  const fonts = [{ schemaVersion: 1, id: "body", name: "Body", family: "Body", faces: [{ family: "Body", weight: 400, style: "normal", format: "woff2", filename: "regular.woff2", file: "regular.woff2", sha256: "" }] }, { schemaVersion: 1, id: "heading", name: "Heading", family: "Heading", faces: [{ family: "Heading", weight: 700, style: "normal", format: "woff2", filename: "bold.woff2", file: "bold.woff2", sha256: "" }] }];
  const system = { schemaVersion: 1, id: "legacy", name: "Legacy", typographyProfileId: typography.id, colorProfileId: colors.id, fontBindings: { body: "body", heading: "heading" } };
  const payload = compileVNextPayload(system, typography, colors, fonts);
  assert.deepEqual(Object.keys(payload.designSystem.globalTypography), ["primary", "secondary", "text", "accent"]);
  assert.equal(payload.designSystem.globalTypography.primary.fontRole, "heading");
  assert.equal(payload.designSystem.globalTypography.accent.fontRole, "body");
});

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
  const normalized = normalizeTypographyProfile(typography);
  assert.deepEqual(normalized.roles.body.size.desktop, { value: 15, unit: "px" });
  assert.deepEqual(normalized.roles.body.lineHeight.desktop, { value: 1.8, unit: "" });
  assertValidReport(validateTypographyProfile(normalized));
  assertValidReport(validateColorProfile(colors));
  const report = validateDesignSystem({ schemaVersion: 1, id: "store", name: "Store", fontBindings: { primary: "yekan" }, typographyProfileId: normalized.id, colorProfileId: colors.id }, normalized, colors, [{ schemaVersion: 1, id: "yekan", name: "Yekan", family: "Yekan", faces: [{ family: "Yekan", weight: 400, style: "normal", format: "woff2", filename: "regular.woff2", file: "regular.woff2", sha256: "" }] }]);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((entry) => entry.code === "font_face_missing"));
  const unbound = validateDesignSystem({ schemaVersion: 1, id: "store", name: "Store", fontBindings: {}, typographyProfileId: normalized.id, colorProfileId: colors.id }, normalized, colors, []);
  assert.ok(unbound.issues.some(entry => entry.code === "font_binding_missing"));
  assert.equal(validateTypographyProfile({ ...normalized, roles: { body: { ...normalized.roles.body, style: "slanted" } } }).valid, false);
  assert.equal(validateColorProfile({ ...colors, elementor: { ...colors.elementor, primary: "rgb(0,0,0)" } }).valid, false);
  assert.throws(() => normalizeTypographyProfile({ ...typography, roles: { body: { ...typography.roles.body, size: { desktop: "16" } } } }), /explicit numeric value and unit/);
});

test("design-system resources resolve Font Profiles and block referenced deletion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-design-resources-"));
  try {
    const fontDir = path.join(root, "fonts", "inter");
    await mkdir(fontDir, { recursive: true });
    const fontFile = path.join(fontDir, "Inter-Regular.woff2");
    await writeFile(fontFile, "synthetic-woff2");
    const sha256 = createHash("sha256").update("synthetic-woff2").digest("hex");
    await writeFile(path.join(root, "fonts.json"), JSON.stringify({ schemaVersion: 1, systems: [{ id: "inter", name: "Inter", sourceFilename: "inter.zip", addedAt: new Date(0).toISOString(), skipped: [], faces: [{ family: "Inter", weight: 400, style: "normal", format: "woff2", filename: "Inter-Regular.woff2", file: "fonts/inter/Inter-Regular.woff2", sha256 }] }] }));
    const service = new DesignSystemResourceService(root);
    await service.saveTypography({ schemaVersion: 1, id: "base-type", name: "Base Type", roles: { body: { fontRole: "primary", weight: 400, size: { desktop: "16px", tablet: "15px", mobile: "14px" } } } });
    await service.saveColors({ schemaVersion: 1, id: "base-colors", name: "Base Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" } });
    await service.saveDesignSystem({ schemaVersion: 1, id: "base-system", name: "Base System", typographyProfileId: "base-type", colorProfileId: "base-colors", fontBindings: { primary: "inter" } });
    const resolved = await service.resolve("base-system");
    assert.equal(resolved.payload.designSystem.fontFamilies.primary, "Inter");
    assert.equal(resolved.payload.designSystem.resources.typography.sha256.length, 64);
    await assert.rejects(() => service.remove("typography", "base-type"), error => error?.code === "vnext_resource_in_use");
    await assert.rejects(() => new FontSystemRegistry(root).remove("inter"), error => error?.code === "font_system_in_use");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("new resources receive hidden stable IDs and custom color tokens survive renames", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-generated-resource-ids-"));
  try {
    const service = new DesignSystemResourceService(root);
    const created = await service.saveColors({ schemaVersion: 1, id: "", name: "Brand Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" }, custom: [{ id: "color-success", name: "Success", value: "#008000" }] });
    assert.match(created.id, /^brand-colors-[a-f0-9]{10}$/);
    const renamed = await service.saveColors({ ...created, name: "Product Colors", custom: [{ ...created.custom[0], name: "Positive" }] });
    assert.equal(renamed.id, created.id); assert.equal(renamed.custom[0].id, "color-success");
    await assert.rejects(() => service.saveColors({ ...created, id: "", name: "Product Colors" }), error => error?.code === "duplicate_resource_name");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy semantic colors cannot replace Elementor system colors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-legacy-colors-"));
  try {
    const service = new DesignSystemResourceService(root);
    const colors = await service.saveColors({ schemaVersion: 1, id: "legacy-colors", name: "Legacy Colors", elementor: { primary: "#112233", secondary: "#445566", text: "#222222", accent: "#abcdef" }, semantic: { accent: "#470000", border: "#787878" } });
    assert.equal(colors.elementor.accent, "#abcdef");
    assert.deepEqual(colors.custom.map((token) => token.id), ["custom-accent", "border"]);
  } finally { await rm(root, { recursive: true, force: true }); }
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
