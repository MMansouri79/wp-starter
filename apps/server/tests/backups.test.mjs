import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./harness.mjs";

const execute = promisify(execFile);
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:/Program Files", "Git/usr/bin/bash.exe") : "/bin/bash";
const skip = process.platform === "darwin" || !existsSync(bash) ? "Requires Linux coreutils or Git Bash" : false;

test("coordinated backups restore library bytes and restart after dump failure", { skip }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-backup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "library");
  const backup = path.join(root, "backups");
  const bin = path.join(root, "bin");
  const restore = path.join(root, "restore");
  const trace = path.join(root, "service.log");
  await Promise.all([source, bin, restore].map((dir) => mkdir(dir)));
  await writeFile(path.join(source, "registry.json"), '{"test":"offline"}');
  await writeFile(path.join(source, "package.zip"), Buffer.from([0, 1, 2, 255]));
  for (const [file, installed] of [["backup-database.sh", "wp-starter-backup"], ["backup-file-store.sh", "wp-starter-backup-files"], ["backup-system.sh", "wp-starter-backup-system"]]) {
    await copyFile(path.join(repoRoot, "deploy/scripts", file), path.join(bin, installed));
  }
  await writeFile(path.join(bin, "systemctl"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$TRACE"\n');
  await writeFile(path.join(bin, "pg_dump"), '#!/usr/bin/env bash\nif [[ "${FAIL_DUMP:-0}" == 1 ]]; then exit 1; fi\necho "CREATE TABLE backup_test (value TEXT);"\n');
  const env = { ...process.env, WP_STARTER_DATA_DIR: source.replaceAll("\\", "/"), WP_STARTER_BACKUP_DIR: backup.replaceAll("\\", "/"),
    WP_STARTER_DATABASE_URL: "postgres://synthetic", TEST_BIN: bin.replaceAll("\\", "/"), RESTORE: restore.replaceAll("\\", "/"), TRACE: trace.replaceAll("\\", "/") };
  const setup = process.platform === "win32" ? 'export TEST_BIN="$(cygpath -u "$TEST_BIN")"; export WP_STARTER_DATA_DIR="$(cygpath -u "$WP_STARTER_DATA_DIR")"; export WP_STARTER_BACKUP_DIR="$(cygpath -u "$WP_STARTER_BACKUP_DIR")"; export RESTORE="$(cygpath -u "$RESTORE")"; export TRACE="$(cygpath -u "$TRACE")"; ' : "";
  const prefix = 'set -e; export PATH="/usr/bin:/bin:$PATH"; ' + setup + 'export PATH="$TEST_BIN:$PATH"; chmod +x "$TEST_BIN/"*; ';
  await execute(bash, ["-c", prefix + '"$TEST_BIN/wp-starter-backup-system"; archive=$(find "$WP_STARTER_BACKUP_DIR" -name "*.tar.gz"); tar -xzf "$archive" -C "$RESTORE"'], { env, cwd: repoRoot });
  assert.deepEqual(await readFile(path.join(restore, "package.zip")), await readFile(path.join(source, "package.zip")));
  assert.equal(await readFile(path.join(restore, "registry.json"), "utf8"), '{"test":"offline"}');
  const sets = await readdir(backup);
  assert.equal(sets.length, 1);
  assert.ok((await stat(path.join(backup, sets[0], "complete"))).isFile());
  await assert.rejects(execute(bash, ["-c", prefix + '"$TEST_BIN/wp-starter-backup-system"'], {
    env: { ...env, FAIL_DUMP: "1", WP_STARTER_BACKUP_DIR: path.join(root, "failed-backups").replaceAll("\\", "/") }, cwd: repoRoot
  }));
  const log = await readFile(trace, "utf8");
  assert.equal(log.split("\n").filter((line) => line === "start wp-starter-server").length, 2);
  const failedSets = await readdir(path.join(root, "failed-backups"));
  assert.equal(failedSets.length, 1);
  await assert.rejects(stat(path.join(root, "failed-backups", failedSets[0], "complete")), { code: "ENOENT" });
  assert.equal((await readdir(path.join(root, "failed-backups", failedSets[0]))).some((file) => file.endsWith(".partial")), false);
});

test("file backups reject a destination inside the shared library", { skip }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-backup-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const convert = process.platform === "win32" ? 'export WP_STARTER_DATA_DIR="$(cygpath -u "$WP_STARTER_DATA_DIR")"; export WP_STARTER_BACKUP_DIR="$(cygpath -u "$WP_STARTER_BACKUP_DIR")"; ' : "";
  await assert.rejects(execute(bash, ["-c", 'export PATH="/usr/bin:/bin:$PATH"; ' + convert + 'bash deploy/scripts/backup-file-store.sh'], { cwd: repoRoot, env: {
    ...process.env, WP_STARTER_DATA_DIR: root.replaceAll("\\", "/"), WP_STARTER_BACKUP_DIR: path.join(root, "nested").replaceAll("\\", "/")
  } }), (error) => /outside the shared library/.test(error.stderr));
});
