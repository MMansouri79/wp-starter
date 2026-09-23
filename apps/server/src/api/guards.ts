import { forbidden, unauthorized } from "../errors.js";
import { constantTimeEqual } from "../auth/tokens.js";
import type { RequestContext } from "../http/router.js";
import type { User } from "../types.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireUser(context: RequestContext): User {
  if (!context.auth) throw unauthorized();
  return context.auth.user;
}

export function requireAdmin(context: RequestContext): User {
  const user = requireUser(context);
  if (user.role !== "admin") throw forbidden("admin_required", "Administrator access is required.");
  return user;
}

/**
 * Session-bound CSRF token. The client reads it from `GET /api/auth/session`
 * and echoes it in `X-CSRF-Token`; the token is stored with the session row, so
 * a cross-site request cannot guess it.
 */
export function requireCsrf(context: RequestContext): void {
  if (SAFE_METHODS.has(context.req.method ?? "GET")) return;
  if (!context.auth) throw unauthorized();

  const supplied = String(context.req.headers["x-csrf-token"] ?? "");
  if (!supplied || !constantTimeEqual(supplied, context.auth.session.csrfToken)) {
    throw forbidden("csrf_failed", "The request could not be verified. Reload the page and try again.");
  }
}

export function queryString(context: RequestContext, name: string): string | null {
  const value = context.url.searchParams.get(name);
  return value === null || value === "" ? null : value;
}

export function bodyString(body: Record<string, unknown>, field: string, options: { required?: boolean; max?: number } = {}): string {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") {
    if (options.required) throw forbidden("invalid_request", `${field} is required.`);
    return "";
  }
  if (typeof raw !== "string") throw forbidden("invalid_request", `${field} must be text.`);
  return raw.trim().slice(0, options.max ?? 500);
}
