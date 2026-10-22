import { badRequest } from "../errors.js";
import { sendJson } from "../http/response.js";
import { requireAdmin, requireCsrf, requireUser } from "./guards.js";
import { teamRole } from "../services/teams.js";
import type { AppContext } from "../app-context.js";
import type { Router } from "../http/router.js";

export function registerTeamRoutes(router: Router, app: AppContext): void {
  router.get("/api/teams", async context => sendJson(context.res, 200, { teams: await app.teams.forUser(requireUser(context).id) }));
  router.get("/api/admin/teams", async context => { requireAdmin(context); sendJson(context.res, 200, { teams: await app.teams.all() }); });
  router.post("/api/admin/teams", async context => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();
    if (typeof body.ownerEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.ownerEmail.trim())) throw badRequest("invalid_email", "A valid initial owner email is required.");
    const result = await app.db.transaction(async tx => {
      const { TeamService } = await import("../services/teams.js");
      const teams = new TeamService(tx, app.config.dataDir);
      const team = await teams.create(String(body.name ?? ""), actor.id);
      return { team, ...await teams.invite(team.id, body.ownerEmail as string, "owner", actor, true) };
    });
    await app.forTeam(result.team.id);
    sendJson(context.res, 201, { ...result, invitationUrl: `${app.config.baseUrl}/login.html#invite=${encodeURIComponent(result.token)}` });
  });
  router.post("/api/admin/teams/:teamId/status", async context => {
    requireCsrf(context); const actor = requireAdmin(context); const body = await context.readJson();
    await app.teams.setStatus(context.params.teamId, body.status, actor.id); sendJson(context.res, 200, { updated: true });
  });
  router.post("/api/admin/teams/:teamId/owner-invite", async context => {
    requireCsrf(context); const actor = requireAdmin(context); const body = await context.readJson();
    const result = await app.teams.invite(context.params.teamId, String(body.email ?? ""), "owner", actor, true);
    sendJson(context.res, 201, { ...result, invitationUrl: `${app.config.baseUrl}/login.html#invite=${encodeURIComponent(result.token)}` });
  });
  router.post("/api/auth/team-invites/accept", async context => {
    requireCsrf(context); const user = requireUser(context); const body = await context.readJson();
    sendJson(context.res, 200, { teamId: await app.teams.accept(String(body.token ?? ""), user) });
  });
  router.get("/api/teams/:teamId/members", async context => {
    await app.teams.requireAccess(context.params.teamId, requireUser(context));
    sendJson(context.res, 200, { members: await app.teams.members(context.params.teamId) });
  });
  router.put("/api/teams/:teamId/members/:userId", async context => {
    requireCsrf(context); const user = requireUser(context); const body = await context.readJson();
    await app.teams.changeMember(context.params.teamId, context.params.userId, teamRole(body.role), user); sendJson(context.res, 200, { updated: true });
  });
  router.delete("/api/teams/:teamId/members/:userId", async context => {
    requireCsrf(context); await app.teams.changeMember(context.params.teamId, context.params.userId, null, requireUser(context)); sendJson(context.res, 200, { removed: true });
  });
  router.get("/api/teams/:teamId/invites", async context => sendJson(context.res, 200, { invites: await app.teams.invites(context.params.teamId, requireUser(context)) }));
  router.post("/api/teams/:teamId/invites", async context => {
    requireCsrf(context); const actor = requireUser(context); const body = await context.readJson();
    const result = await app.teams.invite(context.params.teamId, String(body.email ?? ""), teamRole(body.role), actor);
    sendJson(context.res, 201, { ...result, invitationUrl: `${app.config.baseUrl}/login.html#invite=${encodeURIComponent(result.token)}` });
  });
  router.delete("/api/teams/:teamId/invites/:id", async context => {
    requireCsrf(context); await app.teams.revoke(context.params.teamId, context.params.id, requireUser(context)); sendJson(context.res, 200, { revoked: true });
  });
  router.get("/api/teams/:teamId/audit", async context => {
    await app.teams.requireManager(context.params.teamId, requireUser(context));
    sendJson(context.res, 200, { events: await app.db.all("SELECT id, actor_id AS \"actorId\", action, target, created_at AS \"createdAt\" FROM team_audit WHERE team_id = ? ORDER BY created_at DESC LIMIT 200", [context.params.teamId]) });
  });
}
