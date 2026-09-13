#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildStarter,
  BuilderError,
  ConfigSnapshotRegistry,
  createProfileFromPackages,
  createProfileFromSnapshot,
  defaultLibraryDir,
  FontSystemRegistry,
  loadProfile,
  PackageRegistry,
  compatibilityReport,
  writeJson,
  VNextResourceRegistry,
  assertValidReport,
  validateTypographyProfile,
  validateColorProfile
} from "../../packages/builder-core/dist/index.js";

const VERSION = "0.1.0-alpha.22";
const SESSION_TOKEN = randomBytes(32).toString("hex");
const SESSION_COOKIE = `wp_starter_session=${SESSION_TOKEN}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const publicDir = path.join(here, "public");
const bootstrapFile = path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php");
const libraryRoot = path.resolve(process.env.WP_STARTER_HOME?.trim() || defaultLibraryDir());
const profilesDir = path.join(libraryRoot, "profiles");
const buildsDir = path.join(libraryRoot, "builds");
const vnextDir = path.join(libraryRoot, "vnext");
const buildJobs = new Map();

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function localHostAllowed(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

function localOriginAllowed(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.protocol === "http:";
  } catch { return false; }
}

function sessionAllowed(req) {
  const cookies = String(req.headers.cookie || "").split(/;\s*/);
  const token = cookies.find((entry) => entry.startsWith("wp_starter_session="))?.slice("wp_starter_session=".length) || "";
  if (token.length !== SESSION_TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(SESSION_TOKEN));
}

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...securityHeaders()
  });
  res.end(body);
}

function text(res, status, value, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store",
    ...securityHeaders()
  });
  res.end(value);
}

function safeName(value, fallback) {
  const cleaned = String(value).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function isInfrastructurePackage(record) {
  return record.kind === "plugin" && ["wp-starter-builder", "wp-starter-exporter", "site-starter"].includes(record.slug);
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new BuilderError("request_too_large", "Request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new BuilderError("invalid_json", "Request body is not valid JSON.");
  }
}

async function receiveZip(req, filename) {
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw new BuilderError("invalid_upload", "Only .zip files can be imported.");
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-starter-gui-upload-"));
  const file = path.join(tempDir, safeName(path.basename(filename), "upload.zip"));
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024 * 1024) req.destroy(new Error("Upload exceeds 1 GB."));
  });
  await pipeline(req, createWriteStream(file));
  return { tempDir, file };
}

async function listProfiles() {
  await mkdir(profilesDir, { recursive: true });
  const entries = await readdir(profilesDir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(profilesDir, entry.name), "utf8"));
      const info = await stat(path.join(profilesDir, entry.name));
      output.push({
        name: String(raw.name || entry.name.replace(/\.json$/i, "")),
        file: entry.name,
        locale: String(raw.locale || ""),
        wordpress: raw.wordpress ? `${String(raw.wordpress.version || "")}${raw.wordpress.variant ? ` (${raw.wordpress.variant})` : ""}` : "",
        theme: raw.theme ? `${raw.theme.slug}@${raw.theme.version}` : "WordPress default",
        plugins: Array.isArray(raw.plugins) ? raw.plugins.length : 0,
        config: String(raw.config?.id || ""),
        fontSystem: String(raw.fontSystem?.id || ""),
        updatedAt: info.mtime.toISOString()
      });
    } catch {
      // Invalid manual files remain on disk; validation reports them when selected.
    }
  }
  return output.sort((a, b) => a.name.localeCompare(b.name));
}

async function listBuilds() {
  await mkdir(buildsDir, { recursive: true });
  const entries = await readdir(buildsDir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) continue;
    const target = path.join(buildsDir, entry.name);
    const info = await stat(target);
    let meta = {};
    try {
      meta = JSON.parse(await readFile(`${target}.json`, "utf8"));
    } catch {
      // Builds made before alpha.14 have no sidecar metadata.
    }
    output.push({
      file: entry.name,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      profile: String(meta.profile || ""),
      profileFile: String(meta.profileFile || ""),
      locale: String(meta.locale || ""),
      sha256: String(meta.sha256 || ""),
      configurationEnabled: meta.configurationEnabled === true,
      compatibility: meta.compatibility || null
    });
  }
  return output.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function state() {
  const packages = (await new PackageRegistry(libraryRoot).list()).filter((record) => !isInfrastructurePackage(record));
  const configs = await new ConfigSnapshotRegistry(libraryRoot).list();
  return {
    version: VERSION,
    library: libraryRoot,
    packages,
    configs,
    fonts: await new FontSystemRegistry(libraryRoot).list(),
    vnext: {
      typography: await new VNextResourceRegistry(vnextDir, "typography.json").list(),
      colors: await new VNextResourceRegistry(vnextDir, "colors.json").list(),
      designSystems: await new VNextResourceRegistry(vnextDir, "design-systems.json").list(),
      templates: await new VNextResourceRegistry(vnextDir, "templates.json").list()
    },
    profiles: await listProfiles(),
    builds: await listBuilds()
  };
}

function vnextResource(kind) {
  const files = { typography: "typography.json", colors: "colors.json", designSystems: "design-systems.json", templates: "templates.json" };
  if (!files[kind]) throw new BuilderError("invalid_vnext_resource", `Unsupported vNext resource type: ${kind}`);
  return new VNextResourceRegistry(vnextDir, files[kind]);
}

async function serveFile(res, target, contentType) {
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      ...securityHeaders()
    });
    res.end(data);
  } catch {
    text(res, 404, "Not found");
  }
}

async function createOrUpdateProfile(body) {
  const configId = String(body.configId || "").trim();
  const name = String(body.name || configId || "profile").trim();
  const locale = String(body.locale || "").trim() || "en_US";
  const pluginVersions = body.pluginVersions && typeof body.pluginVersions === "object" ? body.pluginVersions : {};

  if (configId) {
    const excludedPlugins = Array.isArray(body.excludedPlugins) ? body.excludedPlugins.map(String) : [];
    return createProfileFromSnapshot(configId, {
      libraryDir: libraryRoot,
      name,
      locale,
      excludePlugins: excludedPlugins,
      wordpressVersion: String(body.wordpressVersion || "").trim() || undefined,
      wordpressVariant: String(body.wordpressVariant || "").trim() || undefined,
      themeVersion: String(body.themeVersion || "").trim() || undefined,
      pluginVersions,
      fontSystemId: String(body.fontSystemId || "").trim() || null
    });
  }

  return createProfileFromPackages({
    libraryDir: libraryRoot,
    name,
    locale,
    wordpressVersion: String(body.wordpressVersion || "").trim(),
    wordpressVariant: String(body.wordpressVariant || "").trim(),
    themeSlug: String(body.themeSlug || "").trim() || null,
    themeVersion: String(body.themeVersion || "").trim() || null,
    plugins: pluginVersions,
    fontSystemId: String(body.fontSystemId || "").trim() || null
  });
}

async function reportForProfileDocument(profileDocument) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-starter-profile-report-"));
  const tempProfile = path.join(tempDir, "profile.json");
  try {
    await writeFile(tempProfile, JSON.stringify(profileDocument));
    const loaded = await loadProfile(tempProfile, { libraryDir: libraryRoot });
    return compatibilityReport(loaded);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function performBuild(profileFile, onProgress) {
  const safeProfile = safeName(String(profileFile || ""), "");
  if (!safeProfile || !safeProfile.endsWith(".json")) {
    throw new BuilderError("invalid_request", "A valid profileFile is required.");
  }
  const profilePath = path.join(profilesDir, safeProfile);
  const profile = await loadProfile(profilePath, { libraryDir: libraryRoot });
  const compatibility = compatibilityReport(profile);
  if (compatibility.status === "unsupported") throw new BuilderError("unsupported_compatibility", compatibility.errors.join(" "));
  await mkdir(buildsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputName = `${safeName(profile.name, "starter")}-${timestamp}.zip`;
  const outputZip = path.join(buildsDir, outputName);
  const result = await buildStarter({ profile, outputZip, bootstrapFile, builderVersion: VERSION, onProgress });
  await writeJson(`${outputZip}.json`, {
    schemaVersion: 1,
    file: outputName,
    profile: profile.name,
    profileFile: safeProfile,
    locale: profile.locale,
    sha256: result.sha256,
    configurationEnabled: result.manifest.configurationEnabled === true,
    compatibility: result.compatibility || result.manifest.compatibility || compatibility,
    createdAt: new Date().toISOString()
  });
  return {
    file: outputName,
    sha256: result.sha256,
    compatibility: result.compatibility || result.manifest.compatibility || compatibility,
    manifest: result.manifest,
    download: `/download/${encodeURIComponent(outputName)}`
  };
}

function startBuildJob(profileFile) {
  const id = randomUUID();
  const job = {
    id,
    status: "queued",
    percent: 0,
    stage: "queued",
    message: "Build queued…",
    createdAt: new Date().toISOString(),
    result: null,
    error: null
  };
  buildJobs.set(id, job);

  setTimeout(async () => {
    try {
      job.status = "running";
      job.message = "Starting build…";
      job.result = await performBuild(profileFile, (progress) => {
        job.percent = progress.percent;
        job.stage = progress.stage;
        job.message = progress.message;
        job.current = progress.current;
        job.total = progress.total;
      });
      job.status = "complete";
      job.percent = 100;
      job.stage = "complete";
      job.message = "Build complete.";
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.stage = "failed";
      job.message = error instanceof Error ? error.message : String(error);
      job.error = {
        code: error instanceof BuilderError ? error.code : "internal_error",
        message: job.message
      };
      job.completedAt = new Date().toISOString();
    }
  }, 0);

  return job;
}

async function api(req, res, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  if (!localHostAllowed(req) || !localOriginAllowed(req)) { json(res, 403, { error: "forbidden_origin", message: "Local GUI request origin is not allowed." }); return true; }
  if (!sessionAllowed(req)) { json(res, 401, { error: "unauthorized", message: "Open the WP Starter GUI root page to establish a local session." }); return true; }

  if (req.method === "GET" && url.pathname === "/api/state") {
    json(res, 200, await state());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/vnext") {
    json(res, 200, {
      typography: await vnextResource("typography").list(),
      colors: await vnextResource("colors").list(),
      designSystems: await vnextResource("designSystems").list(),
      templates: await vnextResource("templates").list()
    });
    return true;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/vnext/")) {
    const kind = url.pathname.slice("/api/vnext/".length);
    const body = await readJsonBody(req);
    if (kind === "typography") assertValidReport(validateTypographyProfile(body));
    if (kind === "colors") assertValidReport(validateColorProfile(body));
    if (!body || typeof body.id !== "string" || !body.id.trim()) throw new BuilderError("invalid_vnext_resource", "A vNext resource requires an id.");
    json(res, 200, await vnextResource(kind).save(body));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/packages") {
    const filename = url.searchParams.get("filename") || "package.zip";
    const replace = url.searchParams.get("replace") === "1";
    const upload = await receiveZip(req, filename);
    try {
      const result = await new PackageRegistry(libraryRoot).add(upload.file, { replace });
      json(res, 200, result);
    } finally {
      await rm(upload.tempDir, { recursive: true, force: true });
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/packages") {
    const kind = url.searchParams.get("kind");
    const slug = url.searchParams.get("slug");
    const version = url.searchParams.get("version");
    const variant = url.searchParams.get("variant") || undefined;
    if (!( ["plugin", "theme", "wordpress"].includes(kind) ) || !slug || !version) {
      throw new BuilderError("invalid_request", "kind, slug and version are required.");
    }
    json(res, 200, await new PackageRegistry(libraryRoot).remove(kind, slug, version, variant));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/fonts") {
    const filename = url.searchParams.get("filename") || "fonts.zip";
    const replace = url.searchParams.get("replace") !== "0";
    const name = String(url.searchParams.get("name") || "").trim() || undefined;
    const upload = await receiveZip(req, filename);
    try {
      const result = await new FontSystemRegistry(libraryRoot).add(upload.file, { replace, name });
      json(res, 200, result);
    } finally {
      await rm(upload.tempDir, { recursive: true, force: true });
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/fonts") {
    const id = String(url.searchParams.get("id") || "").trim();
    if (!id) throw new BuilderError("invalid_request", "Font profile id is required.");
    json(res, 200, await new FontSystemRegistry(libraryRoot).remove(id));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/configs") {
    const filename = url.searchParams.get("filename") || "starter-config.zip";
    const replace = url.searchParams.get("replace") === "1";
    const upload = await receiveZip(req, filename);
    try {
      const registry = new ConfigSnapshotRegistry(libraryRoot);
      const result = await registry.add(upload.file, { replace });
      const report = await registry.requirements(result.record.id);
      json(res, 200, { ...result, report });
    } finally {
      await rm(upload.tempDir, { recursive: true, force: true });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/configs/") && url.pathname.endsWith("/check")) {
    const id = decodeURIComponent(url.pathname.slice("/api/configs/".length, -"/check".length));
    json(res, 200, await new ConfigSnapshotRegistry(libraryRoot).requirements(id));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/configs/compare") {
    const left = String(url.searchParams.get("left") || "").trim();
    const right = String(url.searchParams.get("right") || "").trim();
    json(res, 200, await new ConfigSnapshotRegistry(libraryRoot).compare(left, right));
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/configs/") && url.pathname.endsWith("/inspect")) {
    const id = decodeURIComponent(url.pathname.slice("/api/configs/".length, -"/inspect".length));
    const registry = new ConfigSnapshotRegistry(libraryRoot);
    const [inspection, requirements] = await Promise.all([registry.inspect(id), registry.requirements(id)]);
    json(res, 200, { inspection, requirements });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profiles") {
    const body = await readJsonBody(req);
    const name = String(body.name || body.configId || "profile").trim();
    const profile = await createOrUpdateProfile(body);
    await mkdir(profilesDir, { recursive: true });
    const filename = `${safeName(name, "profile")}.json`;
    const target = path.join(profilesDir, filename);
    await writeJson(target, profile);
    const sourceFile = path.basename(String(body.sourceFile || ""));
    if (sourceFile && sourceFile.endsWith(".json") && sourceFile !== filename) {
      await rm(path.join(profilesDir, sourceFile), { force: true });
    }
    json(res, 200, { profile, file: filename, compatibility: await reportForProfileDocument(profile) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profiles/compatibility") {
    const body = await readJsonBody(req);
    const profile = await createOrUpdateProfile(body);
    json(res, 200, { compatibility: await reportForProfileDocument(profile) });
    return true;
  }

  if (url.pathname.startsWith("/api/profiles/") && url.pathname.endsWith("/compatibility") && req.method === "GET") {
    const filename = path.basename(decodeURIComponent(url.pathname.slice("/api/profiles/".length, -"/compatibility".length)));
    const target = path.join(profilesDir, filename);
    if (!filename.endsWith(".json") || path.dirname(target) !== profilesDir) {
      throw new BuilderError("invalid_request", "Invalid profile filename.");
    }
    const profile = await loadProfile(target, { libraryDir: libraryRoot });
    json(res, 200, { compatibility: compatibilityReport(profile) });
    return true;
  }

  if (url.pathname.startsWith("/api/profiles/") && req.method === "GET") {
    const filename = path.basename(decodeURIComponent(url.pathname.slice("/api/profiles/".length)));
    const target = path.join(profilesDir, filename);
    if (!filename.endsWith(".json") || path.dirname(target) !== profilesDir) {
      throw new BuilderError("invalid_request", "Invalid profile filename.");
    }
    await loadProfile(target, { libraryDir: libraryRoot });
    const profile = JSON.parse(await readFile(target, "utf8"));
    json(res, 200, { profile, file: filename });
    return true;
  }

  if (url.pathname.startsWith("/api/profiles/") && req.method === "DELETE") {
    const filename = path.basename(decodeURIComponent(url.pathname.slice("/api/profiles/".length)));
    const target = path.join(profilesDir, filename);
    if (!filename.endsWith(".json") || path.dirname(target) !== profilesDir) {
      throw new BuilderError("invalid_request", "Invalid profile filename.");
    }
    await rm(target, { force: true });
    json(res, 200, { removed: filename });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/builds") {
    const filename = path.basename(String(url.searchParams.get("file") || ""));
    const target = path.join(buildsDir, filename);
    if (!filename.endsWith(".zip") || path.dirname(target) !== buildsDir) {
      throw new BuilderError("invalid_request", "A valid build filename is required.");
    }
    await rm(target, { force: true });
    await rm(`${target}.json`, { force: true });
    json(res, 200, { removed: filename });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/build") {
    const body = await readJsonBody(req);
    json(res, 200, await performBuild(body.profileFile));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/build-jobs") {
    const body = await readJsonBody(req);
    const profileFile = String(body.profileFile || "");
    const job = startBuildJob(profileFile);
    json(res, 202, { id: job.id, status: job.status });
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/build-jobs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/build-jobs/".length));
    const job = buildJobs.get(id);
    if (!job) throw new BuilderError("build_job_not_found", "Build job was not found or has expired.");
    json(res, 200, job);
    return true;
  }

  return false;
}

export function createGuiServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!localHostAllowed(req)) { text(res, 403, "Invalid local host header."); return; }
      if (await api(req, res, url)) return;

      if (req.method === "GET" && url.pathname.startsWith("/download/")) {
        if (!sessionAllowed(req)) { text(res, 401, "Unauthorized local session."); return; }
        const filename = path.basename(decodeURIComponent(url.pathname.slice("/download/".length)));
        const target = path.join(buildsDir, filename);
        if (!filename.endsWith(".zip") || path.dirname(target) !== buildsDir) {
          text(res, 400, "Invalid build filename");
          return;
        }
        const data = await readFile(target);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename=\"${filename.replaceAll('"', '')}\"`,
          "Content-Length": data.length,
          "Cache-Control": "no-store",
          ...securityHeaders()
        });
        res.end(data);
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const data = await readFile(path.join(publicDir, "index.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": data.length,
          "Cache-Control": "no-store",
          "Set-Cookie": `${SESSION_COOKIE}; Path=/; HttpOnly; SameSite=Strict`,
          ...securityHeaders()
        });
        res.end(data);
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        await serveFile(res, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/styles.css") {
        await serveFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
        return;
      }

      text(res, 404, "Not found");
    } catch (error) {
      const code = error instanceof BuilderError ? error.code : "internal_error";
      const message = error instanceof Error ? error.message : String(error);
      json(res, 400, { error: code, message });
    }
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, { windowsHide: true }, () => undefined);
}

async function main() {
  await Promise.all([mkdir(profilesDir, { recursive: true }), mkdir(buildsDir, { recursive: true })]);
  const preferred = Number.parseInt(process.env.WP_STARTER_GUI_PORT || "47831", 10);
  const server = createGuiServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${preferred} is already in use. Set WP_STARTER_GUI_PORT to another local port.`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(preferred, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${preferred}/`;
    console.log(`WP Starter GUI ${VERSION}`);
    console.log(`Library: ${libraryRoot}`);
    console.log(`Open: ${url}`);
    console.log("Keep this window open while using the GUI. Press Ctrl+C to stop it.");
    openBrowser(url);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
