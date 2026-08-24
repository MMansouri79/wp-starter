import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("GUI serves the workspace and local API", async () => {
  const library = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-test-"));
  const previous = process.env.WP_STARTER_HOME;
  process.env.WP_STARTER_HOME = library;
  const { createGuiServer } = await import(`../index.mjs?test=${Date.now()}`);
  const server = createGuiServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${address.port}`;
    const stateResponse = await fetch(`${base}/api/state`);
    assert.equal(stateResponse.status, 200);
    const state = await stateResponse.json();
    assert.equal(state.packages.length, 0);
    assert.equal(state.configs.length, 0);
    assert.equal(path.resolve(state.library), path.resolve(library));

    const htmlResponse = await fetch(`${base}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /WP Starter Builder/);
    assert.match(html, /Package Library/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.WP_STARTER_HOME;
    else process.env.WP_STARTER_HOME = previous;
    await rm(library, { recursive: true, force: true });
  }
});
