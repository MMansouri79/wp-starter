import { appendSetCookie, clearCookie, parseCookies, serializeCookie } from "../http/cookies.js";
import { badRequest } from "../errors.js";
import { requireCsrf, requireUser } from "./guards.js";
import { readJsonBody } from "../http/body.js";
import { sendJson } from "../http/response.js";
import { SESSION_COOKIE } from "../auth/service.js";
import { publicUser } from "../repositories/users.js";
import type { Router, RequestContext } from "../http/router.js";
import type { AppContext } from "../app-context.js";

export const CSRF_COOKIE = "wp_starter_csrf";

/**
 * Records where a session was created for the audit trail. `X-Forwarded-For` is
 * client-controlled, so it is only believed when the deployment declares a
 * trusted reverse proxy.
 */
function sessionMeta(context: RequestContext, trustProxy: boolean) {
  const forwarded = context.req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const direct = context.req.socket.remoteAddress;
  return {
    userAgent: String(context.req.headers["user-agent"] ?? ""),
    ipAddress: String((trustProxy ? forwardedValue : undefined) ?? direct ?? "").split(",")[0].trim()
  };
}

export function sessionPayload(context: RequestContext, isAdmin: boolean) {
  if (!context.auth) return { authenticated: false as const, isAdmin: false, user: null, csrfToken: null };
  return {
    authenticated: true as const,
    isAdmin,
    user: publicUser(context.auth.user),
    csrfToken: context.auth.session.csrfToken,
    expiresAt: context.auth.session.expiresAt
  };
}

export function registerAuthRoutes(router: Router, app: AppContext): void {
  const { config, auth, log } = app;

  const setSessionCookies = (context: RequestContext, token: string, csrfToken: string, maxAgeSeconds: number) => {
    appendSetCookie(
      context.res,
      serializeCookie(SESSION_COOKIE, token, {
        maxAgeSeconds,
        secure: config.secureCookies,
        sameSite: "Strict"
      })
    );
    // Readable by the client so it can echo the value in X-CSRF-Token; it is
    // bound to the session row, so a forged cookie alone is useless.
    appendSetCookie(
      context.res,
      serializeCookie(CSRF_COOKIE, csrfToken, {
        maxAgeSeconds,
        httpOnly: false,
        secure: config.secureCookies,
        sameSite: "Strict"
      })
    );
  };

  router.post("/api/auth/login", async (context) => {
    const body = await context.readJson();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !password) throw badRequest("invalid_request", "Email and password are required.");

    const result = await auth.login(email, password, sessionMeta(context, config.trustProxy));
    setSessionCookies(context, result.token, result.session.csrfToken, config.sessionTtlHours * 3600);
    log.info(`Signed in ${result.user.email} (${result.user.role}).`);
    sendJson(context.res, 200, sessionPayload({ ...context, auth: { user: result.user, session: result.session } }, result.user.role === "admin"));
  });

  router.post("/api/auth/register", async (context) => {
    const body = await context.readJson();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !password) throw badRequest("invalid_request", "Email and password are required.");

    const result = await auth.register({
      email,
      password,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : undefined,
      meta: sessionMeta(context, config.trustProxy)
    });

    setSessionCookies(context, result.token, result.session.csrfToken, config.sessionTtlHours * 3600);
    log.info(`Registered ${result.user.email} (${result.user.role}).`);
    sendJson(context.res, 200, sessionPayload({ ...context, auth: { user: result.user, session: result.session } }, result.user.role === "admin"));
  });

  router.get("/api/auth/session", async (context) => {
    sendJson(context.res, 200, sessionPayload(context, context.auth?.user.role === "admin"));
  });

  router.post("/api/auth/logout", async (context) => {
    requireCsrf(context);
    const token = parseCookies(context.req.headers.cookie)[SESSION_COOKIE] ?? null;
    await auth.logout(token);
    appendSetCookie(context.res, clearCookie(SESSION_COOKIE, { secure: config.secureCookies, sameSite: "Strict" }));
    appendSetCookie(
      context.res,
      clearCookie(CSRF_COOKIE, { httpOnly: false, secure: config.secureCookies, sameSite: "Strict" })
    );
    sendJson(context.res, 200, { authenticated: false, isAdmin: false, user: null, csrfToken: null });
  });

  router.post("/api/auth/password", async (context) => {
    requireCsrf(context);
    const user = requireUser(context);
    const body = await context.readJson();
    await auth.changePassword(user.id, String(body.currentPassword ?? ""), String(body.newPassword ?? ""));
    await auth.sessionRepository.removeForUser(user.id);
    appendSetCookie(context.res, clearCookie(SESSION_COOKIE, { secure: config.secureCookies, sameSite: "Strict" }));
    sendJson(context.res, 200, { updated: true, signedOut: true });
  });

  router.get("/api/auth/quota", async (context) => {
    const user = requireUser(context);
    sendJson(context.res, 200, await app.quota.usage(user.id));
  });

  router.get("/api/health", async (context) => {
    let database = "ok";
    try {
      await app.db.get("SELECT 1 AS ok");
    } catch {
      database = "unavailable";
    }

    // Disk pressure is reported here so monitoring can alert before writes fail.
    const disk = await app.disk.status();
    const healthy = database === "ok" && disk.ok;

    sendJson(context.res, healthy ? 200 : 503, {
      status: healthy ? "ok" : "degraded",
      version: app.version,
      database,
      dialect: app.db.dialect,
      library: app.library.root,
      disk: { freeBytes: disk.freeBytes, usedPercent: disk.usedPercent, ok: disk.ok }
    });
  });
}

export async function readBody(context: RequestContext, maxBytes: number): Promise<Record<string, unknown>> {
  return readJsonBody(context.req, maxBytes);
}
