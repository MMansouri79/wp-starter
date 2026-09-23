import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ADMIN,
  createClient,
  createUserSession,
  makePluginZip,
  makeSnapshotZip,
  makeThemeZip,
  makeWordPressZip,
  readUpload,
  startTestServer
} from "./harness.mjs";

const PASSWORD = "member-password-123";

/** Boots a server with an admin plus two member accounts, and a scratch fixture dir. */
async function withTwoMembers(t) {
  const server = await startTestServer();
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-fixtures-"));

  t.after(async () => {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  });

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const alice = await createUserSession(admin, server.url, {
    email: "alice@example.test",
    password: PASSWORD,
    role: "member"
  });
  const bob = await createUserSession(admin, server.url, {
    email: "bob@example.test",
    password: PASSWORD,
    role: "member"
  });

  return { server, temp, admin, alice, bob };
}

async function uploadPackage(client, zipFile, filename) {
  const body = await readUpload(zipFile);
  return client.post(`/api/packages?filename=${encodeURIComponent(filename)}`, {
    body,
    contentType: "application/octet-stream"
  });
}

test("rejects an upload that is not a valid package", async (t) => {
  const { alice, temp } = await withTwoMembers(t);

  const junk = path.join(temp, "junk.zip");
  const { createZip } = await import("../../../packages/builder-core/dist/index.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = path.join(temp, "junk-src");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "readme.txt"), "not a package\n");
  await createZip(dir, junk);

  const response = await uploadPackage(alice.client, junk, "junk.zip");
  assert.equal(response.status, 400);
  assert.match(response.json.error.code, /invalid|unsupported|unknown/);
});

test("rejects a non-zip upload by filename", async (t) => {
  const { alice, temp } = await withTwoMembers(t);

  const body = Buffer.from("not a zip at all");
  const response = await alice.client.post("/api/packages?filename=notes.txt", {
    body,
    contentType: "application/octet-stream"
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, "invalid_upload");
  void temp;
});

test("user A uploads a package and user B sees it read-only", async (t) => {
  const { alice, bob, temp } = await withTwoMembers(t);

  const pluginZip = await makePluginZip(temp, { slug: "shared-plugin", name: "Shared Plugin", version: "1.2.3" });
  const uploaded = await uploadPackage(alice.client, pluginZip, "shared-plugin.zip");

  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.json.added, true);
  assert.equal(uploaded.json.record.slug, "shared-plugin");
  assert.equal(uploaded.json.record.version, "1.2.3");
  assert.ok(uploaded.json.record.sha256, "the registry records a checksum");

  // The owner sees the item as their own and editable.
  const aliceState = await alice.client.get("/api/state");
  const aliceView = aliceState.json.packages.find((item) => item.slug === "shared-plugin");
  assert.ok(aliceView, "the uploader sees the package");
  assert.equal(aliceView.ownedByCurrentUser, true);
  assert.equal(aliceView.canEdit, true);
  assert.equal(aliceView.canDelete, true);
  assert.equal(aliceView.ownerName, "alice");

  // The other member sees the same package, but cannot change it.
  const bobState = await bob.client.get("/api/state");
  const bobView = bobState.json.packages.find((item) => item.slug === "shared-plugin");
  assert.ok(bobView, "the shared package is visible to other accounts");
  assert.equal(bobView.ownedByCurrentUser, false);
  assert.equal(bobView.canEdit, false);
  assert.equal(bobView.canDelete, false);
  assert.equal(bobView.ownerName, "alice", "the owner label is exposed for the Shared by badge");

  // Bob can read it directly, but not delete it.
  const bobDelete = await bob.client.delete(`/api/packages?id=${encodeURIComponent(bobView.id)}`);
  assert.equal(bobDelete.status, 403);
  assert.equal(bobDelete.json.error.code, "read_only");

  // Alice can delete her own package.
  const aliceDelete = await alice.client.delete(`/api/packages?id=${encodeURIComponent(aliceView.id)}`);
  assert.equal(aliceDelete.status, 200);

  const afterDelete = await bob.client.get("/api/state");
  assert.equal(afterDelete.json.packages.some((item) => item.slug === "shared-plugin"), false);
});

test("an administrator cannot delete another account's package", async (t) => {
  const { admin, alice, temp } = await withTwoMembers(t);

  const themeZip = await makeThemeZip(temp, { slug: "owned-theme", name: "Owned Theme", version: "2.0.0" });
  const uploaded = await uploadPackage(alice.client, themeZip, "owned-theme.zip");
  assert.equal(uploaded.status, 200);

  const adminState = await admin.get("/api/state");
  const adminView = adminState.json.packages.find((item) => item.slug === "owned-theme");
  assert.ok(adminView);
  assert.equal(adminView.canEdit, false, "administrators gain no rights over another account's items");

  const attempt = await admin.delete(`/api/packages?id=${encodeURIComponent(adminView.id)}`);
  assert.equal(attempt.status, 403);
  assert.equal(attempt.json.error.code, "read_only");
});

test("items imported outside the web app are unowned and manageable only by an administrator", async (t) => {
  const { server, admin, alice, temp } = await withTwoMembers(t);

  // Simulate a CLI import straight into the shared library directory.
  const pluginZip = await makePluginZip(temp, { slug: "cli-imported", name: "CLI Imported", version: "9.9.9" });
  await server.app.library.packages().add(pluginZip);
  await server.app.packageItems.upsert({
    record: (await server.app.library.packages().resolve("plugin", "cli-imported", "9.9.9")),
    sizeBytes: 1024,
    uploadedBy: null
  });

  const aliceState = await alice.client.get("/api/state");
  const aliceView = aliceState.json.packages.find((item) => item.slug === "cli-imported");
  assert.ok(aliceView);
  assert.equal(aliceView.createdBy, null);
  assert.equal(aliceView.ownedByCurrentUser, false);
  assert.equal(aliceView.canEdit, false, "a member cannot claim an unowned item");

  const aliceDelete = await alice.client.delete(`/api/packages?id=${encodeURIComponent(aliceView.id)}`);
  assert.equal(aliceDelete.status, 403);
  assert.equal(aliceDelete.json.error.code, "read_only");

  const adminState = await admin.get("/api/state");
  const adminView = adminState.json.packages.find((item) => item.slug === "cli-imported");
  assert.equal(adminView.canEdit, true, "an administrator can clean up unowned items");

  const adminDelete = await admin.delete(`/api/packages?id=${encodeURIComponent(adminView.id)}`);
  assert.equal(adminDelete.status, 200);
});

test("profile ownership is enforced on save, rename and delete", async (t) => {
  const { alice, bob, temp } = await withTwoMembers(t);

  const wordpressZip = await makeWordPressZip(temp, { version: "7.1" });
  const coreUpload = await uploadPackage(alice.client, wordpressZip, "wordpress-7.1.zip");
  assert.equal(coreUpload.status, 200, "the profile needs a WordPress core package in the shared library");
  const pluginZip = await makePluginZip(temp, { slug: "alpha", name: "Alpha", version: "1.0.0" });
  await uploadPackage(alice.client, pluginZip, "alpha.zip");

  const created = await alice.client.post("/api/profiles", {
    json: {
      name: "alice-profile",
      locale: "en_US",
      wordpressVersion: "7.1",
      pluginVersions: { alpha: "1.0.0" }
    }
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.file, "alice-profile.json");

  const aliceState = await alice.client.get("/api/state");
  const aliceProfile = aliceState.json.profiles.find((profile) => profile.file === "alice-profile.json");
  assert.equal(aliceProfile.ownedByCurrentUser, true);

  const bobState = await bob.client.get("/api/state");
  const bobProfile = bobState.json.profiles.find((profile) => profile.file === "alice-profile.json");
  assert.ok(bobProfile, "profiles are shared read-only");
  assert.equal(bobProfile.canEdit, false);
  assert.equal(bobProfile.ownerName, "alice");

  // Bob can read and check compatibility, and can build from it.
  const read = await bob.client.get("/api/profiles/alice-profile.json");
  assert.equal(read.status, 200);
  assert.equal(read.json.profile.name, "alice-profile");
  assert.equal((await bob.client.get("/api/profiles/alice-profile.json/compatibility")).status, 200);

  // Bob cannot delete or overwrite it.
  const bobDelete = await bob.client.delete("/api/profiles/alice-profile.json");
  assert.equal(bobDelete.status, 403);
  assert.equal(bobDelete.json.error.code, "read_only");

  const bobOverwrite = await bob.client.post("/api/profiles", {
    json: { name: "alice-profile", locale: "en_US", wordpressVersion: "7.1", pluginVersions: { alpha: "1.0.0" } }
  });
  assert.equal(bobOverwrite.status, 403);

  // Bob can still create his own profile.
  const bobOwn = await bob.client.post("/api/profiles", {
    json: { name: "bob-profile", locale: "en_US", wordpressVersion: "7.1", pluginVersions: { alpha: "1.0.0" } }
  });
  assert.equal(bobOwn.status, 200);

  const aliceDelete = await alice.client.delete("/api/profiles/alice-profile.json");
  assert.equal(aliceDelete.status, 200);
});

test("profile rename is refused when the source belongs to another account", async (t) => {
  const { alice, bob, temp } = await withTwoMembers(t);

  const wordpressZip = await makeWordPressZip(temp, { version: "7.1" });
  assert.equal((await uploadPackage(alice.client, wordpressZip, "wordpress-7.1.zip")).status, 200);
  const pluginZip = await makePluginZip(temp, { slug: "beta", name: "Beta", version: "1.0.0" });
  await uploadPackage(alice.client, pluginZip, "beta.zip");
  const created = await alice.client.post("/api/profiles", {
    json: { name: "source-profile", locale: "en_US", wordpressVersion: "7.1", pluginVersions: { beta: "1.0.0" } }
  });
  assert.equal(created.status, 200);

  const rename = await bob.client.post("/api/profiles", {
    json: {
      name: "renamed-by-bob",
      sourceFile: "source-profile.json",
      locale: "en_US",
      wordpressVersion: "7.1",
      pluginVersions: { beta: "1.0.0" }
    }
  });
  assert.equal(rename.status, 403);
  assert.equal(rename.json.error.code, "read_only");
});

test("snapshot ownership is enforced while snapshots stay shared read-only", async (t) => {
  const { alice, bob, temp } = await withTwoMembers(t);

  const snapshotZip = await makeSnapshotZip(temp, { label: "alice" });
  const body = await readUpload(snapshotZip);
  const uploaded = await alice.client.post("/api/configs?filename=snapshot.zip", {
    body,
    contentType: "application/octet-stream"
  });

  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.json.added, true);
  const snapshotId = uploaded.json.record.id;

  // Comparing a snapshot with itself is refused by design, so a second one is
  // needed to exercise the shared read-only comparison path.
  const otherZip = await makeSnapshotZip(temp, { label: "other", generatedAt: "2026-08-25T05:01:24+00:00" });
  const otherUpload = await alice.client.post("/api/configs?filename=other.zip", {
    body: await readUpload(otherZip),
    contentType: "application/octet-stream"
  });
  assert.equal(otherUpload.status, 200);
  const otherId = otherUpload.json.record.id;
  assert.notEqual(otherId, snapshotId);

  const bobState = await bob.client.get("/api/state");
  const bobView = bobState.json.configs.find((item) => item.id === snapshotId);
  assert.ok(bobView, "snapshots are shared with every signed-in account");
  assert.equal(bobView.canEdit, false);
  assert.equal(bobView.ownerName, "alice");

  // Bob may inspect and compare, but not delete.
  assert.equal((await bob.client.get(`/api/configs/${snapshotId}/check`)).status, 200);
  assert.equal((await bob.client.get(`/api/configs/${snapshotId}/inspect`)).status, 200);
  assert.equal((await bob.client.get(`/api/configs/compare?left=${snapshotId}&right=${otherId}`)).status, 200);

  const bobDelete = await bob.client.delete(`/api/configs/${snapshotId}`);
  assert.equal(bobDelete.status, 403);

  const aliceDelete = await alice.client.delete(`/api/configs/${snapshotId}`);
  assert.equal(aliceDelete.status, 200);
});

test("design-system resource ownership is enforced on save and delete", async (t) => {
  const { alice, bob } = await withTwoMembers(t);

  const created = await alice.client.post("/api/vnext/colors", {
    json: {
      name: "Alice Palette",
      elementor: { primary: "#123456", secondary: "#234567", text: "#111111", accent: "#345678" }
    }
  });
  assert.equal(created.status, 200);
  const id = created.json.id;
  assert.ok(id, "the saved resource returns an id");

  const bobState = await bob.client.get("/api/state");
  const bobView = bobState.json.vnext.colors.find((item) => item.id === id);
  assert.ok(bobView, "design-system resources are shared read-only");
  assert.equal(bobView.canEdit, false);

  const bobDelete = await bob.client.delete(`/api/vnext/colors/${id}`);
  assert.equal(bobDelete.status, 403);
  assert.equal(bobDelete.json.error.code, "read_only");

  const bobOverwrite = await bob.client.post("/api/vnext/colors", {
    json: {
      id,
      name: "Hijacked Palette",
      elementor: { primary: "#000000", secondary: "#000000", text: "#000000", accent: "#000000" }
    }
  });
  assert.equal(bobOverwrite.status, 403);

  const aliceDelete = await alice.client.delete(`/api/vnext/colors/${id}`);
  assert.equal(aliceDelete.status, 200);
});

test("portable template ownership is enforced", async (t) => {
  const { alice, bob } = await withTwoMembers(t);

  const created = await alice.client.post("/api/vnext/templates", {
    json: {
      schemaVersion: 1,
      id: "alice-template",
      name: "Alice Template",
      provider: "elementor",
      type: "section",
      document: { content: [], settings: {} }
    }
  });
  assert.equal(created.status, 200);
  const id = created.json.id;

  const bobState = await bob.client.get("/api/state");
  const bobView = bobState.json.vnext.templates.find((item) => item.id === id);
  assert.ok(bobView);
  assert.equal(bobView.canEdit, false);

  const bobDelete = await bob.client.delete(`/api/vnext/templates/${id}`);
  assert.equal(bobDelete.status, 403);

  assert.equal((await alice.client.delete(`/api/vnext/templates/${id}`)).status, 200);
});

test("sample content ownership is enforced, but duplicating is allowed", async (t) => {
  const { alice, bob } = await withTwoMembers(t);

  const created = await alice.client.post("/api/sample-content", {
    json: {
      kind: "post",
      title: "Alice Sample",
      slug: "alice-sample",
      status: "draft",
      blocks: []
    }
  });
  assert.equal(created.status, 200);
  const id = created.json.id;

  const bobState = await bob.client.get("/api/state");
  const bobView = bobState.json.sampleContent.content.find((item) => item.id === id);
  assert.ok(bobView, "sample content is shared read-only");
  assert.equal(bobView.canEdit, false);
  assert.equal(bobView.ownerName, "alice");

  const bobDelete = await bob.client.delete(`/api/sample-content/${id}`);
  assert.equal(bobDelete.status, 403);

  const bobOverwrite = await bob.client.put(`/api/sample-content/${id}`, {
    json: { title: "Hijacked Sample", slug: "hijacked", blocks: [] }
  });
  assert.equal(bobOverwrite.status, 403);

  // Duplicating creates a new sample owned by Bob, so it is allowed.
  const duplicate = await bob.client.post(`/api/sample-content/${id}/duplicate`);
  assert.equal(duplicate.status, 200);
  assert.notEqual(duplicate.json.id, id);

  const bobAfter = await bob.client.get("/api/state");
  const copy = bobAfter.json.sampleContent.content.find((item) => item.id === duplicate.json.id);
  assert.ok(copy);
  assert.equal(copy.ownedByCurrentUser, true, "the duplicate belongs to the account that made it");

  assert.equal((await alice.client.delete(`/api/sample-content/${id}`)).status, 200);
});

test("reports storage usage and enforces the per-account quota", async (t) => {
  const server = await startTestServer();
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-quota-"));
  t.after(async () => {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  });

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const alice = await createUserSession(admin, server.url, {
    email: "quota@example.test",
    password: PASSWORD,
    role: "member"
  });

  const initial = await alice.client.get("/api/auth/quota");
  assert.equal(initial.status, 200);
  assert.equal(initial.json.usedBytes, 0);
  assert.equal(initial.json.remainingBytes, initial.json.limitBytes);

  const pluginZip = await makePluginZip(temp, { slug: "quota-plugin", name: "Quota Plugin", version: "1.0.0" });
  const uploaded = await uploadPackage(alice.client, pluginZip, "quota-plugin.zip");
  assert.equal(uploaded.status, 200);

  const after = await alice.client.get("/api/auth/quota");
  assert.ok(after.json.usedBytes > 0, "the upload counts against the quota");
  assert.equal(after.json.remainingBytes, after.json.limitBytes - after.json.usedBytes);
});

test("refuses an upload that would exceed the account quota", async (t) => {
  const server = await startTestServer({ accountQuotaBytes: 64 });
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-quota-full-"));
  t.after(async () => {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  });

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const alice = await createUserSession(admin, server.url, {
    email: "tiny-quota@example.test",
    password: PASSWORD,
    role: "member"
  });

  const pluginZip = await makePluginZip(temp, { slug: "too-big", name: "Too Big", version: "1.0.0" });
  const response = await uploadPackage(alice.client, pluginZip, "too-big.zip");

  assert.equal(response.status, 413);
  assert.equal(response.json.error.code, "quota_exceeded");

  // The rejected upload must not be left in the shared library.
  const state = await alice.client.get("/api/state");
  assert.equal(state.json.packages.some((item) => item.slug === "too-big"), false);
});

test("rejects requests that exceed the configured upload size", async (t) => {
  const server = await startTestServer({ maxUploadBytes: 16 });
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const response = await admin.post("/api/packages?filename=big.zip", {
    body: Buffer.alloc(64, 1),
    contentType: "application/octet-stream"
  });

  assert.equal(response.status, 413);
  assert.equal(response.json.error.code, "upload_too_large");
});

test("refuses writes and reports degraded health when the file store is nearly full", async (t) => {
  // A reserve larger than any real disk keeps the guard permanently tripped.
  const server = await startTestServer({ minimumFreeBytes: Number.MAX_SAFE_INTEGER });
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const health = await admin.get("/api/health");
  assert.equal(health.status, 503);
  assert.equal(health.json.status, "degraded");
  assert.equal(health.json.disk.ok, false);

  const blocked = await admin.post("/api/packages?filename=blocked.zip", {
    body: Buffer.alloc(8, 1),
    contentType: "application/octet-stream"
  });
  assert.equal(blocked.status, 507);
  assert.equal(blocked.json.error.code, "disk_full");

  const blockedBuild = await admin.post("/api/build-jobs", { json: { file: "anything.json" } });
  assert.equal(blockedBuild.status, 507);
  assert.equal(blockedBuild.json.error.code, "disk_full");
});

test("requires the CSRF token for destructive library requests", async (t) => {
  const { alice, temp } = await withTwoMembers(t);

  const pluginZip = await makePluginZip(temp, { slug: "csrf-target", name: "CSRF Target", version: "1.0.0" });
  const uploaded = await uploadPackage(alice.client, pluginZip, "csrf-target.zip");
  assert.equal(uploaded.status, 200);
  const id = uploaded.json.item.id;

  const withoutToken = await alice.client.delete(`/api/packages?id=${encodeURIComponent(id)}`, { csrf: false });
  assert.equal(withoutToken.status, 403);
  assert.equal(withoutToken.json.error.code, "csrf_failed");

  // Still there, and the owner can remove it with the token.
  const stillThere = await alice.client.get("/api/state");
  assert.equal(stillThere.json.packages.some((item) => item.slug === "csrf-target"), true);
  assert.equal((await alice.client.delete(`/api/packages?id=${encodeURIComponent(id)}`)).status, 200);
});

test("does not expose internal file paths to clients", async (t) => {
  const { alice, temp } = await withTwoMembers(t);

  const pluginZip = await makePluginZip(temp, { slug: "path-check", name: "Path Check", version: "1.0.0" });
  const uploaded = await uploadPackage(alice.client, pluginZip, "path-check.zip");
  assert.equal(uploaded.status, 200);

  assert.equal(uploaded.json.item.filePath, undefined, "the library path is stripped from the response");
  assert.equal(uploaded.json.record.zip, undefined, "the registry record does not leak the library-relative path");

  const state = await alice.client.get("/api/state");
  const view = state.json.packages.find((item) => item.slug === "path-check");
  assert.equal(view.filePath, undefined);
  assert.equal(JSON.stringify(state.json).includes("filePath"), false);
});
