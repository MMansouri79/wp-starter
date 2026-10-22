import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADMIN, createClient, startTestServer, makeWordPressZip, makeThemeZip, makePluginZip, makeSnapshotZip, readUpload } from './harness.mjs';
import { createZip, extractZip, normalizeSampleContent, sha256File } from '../../../packages/builder-core/dist/index.js';

test('exported-content profile selections retain membership, write-role and CSRF boundaries', async t => {
  const server = await startTestServer({ teamFixture: false });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'server-site-content-'));
  t.after(async () => { await server.stop(); await rm(temp, { recursive: true, force: true }); });
  const platform = createClient(server.url); await platform.signIn(ADMIN.email, ADMIN.password);
  async function team(name, email) {
    const created = await platform.post('/api/admin/teams', { json: { name, ownerEmail: email } });
    assert.equal(created.status, 201, created.text);
    const client = createClient(server.url); await client.register(email, 'test-content-password-123', created.json.token);
    return { client, prefix: `/api/teams/${created.json.team.id}` };
  }
  const a = await team('Content A', 'content-a@example.test'), b = await team('Content B', 'content-b@example.test');
  async function member(email, role) {
    const invited = await a.client.post(a.prefix + '/invites', { json: { email, role } });
    assert.equal(invited.status, 201, invited.text);
    const client = createClient(server.url); await client.register(email, 'test-content-password-123', invited.json.token); return client;
  }
  const editor = await member('content-editor@example.test', 'editor'), viewer = await member('content-viewer@example.test', 'viewer');
  const sample = { id: 'site-post-stable', kind: 'post', title: 'Stable import identity' };
  const addedSample = await editor.post(a.prefix + '/sample-content', { json: sample });
  assert.equal(addedSample.status, 200, addedSample.text); assert.equal(addedSample.json.id, sample.id);
  assert.equal((await a.client.post(a.prefix + '/sample-content', { json: {...sample,title:'Edited by teammate'} })).status, 200);
  assert.equal((await viewer.post(a.prefix + '/sample-content', { json: sample })).status, 403);
  assert.equal((await editor.post(a.prefix + '/sample-content', { json: sample, csrf:false })).status, 403);
  assert.equal((await b.client.get(a.prefix + '/sample-content/' + sample.id)).status, 404);
  assert.equal((await platform.get(a.prefix + '/sample-content/' + sample.id)).status, 404);
  const attribute = await editor.post(a.prefix + '/sample-content/attributes', { json: {id:'site-attribute-stable',name:'Size',slug:'size'} });
  assert.equal(attribute.status,200,attribute.text); assert.equal(attribute.json.id,'site-attribute-stable');
  const term = await editor.post(a.prefix + '/sample-content/terms', {json:{id:'site-term-stable',taxonomy:'pa_size',name:'Large',slug:'large'}});
  assert.equal(term.status,200,term.text);
  async function upload(suffix, file) {
    const response = await a.client.post(a.prefix + suffix + `?filename=${encodeURIComponent(path.basename(file))}`, { body: await readUpload(file), contentType: 'application/octet-stream' });
    assert.equal(response.status, 200, response.text); return response.json;
  }
  await upload('/packages', await makeWordPressZip(temp));
  await upload('/packages', await makeThemeZip(temp, { slug: 'hello-elementor', name: 'Hello Elementor', version: '3.4.9' }));
  const plugins = [{slug:'classic-editor',version:'1.7.0'}, {slug:'elementor',version:'4.0.8'}, {slug:'elementor-pro',version:'4.0.4'}];
  for (const plugin of plugins) await upload('/packages', await makePluginZip(temp, { ...plugin, name: plugin.slug }));
  const zip = await makeSnapshotZip(temp, { label: 'content', plugins: plugins.map(plugin => ({file:`${plugin.slug}/${plugin.slug}.php`,name:plugin.slug,version:plugin.version,active:true})) });
  await writeFile(path.join(temp, 'snapshot-content/starter-site-content.json'), JSON.stringify({ schemaVersion: 1, content: [normalizeSampleContent({ id: 'site-post-one', kind: 'post', title: 'Exported post' })], terms: [], attributes: [], assets: [] }));
  await createZip(path.join(temp, 'snapshot-content'), zip);
  const imported = await upload('/configs', zip);
  const body = { configId: imported.item.id, name: 'with-content', locale: 'en_US', siteContent: { posts: true, products: false } };
  const created = await a.client.post(a.prefix + '/profiles', { json: body });
  assert.equal(created.status, 200, created.text);
  assert.equal(created.json.profile.schemaVersion, 9);
  assert.deepEqual(created.json.profile.siteContent, body.siteContent);
  const queued = await editor.post(a.prefix + '/build-jobs', { json: { file: created.json.file } });
  assert.equal(queued.status, 202, queued.text);
  let job;
  for (let attempt = 0; attempt < 200; attempt++) {
    job = (await editor.get(a.prefix + '/build-jobs/' + queued.json.id)).json;
    if (['complete', 'failed'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.status, 'complete', JSON.stringify(job.error));
  const cookie = [...editor.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const downloaded = await fetch(server.url + job.result.downloadUrl, { headers: { cookie } });
  assert.equal(downloaded.status, 200);
  const artifact = path.join(temp, 'queued-site-build.zip');
  await writeFile(artifact, Buffer.from(await downloaded.arrayBuffer()));
  assert.equal(await sha256File(artifact), job.result.sha256);
  const extracted = path.join(temp, 'queued-site-build'); await extractZip(artifact, extracted);
  const runtime = await readFile(path.join(extracted, 'wp-content/mu-plugins/site-starter-bootstrap.php'), 'utf8');
  assert.match(runtime, /Keep current products and finish setup/);
  assert.match(runtime, /CATALOG_CHOICE_OPTION/);
  const payloadRoot = path.join(extracted, 'wp-content', (await readdir(path.join(extracted, 'wp-content'))).find(name => name.startsWith('.wp-starter-')));
  const manifest = JSON.parse(await readFile(path.join(payloadRoot, 'starter-build.json'), 'utf8'));
  assert.equal(manifest.sampleContentPayload.posts, 1);
  assert.equal(await sha256File(path.join(payloadRoot, 'sample-content-installer.php')), manifest.sampleContentPayload.installerSha256);
  assert.match(await readFile(path.join(payloadRoot, 'sample-content-installer.php'), 'utf8'), /mms_wp_starter_catalog_choice/);
  const state = await viewer.get(a.prefix + '/state');
  assert.equal(state.status, 200); assert.equal(state.json.configs[0].siteContent.posts, 1);
  assert.equal(JSON.stringify(state.json.configs).includes('filePath'), false);
  const readonly = await viewer.post(a.prefix + '/profiles', { json: body });
  assert.equal(readonly.status, 403); assert.equal(readonly.json.error.code, 'read_only');
  const csrf = await editor.post(a.prefix + '/profiles', { json: body, csrf: false });
  assert.equal(csrf.status, 403); assert.equal(csrf.json.error.code, 'csrf_failed');
  const updated = await editor.post(a.prefix + '/profiles', { json: { ...body, siteContent: { posts: false, products: false } } });
  assert.equal(updated.status, 200, updated.text); assert.equal(updated.json.profile.siteContent, undefined);
  assert.equal((await platform.post(a.prefix + '/profiles', { json: body })).status, 404);
  assert.equal((await b.client.post(b.prefix + '/profiles', { json: body })).status, 404);
  assert.equal((await b.client.get(a.prefix + '/configs/' + imported.item.id + '/inspect')).status, 404);
});
