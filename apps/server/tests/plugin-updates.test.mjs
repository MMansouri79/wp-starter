import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PluginUpdates, pluginUpdates, startPluginUpdateScheduler, newerRelease, wordpressBytes, UPDATE_INTERVAL_MS } from "../dist/services/plugin-updates.js";
import { ADMIN, createClient, createUserSession, makePluginZip, startTestServer } from "./harness.mjs";

async function setup(t) {
  const server = await startTestServer();
  const temp = await mkdtemp(path.join(os.tmpdir(), "plugin-updates-test-"));
  t.after(async () => { await server.stop(); await rm(temp, { recursive: true, force: true }); });
  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);
  const user = (await server.app.teams.requireAccess(server.teamId, await server.app.users.findByEmail(ADMIN.email))).actor;
  const old = await makePluginZip(temp, { slug: "alpha", name: "Alpha", version: "1.0" });
  await server.app.packages.add(old, {}, user);
  const zip = await readFile(await makePluginZip(temp, { slug: "alpha", name: "Alpha", version: "1.1" }));
  let calls = 0;
  const download = async (url) => {
    calls++;
    return url.includes("api.wordpress.org") ? Buffer.from(JSON.stringify({ slug: "alpha", version: "1.1", download_link: "https://downloads.wordpress.org/plugin/alpha.1.1.zip" })) : zip;
  };
  const service = new PluginUpdates(server.app, download);
  return { server, temp, client, user, zip, download, service, calls: () => calls };
}

test("updates are opt-in, keep pinned profiles and versions, and respect the twelve-hour interval", async t => {
  const { server, user, service, calls } = await setup(t);
  assert.equal((await service.view()).enabled, false);
  await service.check(); assert.equal(calls(), 0);
  assert.equal((await service.view()).paused, false);
  await service.save({ enabled: true, slugs: [] }, user);
  await service.check(); assert.equal(calls(), 0, "unconfirmed plugins never make network requests");
  const profile = path.join(server.app.library.profilesDir, "pinned.json");
  const pinned = JSON.stringify({ plugins: [{ slug: "alpha", version: "1.0" }] });
  await writeFile(profile, pinned);
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  await Promise.all([service.check(), service.check()]);
  assert.equal(calls(), 2);
  assert.deepEqual((await server.app.packageItems.list()).map(row => row.version).sort(), ["1.0", "1.1"]);
  assert.equal(await readFile(profile, "utf8"), pinned);
  assert.deepEqual((await service.view()).results, [{ slug: "alpha", status: "added", version: "1.1" }]);
  await new PluginUpdates(server.app, async () => assert.fail("not due after restart")).check();
  await server.app.db.run("UPDATE plugin_update_settings SET last_check = ? WHERE team_id = ?", [new Date(Date.now() - UPDATE_INTERVAL_MS - 1000).toISOString(), server.teamId]);
  await service.check(); assert.equal(calls(), 3, "existing release is not downloaded again");
});

test("download failures and mismatched archives leave the library intact and retry next period", async t => {
  const { server, user, download, service } = await setup(t);
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  const failed = new PluginUpdates(server.app, async () => { throw new Error("private path C:\\secrets\\x"); });
  await failed.check();
  assert.deepEqual((await failed.view()).results, [{ slug: "alpha", status: "failed", code: "update_failed" }]);
  assert.equal((await server.app.packageItems.list()).length, 1);
  const wrong = new PluginUpdates(server.app, async url => {
    if (url.includes("api.wordpress.org")) return Buffer.from(JSON.stringify({ slug: "alpha", version: "1.2", download_link: "https://downloads.wordpress.org/plugin/alpha.zip" }));
    return download(url);
  });
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  await wrong.check();
  assert.equal((await wrong.view()).results[0].code, "update_identity_mismatch");
  assert.equal((await server.app.packageItems.list()).length, 1);
  await server.app.db.run("UPDATE plugin_update_settings SET last_check = NULL WHERE team_id = ?", [server.teamId]);
  await service.check();
  assert.equal((await server.app.packageItems.list()).length, 2);
});

test("policy changes during download cancel finalization without holding the mutation lock", async t => {
  const { server, user, download, service } = await setup(t);
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  let release, arrived;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { arrived = resolve; });
  const worker = new PluginUpdates(server.app, async url => {
    if (url.includes("downloads.wordpress.org")) { arrived(); await gate; }
    return download(url);
  });
  const checking = worker.check();
  await ready;
  try {
    await service.save({ enabled: false, slugs: ["alpha"] }, user);
  } finally { release(); }
  await checking;
  assert.equal((await server.app.packageItems.list()).length, 1);
  assert.equal((await service.view()).lastCheck, null);
});

test("revoked authorization and quotas prevent automatic imports", async t => {
  const { server, user, service, calls } = await setup(t);
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  await server.app.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [server.teamId, user.id]);
  await service.check(); assert.equal(calls(), 0);
  assert.equal((await service.view()).paused, true);
  await server.app.db.run("UPDATE team_memberships SET role = 'owner' WHERE team_id = ? AND user_id = ?", [server.teamId, user.id]);
  server.app.quota.assertWithinQuota = async () => { throw Object.assign(new Error("quota"), { code: "quota_exceeded" }); };
  await service.check();
  assert.equal((await server.app.packageItems.list()).length, 1);
  assert.equal((await service.view()).results[0].code, "quota_exceeded");
});

test("settings require team management, membership and CSRF; team state stays isolated", async t => {
  const { server, client, user } = await setup(t);
  const body = { enabled: false, slugs: ["alpha"] };
  assert.equal((await client.put("/api/plugin-updates", { json: body, csrf: false })).status, 403);
  const editor = await createUserSession(client, server.url, { email: "editor@example.test", password: "member-password-123", role: "member" });
  assert.equal((await editor.client.get("/api/plugin-updates")).status, 200);
  const denied = await editor.client.put("/api/plugin-updates", { json: body });
  assert.equal(denied.status, 403); assert.equal(denied.json.error.code, "team_admin_required");
  const viewer = await createUserSession(client, server.url, { email: "viewer@example.test", password: "member-password-123", role: "member", teamRole: "viewer" });
  const readOnly = await viewer.client.put("/api/plugin-updates", { json: body });
  assert.equal(readOnly.status, 403); assert.equal(readOnly.json.error.code, "read_only");
  assert.equal((await client.put("/api/plugin-updates", { json: { enabled: false, slugs: ["missing"] } })).status, 400);
  assert.equal((await client.put("/api/plugin-updates", { json: body })).status, 200);
  const second = await server.app.teams.create("Other", user.id);
  for (const verb of ["get", "put"]) assert.equal((await client[verb](`/api/teams/${second.id}/plugin-updates`, { json: verb === "put" ? body : undefined, raw: true })).status, 404, "platform admin has no content bypass");
  await server.app.db.run("INSERT INTO team_memberships (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", [second.id, user.id, new Date().toISOString()]);
  const other = await client.get(`/api/teams/${second.id}/plugin-updates`, { raw: true });
  assert.equal(other.status, 200); assert.equal(other.json.enabled, false); assert.deepEqual(other.json.plugins, []);
  const shell = await client.get("/");
  assert.match(shell.text, /src="\/plugin-updates.js"/);
});

test("WordPress downloads reject unapproved origins, redirects and oversized streams", async () => {
  let calls = 0;
  const never = async () => { calls++; assert.fail("unapproved URL fetched"); };
  for (const url of ["http://downloads.wordpress.org/a", "https://example.test/a", "https://downloads.wordpress.org:8443/a", "https://user:pass@api.wordpress.org/a"]) await assert.rejects(wordpressBytes(url, 10, never), { code: "update_url_rejected" });
  assert.equal(calls, 0);
  await assert.rejects(wordpressBytes("https://api.wordpress.org/a", 10, async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://evil.test/a" } }); }), { code: "update_url_rejected" });
  assert.equal(calls, 1);
  await assert.rejects(wordpressBytes("https://api.wordpress.org/a", 3, async () => new Response("1234")), { code: "update_too_large" });
  await assert.rejects(wordpressBytes("https://api.wordpress.org/a", 3, async () => new Response("1234", { headers: { "content-length": "4" } })), { code: "update_too_large" });
  await assert.rejects(wordpressBytes("https://api.wordpress.org/a", 10, async () => new Response(null, { status: 302, headers: { location: "/loop" } })), { code: "update_redirect_failed" });
  assert.equal((await wordpressBytes("https://api.wordpress.org/a", 3, async () => new Response("123"))).toString(), "123");
});

test("release ordering is numeric and excludes downgrades and prereleases", () => {
  assert.equal(newerRelease("1.10", "1.9"), true);
  for (const [next, old] of [["1.0.0", "1"], ["1.1", "2"], ["2.0-beta", "1"], ["2", "vendor-version"]]) assert.equal(newerRelease(next, old), false);
});

test("the scheduler checks overdue libraries at startup, polls newly enabled teams, and stops cleanly", async t => {
  const { server, user } = await setup(t);
  const service = pluginUpdates(server.app);
  const requests = [];
  // No live WordPress.org traffic: both metadata and archive are synthetic.
  const zip = await readFile(await makePluginZip(server.dataDir, { slug: "alpha", name: "Alpha", version: "1.1" }));
  const priorFetch = globalThis.fetch;
  const stopMock = t.mock.method(globalThis, "fetch", async input => {
    const url = String(input);
    if (!url.includes("wordpress.org")) return priorFetch(input);
    requests.push(url);
    return url.includes("api.wordpress.org") ? new Response(JSON.stringify({ slug: "alpha", version: "1.1", download_link: "https://downloads.wordpress.org/plugin/alpha.zip" })) : new Response(zip);
  });
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const stop = startPluginUpdateScheduler(server.platform);
  try {
    await new Promise(setImmediate);
    await service.idle();
    assert.equal(requests.length, 2, "startup processes an enabled overdue library");
    await service.save({ enabled: false, slugs: ["alpha"] }, user);
    t.mock.timers.tick(60_000);
    await new Promise(setImmediate); await service.idle();
    assert.equal(requests.length, 2);
    await service.save({ enabled: true, slugs: ["alpha"] }, user);
    t.mock.timers.tick(60_000);
    await new Promise(setImmediate); await service.idle();
    assert.equal(requests.length, 3, "next poll checks newly enabled settings without downloading duplicate ZIPs");
  } finally { await stop(); t.mock.timers.reset(); stopMock.mock.restore(); }
  await service.save({ enabled: true, slugs: ["alpha"] }, user);
  assert.equal((await service.view()).lastCheck, null);
});
