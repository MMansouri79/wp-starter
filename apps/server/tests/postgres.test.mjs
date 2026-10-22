import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { PostgresDatabase } from "../dist/db/postgres.js";
import { migrate, MIGRATIONS, LEGACY_TEAM_ID } from "../dist/db/migrations.js";
import { TeamService } from "../dist/services/teams.js";
import { ResourceRepository } from "../dist/repositories/resources.js";
import { BuildRepository } from "../dist/repositories/builds.js";
import { migrateTeamLibrary } from "../dist/services/team-migration.js";
import { AuthService } from "../dist/auth/service.js";
import { LoginRateLimiter } from "../dist/auth/rate-limit.js";

const url = process.env.WP_STARTER_TEST_PG_URL;
test("PostgreSQL migrations, isolated rollback and concurrent invite redemption", { skip: !url && "Set WP_STARTER_TEST_PG_URL to run PostgreSQL integration" }, async () => {
  const pool = new Pool({ connectionString: url });
  const schema = `wp_test_${randomUUID().replaceAll("-", "")}`;
  let db;
  const root = await mkdtemp(path.join(os.tmpdir(), "wp-pg-team-"));
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const isolated = new URL(url);
    isolated.searchParams.set("options", `-csearch_path=${schema}`);
    db = await PostgresDatabase.connect({ connectionString: isolated.toString(), ssl: false });
    await db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of MIGRATIONS.filter(row => row.version < 5)) {
      for (const sql of migration.statements) await db.run(sql);
      await db.run("INSERT INTO schema_migrations VALUES (?, ?, ?)", [migration.version, migration.name, new Date().toISOString()]);
    }
    const legacyAuth = new AuthService(db, { sessionTtlHours: 24, allowOpenRegistration: false, rateLimiter: new LoginRateLimiter({ maxAttempts: 10, lockoutSeconds: 900 }) });
    const legacyAdmin = await legacyAuth.ensureBootstrapAdmin({ email: "admin@example.test", password: "admin-password-123" });
    await mkdir(path.join(root, "builds")); await writeFile(path.join(root, "builds", "old.zip"), "synthetic legacy artifact");
    await migrateTeamLibrary(db, root, true);
    assert.equal((await db.all("SELECT version FROM schema_migrations")).length, 4);
    await migrateTeamLibrary(db, root);
    assert.equal(await readFile(path.join(root, "teams", LEGACY_TEAM_ID, "builds", "old.zip"), "utf8"), "synthetic legacy artifact");
    assert.equal((await db.get("SELECT state FROM team_migration")).state, "complete");
    await db.exec("CREATE TABLE transaction_probe (value TEXT)");
    let release; const gate = new Promise((resolve) => { release = resolve; });
    let started; const ready = new Promise((resolve) => { started = resolve; });
    const failed = db.transaction(async (tx) => {
      await tx.run("INSERT INTO transaction_probe VALUES (?)", ["rolled-back"]);
      started(); await gate; throw new Error("intentional rollback");
    });
    const rejected = assert.rejects(failed, /intentional rollback/);
    await ready;
    await db.run("INSERT INTO transaction_probe VALUES (?)", ["kept"]);
    await db.transaction(async (tx) => { await tx.run("INSERT INTO transaction_probe VALUES (?)", ["other-transaction"]); });
    release(); await rejected;
    assert.deepEqual((await db.all("SELECT value FROM transaction_probe ORDER BY value")).map((row) => row.value), ["kept", "other-transaction"]);
    const auth = new AuthService(db, { sessionTtlHours: 24, allowOpenRegistration: false,
      rateLimiter: new LoginRateLimiter({ maxAttempts: 10, lockoutSeconds: 900 }) });
    const admin = await auth.userRepository.findById(legacyAdmin.id);
    const teams = new TeamService(db, root);
    const invite = await teams.invite(LEGACY_TEAM_ID, "race@example.test", "editor", admin);
    const results = await Promise.allSettled(["one", "two"].map((name) => auth.register({ email: "race@example.test",
      password: "member-password-123", inviteCode: invite.token, meta: { ipAddress: name, userAgent: "test" } })));
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    assert.ok(["invite_invalid", "invite_used"].includes(results.find((row) => row.status === "rejected").reason.code));
    assert.equal((await auth.listUsers()).length, 2);
    const second = await teams.create("Second team", admin.id);
    for (const id of [LEGACY_TEAM_ID, second.id]) {
      await new ResourceRepository(db, "colors", id).save({ id: "same", name: id, sha256: "", document: { id: "same" }, createdBy: admin.id });
      await new BuildRepository(db, id).enqueue({ profileId: null, profileFile: "same.json", profileName: "Same", createdBy: admin.id });
    }
    assert.equal((await new ResourceRepository(db, "colors", LEGACY_TEAM_ID).findById("same")).name, LEGACY_TEAM_ID);
    assert.equal((await new ResourceRepository(db, "colors", second.id).findById("same")).name, second.id);
    assert.equal(await new BuildRepository(db).countActive(), 2);
    const claimed = await new BuildRepository(db).claimNext();
    assert.equal(claimed.teamId, LEGACY_TEAM_ID);
    assert.equal(await new BuildRepository(db, second.id).findById(claimed.id), null);
  } finally {
    if (db) await db.close();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
});
