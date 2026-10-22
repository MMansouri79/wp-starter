import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractZip } from "../../../packages/builder-core/dist/index.js";
import { ADMIN, createClient, repoRoot, startTestServer } from "./harness.mjs";

test("public exporter download is installable while team content remains private", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  const endpoint = `${server.url}/downloads/wp-starter-exporter.zip`;
  const response = await fetch(endpoint, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="wp-starter-exporter.zip"/);
  assert.equal(response.headers.get("set-cookie"), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, await readFile(path.join(repoRoot, "apps/server/client/downloads/wp-starter-exporter.zip")));
  const temp = await mkdtemp(path.join(os.tmpdir(), "exporter-download-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await writeFile(path.join(temp, "plugin.zip"), bytes);
  await extractZip(path.join(temp, "plugin.zip"), path.join(temp, "plugin"));
  assert.deepEqual(await readFile(path.join(temp, "plugin/wp-starter-exporter/starter-exporter.php")),
    await readFile(path.join(repoRoot, "wordpress/exporter/starter-exporter.php")));
  assert.equal((await fetch(endpoint, { method: "HEAD" })).headers.get("content-length"), String(bytes.length));
  const refused = await fetch(endpoint, { method: "POST" });
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.get("allow"), "GET, HEAD");
  assert.equal((await fetch(`${server.url}/downloads/other.zip`, { redirect: "manual" })).status, 302);
  assert.equal((await fetch(`${server.url}/api/teams/${server.teamId}/state`)).status, 401);
  const login = await (await fetch(`${server.url}/login.html`)).text();
  assert.match(login, /href="\/downloads\/wp-starter-exporter.zip"/);
  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);
  assert.equal((await client.get("/downloads/wp-starter-exporter.zip")).status, 200);
});

test("missing exporter returns a public 404 without exposing disk paths", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());
  server.platform.config.clientDir = server.dataDir;
  const response = await fetch(`${server.url}/downloads/wp-starter-exporter.zip`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "exporter_not_found");
  assert.equal(JSON.stringify(body).includes(server.dataDir), false);
});
