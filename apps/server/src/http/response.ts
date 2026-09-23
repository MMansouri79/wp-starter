import type { ServerResponse } from "node:http";

export interface SecurityOptions {
  secureCookies: boolean;
  /** Extra connect-src origins, if any future integration needs them. */
  connectSources?: string[];
}

export function securityHeaders(options: SecurityOptions): Record<string, string> {
  const connect = ["'self'", ...(options.connectSources ?? [])].join(" ");
  const headers: Record<string, string> = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src ${connect}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
  if (options.secureCookies) {
    headers["Strict-Transport-Security"] = "max-age=15552000; includeSubDomains";
  }
  return headers;
}

export function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  options: { headers?: Record<string, string> } = {}
): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...options.headers
  });
  res.end(body);
}

export function sendText(
  res: ServerResponse,
  status: number,
  value: string,
  contentType = "text/plain; charset=utf-8",
  options: { headers?: Record<string, string> } = {}
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store",
    ...options.headers
  });
  res.end(value);
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  data: Buffer,
  contentType: string,
  options: { headers?: Record<string, string> } = {}
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    ...options.headers
  });
  res.end(data);
}
