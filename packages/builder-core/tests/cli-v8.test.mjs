import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const run = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const cli = path.join(repoRoot, "apps", "cli", "dist", "index.js");

test("CLI adds, lists, and removes canonical design-system resources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-starter-cli-v8-"));
  try {
    const input = path.join(root, "typography.json");
    await writeFile(input, JSON.stringify({ schemaVersion: 1, id: "cli-type", name: "CLI Type", roles: { body: { fontRole: "primary", weight: 400, size: { desktop: "16px" } } } }));
    const added = await run(process.execPath, [cli, "resource", "typography", "add", input, "--library", root]);
    assert.match(added.stdout, /Saved typography resource: cli-type/);
    const listed = await run(process.execPath, [cli, "resource", "typography", "list", "--library", root]);
    const records = JSON.parse(listed.stdout);
    assert.deepEqual(records[0].roles.body.size.desktop, { value: 16, unit: "px" });
    const removed = await run(process.execPath, [cli, "resource", "typography", "remove", "cli-type", "--library", root]);
    assert.match(removed.stdout, /Removed typography resource: cli-type/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
