import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresDatabase } from "../dist/db/postgres.js";
import { migrate } from "../dist/db/migrations.js";
import { AuthService } from "../dist/auth/service.js";
import { LoginRateLimiter } from "../dist/auth/rate-limit.js";

const url = process.env.WP_STARTER_TEST_PG_URL;
test("PostgreSQL migrations, isolated rollback and concurrent invite redemption", { skip: !url && "Set WP_STARTER_TEST_PG_URL to run PostgreSQL integration" }, async () => {
  const pool = new Pool({ connectionString: url });
  const schema = `wp_test_${randomUUID().replaceAll("-", "")}`;
  let db;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    const isolated = new URL(url);
    isolated.searchParams.set("options", `-csearch_path=${schema}`);
    db = await PostgresDatabase.connect({ connectionString: isolated.toString(), ssl: false });
    await migrate(db);
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
    const admin = await auth.ensureBootstrapAdmin({ email: "admin@example.test", password: "admin-password-123" });
    const invite = await auth.createInvite({ role: "client" }, admin.id);
    const results = await Promise.allSettled(["one", "two"].map((name) => auth.register({ email: `${name}@example.test`,
      password: "member-password-123", inviteCode: invite.code, meta: { ipAddress: name, userAgent: "test" } })));
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
    assert.equal(results.find((row) => row.status === "rejected").reason.code, "invite_used");
    assert.equal((await auth.listUsers()).length, 2);
  } finally {
    if (db) await db.close();
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
