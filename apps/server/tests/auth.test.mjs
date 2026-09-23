import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN, createClient, startTestServer } from "./harness.mjs";

test("reports health and database status", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  const response = await client.get("/api/health");

  assert.equal(response.status, 200);
  assert.equal(response.json.status, "ok");
  assert.equal(response.json.database, "ok");
  assert.equal(response.json.dialect, "sqlite");
});

test("signs in the bootstrap administrator and exposes the session", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  const session = await client.signIn(ADMIN.email, ADMIN.password);

  assert.equal(session.authenticated, true);
  assert.equal(session.isAdmin, true);
  assert.equal(session.user.email, ADMIN.email);
  assert.equal(session.user.role, "admin");
  assert.ok(session.csrfToken, "a CSRF token is issued with the session");
  assert.equal(client.cookie("wp_starter_session") !== null, true);

  const current = await client.get("/api/auth/session");
  assert.equal(current.status, 200);
  assert.equal(current.json.user.email, ADMIN.email);
  assert.equal(current.json.csrfToken, session.csrfToken);
});

test("rejects wrong credentials without revealing whether the account exists", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  const wrongPassword = await client.post("/api/auth/login", {
    json: { email: ADMIN.email, password: "definitely-not-the-password" }
  });
  const unknownAccount = await client.post("/api/auth/login", {
    json: { email: "nobody@example.test", password: "definitely-not-the-password" }
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownAccount.status, 401);
  assert.equal(wrongPassword.json.error.message, unknownAccount.json.error.message);
});

test("requires authentication for library endpoints", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  assert.equal((await anonymous.get("/api/state")).status, 401);
  assert.equal((await anonymous.get("/api/build-jobs")).status, 401);
  assert.equal((await anonymous.get("/api/admin/users")).status, 401);
});

test("redirects unauthenticated page requests to the login page", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  const root = await anonymous.get("/");
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login.html");

  const login = await anonymous.get("/login.html");
  assert.equal(login.status, 200);
  assert.match(login.text, /ws-auth-card/);
});

test("serves the Builder shell with the server overlay for signed-in users", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);

  const page = await client.get("/");
  assert.equal(page.status, 200);
  assert.match(page.text, /href="\/app\.css"/);
  assert.match(page.text, /src="\/shell\.js"/);
  assert.match(page.text, /src="\/app\.js"/);

  const overlay = await client.get("/shell.js");
  assert.equal(overlay.status, 200);
});

test("enforces the CSRF token on mutating requests", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);

  const withoutToken = await client.post("/api/admin/invites", {
    json: { role: "client" },
    csrf: false
  });
  assert.equal(withoutToken.status, 403);
  assert.equal(withoutToken.json.error.code, "csrf_failed");

  const withWrongToken = await client.post("/api/admin/invites", {
    json: { role: "client" },
    headers: { "x-csrf-token": "not-the-right-token" }
  });
  assert.equal(withWrongToken.status, 403);

  const withToken = await client.post("/api/admin/invites", { json: { role: "client" } });
  assert.equal(withToken.status, 201);
});

test("signs out and clears the session", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);

  const logout = await client.post("/api/auth/logout");
  assert.equal(logout.status, 200);
  assert.equal(logout.json.authenticated, false);
  assert.equal(client.cookie("wp_starter_session"), null);

  const after = await client.get("/api/auth/session");
  assert.equal(after.json.authenticated, false);
});

test("changes a password and invalidates existing sessions", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);

  const changed = await client.post("/api/auth/password", {
    json: { currentPassword: ADMIN.password, newPassword: "a-brand-new-password-456" }
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.signedOut, true);

  const afterChange = await client.get("/api/auth/session");
  assert.equal(afterChange.json.authenticated, false);

  const oldPassword = createClient(server.url);
  assert.equal((await oldPassword.post("/api/auth/login", { json: ADMIN })).status, 401);

  const newPassword = createClient(server.url);
  const signedIn = await newPassword.signIn(ADMIN.email, "a-brand-new-password-456");
  assert.equal(signedIn.authenticated, true);
});

test("rejects a password change when the current password is wrong", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const client = createClient(server.url);
  await client.signIn(ADMIN.email, ADMIN.password);

  const result = await client.post("/api/auth/password", {
    json: { currentPassword: "wrong-password", newPassword: "a-brand-new-password-456" }
  });
  assert.equal(result.status, 401);
});

test("refuses to start without a strong session secret", async (t) => {
  await assert.rejects(
    () => startTestServer({ sessionSecret: "too-short" }),
    /WP_STARTER_SESSION_SECRET must be set to at least 32 characters/
  );
});
