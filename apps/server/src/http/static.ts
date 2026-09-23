import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { sendBytes, sendText } from "./response.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves a file from the first root that contains it. Roots are searched in
 * order so server-specific assets (login, admin) can override the reused
 * Builder UI without duplicating it.
 */
export async function serveStatic(
  res: ServerResponse,
  roots: readonly string[],
  pathname: string,
  options: { securityHeaders: Record<string, string> }
): Promise<boolean> {
  const relative = pathname === "/" || pathname === "" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return false;

  for (const root of roots) {
    const candidate = path.resolve(root, relative);
    const base = path.resolve(root);
    if (candidate !== base && !candidate.startsWith(base + path.sep)) continue;

    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const data = await readFile(candidate);
      sendBytes(res, 200, data, contentTypeFor(candidate), { headers: options.securityHeaders });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

export function staticNotFound(res: ServerResponse): void {
  sendText(res, 404, "Not found");
}
