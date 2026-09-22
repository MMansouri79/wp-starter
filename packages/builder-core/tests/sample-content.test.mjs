import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SampleContentRegistry, normalizeSampleContent, normalizeSampleGlobalAttribute, sampleSlug, writeJson } from "../dist/index.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), "sample-content-")); try { await fn(new SampleContentRegistry(root), root); } finally { await rm(root, { recursive: true, force: true }); } }
const product = (title, productType = "simple", extra = {}) => ({ kind: "product", title, productType, ...extra });

test("sample post defaults keep optional classic fields optional and preserve Unicode slugs", () => {
  const post = normalizeSampleContent({ kind: "post", title: "نمونه نوشته", content: "<p>Text</p>" });
  assert.equal(post.slug, "نمونه-نوشته"); assert.equal(post.status, "draft"); assert.equal(post.excerpt, ""); assert.deepEqual(post.categoryIds, []);
  assert.equal(sampleSlug("My First POST!"), "my-first-post");
  assert.throws(() => normalizeSampleContent({ kind: "post", title: "" }), e => e.issues.some(i => i.field === "title"));
  assert.throws(() => normalizeSampleContent({ kind: "post", title: "Example", slug: "Bad Slug" }), /slug/);
});

test("sample library persists real taxonomy definitions and resolves only selected dependencies", async () => fixture(async (registry, root) => {
  const category = await registry.saveTerm({ taxonomy: "category", name: "Parent", slug: "parent" });
  const child = await registry.saveTerm({ taxonomy: "category", name: "Child", slug: "child", parentId: category.id });
  const tag = await registry.saveTerm({ taxonomy: "post_tag", name: "News", slug: "news" });
  const post = await registry.save({ kind: "post", title: "Sample", categoryIds: [child.id], tagIds: [tag.id] });
  await registry.save({ kind: "post", title: "Unselected" });
  const resolved = await new SampleContentRegistry(root).resolve([post.id]);
  assert.equal(resolved.content.length, 1); assert.deepEqual(new Set(resolved.terms.map(t => t.slug)), new Set(["parent", "child", "news"]));
  await assert.rejects(() => registry.remove("terms", category.id), e => e.code === "resource_in_use");
  await writeJson(path.join(root, "profiles", "example.json"), { name: "Example", schemaVersion: 9, sampleContentIds: [post.id] });
  await assert.rejects(() => registry.remove("content", post.id), /profile Example/);
  await assert.rejects(() => registry.saveTerm({ ...child, parentId: child.id }, child.id), /cycle/);
}));

test("all four WooCommerce sample types validate and resolve linked products and variations", async () => fixture(async registry => {
  const global = await registry.saveAttribute({ name: "Color", slug: "color" });
  const red = await registry.saveTerm({ taxonomy: "pa_color", name: "Red", slug: "red" });
  const brand = await registry.saveTerm({ taxonomy: "product_brand", name: "Sample Brand", slug: "sample-brand" });
  const simple = await registry.save(product("Simple", "simple", { pricing: { regularPrice: "12.50", salePrice: "10.00" }, inventory: { sku: "SAMPLE-1" }, brandIds: [brand.id] }));
  const external = await registry.save(product("Affiliate", "external", { externalUrl: "https://example.test/item" }));
  const grouped = await registry.save(product("Group", "grouped", { childrenIds: [simple.id] }));
  const variable = await registry.save(product("Variable", "variable", { attributes: [{ id: "color", globalId: global.id, name: "Color", options: [red.id], variation: true }], defaultAttributes: { color: red.id }, variations: [{ attributes: { color: red.id }, pricing: { regularPrice: "5" } }], upsellIds: [external.id, grouped.id] }));
  const result = await registry.resolve([variable.id]);
  assert.equal(result.content.length, 4); assert.equal(result.attributes[0].slug, "color"); assert.equal(result.terms.find(t => t.id === brand.id).taxonomy, "product_brand");
  await assert.rejects(() => registry.save(product("Duplicate SKU", "simple", { inventory: { sku: "sample-1" } })), /inventory.sku/);
  const copy = await registry.duplicate(simple.id); assert.notEqual(copy.id, simple.id); assert.equal(copy.inventory.sku, ""); assert.equal(copy.status, "draft");
}));

test("conditional product validation rejects invalid prices, stock, attributes and URLs", () => {
  assert.throws(() => normalizeSampleContent(product("Sale", "simple", { pricing: { regularPrice: "2", salePrice: "3" } })), /salePrice/);
  assert.throws(() => normalizeSampleContent(product("Money", "simple", { pricing: { regularPrice: 1.5 } })), /Must be text/);
  assert.throws(() => normalizeSampleContent(product("Stock", "simple", { inventory: { manageStock: true } })), /Quantity is required/);
  assert.throws(() => normalizeSampleContent(product("URL", "external", { externalUrl: "javascript:alert(1)" })), /HTTP/);
  assert.throws(() => normalizeSampleContent(product("Downloads", "simple", { downloadable: true })), /at least one file/);
  assert.throws(() => normalizeSampleContent(product("Variable", "variable", { attributes: [{ id: "size", name: "Size", options: ["S"], variation: true }], variations: [{ attributes: { size: "XL" } }] })), /one of its options/);
  assert.throws(() => normalizeSampleContent(product("Variable", "variable", { attributes: [{ id: "size", name: "Size", options: ["S"], variation: true }], variations: [{ attributes: { size: "S" } }, { attributes: { size: "S" } }] })), /Duplicate attribute combination/);
  assert.throws(() => normalizeSampleGlobalAttribute({ name: "Category", slug: "category" }), /Reserved/);
  assert.throws(() => normalizeSampleContent({ kind: "post", title: "Schedule", status: "future" }), /requires a date/);
});

test("sample assets verify signatures, hashes and selection while blocking deletion in use", async () => fixture(async (registry, root) => {
  const file = path.join(root, "test.png");
  await writeFile(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD3kAAAAASUVORK5CYII=", "base64"));
  const asset = await registry.importAsset(file, { kind: "image", alt: "Sample" });
  const post = await registry.save({ kind: "post", title: "Image", content: `<img src="{{sample-asset:${asset.id}}}">`, featuredImageId: asset.id });
  assert.equal((await registry.resolve([post.id])).assets[0].alt, "Sample");
  await assert.rejects(() => registry.remove("assets", asset.id), /still referenced/);
  await writeFile(path.join(root, asset.file), "corrupted");
  await assert.rejects(() => registry.resolve([post.id]), /integrity verification/);
  const svg = path.join(root, "test.svg"); await writeFile(svg, "<svg></svg>");
  await assert.rejects(() => registry.importAsset(svg, { kind: "image" }), /Unsupported/);
}));

test("sample selections round-trip through profile v9 and require WooCommerce for products", async () => fixture(async (samples, root) => {
  const { PackageRegistry, createProfileFromPackages, loadProfile, createZip } = await import("../dist/index.js");
  const wp = path.join(root, "fixture", "wordpress");
  await mkdir(path.join(wp, "wp-admin"), { recursive: true }); await mkdir(path.join(wp, "wp-includes"), { recursive: true });
  await writeFile(path.join(wp, "wp-includes", "version.php"), "<?php $wp_version = '7.1';");
  const zip = path.join(root, "wp.zip"); await createZip(path.join(root, "fixture"), zip);
  await new PackageRegistry(root).add(zip);
  const post = await samples.save({ kind: "post", title: "Profile post" });
  const options = { libraryDir: root, name: "Samples", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", sampleContentIds: [post.id] };
  const doc = await createProfileFromPackages(options); assert.equal(doc.schemaVersion, 9); assert.deepEqual(doc.sampleContentIds, [post.id]);
  const profileFile = path.join(root, "profile.json"); await writeJson(profileFile, doc);
  const loaded = await loadProfile(profileFile, { libraryDir: root }); assert.equal(loaded.sampleContent.content[0].id, post.id);
  const item = await samples.save(product("Needs Woo"));
  await assert.rejects(() => createProfileFromPackages({ ...options, sampleContentIds: [item.id] }), /WooCommerce/);
}));

test("sample builds bundle only selected content, verified assets, and manifest provenance", async () => fixture(async (samples, root) => {
  const { PackageRegistry, createProfileFromPackages, loadProfile, buildStarter, extractZip, createZip } = await import("../dist/index.js");
  const file = path.join(root, "test.png");
  await writeFile(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD3kAAAAASUVORK5CYII=", "base64"));
  const asset = await samples.importAsset(file, { kind: "image" });
  await samples.save({ kind: "post", title: "Bundled", featuredImageId: asset.id });
  const unselected = await samples.save({ kind: "post", title: "Unbundled" });
  const wp = path.join(root, "fixture", "wordpress");
  await mkdir(path.join(wp, "wp-admin"), { recursive: true }); await mkdir(path.join(wp, "wp-includes"), { recursive: true });
  await writeFile(path.join(wp, "wp-includes", "version.php"), "<?php $wp_version = '7.1';");
  const wpZip = path.join(root, "wp.zip"); await createZip(path.join(root, "fixture"), wpZip);
  await new PackageRegistry(root).add(wpZip);
  const plugin = path.join(root, "fixture", "woocommerce"); await mkdir(plugin, { recursive: true }); await writeFile(path.join(plugin, "woocommerce.php"), "<?php\n/*\nPlugin Name: WooCommerce\nVersion: 9.6.0\n*/\n");
  const pluginZip = path.join(root, "woo.zip"); await createZip(path.join(root, "fixture"), pluginZip); await new PackageRegistry(root).add(pluginZip, { kind: "plugin" });
  const existingWoo = (await new PackageRegistry(root).list()).find(p => p.kind === "plugin" && p.slug === "woocommerce");
  const doc = await createProfileFromPackages({ libraryDir: root, name: "Bundle", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", plugins: existingWoo ? { woocommerce: existingWoo.version } : {}, sampleContentIds: [(await samples.list()).content[0].id] });
  const profileFile = path.join(root, "profile.json"); await writeJson(profileFile, doc);
  const output = path.join(root, "starter.zip");
  const build = await loadProfile(profileFile, { libraryDir: root }).then(profile => buildStarter({ profile, outputZip: output, bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), builderVersion: "test" }));
  assert.equal(build.manifest.sampleContentPayload.posts, 1); assert.equal(build.manifest.sampleContentPayload.assets, 1);
  const unpack = path.join(root, "unpacked"); await mkdir(unpack, { recursive: true }); await extractZip(output, unpack);
  const payload = path.join(unpack, "wp-content", (await readdir(path.join(unpack, "wp-content"))).find(name => name.startsWith(".wp-starter-")));
  const bundled = JSON.parse(await readFile(path.join(payload, "starter-sample-content.json"), "utf8"));
  assert.deepEqual(bundled.content.map(c => c.title), ["Bundled"]); assert.equal(bundled.assets[0].absoluteFile, undefined);
  await readFile(path.join(payload, "sample-assets", `${asset.id}.png`));
  assert.match(await readFile(path.join(payload, "starter-build.json"), "utf8"), /"sampleContentPayload"/);
  assert.notEqual(JSON.stringify(bundled.content), JSON.stringify([unselected]));
}, 20000));

test("serialized sample saves do not lose concurrent additions", async () => fixture(async registry => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => registry.save({ kind: "post", title: `Post ${i}` })));
  assert.equal((await registry.list()).content.length, 12);
}));
