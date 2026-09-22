import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const php = (...args) => { const result = spawnSync('php', args, { stdio: 'inherit' }); assert.equal(result.error, undefined); assert.equal(result.status, 0); };
test('executable PHP sample taxonomy and post contracts', () => { php(path.join(repo, 'packages/builder-core/tests/sample-bootstrap-fixture.php')); });
test('real bootstrap entry point resumes sample stages and cleans up only after success', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'sample-bootstrap-entry-'));
 try {
  const payloadDir = path.join(root, 'wp-content/starter-package'); const mu = path.join(root, 'wp-content/mu-plugins');
  await mkdir(payloadDir, {recursive:true}); await mkdir(mu, {recursive:true});
  await copyFile(path.join(repo,'wordpress/bootstrap/site-starter-bootstrap.php'), path.join(mu,'site-starter-bootstrap.php'));
  await copyFile(path.join(repo,'wordpress/bootstrap/sample-content-installer.php'), path.join(payloadDir,'sample-content-installer.php'));
  const payload = JSON.stringify({schemaVersion:1,content:[{id:'post-test',kind:'post',title:'Test',slug:'test',status:'publish',content:'Body',excerpt:'',categoryIds:[],tagIds:[]}],terms:[],attributes:[],assets:[]});
  await writeFile(path.join(payloadDir,'starter-sample-content.json'),payload);
  const sha = value => createHash('sha256').update(value).digest('hex');
  await writeFile(path.join(payloadDir,'starter-build.json'),JSON.stringify({schemaVersion:4,configurationEnabled:false,sampleContentPayload:{path:'starter-sample-content.json',sha256:sha(payload),installerSha256:sha(await readFile(path.join(payloadDir,'sample-content-installer.php')))}}));
  const stateFile = path.join(root,'options.json');
  await writeFile(stateFile,JSON.stringify({mms_wp_starter_bootstrap_state:{phase:'configure'}}));
  const readState = async () => JSON.parse(await readFile(stateFile,'utf8'));
  const step = () => php(path.join(repo,'packages/builder-core/tests/sample-bootstrap-entry-fixture.php'),root);
  step(); assert.equal((await readState()).mms_wp_starter_bootstrap_state.phase,'sample_content');
  let rounds = 0;
  while((await readState()).mms_wp_starter_sample_progress?.phase !== 'publish' && rounds++ < 30) step();
  const before = await readState(); assert.equal(before.fixture_post.post_status,'draft'); assert.equal(before.mms_wp_starter_bootstrap_complete,undefined);
  await writeFile(stateFile,JSON.stringify({...before,fixture_corrupt:true})); step();
  assert.match((await readState()).mms_wp_starter_bootstrap_error,/slug/); await access(payloadDir); await access(path.join(mu,'site-starter-bootstrap.php'));
  const retry = await readState(); delete retry.fixture_corrupt; await writeFile(stateFile,JSON.stringify(retry));
  while(!(await readState()).mms_wp_starter_bootstrap_complete && rounds++ < 50) step();
  const final = await readState(); assert.ok(final.mms_wp_starter_bootstrap_complete); assert.equal(final.fixture_post.post_status,'publish'); assert.equal(final.mms_wp_starter_bootstrap_report.sample_content_verified,1);
  await assert.rejects(access(payloadDir)); await assert.rejects(access(path.join(mu,'site-starter-bootstrap.php')));
 } finally {await rm(root,{recursive:true,force:true});}
});
