import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN, createClient, createInvite, createUserSession, startTestServer } from "./harness.mjs";

const CLIENT_PASSWORD = "client-password-123";

test("closes registration by default and requires an invite code", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  const result = await anonymous.post("/api/auth/register", {
    json: { email: "stranger@example.test", password: CLIENT_PASSWORD }
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.error.code, "invite_required");
});

test("lets an invited client register and sign in", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const { code } = await createInvite(admin, { role: "client" });
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const invited = createClient(server.url);
  const session = await invited.register("client@example.test", CLIENT_PASSWORD, code, "Invited Client");

  assert.equal(session.authenticated, true);
  assert.equal(session.user.role, "client");
  assert.equal(session.user.displayName, "Invited Client");
  assert.equal(session.isAdmin, false);
});

test("accepts an invite code regardless of case and surrounding whitespace", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { code } = await createInvite(admin, { role: "client" });

  const invited = createClient(server.url);
  const session = await invited.register("lowercase@example.test", CLIENT_PASSWORD, `  ${code.toLowerCase()}  `);
  assert.equal(session.authenticated, true);
});

test("refuses an invite code that was already used", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { code } = await createInvite(admin, { role: "client" });

  const first = createClient(server.url);
  await first.register("first@example.test", CLIENT_PASSWORD, code);

  const second = createClient(server.url);
  const reuse = await second.post("/api/auth/register", {
    json: { email: "second@example.test", password: CLIENT_PASSWORD, inviteCode: code }
  });

  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error.code, "invite_used");
});

test("refuses an unknown invite code", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  const result = await anonymous.post("/api/auth/register", {
    json: { email: "nobody@example.test", password: CLIENT_PASSWORD, inviteCode: "AAAA-BBBB-CCCC" }
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.error.code, "invite_invalid");
});

test("refuses an expired invite code", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { code } = await createInvite(admin, { role: "client" });

  // Expire the invite directly, the way time would.
  await server.app.db.run("UPDATE invites SET expires_at = ?", ["2000-01-01T00:00:00.000Z"]);

  const anonymous = createClient(server.url);
  const result = await anonymous.post("/api/auth/register", {
    json: { email: "late@example.test", password: CLIENT_PASSWORD, inviteCode: code }
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.error.code, "invite_expired");
});

test("binds an invite to its reserved email address", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { code } = await createInvite(admin, { role: "client", email: "reserved@example.test" });

  const wrongPerson = createClient(server.url);
  const mismatch = await wrongPerson.post("/api/auth/register", {
    json: { email: "someone-else@example.test", password: CLIENT_PASSWORD, inviteCode: code }
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.json.error.code, "invite_email_mismatch");

  const rightPerson = createClient(server.url);
  const accepted = await rightPerson.register("reserved@example.test", CLIENT_PASSWORD, code);
  assert.equal(accepted.authenticated, true);
});

test("never returns the invite code after creation", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const created = await createInvite(admin, { role: "client" });

  const listed = await admin.get("/api/admin/invites");
  assert.equal(listed.status, 200);

  const stored = listed.json.invites.find((invite) => invite.id === created.invite.id);
  assert.ok(stored, "the invite is listed");
  assert.equal(stored.pending, true);
  assert.equal(stored.code, undefined, "the plaintext code is not persisted or re-served");
  assert.match(stored.codeHint, /^…[A-Z2-9]{4}$/);
  assert.equal(JSON.stringify(listed.json).includes(created.code), false, "the code never appears in the listing");
});

test("lets an administrator revoke a pending invite", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { invite, code } = await createInvite(admin, { role: "client" });

  const revoked = await admin.delete(`/api/admin/invites/${invite.id}`);
  assert.equal(revoked.status, 200);

  const anonymous = createClient(server.url);
  const result = await anonymous.post("/api/auth/register", {
    json: { email: "revoked@example.test", password: CLIENT_PASSWORD, inviteCode: code }
  });
  assert.equal(result.status, 400);
  assert.equal(result.json.error.code, "invite_invalid");
});

test("honours the role recorded on the invite, not the requested role", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { code } = await createInvite(admin, { role: "member" });

  const invited = createClient(server.url);
  const session = await invited.register("member@example.test", CLIENT_PASSWORD, code);

  assert.equal(session.user.role, "member");
  assert.equal(session.isAdmin, false);
});

test("allows registration without an invite only when explicitly enabled", async (t) => {
  const server = await startTestServer({ allowOpenRegistration: true });
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  const session = await anonymous.register("open@example.test", CLIENT_PASSWORD);

  assert.equal(session.authenticated, true);
  assert.equal(session.user.role, "client", "open registration still produces the least privileged role");
});

test("rejects weak passwords at registration", async (t) => {
  const server = await startTestServer({ allowOpenRegistration: true });
  t.after(() => server.stop());

  const anonymous = createClient(server.url);
  const result = await anonymous.post("/api/auth/register", {
    json: { email: "weak@example.test", password: "short" }
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.error.code, "weak_password");
});

test("does not let a non-administrator reach admin endpoints", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { client } = await createUserSession(admin, server.url, {
    email: "member@example.test",
    password: CLIENT_PASSWORD,
    role: "member"
  });

  for (const [method, path] of [
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/invites"],
    ["GET", "/api/admin/overview"]
  ]) {
    const result = await client.request(method, path);
    assert.equal(result.status, 403, `${method} ${path} must be forbidden for members`);
    assert.equal(result.json.error.code, "admin_required");
  }

  const createInviteAttempt = await client.post("/api/admin/invites", { json: { role: "client" } });
  assert.equal(createInviteAttempt.status, 403);

  const createUserAttempt = await client.post("/api/admin/users", {
    json: { email: "sneaky@example.test", password: CLIENT_PASSWORD, role: "admin" }
  });
  assert.equal(createUserAttempt.status, 403);
});

test("keeps at least one active administrator", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  const session = await admin.signIn(ADMIN.email, ADMIN.password);

  const demote = await admin.post(`/api/admin/users/${session.user.id}/role`, { json: { role: "member" } });
  assert.equal(demote.status, 400);
  assert.equal(demote.json.error.code, "cannot_demote_self");

  const disable = await admin.post(`/api/admin/users/${session.user.id}/status`, { json: { status: "disabled" } });
  assert.equal(disable.status, 400);
  assert.equal(disable.json.error.code, "cannot_disable_self");

  const remove = await admin.delete(`/api/admin/users/${session.user.id}`);
  assert.equal(remove.status, 400);
  assert.equal(remove.json.error.code, "cannot_remove_self");
});

test("protects the last administrator when another admin acts on them", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const first = createClient(server.url);
  const firstSession = await first.signIn(ADMIN.email, ADMIN.password);

  const second = createClient(server.url);
  await second.signIn(ADMIN.email, ADMIN.password);

  // A second admin account, created by the first.
  const created = await first.post("/api/admin/users", {
    json: { email: "second-admin@example.test", password: CLIENT_PASSWORD, role: "admin" }
  });
  assert.equal(created.status, 201);

  const secondAdmin = createClient(server.url);
  await secondAdmin.signIn("second-admin@example.test", CLIENT_PASSWORD);

  // Disabling the only *other* admin is allowed; disabling the last one is not.
  const disableFirst = await secondAdmin.post(`/api/admin/users/${firstSession.user.id}/status`, {
    json: { status: "disabled" }
  });
  assert.equal(disableFirst.status, 200);

  const secondSession = await secondAdmin.get("/api/auth/session");
  const selfDisable = await secondAdmin.post(`/api/admin/users/${secondSession.json.user.id}/status`, {
    json: { status: "disabled" }
  });
  assert.equal(selfDisable.status, 400);
  assert.equal(selfDisable.json.error.code, "cannot_disable_self");
});

test("refuses duplicate email addresses", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);

  const first = await admin.post("/api/admin/users", {
    json: { email: "duplicate@example.test", password: CLIENT_PASSWORD, role: "member" }
  });
  assert.equal(first.status, 201);

  const second = await admin.post("/api/admin/users", {
    json: { email: "DUPLICATE@example.test", password: CLIENT_PASSWORD, role: "member" }
  });
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "email_in_use");
});

test("disabling an account signs it out immediately", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { client, user } = await createUserSession(admin, server.url, {
    email: "disable-me@example.test",
    password: CLIENT_PASSWORD,
    role: "member"
  });

  assert.equal((await client.get("/api/auth/session")).json.authenticated, true);

  const disabled = await admin.post(`/api/admin/users/${user.id}/status`, { json: { status: "disabled" } });
  assert.equal(disabled.status, 200);

  assert.equal((await client.get("/api/auth/session")).json.authenticated, false);
  const login = await createClient(server.url).post("/api/auth/login", {
    json: { email: "disable-me@example.test", password: CLIENT_PASSWORD }
  });
  assert.equal(login.status, 403);
  assert.equal(login.json.error.code, "account_disabled");
});

test("resetting a password invalidates that account's sessions", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  const { client, user } = await createUserSession(admin, server.url, {
    email: "reset-me@example.test",
    password: CLIENT_PASSWORD,
    role: "member"
  });

  const reset = await admin.post(`/api/admin/users/${user.id}/password`, { json: { password: "a-reset-password-789" } });
  assert.equal(reset.status, 200);

  assert.equal((await client.get("/api/auth/session")).json.authenticated, false);

  const reLogin = createClient(server.url);
  const session = await reLogin.signIn("reset-me@example.test", "a-reset-password-789");
  assert.equal(session.authenticated, true);
});

test("reports account and invitation totals to administrators", async (t) => {
  const server = await startTestServer();
  t.after(() => server.stop());

  const admin = createClient(server.url);
  await admin.signIn(ADMIN.email, ADMIN.password);
  await createInvite(admin, { role: "client" });
  await createUserSession(admin, server.url, {
    email: "counted@example.test",
    password: CLIENT_PASSWORD,
    role: "member"
  });

  const overview = await admin.get("/api/admin/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.json.users, 2);
  assert.equal(overview.json.byRole.admin, 1);
  assert.equal(overview.json.byRole.member, 1);
  assert.equal(overview.json.byRole.client, 0);
  assert.equal(overview.json.pendingInvites, 1);
  assert.equal(overview.json.activeBuilds, 0);
});
