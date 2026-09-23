import { badRequest, notFound } from "../errors.js";
import { sendJson } from "../http/response.js";
import { requireAdmin, requireCsrf } from "./guards.js";
import { publicUser } from "../repositories/users.js";
import type { Invite, Role } from "../types.js";
import type { RequestContext, Router } from "../http/router.js";
import type { AppContext } from "../app-context.js";

const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "member", "client"];

function requireRole(value: unknown, fallback?: Role): Role {
  if (value === undefined || value === null || value === "") {
    if (fallback) return fallback;
    throw badRequest("invalid_role", `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  const role = String(value) as Role;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw badRequest("invalid_role", `Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }
  return role;
}

function inviteView(invite: Invite, names: Map<string, string>) {
  return {
    ...invite,
    createdByName: names.get(invite.createdBy) ?? "Unknown account",
    usedByName: invite.usedBy ? names.get(invite.usedBy) ?? "Unknown account" : null,
    expired: Date.parse(invite.expiresAt) <= Date.now(),
    pending: invite.usedAt === null && Date.parse(invite.expiresAt) > Date.now()
  };
}

/**
 * Administrator-only account and invitation management. Administrators manage
 * people; they gain no rights over items owned by another account.
 */
export function registerAdminRoutes(router: Router, app: AppContext): void {
  const { auth, log } = app;

  router.get("/api/admin/users", async (context) => {
    requireAdmin(context);
    sendJson(context.res, 200, { users: await auth.listUsers() });
  });

  router.post("/api/admin/users", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();

    const created = await auth.createUser(
      {
        email: String(body.email ?? "").trim(),
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
        role: requireRole(body.role, "member"),
        password: String(body.password ?? "")
      },
      actor.id
    );

    log.info(`${actor.email} created ${created.email} (${created.role}).`);
    sendJson(context.res, 201, { user: created });
  });

  router.post("/api/admin/users/:id/status", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();
    const status = String(body.status ?? "");
    if (status !== "active" && status !== "disabled") {
      throw badRequest("invalid_status", "Status must be active or disabled.");
    }

    const updated = await auth.setUserStatus(context.params.id, status, actor.id);
    log.info(`${actor.email} set ${updated.email} to ${status}.`);
    sendJson(context.res, 200, { user: updated });
  });

  router.post("/api/admin/users/:id/role", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();
    const updated = await auth.setUserRole(context.params.id, requireRole(body.role), actor.id);
    log.info(`${actor.email} set ${updated.email} to role ${updated.role}.`);
    sendJson(context.res, 200, { user: updated });
  });

  router.post("/api/admin/users/:id/password", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();
    await auth.resetUserPassword(context.params.id, String(body.password ?? ""));
    log.info(`${actor.email} reset the password for user ${context.params.id}.`);
    sendJson(context.res, 200, { updated: true });
  });

  router.delete("/api/admin/users/:id", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    await auth.removeUser(context.params.id, actor.id);
    log.info(`${actor.email} deleted user ${context.params.id}.`);
    sendJson(context.res, 200, { removed: context.params.id });
  });

  router.get("/api/admin/invites", async (context) => {
    requireAdmin(context);
    const names = await app.users.displayNames();
    const invites = await auth.listInvites();
    sendJson(context.res, 200, { invites: invites.map((invite) => inviteView(invite, names)) });
  });

  router.post("/api/admin/invites", async (context) => {
    requireCsrf(context);
    const actor = requireAdmin(context);
    const body = await context.readJson();
    const expiresInDays = body.expiresInDays === undefined ? undefined : Number(body.expiresInDays);
    if (expiresInDays !== undefined && !Number.isFinite(expiresInDays)) {
      throw badRequest("invalid_request", "expiresInDays must be a number.");
    }

    const { invite, code } = await auth.createInvite(
      {
        email: typeof body.email === "string" ? body.email : null,
        role: requireRole(body.role, "client"),
        expiresInDays
      },
      actor.id
    );

    log.info(`${actor.email} created an invite for role ${invite.role}.`);
    // The plaintext code is returned exactly once; only its digest is stored.
    sendJson(context.res, 201, { invite: inviteView(invite, await app.users.displayNames()), code });
  });

  router.delete("/api/admin/invites/:id", async (context) => {
    requireCsrf(context);
    requireAdmin(context);
    await auth.revokeInvite(context.params.id);
    sendJson(context.res, 200, { removed: context.params.id });
  });

  router.get("/api/admin/overview", async (context) => {
    requireAdmin(context);
    const [users, invites] = await Promise.all([auth.listUsers(), auth.listInvites()]);
    const byRole = { admin: 0, member: 0, client: 0 };
    for (const user of users) byRole[user.role] += 1;

    sendJson(context.res, 200, {
      users: users.length,
      byRole,
      active: users.filter((user) => user.status === "active").length,
      pendingInvites: invites.filter((invite) => invite.usedAt === null && Date.parse(invite.expiresAt) > Date.now()).length,
      activeBuilds: await app.buildItems.countActive(),
      accounts: users
    });
  });

  router.get("/api/admin/users/:id", async (context) => {
    requireAdmin(context);
    const user = await app.users.findById(context.params.id);
    if (!user) throw notFound("user_not_found", "That account no longer exists.");
    sendJson(context.res, 200, { user: publicUser(user) });
  });
}

export function describeActor(context: RequestContext): string {
  return context.auth?.user.email ?? "anonymous";
}
