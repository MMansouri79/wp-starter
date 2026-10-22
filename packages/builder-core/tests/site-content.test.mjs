import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, extractZip, resolveSiteContent, inspectSiteContent, buildStarter, siteContentSelection, ConfigSnapshotRegistry, PackageRegistry, createProfileFromSnapshot, loadProfile } from '../dist/index.js';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture(root) {
  await mkdir(path.join(root, 'uploads'), { recursive: true });
  await writeFile(path.join(root, 'uploads/image.png'), png);
  await writeFile(path.join(root, 'uploads/manual.pdf'), '%PDF-1.4\nSynthetic document');
  const result = spawnSync('php', [path.join(repo, 'packages/builder-core/tests/site-content-export-fixture.php'), root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const dir = path.join(root, 'export');
  await writeFile(path.join(dir, 'starter-config.json'), JSON.stringify({ schema_version: 1, generated_at: '2026-10-14T00:00:00Z', source: { wordpress_version: '6.8', locale: 'en_US', theme: { slug: 'example', name: 'Example', version: '1.0' }, plugins: [{ file: 'woocommerce/woocommerce.php', name: 'WooCommerce', version: '9.6.0', active: true }, { file: 'advanced-custom-fields-pro/acf.php', name: 'ACF Pro', version: '6.4.0', active: true }] }, wordpress: { options: {}, pages: [] }, adapters: {} }));
  const zip = path.join(root, 'config.zip'); await createZip(dir, zip);
  return { dir, zip };
}
test('exported classic posts, variable products and ACF survive the portable content boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-export-'));
  try {
    const { dir, zip } = await fixture(root);
    const all = await resolveSiteContent(dir, { posts: true, products: true });
    assert.equal(all.content.length, 2); assert.equal(all.assets.length, 2);
    const post = all.content.find(r => r.kind === 'post'), product = all.content.find(r => r.kind === 'product');
    assert.equal(post.publishAt, '2020-05-04T10:00:00Z');
    assert.match(post.content, /\{\{sample-asset:asset-site-image-9\}\}/);
    assert.match(post.content, /wp-image-\{\{sample-attachment:asset-site-image-9\}\}/);
    assert.equal(post.acf.values.field_headline, 'ACF headline');
    assert.equal(post.acf.values.field_rows[0].field_caption, 'Nested value');
    assert.equal(post.acf.groups[0].fields[0].ID, undefined);
    assert.deepEqual(post.acf.values.field_file, { $siteRef: 'asset', id: 'asset-site-document-10' });
    assert.equal(product.productType, 'variable'); assert.equal(product.variations.length, 1);
    assert.deepEqual(product.attributes[0].options, ['site-term-3', 'site-term-4']);
    assert.equal(product.defaultAttributes[product.attributes[0].id], 'site-term-3');
    assert.equal(product.variations[0].attributes[product.attributes[0].id], 'site-term-3');
    assert.equal(product.variations[0].attributes[product.attributes[1].id], 'Large');
    assert.equal(product.variations[0].pricing.salePrice, '15');
    assert.equal(product.variations[0].inventory.quantity, 7);
    const posts = await resolveSiteContent(dir, { posts: true, products: false });
    assert.deepEqual(posts.content.map(r => r.kind), ['post']);
    assert.equal(posts.attributes.length, 0);
    assert.deepEqual(await inspectSiteContent(zip), { posts: 1, products: 1, acf: true, acfPro: true });
    const payload = JSON.parse(await readFile(path.join(dir, 'starter-site-content.json')));
    payload.content[0].acf.values.field_related = [{ $siteRef: 'content', id: 'site-product-2' }];
    await writeFile(path.join(dir, 'starter-site-content.json'), JSON.stringify(payload));
    await assert.rejects(resolveSiteContent(dir, { posts: true, products: false }), { code: 'site_content_selection_required' });
    payload.assets[0].file = '../../private.png'; await writeFile(path.join(dir, 'starter-site-content.json'), JSON.stringify(payload));
    await assert.rejects(resolveSiteContent(dir, { posts: true, products: true }), { code: 'invalid_site_content' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('site content is off by default and builds include only the enabled types and verified assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-build-'));
  try {
    const { zip } = await fixture(root);
    const core = path.join(root, 'core/wordpress'); await mkdir(path.join(core, 'wp-admin'), { recursive: true }); await mkdir(path.join(core, 'wp-includes')); await mkdir(path.join(core, 'wp-content'));
    await writeFile(path.join(core, 'index.php'), '<?php');
    const coreZip = path.join(root, 'wordpress.zip'); await createZip(path.dirname(core), coreZip);
    const profile = { schemaVersion: 9, name: 'Site content', locale: 'en_US', wordpress: { version: '6.8', zip: coreZip }, theme: null, plugins: [], configExport: zip };
    const options = { profile, outputZip: path.join(root, 'build.zip'), bootstrapFile: path.join(repo, 'wordpress/bootstrap/site-starter-bootstrap.php'), builderVersion: 'test', compatibilityMatrix: { schemaVersion: 1, generatedAt: '', entries: [{ id: 'empty', status: 'known-good', wordpress: { version: '6.8', variant: 'en_US' }, php: '8.2', plugins: {} }, { id: 'acf', status: 'known-good', wordpress: { version: '6.8', variant: 'en_US' }, php: '8.2', plugins: { 'advanced-custom-fields-pro': '6.4.0' } }] } };
    const disabled = await buildStarter(options); assert.equal(disabled.manifest.sampleContentPayload, null);
    profile.siteContent = { posts: true, products: false };
    const pluginDir = path.join(root, 'plugin/advanced-custom-fields-pro'); await mkdir(pluginDir, { recursive: true }); await writeFile(path.join(pluginDir, 'acf.php'), '<?php');
    const pluginZip = path.join(root, 'acf.zip'); await createZip(path.dirname(pluginDir), pluginZip);
    profile.plugins = [{ slug: 'advanced-custom-fields-pro', version: '6.4.0', file: 'advanced-custom-fields-pro/acf.php', zip: pluginZip, required: true }];
    const built = await buildStarter(options); assert.equal(built.manifest.sampleContentPayload.posts, 1); assert.equal(built.manifest.sampleContentPayload.products, 0);
    const out = path.join(root, 'unpacked'); await extractZip(options.outputZip, out);
    const dataDir = (await import('node:fs/promises')).readdir;
    const payloadDir = (await dataDir(path.join(out, 'wp-content'))).find(r => r.startsWith('.wp-starter-'));
    const payload = JSON.parse(await readFile(path.join(out, 'wp-content', payloadDir, 'starter-sample-content.json')));
    assert.equal(payload.content[0].acf.values.field_rows[0].field_caption, 'Nested value');
    assert.equal(payload.assets.length, 2);
    profile.siteContent = { posts: false, products: true };
    await assert.rejects(buildStarter(options), { code: 'site_woocommerce_required' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('site content controls require explicit booleans', () => {
  assert.deepEqual(siteContentSelection(undefined), { posts: false, products: false });
  assert.throws(() => siteContentSelection({ posts: 'yes', products: false }), { code: 'invalid_profile' });
});
test('snapshot inventory and saved profiles preserve explicit inclusion and reject missing dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-profile-'));
  try {
    const { zip } = await fixture(root);
    const library = path.join(root, 'library'), registry = new PackageRegistry(library);
    const core = path.join(root, 'core/wordpress/wp-includes'); await mkdir(core, { recursive: true });
    await mkdir(path.join(root, 'core/wordpress/wp-admin')); await mkdir(path.join(root, 'core/wordpress/wp-content'));
    await writeFile(path.join(core, 'version.php'), "<?php\n$wp_version = '6.8';\n");
    const coreZip = path.join(root, 'core.zip'); await createZip(path.join(root, 'core'), coreZip); await registry.add(coreZip);
    const theme = path.join(root, 'theme/example'); await mkdir(theme, { recursive: true });
    await writeFile(path.join(theme, 'style.css'), 'Theme Name: Example\nVersion: 1.0\n');
    const themeZip = path.join(root, 'theme.zip'); await createZip(path.join(root, 'theme'), themeZip); await registry.add(themeZip);
    for (const [slug, version, file] of [['woocommerce', '9.6.0', 'woocommerce.php'], ['advanced-custom-fields-pro', '6.4.0', 'acf.php']]) {
      const dir = path.join(root, slug, slug); await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, file), `<?php\n/*\nPlugin Name: ${slug}\nVersion: ${version}\n*/\n`);
      const pkg = path.join(root, slug + '.zip'); await createZip(path.join(root, slug), pkg); await registry.add(pkg);
    }
    const snapshot = await new ConfigSnapshotRegistry(library).add(zip);
    assert.equal(snapshot.record.siteContent.posts, 1); assert.equal(snapshot.record.siteContent.products, 1);
    const defaultProfile = await createProfileFromSnapshot(snapshot.record.id, { libraryDir: library });
    assert.equal(defaultProfile.schemaVersion, 7); assert.equal(defaultProfile.siteContent, undefined);
    const profile = await createProfileFromSnapshot(snapshot.record.id, { libraryDir: library, siteContent: { posts: true, products: true } });
    assert.equal(profile.schemaVersion, 9); assert.deepEqual(profile.siteContent, { posts: true, products: true });
    const saved = path.join(root, 'profile.json'); await writeFile(saved, JSON.stringify(profile));
    assert.deepEqual((await loadProfile(saved, { libraryDir: library })).siteContent, profile.siteContent);
    await assert.rejects(createProfileFromSnapshot(snapshot.record.id, { libraryDir: library, siteContent: profile.siteContent, excludePlugins: ['woocommerce'] }), { code: 'site_woocommerce_required' });
    await assert.rejects(createProfileFromSnapshot(snapshot.record.id, { libraryDir: library, siteContent: { posts: true, products: false }, excludePlugins: ['advanced-custom-fields-pro'] }), { code: 'site_acf_required' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('bootstrap persists ACF definitions and remaps values without overwriting unrelated groups', () => {
  const result = spawnSync('php', [path.join(repo, 'packages/builder-core/tests/site-acf-bootstrap-fixture.php')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
