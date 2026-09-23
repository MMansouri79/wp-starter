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
  makeWordPressZip,
  readUpload,
  startTestServer
} from "./harness.mjs";

const PASSWORD = "member-password-123";
const PROFILE_FILE = "server-build.json";

/** Boots a server with an admin plus one member and a scratch fixture dir. */
async function withMember(t) {
  const server = await startTestServer();
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-builds-"));

  t.after(async () => {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  });

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const alice = await createUserSession(admin, server.url, {
    email: "builder@example.test",
    password: PASSWORD,
    role: "member"
  });

  return { server, temp, admin, alice };
}

async function uploadPackage(client, zipFile, filename) {
  return client.post(`/api/packages?filename=${encodeURIComponent(filename)}`, {
    body: await readUpload(zipFile),
    contentType: "application/octet-stream"
  });
}

/** A package-only profile is enough for a real build: no snapshot is involved. */
async function createBuildProfile(client, temp) {
  const wordpress = await uploadPackage(client, await makeWordPressZip(temp, { version: "7.1" }), "wordpress-7.1.zip");
  assert.equal(wordpress.status, 200);
  const plugin = await uploadPackage(
    client,
    await makePluginZip(temp, { slug: "alpha", name: "Alpha", version: "1.0.0" }),
    "alpha.zip"
  );
  assert.equal(plugin.status, 200);

  const created = await client.post("/api/profiles", {
    json: {
      name: "server-build",
      locale: "en_US",
      wordpressVersion: "7.1",
      wordpressVariant: "en_US",
      pluginVersions: { alpha: "1.0.0" }
    }
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.file, PROFILE_FILE);
}

/** Polls the job until it leaves the queue, mirroring what the web client does. */
async function waitForBuild(client, id, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let view = null;

  while (Date.now() < deadline) {
    const response = await client.get(`/api/build-jobs/${id}`);
    assert.equal(response.status, 200);
    view = response.json;
    if (view.status !== "queued" && view.status !== "running") return view;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  assert.fail(`Build ${id} did not finish within ${timeoutMs}ms (last status ${view?.status}).`);
}

test("queues a build asynchronously and stores a downloadable artifact", async (t) => {
  const { alice, temp } = await withMember(t);
  await createBuildProfile(alice.client, temp);

  const queued = await alice.client.post("/api/build-jobs", { json: { file: PROFILE_FILE } });
  assert.equal(queued.status, 202, "the request returns immediately with a job id");
  assert.ok(queued.json.id);
  assert.equal(queued.json.status, "queued");

  const finished = await waitForBuild(alice.client, queued.json.id);
  assert.equal(finished.status, "complete", `build failed: ${finished.error?.message ?? "unknown error"}`);
  assert.equal(finished.percent, 100);
  assert.ok(finished.result?.file.endsWith(".zip"), "the job reports the artifact file");
  assert.ok(finished.result?.sha256, "the artifact is checksummed");
  assert.equal(finished.result.downloadUrl, `/api/builds/${queued.json.id}/download`);

  const download = await alice.client.get(finished.result.downloadUrl);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.ok(download.text.length > 0);

  const listed = await alice.client.get("/api/build-jobs");
  assert.equal(listed.status, 200);
  const entry = listed.json.find((build) => build.id === queued.json.id);
  assert.ok(entry, "finished builds are part of the shared history");
  assert.equal(entry.status, "complete");
  assert.equal(entry.profileFile, PROFILE_FILE);
});

test("build history is shared read-only across accounts", async (t) => {
  const { server, admin, alice, temp } = await withMember(t);
  await createBuildProfile(alice.client, temp);

  const queued = await alice.client.post("/api/build-jobs", { json: { file: PROFILE_FILE } });
  assert.equal(queued.status, 202);
  const finished = await waitForBuild(alice.client, queued.json.id);
  assert.equal(finished.status, "complete", `build failed: ${finished.error?.message ?? "unknown error"}`);

  const bob = await createUserSession(admin, server.url, {
    email: "reader@example.test",
    password: PASSWORD,
    role: "member"
  });

  const bobList = await bob.client.get("/api/build-jobs");
  const bobView = bobList.json.find((build) => build.id === queued.json.id);
  assert.ok(bobView, "other accounts see the shared build history");
  assert.equal(bobView.canEdit, false);

  // Bob may download the artifact, but only its owner may delete it.
  assert.equal((await bob.client.get(finished.result.downloadUrl)).status, 200);
  const bobDelete = await bob.client.delete(`/api/build-jobs/${queued.json.id}`);
  assert.equal(bobDelete.status, 403);
  assert.equal(bobDelete.json.error.code, "read_only");

  const aliceDelete = await alice.client.delete(`/api/build-jobs/${queued.json.id}`);
  assert.equal(aliceDelete.status, 200);
  assert.equal((await alice.client.get(finished.result.downloadUrl)).status, 404);
});

test("refuses a build job for a profile that is not in the shared library", async (t) => {
  const { alice } = await withMember(t);

  const missing = await alice.client.post("/api/build-jobs", { json: { file: "nope.json" } });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "profile_not_found");

  const unnamed = await alice.client.post("/api/build-jobs", { json: {} });
  assert.equal(unnamed.status, 400);
  assert.equal(unnamed.json.error.code, "invalid_request");
});
