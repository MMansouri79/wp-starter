import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN, createClient, createUserSession, createInvite, startTestServer } from "./harness.mjs";
import { hashToken } from "../dist/auth/tokens.js";
const PASSWORD = "invited-password-123";
async function fixture(t, settings = {}) {
  const server = await startTestServer(settings); t.after(() => server.stop());
  const owner = createClient(server.url); await owner.signIn(ADMIN.email, ADMIN.password);
  return { server, owner, prefix: `/api/teams/${server.teamId}` };
}
test("registration stays closed even if legacy open registration was configured", async t => {
  const { server } = await fixture(t, { allowOpenRegistration: true });
  const result = await createClient(server.url).post("/api/auth/register", { json: { email: "open@example.test", password: PASSWORD } });
  assert.equal(result.status, 400); assert.equal(result.json.error.code, "invite_required");
});
test("new invitees get only the invited team role and never platform administration", async t => {
  const { server, owner } = await fixture(t);
  for (const role of ["owner", "admin", "editor", "viewer"]) {
    const email = `invited-${role}@example.test`;
    const created = await createInvite(owner, { email, role });
    const user = createClient(server.url);
    const result = await user.post("/api/auth/register", { json: { email: email.toUpperCase(), password: PASSWORD, inviteCode: created.token, role: "admin" } });
    assert.equal(result.status, 200, result.text); assert.equal(result.json.user.role, "member"); assert.equal(result.json.isAdmin, false);
    assert.equal(result.json.teams[0].role, role); assert.equal((await user.get("/api/admin/users")).status, 403);
  }
});
test("invitations require an email, expire in seven days and expose the token only once", async t => {
  const { server, owner, prefix } = await fixture(t);
  assert.equal((await owner.post(prefix + "/invites", { json: { role: "editor" } })).status, 400);
  const created = await createInvite(owner);
  assert.equal(Date.parse(created.invite.expiresAt) - Date.parse(created.invite.createdAt), 7 * 86400_000);
  assert.match(created.invitationUrl, /\/login\.html#invite=/);
  const listed = await owner.get(prefix + "/invites");
  assert.ok(listed.json.invites.some(invite => invite.id === created.invite.id));
  assert.equal(JSON.stringify(listed.json).includes(created.token), false);
  assert.equal(JSON.stringify(listed.json).includes(hashToken(created.token)), false);
  const stored = await server.app.db.get("SELECT token_hash FROM team_invites WHERE id = ?", [created.invite.id]);
  assert.equal(stored.token_hash, hashToken(created.token));
});
test("unknown, expired, revoked, used, wrong-case and wrong-email tokens cannot register", async t => {
  const { server, owner, prefix } = await fixture(t);
  const user = createClient(server.url);
  async function register(token, email = "client@example.test") { return user.post("/api/auth/register", { json: { email, password: PASSWORD, inviteCode: token } }); }
  const token = (await createInvite(owner)).token;
  for (const [candidate, email] of [["unknown", "client@example.test"], [token, "wrong@example.test"], [token.toUpperCase(), "client@example.test"]]) assert.equal((await register(candidate, email)).status, 400);
  const expired = await createInvite(owner);
  await server.app.db.run("UPDATE team_invites SET expires_at = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", expired.invite.id]);
  assert.equal((await register(expired.token)).status, 400);
  const revoked = await createInvite(owner);
  assert.equal((await owner.delete(prefix + "/invites/" + revoked.invite.id)).status, 200);
  assert.equal((await register(revoked.token)).status, 400);
  assert.equal((await register(token)).status, 200);
  assert.equal((await register(token)).status, 400);
});
test("existing users accept invitations with CSRF and concurrent acceptance succeeds only once", async t => {
  const { server, owner } = await fixture(t);
  const other = await owner.post("/api/admin/teams", { json: { name: "Another", ownerEmail: "existing@example.test" } });
  const created = await createUserSession(owner, server.url, { email: "existing@example.test", password: PASSWORD, role: "member" });
  const url = "/api/auth/team-invites/accept";
  assert.equal((await created.client.post(url, { json: { token: other.json.token }, csrf: false })).status, 403);
  const responses = await Promise.all([1, 2].map(() => created.client.post(url, { json: { token: other.json.token } })));
  assert.equal(responses.filter(result => result.status === 200).length, 1);
  assert.equal(responses.filter(result => result.status === 400).length, 1);
  assert.equal((await created.client.get("/api/auth/session")).json.teams.length, 2);
  const before = (await server.app.teams.forUser(created.user.id)).find(team => team.id === server.teamId).role;
  const invite = await createInvite(owner, { email: created.user.email, role: "owner" });
  assert.equal((await created.client.post(url, { json: { token: invite.token } })).status, 409, "An invite cannot silently change existing membership");
  assert.equal((await server.app.teams.forUser(created.user.id)).find(team => team.id === server.teamId).role, before);
});
test("concurrent new-account redemption is atomic and leaves no extra account", async t => {
  const { server, owner } = await fixture(t);
  const created = await createInvite(owner, { email: "race@example.test" });
  const attempts = await Promise.all([1, 2].map(() => createClient(server.url).post("/api/auth/register", { json: { email: "race@example.test", password: PASSWORD, inviteCode: created.token } })));
  assert.equal(attempts.filter(result => result.status === 200).length, 1);
  assert.equal((await server.app.auth.listUsers()).filter(user => user.email === "race@example.test").length, 1);
  assert.equal((await server.app.db.all("SELECT * FROM team_memberships WHERE team_id = ?", [server.teamId])).length, 2);
});
test("team admins cannot invite owners/admins and legacy invitations cannot grant access", async t => {
  const { server, owner, prefix } = await fixture(t);
  const adminInvite = await createInvite(owner, { email: "team-admin@example.test", role: "admin" });
  const admin = createClient(server.url); await admin.register("team-admin@example.test", PASSWORD, adminInvite.token);
  for (const role of ["owner", "admin"]) assert.equal((await admin.post(prefix + "/invites", { json: { email: "elevated@example.test", role } })).status, 403);
  assert.equal((await admin.post(prefix + "/invites", { json: { email: "view@example.test", role: "viewer" } })).status, 201);
  assert.equal((await owner.post("/api/admin/invites", { json: { email: "legacy@example.test", role: "admin" } })).status, 400);
  const legacy = await server.app.auth.createInvite({ email: "legacy@example.test", role: "admin" }, (await owner.get("/api/auth/session")).json.user.id);
  assert.equal((await createClient(server.url).post("/api/auth/register", { json: { email: "legacy@example.test", password: PASSWORD, inviteCode: legacy.code } })).status, 400);
});

test("reissuing an initial owner invite revokes its previous link and provisioning never bypasses membership", async t => {
  const { server, owner } = await fixture(t);
  const provisioned = await owner.post("/api/admin/teams", { json: { name: "Provisioning", ownerEmail: "first@example.test" } });
  const prefix = `/api/admin/teams/${provisioned.json.team.id}`;
  const reissued = await owner.post(prefix + "/owner-invite", { json: { email: "second@example.test" } }); assert.equal(reissued.status, 201);
  assert.equal((await createClient(server.url).post("/api/auth/register", { json: { email: "first@example.test", password: PASSWORD, inviteCode: provisioned.json.token } })).status, 400);
  const accepted = createClient(server.url); await accepted.register("second@example.test", PASSWORD, reissued.json.token);
  assert.equal((await owner.post(prefix + "/owner-invite", { json: { email: "third@example.test" } })).status, 403);
  assert.equal((await owner.get(`/api/teams/${provisioned.json.team.id}/state`)).status, 404);
});
