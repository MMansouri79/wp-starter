import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ADMIN, createClient, startTestServer, makeWordPressZip, makePluginZip, makeSnapshotZip, readUpload } from "./harness.mjs";
import { createZip } from "../../../packages/builder-core/dist/index.js";

const PASSWORD = "team-member-password-123";
async function setup(t) {
  const server = await startTestServer({ teamFixture: false });
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-team-fixtures-"));
  t.after(async () => { await server.stop(); await rm(temp, { recursive: true, force: true }); });
  const platform = createClient(server.url); await platform.signIn(ADMIN.email, ADMIN.password);
  async function provision(name, email) {
    const result = await platform.post("/api/admin/teams", { json: { name, ownerEmail: email } });
    assert.equal(result.status, 201, result.text);
    const client = createClient(server.url);
    const session = await client.register(email, PASSWORD, result.json.token);
    assert.equal(session.user.role, "member"); assert.equal(session.isAdmin, false);
    const id = result.json.team.id;
    return { id, client, user: session.user, prefix: `/api/teams/${id}`, app: await server.platform.forTeam(id) };
  }
  const a = await provision("Team A", "a@example.test");
  const b = await provision("Team B", "b@example.test");
  async function member(team, email, role) {
    const invitation = await team.client.post(team.prefix + "/invites", { json: { email, role } });
    assert.equal(invitation.status, 201, invitation.text);
    const client = createClient(server.url); const session = await client.register(email, PASSWORD, invitation.json.token);
    return { client, user: session.user };
  }
  return { server, platform, temp, a, b, member };
}
async function upload(team, suffix, file) {
  const response = await team.client.post(team.prefix + suffix + `?filename=${encodeURIComponent(path.basename(file))}`, { body: await readUpload(file), contentType: "application/octet-stream" });
  assert.equal(response.status, 200, response.text); return response.json;
}
async function wait(client, prefix, id) {
  for (let i = 0; i < 100; i++) {
    const result = await client.get(prefix + "/build-jobs/" + id); assert.equal(result.status, 200);
    if (!["queued", "running"].includes(result.json.status)) return result.json;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail("Build did not finish");
}

test("all content routes require team membership, including platform administrators", async t => {
  const { a, b, platform } = await setup(t);
  for (const suffix of ["/state", "/vnext", "/elementor-templates", "/sample-content", "/sample-content/assets/secret", "/build-jobs", "/build-jobs/secret", "/builds/secret/download", "/configs/secret/check", "/configs/secret/inspect", "/configs/compare?left=a&right=b", "/profiles/secret.json", "/profiles/secret.json/compatibility", "/members", "/invites", "/audit", "/quota"]) {
    for (const client of [b.client, platform]) assert.equal((await client.get(a.prefix + suffix)).status, 404, suffix);
  }
  for (const suffix of ["/packages", "/configs", "/fonts", "/profiles", "/vnext/colors", "/sample-content", "/build-jobs", "/invites"]) assert.equal((await b.client.post(a.prefix + suffix, { json: {} })).status, 404, suffix);
  assert.equal((await a.client.get("/api/state", { raw: true })).status, 404, "No legacy content fallback");
  assert.equal((await platform.get("/api/auth/session")).json.teams.length, 0);
});

test("identical packages, snapshot IDs, profile filenames and resources coexist across teams", async t => {
  const { temp, a, b } = await setup(t);
  const core = await makeWordPressZip(temp);
  const plugin = await makePluginZip(temp, { slug: "team-plugin", name: "Private plugin", version: "1.0" });
  const snapshot = await makeSnapshotZip(temp);
  let colorId;
  for (const team of [a, b]) {
    await upload(team, "/packages", core); await upload(team, "/packages", plugin); await upload(team, "/configs", snapshot);
    const profile = await team.client.post(team.prefix + "/profiles", { json: { name: "same-profile", wordpressVersion: "7.1", pluginVersions: { "team-plugin": "1.0" } } });
    assert.equal(profile.status, 200, profile.text);
    const colors = await team.client.post(team.prefix + "/vnext/colors", { json: { ...(colorId ? { id: colorId } : {}), name: team.id, elementor: { primary: "#123456", secondary: "#234567", text: "#111111", accent: "#345678" } } });
    assert.equal(colors.status, 200, colors.text); colorId = colors.json.id;
    for (const kind of ["typography", "designSystems", "templates"]) await team.app.resourceItems[kind].save({ id: "same-resource", name: team.id, document: { id: "same-resource", name: team.id }, sha256: "", createdBy: team.user.id });
    await team.app.fontItems.save({ id: "same-font", name: team.id, document: { id: "same-font", name: team.id, faces: [] }, sha256: "", createdBy: team.user.id });
    await team.app.elementorItems.save({ id: "same-template", name: team.id, document: { id: "same-template", name: team.id }, sha256: "", createdBy: team.user.id });
    for (const resource of ["terms", "attributes", "assets"]) await team.app.sampleItems.save(resource, { id: `same-${resource}`, name: team.id, document: { id: `same-${resource}`, name: team.id, ...(resource === "assets" ? { file: "sample-assets/missing.txt" } : {}) }, sha256: "", createdBy: team.user.id });
    await team.app.sampleItems.save("content", { id: "same-post", name: team.id, document: { id: "same-post", kind: "post", title: team.id }, sha256: "", createdBy: team.user.id });
  }
  for (const team of [a, b]) {
    const state = await team.client.get(team.prefix + "/state"); assert.equal(state.status, 200, state.text);
    assert.equal(state.json.profiles.length, 1); assert.equal(state.json.configs.length, 1);
    assert.equal(state.json.vnext.colors[0].name, team.id);
    assert.equal(state.json.fonts[0].name, team.id);
    assert.equal((await team.app.elementorItems.findById("same-template")).name, team.id);
    for (const kind of ["typography", "designSystems", "templates"]) assert.equal((await team.app.resourceItems[kind].findById("same-resource")).name, team.id);
    for (const kind of ["terms", "attributes", "assets"]) assert.equal((await team.app.sampleItems.findById(kind, `same-${kind}`)).name, team.id);
  }
  const changed = await a.client.post(a.prefix + "/vnext/colors", { json: { id: colorId, name: "Changed in A", elementor: { primary: "#123456", secondary: "#234567", text: "#111111", accent: "#345678" } } });
  assert.equal(changed.status, 200);
  assert.equal((await b.app.resourceItems.colors.findById(colorId)).name, b.id);
  assert.notEqual(a.app.library.root, b.app.library.root);
  const bPackage = (await b.app.packageItems.list()).find(item => item.slug === "team-plugin");
  await assert.rejects(b.app.packages.remove(bPackage.id, { ...a.user, teamRole: "owner", teamId: a.id }), { code: "read_only" });
});

test("editors collaborate on others' items and viewers cannot create, change, duplicate or build", async t => {
  const { a, member } = await setup(t);
  const editor = await member(a, "editor@example.test", "editor");
  const viewer = await member(a, "viewer@example.test", "viewer");
  const created = await a.client.post(a.prefix + "/sample-content", { json: { kind: "post", title: "Team post" } }); assert.equal(created.status, 200, created.text);
  const id = created.json.id;
  assert.equal((await editor.client.put(a.prefix + "/sample-content/" + id, { json: { kind: "post", title: "Collaborative edit" } })).status, 200);
  assert.equal((await a.app.sampleItems.findById("content", id)).createdBy, a.user.id);
  assert.equal((await viewer.client.get(a.prefix + "/sample-content/" + id)).status, 200);
  for (const [method, suffix] of [["POST", "/sample-content"], ["PUT", "/sample-content/" + id], ["POST", "/sample-content/" + id + "/duplicate"], ["DELETE", "/sample-content/" + id], ["POST", "/packages"], ["POST", "/fonts"], ["POST", "/configs"], ["POST", "/profiles"], ["POST", "/build-jobs"], ["POST", "/vnext/colors"]]) {
    const result = await viewer.client.request(method, a.prefix + suffix, { json: {} }); assert.equal(result.status, 403); assert.equal(result.json.error.code, "read_only");
  }
  const csrf = await editor.client.put(a.prefix + "/sample-content/" + id, { json: {}, csrf: false }); assert.equal(csrf.json.error.code, "csrf_failed");
  const events = (await a.client.get(a.prefix + "/audit")).json.events;
  assert.ok(events.some(event => event.actorId === editor.user.id && event.action === "content.put"));
  assert.equal((await editor.client.delete(a.prefix + "/sample-content/" + id)).status, 200);
});

test("member administration protects owners and removed memberships lose access immediately", async t => {
  const { server, a, b, member } = await setup(t);
  const admin = await member(a, "team-admin@example.test", "admin");
  const editor = await member(a, "edit@example.test", "editor");
  const ownerRemove = await a.client.delete(a.prefix + "/members/" + a.user.id); assert.equal(ownerRemove.status, 409); assert.equal(ownerRemove.json.error.code, "last_owner");
  for (const role of ["owner", "admin"]) assert.equal((await admin.client.put(a.prefix + "/members/" + editor.user.id, { json: { role } })).status, 403);
  assert.equal((await admin.client.delete(a.prefix + "/members/" + a.user.id)).status, 403);
  assert.equal((await editor.client.post(a.prefix + "/invites", { json: { email: "x@example.test", role: "viewer" } })).status, 403);
  assert.equal((await admin.client.put(a.prefix + "/members/" + editor.user.id, { json: { role: "viewer" } })).status, 200);
  const invite = await b.client.post(b.prefix + "/invites", { json: { email: editor.user.email, role: "editor" } });
  assert.equal((await editor.client.post("/api/auth/team-invites/accept", { json: { token: invite.json.token } })).status, 200);
  assert.equal((await editor.client.get("/api/auth/session")).json.teams.length, 2);
  assert.equal((await admin.client.delete(a.prefix + "/members/" + editor.user.id)).status, 200);
  assert.equal((await editor.client.get(a.prefix + "/state")).status, 404);
  assert.equal((await editor.client.get(b.prefix + "/state")).status, 200);
  const platform = createClient(server.url); await platform.signIn(ADMIN.email, ADMIN.password);
  assert.equal((await platform.post(`/api/admin/users/${a.user.id}/status`, { json: { status: "disabled" } })).status, 409);
});

test("permission changes are checked after a queued write waits for the global mutation lock", async t => {
  const { server, a, member } = await setup(t);
  const editor = await member(a, "waiting@example.test", "editor");
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  const holding = server.platform.library.mutate(async () => { entered(); await gate; }); await started;
  const pending = editor.client.post(a.prefix + "/sample-content", { json: { kind: "post", title: "Forbidden after demotion" } });
  await new Promise(resolve => setTimeout(resolve, 50));
  await server.platform.db.run("UPDATE team_memberships SET role = 'viewer' WHERE team_id = ? AND user_id = ?", [a.id, editor.user.id]);
  release(); await holding;
  const result = await pending; assert.equal(result.status, 403); assert.equal(result.json.error.code, "read_only");
  assert.equal((await a.app.sampleItems.list()).length, 0);
});

test("build jobs, downloads and dependencies stay team-bound and the queue limit is global", async t => {
  const { server, temp, a, b, member } = await setup(t);
  const core = await makeWordPressZip(temp); await upload(a, "/packages", core);
  const profile = { name: "same-profile", wordpressVersion: "7.1" };
  assert.equal((await b.client.post(b.prefix + "/profiles", { json: profile })).status, 404, "B cannot resolve A's WordPress package");
  assert.equal((await a.client.post(a.prefix + "/profiles", { json: profile })).status, 200);
  await server.queue.stop();
  for (let i = 0; i < 4; i++) assert.equal((await a.client.post(a.prefix + "/build-jobs", { json: { profileFile: "same-profile.json" } })).status, 202);
  await upload(b, "/packages", core); assert.equal((await b.client.post(b.prefix + "/profiles", { json: profile })).status, 200);
  assert.equal((await b.client.post(b.prefix + "/build-jobs", { json: { file: "same-profile.json" } })).status, 429);
  const jobs = await a.app.buildItems.list();
  await server.queue.start();
  const result = await wait(a.client, a.prefix, jobs[0].id); assert.equal(result.status, "complete", JSON.stringify(result.error));
  assert.equal((await b.client.get(b.prefix + "/build-jobs/" + jobs[0].id)).status, 404);
  assert.equal((await b.client.get(b.prefix + "/builds/" + jobs[0].id + "/download")).status, 404);
  assert.equal((await b.client.get(result.result.downloadUrl)).status, 404);
  const viewer = await member(a, "download@example.test", "viewer"); assert.equal((await viewer.client.get(result.result.downloadUrl)).status, 200);
  assert.equal(result.result.download, result.result.downloadUrl);
  assert.equal((await viewer.client.get(a.prefix + "/builds/by-file/" + result.result.file + "/download")).status, 200);
  assert.equal((await b.client.get(b.prefix + "/builds/by-file/" + result.result.file + "/download")).status, 404);
  assert.ok(result.result.downloadUrl.startsWith(a.prefix)); assert.equal((await b.app.quota.usage()).usedBytes, (await b.app.packageItems.totalBytes()));
});

test("team suspension denies access and team library paths reject traversal and junction escapes", async t => {
  const { platform, temp, a, b } = await setup(t);
  await writeFile(path.join(a.app.library.root, "registry.json"), JSON.stringify({ schemaVersion: 2, packages: [{ kind: "plugin", slug: "escape", version: "1", zip: "../outside.zip" }] }));
  const traversal = await a.client.get(a.prefix + "/state"); assert.equal(traversal.status, 400); assert.equal(traversal.json.error.code, "unsafe_team_path");
  await rm(path.join(a.app.library.root, "registry.json"));
  await symlink(b.app.library.root, path.join(a.app.library.root, "linked"), "junction");
  const link = await a.client.get(a.prefix + "/state"); assert.equal(link.status, 400); assert.equal(link.json.error.code, "unsafe_team_path");
  await rm(path.join(a.app.library.root, "linked"));
  assert.equal((await platform.post(`/api/admin/teams/${a.id}/status`, { json: { status: "suspended" } })).status, 200);
  assert.equal((await a.client.get(a.prefix + "/state")).status, 404);
  assert.equal((await a.client.get("/api/auth/session")).json.teams.length, 0);
  assert.equal((await b.client.get(b.prefix + "/state")).status, 200);
});

test("foreign item IDs return 404 inside an accessible team, including comparison and destructive routes", async t => {
  const { a, b, temp } = await setup(t);
  const snapshot = await upload(a, "/configs", await makeSnapshotZip(temp));
  const post = await a.client.post(a.prefix + "/sample-content", { json: { kind: "post", title: "Only A" } });
  const palette = await a.client.post(a.prefix + "/vnext/colors", { json: { name: "Only A", elementor: { primary: "#123456", secondary: "#234567", text: "#111111", accent: "#345678" } } });
  const plugin = await upload(a, "/packages", await makePluginZip(temp, { slug: "only-a", name: "Only A", version: "1" }));
  for (const [method, suffix] of [["GET", `/sample-content/${post.json.id}`], ["PUT", `/sample-content/${post.json.id}`], ["DELETE", `/sample-content/${post.json.id}`], ["GET", `/configs/${snapshot.item.id}/inspect`], ["GET", `/configs/compare?left=${snapshot.item.id}&right=${snapshot.item.id}`], ["DELETE", `/configs/${snapshot.item.id}`], ["DELETE", `/vnext/colors/${palette.json.id}`], ["DELETE", `/packages?id=${plugin.item.id}`], ["DELETE", "/fonts?id=foreign-font"], ["DELETE", "/elementor-templates/foreign-template"]]) {
    const response = await b.client.request(method, b.prefix + suffix, { json: method === "PUT" ? { kind: "post", title: "Forbidden" } : undefined });
    assert.equal(response.status, 404, `${method} ${suffix}: ${response.text}`);
  }
  assert.equal((await a.client.get(a.prefix + "/sample-content/" + post.json.id)).status, 200);
});

test("account deletion retains team items and creator attribution and records membership removal", async t => {
  const { platform, a, member } = await setup(t);
  const colleague = await member(a, "next-owner@example.test", "owner");
  const post = await a.client.post(a.prefix + "/sample-content", { json: { kind: "post", title: "Retained team item" } });
  assert.equal((await platform.delete("/api/admin/users/" + a.user.id)).status, 200);
  const row = await a.app.sampleItems.findById("content", post.json.id); assert.equal(row.createdBy, a.user.id);
  const state = await colleague.client.get(a.prefix + "/state"); assert.equal(state.status, 200);
  assert.ok(state.json.sampleContent.content.some(item => item.id === post.json.id && item.canEdit));
  assert.ok((await colleague.client.get(a.prefix + "/audit")).json.events.some(event => event.action === "member.account_delete" && event.target === a.user.id));
});
