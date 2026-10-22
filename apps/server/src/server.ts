import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendSetCookie, parseCookies } from "./http/cookies.js";
import { readJsonBody } from "./http/body.js";
import { Router, type RequestContext } from "./http/router.js";
import { securityHeaders, sendBytes, sendJson, sendText } from "./http/response.js";
import { publicErrorMessage } from "./http/public-data.js";
import { serveStatic, staticNotFound } from "./http/static.js";
import { HttpError, notFound, forbidden } from "./errors.js";
import { requireUser, requireCsrf } from "./api/guards.js";
import { registerTeamRoutes } from "./api/teams.js";
import { validateTeamFiles } from "./services/team-paths.js";
import { BuilderError } from "./core.js";
import { SESSION_COOKIE } from "./auth/service.js";
import { registerAdminRoutes } from "./api/admin.js";
import { registerAuthRoutes } from "./api/auth.js";
import { registerBuildRoutes } from "./api/builds.js";
import { registerLibraryRoutes } from "./api/library.js";
import { CSRF_COOKIE } from "./api/auth.js";
import type { AppContext } from "./app-context.js";

export interface WebServerOptions {
  app: AppContext;
}

/** Paths served without a session. Everything else in the UI requires sign-in. */
const PUBLIC_PAGES = new Set(["/login.html", "/login", "/app.css", "/login.js", "/ui.js", "/design.css"]);

/**
 * Adds the server overlay to the reused Builder UI: account panel, CSRF header
 * handling, and owner badges. The Builder files themselves stay untouched so the
 * local GUI keeps its single-user behavior.
 */
function injectServerOverlay(html: string): string {
  const withStyles = html.includes('href="/app.css"')
    ? html
    : html.includes('href="/design.css"')
      ? html.replace('<link rel="stylesheet" href="/design.css">', '<link rel="stylesheet" href="/app.css">\n  <link rel="stylesheet" href="/design.css">')
      : html.replace("</head>", '<link rel="stylesheet" href="/app.css">\n</head>');
  if (withStyles.includes('src="/shell.js"')) return withStyles;
  return withStyles.replace("</head>", '<script src="/team-transport.js"></script>\n</head>').replace("</body>", '  <script src="/shell.js"></script>\n  <script src="/plugin-updates.js"></script>\n</body>');
}

async function serveAppShell(app: AppContext, res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(path.join(app.config.guiPublicDir, "index.html"), "utf8");
    sendBytes(res, 200, Buffer.from(injectServerOverlay(html), "utf8"), "text/html; charset=utf-8");
  } catch {
    staticNotFound(res);
  }
}

export function createRouter(app: AppContext): Router {
  const router = new Router();
  registerAuthRoutes(router, app);
  registerAdminRoutes(router, app);
  registerTeamRoutes(router, app);
  return router;
}

export function createServer({ app }: WebServerOptions): Server {
  const router = createRouter(app);
  const headers = securityHeaders({ secureCookies: app.config.secureCookies });

  return createHttpServer(async (req, res) => {
    try {
      for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);

      const url = new URL(req.url ?? "/", app.config.baseUrl);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        await dispatchApi(app, router, req, res, url);
        return;
      }

      await dispatchPage(app, req, res, pathname);
    } catch (error) {
      handleError(app, res, error);
    }
  });
}

async function dispatchApi(
  app: AppContext,
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  let contentApp: AppContext | null = null;
  const teamPath = /^\/api\/teams\/([^/]+)(\/.*)$/.exec(url.pathname);
  let match = router.match(req.method ?? "GET", url.pathname);
  if (!match && teamPath) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
    const auth = await app.auth.resolveSession(token);
    if (!auth) throw new HttpError(401, "unauthorized", "Sign in to continue.");
    await app.teams.requireAccess(teamPath[1], auth.user);
    contentApp = await app.forTeam(teamPath[1]);
    const contentRouter = new Router();
    registerLibraryRoutes(contentRouter, contentApp);
    registerBuildRoutes(contentRouter, contentApp);
    contentRouter.get("/api/quota", async context => sendJson(context.res, 200, await contentApp!.quota.usage(requireUser(context).id)));
    match = contentRouter.match(req.method ?? "GET", `/api${teamPath[2]}`);
  }
  if (!match) {
    if (router.allowsMethod(url.pathname)) {
      sendJson(res, 405, { error: { code: "method_not_allowed", message: `${req.method} is not allowed for this endpoint.` } });
      return;
    }
    throw notFound("not_found", `Unknown API endpoint: ${url.pathname}`);
  }

  const cookies = parseCookies(req.headers.cookie);
  const auth = await app.auth.resolveSession(cookies[SESSION_COOKIE] ?? null);

  // Keep the readable CSRF cookie aligned with the live session so a page reload
  // after a session rotation always has the matching token.
  if (auth && cookies[CSRF_COOKIE] !== auth.session.csrfToken) {
    appendSetCookie(
      res,
      `${CSRF_COOKIE}=${encodeURIComponent(auth.session.csrfToken)}; Path=/; SameSite=Strict${app.config.secureCookies ? "; Secure" : ""}`
    );
  }

  const context: RequestContext = {
    req,
    res,
    url,
    params: match.params,
    auth,
    readJson: () => readJsonBody(req, app.config.maxJsonBytes),
    query: (name) => url.searchParams.get(name)
  };

  const handler = match.handler;
  const run = async () => {
    if (teamPath) {
      const access = await app.teams.requireAccess(teamPath[1], requireUser(context));
      context.auth!.user = access.actor;
      if (contentApp) await validateTeamFiles(contentApp.library.root);
      if (contentApp && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET")) {
        requireCsrf(context);
        if (access.membership.role === "viewer") throw forbidden("read_only", "An editor role in this team is required.");
      }
    }
    await handler(context);
    if (contentApp && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET") && res.statusCode < 400) {
      await app.teams.audit(teamPath![1], requireUser(context).id, `content.${req.method!.toLowerCase()}`, `${teamPath![2]}${url.search}`);
    }
  };
  if (["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET")) {
    await run();
  } else {
    await app.library.mutate(async () => {
      // A queued write may outlive account disabling, logout or a role change.
      context.auth = await app.auth.resolveSession(cookies[SESSION_COOKIE] ?? null);
      await run();
    });
  }
}

async function dispatchPage(app: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  // One deliberately public release artifact; all team downloads stay protected.
  if (pathname === "/downloads/wp-starter-exporter.zip") {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed", "text/plain; charset=utf-8", { headers: { Allow: "GET, HEAD" } });
      return;
    }
    let zip: Buffer;
    try {
      zip = await readFile(path.join(app.config.clientDir, "downloads/wp-starter-exporter.zip"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw notFound("exporter_not_found", "The exporter download is unavailable. Ask the administrator to rebuild the server.");
    }
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": zip.length,
      "Content-Disposition": 'attachment; filename="wp-starter-exporter.zip"',
      "Cache-Control": "no-cache"
    });
    res.end(req.method === "HEAD" ? undefined : zip);
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const auth = await app.auth.resolveSession(cookies[SESSION_COOKIE] ?? null);
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (!auth && !PUBLIC_PAGES.has(normalized)) {
    res.writeHead(302, { Location: "/login.html", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (normalized === "/admin" || normalized === "/admin/") {
    const served = await serveStatic(res, [app.config.clientDir], "/admin.html", { securityHeaders: {} });
    if (!served) staticNotFound(res);
    return;
  }

  // The Builder shell is always served with the server overlay injected.
  if (normalized === "/" || normalized === "/index.html") {
    const accessible = await app.teams.forUser(auth!.user.id);
    const selected = new URL(req.url ?? "/", app.config.baseUrl).searchParams.get("team");
    if (!selected || !accessible.some(team => team.id === selected)) {
      res.writeHead(302, { Location: !selected && accessible.length === 1 ? `/?team=${accessible[0].id}` : "/teams.html", "Cache-Control": "no-store" });
      res.end(); return;
    }
    await serveAppShell(app, res);
    return;
  }

  const served = await serveStatic(res, [app.config.clientDir, app.config.guiPublicDir], normalized === "/login" ? "/login.html" : normalized, { securityHeaders: {} });
  if (served) return;

  // Unknown non-API paths fall back to the app shell so client-side navigation works.
  await serveAppShell(app, res);
}

function handleError(app: AppContext, res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof HttpError) {
    if (error.status >= 500) app.log.error(`${error.code}: ${error.message}`);
    sendJson(res, error.status, { error: { code: error.code, message: publicErrorMessage(error.message, app.library.root), details: error.details ?? null } });
    return;
  }

  // builder-core rejects bad input with a coded error. Those are client
  // mistakes (an invalid archive, an unknown package, a refused comparison),
  // so they are reported with their own code instead of a generic 500.
  if (error instanceof BuilderError) {
    const status = error.code.endsWith("not_found") ? 404 : 400;
    sendJson(res, status, { error: { code: error.code, message: publicErrorMessage(error.message, app.library.root), details: null } });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  app.log.error(`Unhandled error: ${message}`);
  sendText(res, 500, "Internal server error");
}
