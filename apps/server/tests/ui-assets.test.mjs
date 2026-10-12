import assert from "node:assert/strict";
import test from "node:test";
import { startTestServer, createClient, ADMIN } from "./harness.mjs";

test("account pages receive shared UI assets without exposing authenticated workspace assets", async () => {
  const app = await startTestServer();
  try {
    for (const asset of ["/ui.js", "/design.css"]) {
      const response = await fetch(app.url + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    }
    const workspace = await fetch(app.url + "/workspace.js", { redirect:"manual" });
    assert.equal(workspace.status, 302);
    const login = await (await fetch(app.url + "/login")).text();
    assert.match(login, /src="\/ui.js"/);
    assert.match(login, /href="\/design.css"/);
    assert.match(login, /id="email"/);
    const client = createClient(app.url);
    await client.signIn(ADMIN.email, ADMIN.password);
    const shell = await client.get("/");
    assert.equal(shell.status, 200);
    assert.ok(shell.text.indexOf('href="/app.css"') < shell.text.indexOf('href="/design.css"'));
    assert.match(shell.text, /src="\/workspace.js"/);
    assert.match(shell.text, /src="\/shell.js"/);
    const admin = await client.get("/admin");
    assert.match(admin.text, /href="\/design.css"/);
  } finally { await app.stop(); }
});
