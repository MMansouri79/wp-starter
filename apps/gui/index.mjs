#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
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
  loadProfile,
  PackageRegistry
} from "../../packages/builder-core/dist/index.js";

const VERSION = "0.1.0-alpha.15";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const publicDir = path.join(here, "public");
const bootstrapFile = path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php");
const libraryRoot = path.resolve(process.env.WP_STARTER_HOME?.trim() || defaultLibraryDir());
const profilesDir = path.join(libraryRoot, "profiles");
const buildsDir = path.join(libraryRoot, "builds");
const buildJobs = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function text(res, status, value, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store"
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
      configurationEnabled: meta.configurationEnabled === true
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
    profiles: await listProfiles(),
    builds: await listBuilds()
  };
}

async function serveFile(res, target, contentType) {
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
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
      pluginVersions
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
    plugins: pluginVersions
  });
}

async function performBuild(profileFile, onProgress) {
  const safeProfile = safeName(String(profileFile || ""), "");
  if (!safeProfile || !safeProfile.endsWith(".json")) {
    throw new BuilderError("invalid_request", "A valid profileFile is required.");
  }
  const profilePath = path.join(profilesDir, safeProfile);
  const profile = await loadProfile(profilePath, { libraryDir: libraryRoot });
  await mkdir(buildsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputName = `${safeName(profile.name, "starter")}-${timestamp}.zip`;
  const outputZip = path.join(buildsDir, outputName);
  const result = await buildStarter({ profile, outputZip, bootstrapFile, builderVersion: VERSION, onProgress });
  await writeFile(`${outputZip}.json`, JSON.stringify({
    schemaVersion: 1,
    file: outputName,
    profile: profile.name,
    profileFile: safeProfile,
    locale: profile.locale,
    sha256: result.sha256,
    configurationEnabled: result.manifest.configurationEnabled === true,
    createdAt: new Date().toISOString()
  }, null, 2) + "\n", "utf8");
  return {
    file: outputName,
    sha256: result.sha256,
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

  if (req.method === "GET" && url.pathname === "/api/state") {
    json(res, 200, await state());
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
    await writeFile(target, JSON.stringify(profile, null, 2) + "\n", "utf8");
    const sourceFile = path.basename(String(body.sourceFile || ""));
    if (sourceFile && sourceFile.endsWith(".json") && sourceFile !== filename) {
      await rm(path.join(profilesDir, sourceFile), { force: true });
    }
    json(res, 200, { profile, file: filename });
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
      if (await api(req, res, url)) return;

      if (req.method === "GET" && url.pathname.startsWith("/download/")) {
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
          "Cache-Control": "no-store"
        });
        res.end(data);
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        await serveFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
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
