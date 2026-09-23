import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "../../../packages/builder-core/dist/index.js";
import { startApplication } from "../dist/app.js";

export const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export const ADMIN = { email: "admin@example.test", password: "admin-password-123" };

/**
 * Boots an isolated server: temporary library directory, in-memory SQLite, and
 * an ephemeral port. Every test gets its own database, so nothing leaks between
 * test files or runs.
 */
export async function startTestServer(overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wp-starter-server-test-"));
  const application = await startApplication({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    database: { driver: "sqlite", file: ":memory:" },
    sessionSecret: "test-session-secret-that-is-long-enough-000000",
    secureCookies: false,
    baseUrl: "http://127.0.0.1",
    bootstrapAdmin: ADMIN,
    allowOpenRegistration: false,
    logLevel: "quiet",
    skipSync: true,
    buildWorkers: 1,
    ...overrides
  });

  return {
    ...application,
    dataDir,
    async stop() {
      await application.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

/**
 * Cookie-jar HTTP client. It mirrors what the browser does: it keeps the session
 * and CSRF cookies and echoes the CSRF cookie in `X-CSRF-Token`.
 */
export function createClient(baseUrl) {
  const jar = new Map();

  function cookieHeader() {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  function capture(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
  }

  async function request(method, target, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    const cookies = cookieHeader();
    if (cookies) headers.cookie = cookies;

    let body;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      body = options.body;
    }

    const mutating = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
    // `csrf: false` simulates a cross-site request that cannot read the cookie.
    // An explicitly supplied header wins, so tests can send a wrong token.
    const hasExplicitToken = Object.keys(headers).some((name) => name.toLowerCase() === "x-csrf-token");
    if (mutating && options.csrf !== false && !hasExplicitToken) {
      const token = jar.get("wp_starter_csrf");
      if (token) headers["x-csrf-token"] = token;
    }
    if (options.contentType) headers["content-type"] = options.contentType;
    if (options.contentLength !== undefined) headers["content-length"] = String(options.contentLength);

    const response = await fetch(baseUrl + target, { method, headers, body, redirect: "manual" });
    capture(response);

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: response.status, headers: response.headers, text, json };
  }

  return {
    jar,
    request,
    get: (target, options) => request("GET", target, options),
    post: (target, options) => request("POST", target, options),
    put: (target, options) => request("PUT", target, options),
    delete: (target, options) => request("DELETE", target, options),
    cookie: (name) => jar.get(name) ?? null,

    async signIn(email, password) {
      const result = await request("POST", "/api/auth/login", { json: { email, password } });
      if (result.status !== 200) {
        throw new Error(`Sign-in failed for ${email}: ${result.status} ${result.text}`);
      }
      return result.json;
    },

    async register(email, password, inviteCode, displayName) {
      const result = await request("POST", "/api/auth/register", {
        json: { email, password, inviteCode, displayName }
      });
      if (result.status !== 200) {
        throw new Error(`Registration failed for ${email}: ${result.status} ${result.text}`);
      }
      return result.json;
    }
  };
}

/** Creates a user through the admin API and returns a signed-in client. */
export async function createUserSession(adminClient, baseUrl, { email, password, role }) {
  const created = await adminClient.post("/api/admin/users", { json: { email, password, role } });
  if (created.status !== 201) {
    throw new Error(`Could not create ${email}: ${created.status} ${created.text}`);
  }
  const client = createClient(baseUrl);
  await client.signIn(email, password);
  return { client, user: created.json.user };
}

/** Creates an invite code through the admin API. */
export async function createInvite(adminClient, { role = "client", email = null, expiresInDays = 14 } = {}) {
  const result = await adminClient.post("/api/admin/invites", { json: { role, email, expiresInDays } });
  if (result.status !== 201) throw new Error(`Could not create invite: ${result.status} ${result.text}`);
  return result.json;
}

/* ----------------------------------------------------------- synthetic fixtures */

async function zipDir(source, destination) {
  await createZip(source, destination);
}

/** Minimal valid WordPress core archive. */
export async function makeWordPressZip(temp, { version = "7.1" } = {}) {
  const core = path.join(temp, `wp-${version}/wordpress`);
  await mkdir(path.join(core, "wp-admin"), { recursive: true });
  await mkdir(path.join(core, "wp-includes"), { recursive: true });
  await mkdir(path.join(core, "wp-content/languages"), { recursive: true });
  await writeFile(path.join(core, "wp-includes/version.php"), `<?php\n$wp_version = '${version}';\n`);
  await writeFile(path.join(core, "wp-content/languages/en_US.mo"), "fake-language");
  const zip = path.join(temp, `wordpress-${version}.zip`);
  await zipDir(path.join(temp, `wp-${version}`), zip);
  return zip;
}

/** Minimal plugin archive with a detectable slug and version. */
export async function makePluginZip(temp, { slug, name, version }) {
  const dir = path.join(temp, `plugin-${slug}`);
  await mkdir(path.join(dir, slug), { recursive: true });
  await writeFile(
    path.join(dir, slug, `${slug}.php`),
    `<?php\n/*\nPlugin Name: ${name}\nVersion: ${version}\nText Domain: ${slug}\n*/\n`
  );
  const zip = path.join(temp, `plugin-${slug}-${version}.zip`);
  await zipDir(dir, zip);
  return zip;
}

/** Minimal theme archive. */
export async function makeThemeZip(temp, { slug, name, version }) {
  const dir = path.join(temp, `theme-${slug}`);
  await mkdir(path.join(dir, slug), { recursive: true });
  await writeFile(
    path.join(dir, slug, "style.css"),
    `/*\nTheme Name: ${name}\nVersion: ${version}\nText Domain: ${slug}\n*/\n`
  );
  const zip = path.join(temp, `theme-${slug}-${version}.zip`);
  await zipDir(dir, zip);
  return zip;
}

/** Exporter-shaped configuration snapshot archive. */
export async function makeSnapshotZip(temp, options = {}) {
  const {
    generatedAt = "2026-08-24T05:01:24+00:00",
    wordpressVersion = "7.1",
    locale = "en_US",
    theme = { slug: "hello-elementor", name: "Hello Elementor", version: "3.4.9" },
    plugins = [
      { file: "elementor/elementor.php", name: "Elementor", version: "4.0.8", active: true },
      { file: "wp-starter-exporter/starter-exporter.php", name: "WP Starter Exporter", version: "0.1", active: true }
    ],
    label = "config"
  } = options;

  const dir = path.join(temp, `snapshot-${label}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "starter-config.json"),
    JSON.stringify(
      {
        schema_version: 1,
        exporter_version: "test",
        generated_at: generatedAt,
        source: { wordpress_version: wordpressVersion, php_version: "8.3.33", locale, theme, plugins },
        wordpress: { options: {}, pages: [] },
        adapters: {}
      },
      null,
      2
    )
  );
  await writeFile(path.join(dir, "export-manifest.json"), "{}\n");
  const zip = path.join(temp, `snapshot-${label}.zip`);
  await zipDir(dir, zip);
  return zip;
}

/** A .zip that is not a valid package or snapshot. */
export async function makeJunkZip(temp, name = "junk") {
  const dir = path.join(temp, `junk-${name}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "readme.txt"), "not a package\n");
  const zip = path.join(temp, `junk-${name}.zip`);
  await zipDir(dir, zip);
  return zip;
}

/** Reads a file into a Buffer for raw upload requests. */
export async function readUpload(file) {
  const { readFile } = await import("node:fs/promises");
  return readFile(file);
}
