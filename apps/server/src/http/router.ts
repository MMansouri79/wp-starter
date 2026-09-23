import type { IncomingMessage, ServerResponse } from "node:http";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Resolved after authentication middleware runs. */
  auth: { user: import("../types.js").User; session: import("../types.js").SessionRecord } | null;
  readJson: () => Promise<Record<string, unknown>>;
  query: (name: string) => string | null;
}

export type Handler = (context: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export interface MatchResult {
  handler: Handler;
  params: Record<string, string>;
}

/** Tiny dependency-free router with `:param` segments. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const segments = pattern.split("/").filter((segment) => segment.length > 0);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add("POST", pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add("PUT", pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.add("DELETE", pattern, handler);
  }

  match(method: string, pathname: string): MatchResult | null {
    const requested = pathname.split("/").filter((segment) => segment.length > 0).map(decodeURIComponent);
    const upper = method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== upper) continue;
      if (route.segments.length !== requested.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let index = 0; index < route.segments.length; index += 1) {
        const pattern = route.segments[index];
        if (pattern.startsWith(":")) {
          params[pattern.slice(1)] = requested[index];
          continue;
        }
        if (pattern !== requested[index]) {
          matched = false;
          break;
        }
      }

      if (matched) return { handler: route.handler, params };
    }

    return null;
  }

  /** True when the path matches some route under a different method. */
  allowsMethod(pathname: string): boolean {
    const requested = pathname.split("/").filter((segment) => segment.length > 0);
    return this.routes.some((route) => route.segments.length === requested.length);
  }
}
