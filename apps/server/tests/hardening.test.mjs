import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ADMIN, createClient, createUserSession, createInvite, makePluginZip, makeSnapshotZip, makeWordPressZip, readUpload, startTestServer } from "./harness.mjs";
import { createZip, sha256File } from "../../../packages/builder-core/dist/index.js";
import { LoginRateLimiter } from "../dist/auth/rate-limit.js";
import { LibrarySyncService } from "../dist/services/sync.js";
import { SqliteDatabase } from "../dist/db/sqlite.js";
import { PostgresDatabase } from "../dist/db/postgres.js";

async function fixture(t, overrides = {}) {
  const server = await startTestServer(overrides);
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-hardening-"));
  t.after(async () => { await server.stop(); await rm(temp, { recursive: true, force: true }); });
  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  return { server, temp, admin };
}
async function members(admin, url) {
  const alice = await createUserSession(admin, url, { email: "alice@example.test", password: "member-password-123", role: "member" });
  const bob = await createUserSession(admin, url, { email: "bob@example.test", password: "member-password-123", role: "member" });
  return { alice, bob };
}
async function upload(client, route, zip, replace = false, csrf = true) {
  return client.post(`${route}?filename=${encodeURIComponent(path.basename(zip))}${replace ? "&replace=1" : ""}`, {
    body: await readUpload(zip), contentType: "application/octet-stream", csrf
  });
}
function sync(app) {
  return new LibrarySyncService(app.library, app.packageItems, app.snapshotItems, app.profileItems,
    app.resourceItems, app.fontItems, app.elementorItems, app.sampleItems, app.log).run();
}

test("duplicate package imports preserve ownership; viewer replacement is refused before file mutation", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const { alice, bob } = await members(admin, server.url);
  const original = await makePluginZip(temp, { slug: "shared", name: "Original", version: "1.0" });
  const added = await upload(alice.client, "/api/packages", original);
  const duplicate = await upload(bob.client, "/api/packages", original);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.json.item.createdBy, alice.user.id);
  assert.equal(duplicate.json.added, false);
  const changed = await makePluginZip(temp, { slug: "shared", name: "Changed", version: "1.0" });
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, bob.user.id]);
  for (const client of [bob.client]) {
    const denied = await upload(client, "/api/packages", changed, true);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, "read_only");
  }
  assert.equal((await upload(alice.client, "/api/packages", changed, true, false)).status, 403);
  const stored = await server.app.library.packages().resolve("plugin", "shared", "1.0");
  assert.equal(stored.sha256, added.json.item.sha256);
  const allowed = await upload(alice.client, "/api/packages", changed, true);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.item.createdBy, alice.user.id);
});

test("snapshot duplicate and replacement imports enforce team roles", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const { alice, bob } = await members(admin, server.url);
  const zip = await makeSnapshotZip(temp);
  const added = await upload(alice.client, "/api/configs", zip);
  assert.equal(added.status, 200);
  const duplicate = await upload(bob.client, "/api/configs", zip);
  assert.equal(duplicate.json.item.createdBy, alice.user.id);
  const changed = await makeSnapshotZip(temp, { locale: "fa_IR", label: "changed" });
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, bob.user.id]);
  const denied = await upload(bob.client, "/api/configs", changed, true);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "read_only");
  assert.equal((await server.app.snapshotItems.findById(added.json.item.id)).sha256, added.json.item.sha256);
  assert.equal((await upload(alice.client, "/api/configs", changed, true)).status, 200);
});

test("unowned package imports cannot be claimed or replaced by viewers", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const { alice } = await members(admin, server.url);
  const zip = await makePluginZip(temp, { slug: "cli", name: "CLI", version: "1.0" });
  await server.app.library.packages().add(zip);
  const duplicate = await upload(alice.client, "/api/packages", zip);
  assert.equal(duplicate.json.item.createdBy, null);
  const changed = await makePluginZip(temp, { slug: "cli", name: "Changed", version: "1.0" });
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, alice.user.id]);
  assert.equal((await upload(alice.client, "/api/packages", changed, true)).status, 403);
  const replaced = await upload(admin, "/api/packages", changed, true);
  assert.equal(replaced.status, 200);
  assert.equal(replaced.json.item.createdBy, null);
});

test("quota refusals leave no package or snapshot in file registries", async (t) => {
  const { server, temp, admin } = await fixture(t, { accountQuotaBytes: 1 });
  const plugin = await makePluginZip(temp, { slug: "large", name: "Large", version: "1.0" });
  const snapshot = await makeSnapshotZip(temp);
  assert.equal((await upload(admin, "/api/packages", plugin)).status, 413);
  assert.equal((await upload(admin, "/api/configs", snapshot)).status, 413);
  assert.deepEqual(await server.app.library.packages().list(), []);
  assert.deepEqual(await server.app.library.snapshots().list(), []);
  await sync(server.app);
  assert.deepEqual((await admin.get("/api/state")).json.packages, []);
});

test("simultaneous uploads cannot both consume the same quota headroom", async (t) => {
  const { server, temp, admin } = await fixture(t, { accountQuotaBytes: 700 });
  const a = await makePluginZip(temp, { slug: "one", name: "One", version: "1.0" });
  const b = await makePluginZip(temp, { slug: "two", name: "Two", version: "1.0" });
  server.app.quota.limitBytes = Math.max((await stat(a)).size, (await stat(b)).size);
  const results = await Promise.all([upload(admin, "/api/packages", a), upload(admin, "/api/packages", b)]);
  assert.deepEqual(results.map((row) => row.status).sort(), [200, 413]);
  assert.equal((await server.app.library.packages().list()).length, 1);
});

test("fonts and sample assets accumulate quota usage; rejected fonts never enter the library", async (t) => {
  const { server, temp, admin } = await fixture(t, { accountQuotaBytes: 100 });
  const source = path.join(temp, "font-source");
  await mkdir(source);
  await writeFile(path.join(source, "Review-Regular.woff2"), Buffer.alloc(60, 1));
  const font = path.join(temp, "review.zip"); await createZip(source, font);
  const imported = await upload(admin, "/api/fonts", font);
  assert.equal(imported.status, 200);
  assert.equal((await admin.get("/api/state")).json.quota.usedBytes, 60);
  const text = path.join(temp, "sample.txt"); await writeFile(text, "sample download");
  const asset = await admin.post("/api/sample-content/example/assets?filename=sample.txt&kind=download", {
    body: await readFile(text), contentType: "application/octet-stream"
  });
  assert.equal(asset.status, 200);
  assert.equal((await admin.get("/api/state")).json.quota.usedBytes, 75);
  await writeFile(path.join(source, "Review-Regular.woff2"), Buffer.alloc(90, 2));
  await createZip(source, font);
  assert.equal((await upload(admin, "/api/fonts", font, true)).status, 413);
  const resolved = await server.app.library.fonts().resolve(imported.json.records[0].id);
  assert.equal((await stat(resolved.faces[0].absoluteFile)).size, 60);
});

test("font IDs cannot be overwritten by another owner through a different archive name", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const { alice, bob } = await members(admin, server.url);
  const source = path.join(temp, "faces"); await mkdir(source);
  await writeFile(path.join(source, "Review-Regular.woff2"), "synthetic-font");
  const zip = path.join(temp, "first.zip"); await createZip(source, zip);
  assert.equal((await upload(alice.client, "/api/fonts", zip)).status, 200);
  const other = path.join(temp, "other.zip"); await createZip(source, other);
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, bob.user.id]);
  const response = await upload(bob.client, "/api/fonts", other, true);
  assert.equal(response.status, 403);
  assert.equal(response.json.error.code, "read_only");
});

test("login lockout applies to IP and normalized email; successful login resets failures", async (t) => {
  const { server } = await fixture(t, { loginMaxAttempts: 2 });
  const client = createClient(server.url);
  const attempt = (email, password) => client.post("/api/auth/login", { json: { email, password } });
  assert.equal((await attempt(ADMIN.email, "wrong")).status, 401);
  assert.equal((await attempt(ADMIN.email, ADMIN.password)).status, 200);
  assert.equal((await attempt(ADMIN.email, "wrong")).status, 401);
  assert.equal((await attempt(ADMIN.email.toUpperCase(), "wrong")).status, 401);
  const locked = await attempt("unknown@example.test", "wrong");
  assert.equal(locked.status, 429);
  assert.equal(locked.json.error.code, "too_many_attempts");
  assert.ok(locked.json.error.details.retryAfterSeconds > 0);
});

test("normalized email lockout holds across distinct trusted proxy IPs", async (t) => {
  const { server } = await fixture(t, { loginMaxAttempts: 2 });
  server.app.config.trustProxy = true;
  const client = createClient(server.url);
  for (const [index, email] of [ADMIN.email, ADMIN.email.toUpperCase()].entries()) {
    const response = await client.post("/api/auth/login", { json: { email, password: "wrong" }, headers: { "x-forwarded-for": `192.0.2.${index + 1}` } });
    assert.equal(response.status, 401);
  }
  assert.equal((await client.post("/api/auth/login", { json: ADMIN, headers: { "x-forwarded-for": "192.0.2.3" } })).status, 429);
});

test("sample objects created through the CLI cannot be claimed or deleted by a viewer", async (t) => {
  const { server, admin } = await fixture(t);
  const { alice } = await members(admin, server.url);
  const post = await server.app.library.sampleContent().save({ kind: "post", title: "CLI post" });
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, alice.user.id]);
  const refused = await alice.client.post("/api/sample-content", { json: { ...post, title: "Claimed" } });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, "read_only");
  assert.equal((await alice.client.delete(`/api/sample-content/${post.id}`)).status, 403);
  assert.equal((await server.app.library.sampleContent().get(post.id)).title, "CLI post");
});

test("invite guesses are throttled and simultaneous redemption creates only one account", async (t) => {
  const { server, admin } = await fixture(t, { loginMaxAttempts: 2 });
  const client = createClient(server.url);
  const register = (email, inviteCode) => client.post("/api/auth/register", { json: { email, password: "member-password-123", inviteCode } });
  assert.equal((await register("guess@example.test", "invalid")).status, 400);
  assert.equal((await register("guess@example.test", "invalid")).status, 400);
  assert.equal((await register("guess@example.test", "invalid")).status, 429);
  // Reset counters deliberately for the separate redemption race.
  server.app.auth.options.rateLimiter.clear("ip:127.0.0.1");
  server.app.auth.options.rateLimiter.clear("email:guess@example.test");
  const invite = await createInvite(admin, { email: "one@example.test" });
  const results = await Promise.all([register("one@example.test", invite.code), register("one@example.test", invite.code)]);
  assert.equal(results.filter((row) => row.status === 200).length, 1);
});

test("rate limiter expires, clears and bounds counters", (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const limiter = new LoginRateLimiter({ maxAttempts: 2, lockoutSeconds: 10 });
  limiter.recordFailure("a"); limiter.recordFailure("a");
  assert.equal(limiter.retryAfterSeconds("a"), 10);
  now += 10000;
  assert.equal(limiter.retryAfterSeconds("a"), 0);
  limiter.recordFailure("a"); limiter.recordFailure("a"); limiter.clear("a");
  assert.equal(limiter.retryAfterSeconds("a"), 0);
  for (let index = 0; index < 2000; index++) limiter.recordFailure(`key-${index}`);
  assert.ok(limiter.counters.size <= 1000);
  assert.equal(limiter.retryAfterSeconds("new-key"), 1);
  now += 10000;
  assert.equal(limiter.retryAfterSeconds("new-key"), 0);
});

test("health, state, nested upload documents and build failures hide internal paths", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const zip = await makePluginZip(temp, { slug: "paths", name: "Paths", version: "1.0" });
  const uploaded = await upload(admin, "/api/packages", zip);
  const assertSafe = (value) => {
    const text = JSON.stringify(value);
    assert.equal(text.includes(server.dataDir.replaceAll("\\", "\\\\")), false);
    assert.equal(/"(?:filePath|zip|absoluteFile|artifactPath)"/.test(text), false);
  };
  assertSafe(uploaded.json);
  assertSafe((await admin.get("/api/health")).json);
  assertSafe((await admin.get("/api/state")).json);
  assert.equal(uploaded.json.item.document.zip, undefined);
});

test("retention removes old artifacts beyond 1000 newer rows and preserves active/recent jobs", async (t) => {
  const { server } = await fixture(t);
  await server.queue.stop();
  const repo = server.app.buildItems;
  const old = await repo.enqueue({ profileId: null, profileFile: "old.json", profileName: "Old", createdBy: null });
  await repo.update(old.id, { status: "complete", completedAt: "2000-01-01T00:00:00.000Z", artifactFile: "old.zip" });
  const target = path.join(server.app.library.buildsDir, "old.zip");
  await writeFile(target, "artifact"); await writeFile(`${target}.json`, "{}");
  const active = await repo.enqueue({ profileId: null, profileFile: "active.json", profileName: "Active", createdBy: null });
  for (let index = 0; index < 1001; index++) {
    const row = await repo.enqueue({ profileId: null, profileFile: "recent.json", profileName: "Recent", createdBy: null });
    await repo.update(row.id, { status: "complete", completedAt: new Date().toISOString() });
  }
  assert.equal(await server.queue.pruneExpired(), 1);
  assert.equal(await repo.findById(old.id), null);
  assert.equal((await repo.findById(active.id)).status, "queued");
  await assert.rejects(stat(target), { code: "ENOENT" });
  await assert.rejects(stat(`${target}.json`), { code: "ENOENT" });
});

test("startup retention runs and stop clears the hourly timer", async (t) => {
  const { server } = await fixture(t);
  await server.queue.stop();
  const row = await server.app.buildItems.enqueue({ profileId: null, profileFile: "old.json", profileName: "Old", createdBy: null });
  await server.app.buildItems.update(row.id, { status: "failed", completedAt: "2000-01-01T00:00:00.000Z" });
  await server.queue.start();
  assert.equal(await server.app.buildItems.findById(row.id), null);
  assert.ok(server.queue.retentionTimer);
  await server.queue.stop();
  assert.equal(server.queue.retentionTimer, null);
});

test("hourly retention removes builds that expire after startup", async (t) => {
  const { server } = await fixture(t);
  await server.queue.stop();
  t.mock.timers.enable({ apis: ["setInterval"] });
  await server.queue.start();
  const row = await server.app.buildItems.enqueue({ profileId: null, profileFile: "expired.json", profileName: "Expired", createdBy: null });
  await server.app.buildItems.update(row.id, { status: "failed", completedAt: "2000-01-01T00:00:00.000Z" });
  t.mock.timers.tick(3600_000);
  await server.queue.retentionSweep;
  assert.equal(await server.app.buildItems.findById(row.id), null);
  await server.queue.stop();
});

test("reconciliation refreshes content while preserving owners and removes stale mirrors", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const zip = await makePluginZip(temp, { slug: "sync", name: "Original", version: "1.0" });
  const uploaded = await upload(admin, "/api/packages", zip);
  const changed = await makePluginZip(temp, { slug: "sync", name: "Updated", version: "1.0" });
  await server.app.library.packages().add(changed, { replace: true });
  await sync(server.app);
  const mirror = await server.app.packageItems.findById(uploaded.json.item.id);
  assert.equal(mirror.name, "Updated");
  assert.equal(mirror.createdBy, uploaded.json.item.createdBy);
  await server.app.library.packages().remove("plugin", "sync", "1.0");
  await sync(server.app);
  assert.equal(await server.app.packageItems.findById(mirror.id), null);
});

test("SQLite rollback never consumes an unrelated concurrent write", async () => {
  const db = new SqliteDatabase(":memory:");
  try {
    await db.exec("CREATE TABLE values_test (value TEXT)");
    let release; const gate = new Promise((resolve) => { release = resolve; });
    let started; const ready = new Promise((resolve) => { started = resolve; });
    const transaction = db.transaction(async (tx) => {
      await tx.run("INSERT INTO values_test VALUES (?)", ["rolled-back"]);
      started(); await gate; throw new Error("rollback");
    });
    const rejected = assert.rejects(transaction, /rollback/);
    await ready;
    const unrelated = db.run("INSERT INTO values_test VALUES (?)", ["kept"]);
    release(); await rejected; await unrelated;
    assert.deepEqual((await db.all("SELECT value FROM values_test")).map((row) => row.value), ["kept"]);
  } finally { await db.close(); }
});

test("PostgreSQL transactions use independent clients and root queries stay outside them", async () => {
  const calls = [];
  let sequence = 0;
  const pool = {
    query: async (sql) => { calls.push(["pool", sql]); return { rows: [] }; },
    connect: async () => {
      const id = ++sequence;
      return { query: async (sql) => { calls.push([id, sql]); return { rows: [] }; }, release: () => calls.push([id, "release"]) };
    }
  };
  const db = Object.create(PostgresDatabase.prototype); db.pool = pool; db.client = null;
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const ready = new Promise((resolve) => { started = resolve; });
  const first = db.transaction(async (tx) => { await tx.run("first"); started(); await gate; });
  await ready;
  await db.run("outside");
  await db.transaction(async (tx) => { await tx.run("second"); });
  release(); await first;
  assert.ok(calls.some(([id, sql]) => id === "pool" && sql === "outside"));
  assert.ok(calls.some(([id, sql]) => id === 1 && sql === "first"));
  assert.ok(calls.some(([id, sql]) => id === 2 && sql === "second"));
  assert.equal(calls.filter(([, sql]) => sql === "COMMIT").length, 2);
});

async function buildProfile(admin, temp) {
  assert.equal((await upload(admin, "/api/packages", await makeWordPressZip(temp))).status, 200);
  const response = await admin.post("/api/profiles", { json: {
    name: "hardening-build", locale: "en_US", wordpressVersion: "7.1", wordpressVariant: "en_US", pluginVersions: {}
  } });
  assert.equal(response.status, 200);
  return response.json.file;
}
async function finished(client, id) {
  for (let index = 0; index < 200; index++) {
    const response = await client.get(`/api/build-jobs/${id}`);
    if (["failed", "complete"].includes(response.json.status)) return response.json;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Build did not finish");
}

test("two workers building one profile produce independent verifiable artifacts", async (t) => {
  const { server, temp, admin } = await fixture(t, { buildWorkers: 2 });
  const file = await buildProfile(admin, temp);
  const jobs = await Promise.all([1, 2].map(() => admin.post("/api/build-jobs", { json: { file } })));
  assert.ok(jobs.every((row) => row.status === 202));
  const results = await Promise.all(jobs.map((row) => finished(admin, row.json.id)));
  assert.ok(results.every((row) => row.status === "complete"), JSON.stringify(results));
  assert.notEqual(results[0].result.file, results[1].result.file);
  for (const result of results) {
    const zip = path.join(server.app.library.buildsDir, result.result.file);
    assert.equal(await sha256File(zip), result.result.sha256);
    assert.ok(result.result.file.includes(result.id));
  }
  const second = path.join(server.app.library.buildsDir, results[1].result.file);
  assert.equal((await admin.delete(`/api/build-jobs/${results[0].id}`)).status, 200);
  assert.ok((await stat(second)).size > 0);
});

test("build quota includes new artifact bytes and discards rejected outputs", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const file = await buildProfile(admin, temp);
  const user = (await admin.get("/api/auth/session")).json.user;
  const usage = await server.app.quota.usage(user.id);
  server.app.quota.limitBytes = usage.usedBytes + 1;
  const job = await admin.post("/api/build-jobs", { json: { file } });
  assert.equal(job.status, 202);
  const result = await finished(admin, job.json.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "quota_exceeded");
  assert.deepEqual(await readdir(server.app.library.buildsDir), []);
});

test("build failures expose coded errors without filesystem paths", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const file = await buildProfile(admin, temp);
  await rm(path.join(server.app.library.profilesDir, file));
  const job = await admin.post("/api/build-jobs", { json: { file } });
  const result = await finished(admin, job.json.id);
  assert.equal(result.status, "failed");
  assert.equal(JSON.stringify(result).includes(server.dataDir.replaceAll("\\", "\\\\")), false);
  assert.equal(/[A-Za-z]:\\/.test(result.error.message), false);
});

async function templateSnapshot(temp, generatedAt, name = "Header") {
  const source = path.join(temp, `template-${name}`); await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "starter-config.json"), JSON.stringify({
    schema_version: 2, exporter_version: "test", generated_at: generatedAt,
    source: { wordpress_version: "7.1", php_version: "8.3", locale: "en_US", site_domain: "source.example.test", theme: { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" }, plugins: [] },
    targets: { plugins: [] },
    wordpress: { options: {}, pages: [] },
    adapters: { elementor: { templates: [{ id: "header", sourceId: "100", name, type: "header", document: [] }] } }
  }));
  await writeFile(path.join(source, "export-manifest.json"), "{}");
  const zip = path.join(temp, `${name}.zip`); await createZip(source, zip); return zip;
}

test("snapshot templates inherit ownership and a viewer cannot overwrite them", async (t) => {
  const { server, temp, admin } = await fixture(t);
  const { alice, bob } = await members(admin, server.url);
  const original = await templateSnapshot(temp, "2026-08-24T05:01:24+00:00");
  assert.equal((await upload(alice.client, "/api/configs", original)).status, 200);
  const item = (await alice.client.get("/api/state")).json.elementorTemplates[0];
  assert.equal(item.createdBy, alice.user.id);
  assert.equal(item.canDelete, true);
  const changed = await templateSnapshot(temp, "2026-08-25T05:01:24+00:00", "Changed");
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, bob.user.id]);
  const refused = await upload(bob.client, "/api/configs", changed);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, "read_only");
  assert.equal((await server.app.library.snapshots().list()).length, 1);
  assert.equal((await bob.client.delete(`/api/elementor-templates/${item.id}`)).status, 403);
  assert.equal((await alice.client.delete(`/api/elementor-templates/${item.id}`)).status, 200);
});
