import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { SqliteDatabase } from "../dist/db/sqlite.js";
import { MIGRATIONS, LEGACY_TEAM_ID, migrate } from "../dist/db/migrations.js";
import { migrateTeamLibrary } from "../dist/services/team-migration.js";
import { createApplication } from "../dist/app.js";
import { AuthService } from "../dist/auth/service.js";
import { LoginRateLimiter } from "../dist/auth/rate-limit.js";
import { ADMIN, makePluginZip } from "./harness.mjs";
import { PackageRegistry, sha256File } from "../../../packages/builder-core/dist/index.js";

async function legacy(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-team-migration-"));
  const file = path.join(root, "server.sqlite");
  const db = new SqliteDatabase(file);
  t.after(async () => { await db.close(); await rm(root, { recursive: true, force: true }); });
  await db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of MIGRATIONS.filter(m => m.version < 5)) {
    for (const sql of migration.statements) await db.run(sql);
    await db.run("INSERT INTO schema_migrations VALUES (?, ?, ?)", [migration.version, migration.name, new Date().toISOString()]);
  }
  const auth = new AuthService(db, { sessionTtlHours: 24, allowOpenRegistration: false, rateLimiter: new LoginRateLimiter({ maxAttempts: 10, lockoutSeconds: 60 }) });
  const admin = await auth.ensureBootstrapAdmin(ADMIN);
  const member = await auth.createUser({ email: "legacy-member@example.test", password: "legacy-password-123", role: "member" }, admin.id);
  await auth.login(ADMIN.email, ADMIN.password, { userAgent: "test", ipAddress: "127.0.0.1" });
  await auth.createInvite({ role: "admin" }, admin.id);
  const zip = await makePluginZip(root, { slug: "legacy", name: "Legacy", version: "1" });
  const { record } = await new PackageRegistry(root).add(zip);
  await db.run("INSERT INTO packages (id, kind, slug, version, variant, name, sha256, file_path, size_bytes, document_json, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["plugin-legacy-1", record.kind, record.slug, record.version, record.variant || "default", record.name, record.sha256, record.zip, 100, JSON.stringify(record), admin.id, new Date().toISOString()]);
  await mkdir(path.join(root, "builds")); await writeFile(path.join(root, "builds", "legacy.zip"), "legacy-build");
  await writeFile(path.join(root, "operator.local.json"), '{"keep":"operational"}');
  return { root, file, db, admin, member, record };
}
function config(root, file) { return { dataDir: root, database: { driver: "sqlite", file }, sessionSecret: "migration-session-secret-that-is-long-enough", bootstrapAdmin: null, logLevel: "quiet", skipSync: true }; }

test("migration dry run leaves schemas, sessions and files untouched", async t => {
  const { root, db, record } = await legacy(t);
  const report = await migrateTeamLibrary(db, root, true);
  assert.equal(report.rows.users, 2); assert.ok(report.files >= 3);
  assert.equal((await db.all("SELECT version FROM schema_migrations")).length, 4);
  assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM sessions")).total), 1);
  assert.equal(await sha256File(path.join(root, record.zip)), record.sha256);
  assert.equal((await readdir(root)).includes("team-migration.checkpoint.json"), false);
});

test("legacy rows/files migrate intact, invalidating old invitations and sessions", async t => {
  const { root, file, db, admin, member, record } = await legacy(t);
  await migrate(db);
  await assert.rejects(createApplication(config(root, file)), /migration is incomplete/);
  await migrateTeamLibrary(db, root);
  const target = path.join(root, "teams", LEGACY_TEAM_ID);
  assert.equal(await sha256File(path.join(target, record.zip)), record.sha256);
  assert.equal(await readFile(path.join(target, "builds", "legacy.zip"), "utf8"), "legacy-build");
  assert.equal(await readFile(path.join(root, "operator.local.json"), "utf8"), '{"keep":"operational"}');
  assert.equal((await db.get("SELECT * FROM packages")).id, "plugin-legacy-1");
  assert.equal((await db.get("SELECT * FROM packages")).uploaded_by, admin.id);
  assert.equal((await db.get("SELECT role FROM team_memberships WHERE user_id = ?", [admin.id])).role, "owner");
  assert.equal((await db.get("SELECT role FROM team_memberships WHERE user_id = ?", [member.id])).role, "editor");
  assert.equal((await db.all("SELECT * FROM invites")).length, 0); assert.equal((await db.all("SELECT * FROM sessions")).length, 0);
  await migrateTeamLibrary(db, root);
  const application = await createApplication(config(root, file));
  assert.equal((await application.app.forTeam(LEGACY_TEAM_ID)).library.root, target); await application.stop();
});

test("migration resumes a durable checkpoint after some files were already moved", async t => {
  const { root, db } = await legacy(t); await migrate(db);
  const checkpoint = { version: 1, teamId: LEGACY_TEAM_ID, files: [] };
  for (const relative of ["registry.json", "builds/legacy.zip"]) checkpoint.files.push({ relative, sha256: createHash("sha256").update(await readFile(path.join(root, relative))).digest("hex") });
  // Include the package directory inventory too, so restarting retains all payload bytes.
  const packageFile = (await db.get("SELECT file_path FROM packages")).file_path;
  for (const relative of [packageFile, path.join(path.dirname(packageFile), "package.json")]) checkpoint.files.push({ relative, sha256: await sha256File(path.join(root, relative)) });
  await writeFile(path.join(root, "team-migration.checkpoint.json.tmp"), JSON.stringify(checkpoint));
  const target = path.join(root, "teams", LEGACY_TEAM_ID); await mkdir(target, { recursive: true });
  await rename(path.join(root, "registry.json"), path.join(target, "registry.json"));
  await assert.rejects(createApplication(config(root, path.join(root, "server.sqlite"))), /migration is incomplete/);
  await migrateTeamLibrary(db, root);
  assert.equal((await db.get("SELECT state FROM team_migration")).state, "complete");
  for (const entry of checkpoint.files) assert.equal(await sha256File(path.join(target, entry.relative)), entry.sha256);
});

test("migration refuses changed files and unsafe checkpoint paths", async t => {
  const { root, db } = await legacy(t); await migrate(db);
  const checkpointFile = path.join(root, "team-migration.checkpoint.json");
  await writeFile(checkpointFile, JSON.stringify({ version: 1, teamId: LEGACY_TEAM_ID, files: [{ relative: "builds/legacy.zip", sha256: "wrong" }] }));
  await assert.rejects(migrateTeamLibrary(db, root), /missing or changed/);
  assert.equal((await db.get("SELECT state FROM team_migration")).state, "pending");
  await writeFile(checkpointFile, JSON.stringify({ version: 1, teamId: LEGACY_TEAM_ID, files: [{ relative: "../outside", sha256: "wrong" }] }));
  await assert.rejects(migrateTeamLibrary(db, root), /Unsafe migration checkpoint/);
});
