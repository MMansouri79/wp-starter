import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { appendSetCookie, parseCookies } from "./http/cookies.js";
import { readJsonBody } from "./http/body.js";
import { Router, type RequestContext } from "./http/router.js";
import { securityHeaders, sendBytes, sendJson, sendText } from "./http/response.js";
import { serveStatic, staticNotFound } from "./http/static.js";
import { HttpError, notFound } from "./errors.js";
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
const PUBLIC_PAGES = new Set(["/login.html", "/login", "/app.css", "/login.js"]);

/**
 * Adds the server overlay to the reused Builder UI: account panel, CSRF header
 * handling, and owner badges. The Builder files themselves stay untouched so the
 * local GUI keeps its single-user behavior.
 */
function injectServerOverlay(html: string): string {
  const withStyles = html.includes('href="/app.css"')
    ? html
    : html.replace("</head>", '  <link rel="stylesheet" href="/app.css">\n</head>');
  if (withStyles.includes('src="/shell.js"')) return withStyles;
  return withStyles.replace("</body>", '  <script src="/shell.js"></script>\n</body>');
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
  registerLibraryRoutes(router, app);
  registerBuildRoutes(router, app);
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
  const match = router.match(req.method ?? "GET", url.pathname);
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

  await match.handler(context);
}

async function dispatchPage(app: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const auth = await app.auth.resolveSession(cookies[SESSION_COOKIE] ?? null);
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (!auth && !PUBLIC_PAGES.has(normalized)) {
    res.writeHead(302, { Location: "/login.html", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (auth && (normalized === "/login" || normalized === "/login.html")) {
    res.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
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
    await serveAppShell(app, res);
    return;
  }

  const served = await serveStatic(res, [app.config.clientDir, app.config.guiPublicDir], normalized, { securityHeaders: {} });
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
    sendJson(res, error.status, { error: { code: error.code, message: error.message, details: error.details ?? null } });
    return;
  }

  // builder-core rejects bad input with a coded error. Those are client
  // mistakes (an invalid archive, an unknown package, a refused comparison),
  // so they are reported with their own code instead of a generic 500.
  if (error instanceof BuilderError) {
    const status = error.code.endsWith("not_found") ? 404 : 400;
    sendJson(res, status, { error: { code: error.code, message: error.message, details: null } });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  app.log.error(`Unhandled error: ${message}`);
  sendText(res, 500, "Internal server error");
}
