import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppContext } from "../app-context.js";
import type { User } from "../types.js";
import { badRequest } from "../errors.js";
import { inspectPackage } from "../core.js";
import { assertCanWrite } from "./ownership.js";
import { isInfrastructurePackage } from "./packages.js";
import { validateTeamFiles } from "./team-paths.js";

export const UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const STABLE_VERSION = /^\d+(?:\.\d+)*$/;
interface Settings { enabled: number; authorized_by: string; revision: string; last_check: string | null; results_json: string; }
interface UpdateResult { slug: string; status: "added" | "current" | "skipped" | "failed"; version?: string; code?: string; }
const services = new WeakMap<AppContext, PluginUpdates>();
export function pluginUpdates(app: AppContext): PluginUpdates {
  let service = services.get(app);
  if (!service) { service = new PluginUpdates(app); services.set(app, service); }
  return service;
}

/** Stable numeric releases only; do not treat prereleases or unusual vendor versions as upgrades. */
export function newerRelease(candidate: string, installed: string): boolean {
  if (!STABLE_VERSION.test(candidate) || !STABLE_VERSION.test(installed)) return false;
  const a = candidate.split(".").map(Number), b = installed.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Every redirect is checked before fetching. No user-supplied URLs reach fetch. */
export async function wordpressBytes(url: string, maxBytes: number, request: typeof fetch = fetch): Promise<Buffer> {
  const signal = AbortSignal.timeout(60_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !["api.wordpress.org", "downloads.wordpress.org"].includes(target.hostname) || target.port || target.username || target.password) {
      throw badRequest("update_url_rejected", "The update URL is not an approved WordPress.org address.");
    }
    const response = await request(target, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) break;
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw badRequest("update_download_failed", "WordPress.org could not provide this update."); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); throw badRequest("update_too_large", "The update exceeds the download limit."); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw badRequest("update_too_large", "The update exceeds the download limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  throw badRequest("update_redirect_failed", "WordPress.org returned too many redirects.");
}

export class PluginUpdates {
  private running: Promise<void> | null = null;
  constructor(private readonly app: AppContext, private readonly download = wordpressBytes) {}
  private settings() { return this.app.db.get<Settings>("SELECT * FROM plugin_update_settings WHERE team_id = ?", [this.app.teamId!]); }
  async view() {
    const settings = await this.settings();
    const sources = await this.app.db.all<{ slug: string }>("SELECT slug FROM plugin_update_sources WHERE team_id = ?", [this.app.teamId!]);
    const confirmed = new Set(sources.map(row => row.slug));
    const plugins = (await this.app.packageItems.list()).filter(row => row.kind === "plugin" && !isInfrastructurePackage(row));
    return {
      enabled: settings?.enabled === 1, lastCheck: settings?.last_check ?? null,
      paused: settings?.enabled === 1 && !await this.actor(),
      running: this.running !== null, results: JSON.parse(settings?.results_json ?? "[]") as UpdateResult[],
      plugins: [...new Set(plugins.map(row => row.slug))].sort().map(slug => ({ slug, confirmed: confirmed.has(slug) }))
    };
  }
  async save(body: Record<string, unknown>, user: User) {
    return this.app.library.mutate(() => this.saveLocked(body, user));
  }
  private async saveLocked(body: Record<string, unknown>, user: User) {
    const app = this.app;
    assertCanWrite({ teamId: app.teamId!, createdBy: null }, user);
    await app.teams.requireManager(app.teamId!, user);
    if (typeof body.enabled !== "boolean" || !Array.isArray(body.slugs) || !body.slugs.every(slug => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
      throw badRequest("invalid_update_settings", "Provide enabled and a list of confirmed WordPress.org plugin slugs.");
    }
    const available = new Set((await this.view()).plugins.map(row => row.slug));
    if (!body.slugs.every(slug => available.has(slug))) throw badRequest("invalid_update_source", "Only plugins already in this team library can be confirmed.");
    const existing = await this.settings();
    await app.db.transaction(async tx => {
      if (existing) await tx.run("UPDATE plugin_update_settings SET enabled = ?, authorized_by = ?, revision = ?, last_check = NULL, results_json = '[]' WHERE team_id = ?", [body.enabled ? 1 : 0, user.id, randomUUID(), app.teamId!]);
      else await tx.run("INSERT INTO plugin_update_settings (team_id, enabled, authorized_by, revision, last_check, results_json) VALUES (?, ?, ?, ?, NULL, '[]')", [app.teamId!, body.enabled ? 1 : 0, user.id, randomUUID()]);
      await tx.run("DELETE FROM plugin_update_sources WHERE team_id = ?", [app.teamId!]);
      for (const slug of new Set(body.slugs as string[])) await tx.run("INSERT INTO plugin_update_sources (team_id, slug) VALUES (?, ?)", [app.teamId!, slug]);
    });
    await app.teams.audit(app.teamId!, user.id, "plugins.updates.configure", app.teamId!);
    return this.view();
  }
  check(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async idle() { await this.running; }
  private async actor(): Promise<User | null> {
    const settings = await this.settings();
    if (!settings?.enabled) return null;
    const user = await this.app.users.findById(settings.authorized_by);
    if (!user || user.status !== "active") return null;
    try {
      await this.app.teams.requireManager(this.app.teamId!, user);
      return (await this.app.teams.requireAccess(this.app.teamId!, user)).actor;
    } catch { return null; }
  }
  private async run() {
    const app = this.app;
    const settings = await this.settings();
    if (!settings?.enabled || settings.last_check && Date.now() - Date.parse(settings.last_check) < UPDATE_INTERVAL_MS || !await this.actor()) return;
    const results: UpdateResult[] = [];
    const sources = (await this.view()).plugins.filter(row => row.confirmed);
    for (const { slug } of sources) {
      let temp: string | undefined;
      try {
        if (!await this.actor() || (await this.settings())?.revision !== settings.revision) break;
        const infoUrl = new URL("https://api.wordpress.org/plugins/info/1.2/");
        infoUrl.searchParams.set("action", "plugin_information");
        infoUrl.searchParams.set("request[slug]", slug);
        const info = JSON.parse((await this.download(infoUrl.href, 2 * 1024 * 1024)).toString("utf8"));
        if (info?.slug !== slug || typeof info.version !== "string" || !STABLE_VERSION.test(info.version) || typeof info.download_link !== "string") throw badRequest("invalid_update_metadata", "WordPress.org returned invalid plugin metadata.");
        const installed = (await app.packageItems.list()).filter(row => row.kind === "plugin" && row.slug === slug);
        if (!installed.length) continue;
        if (installed.some(row => !STABLE_VERSION.test(row.version))) { results.push({ slug, status: "skipped", code: "version_not_comparable" }); continue; }
        if (installed.some(row => !newerRelease(info.version, row.version))) { results.push({ slug, status: "current" }); continue; }
        await app.disk.assertWritable();
        const bytes = await this.download(info.download_link, Math.min(app.config.maxUploadBytes, MAX_DOWNLOAD_BYTES));
        temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-plugin-update-"));
        const file = path.join(temp, "package.zip");
        await writeFile(file, bytes);
        const inspected = await inspectPackage(file);
        if (inspected.kind !== "plugin" || inspected.slug !== slug || inspected.version !== info.version) throw badRequest("update_identity_mismatch", "The downloaded plugin does not match the requested release.");
        await app.library.mutate(async () => {
          const actor = await this.actor();
          const source = await app.db.get("SELECT slug FROM plugin_update_sources WHERE team_id = ? AND slug = ?", [app.teamId!, slug]);
          if (!actor || !source || (await this.settings())?.revision !== settings.revision || !(await app.packageItems.list()).some(row => row.kind === "plugin" && row.slug === slug)) return;
          assertCanWrite({ teamId: app.teamId!, createdBy: null }, actor);
          await validateTeamFiles(app.library.root);
          await app.disk.assertWritable();
          const result = await app.packages.add(file, { replace: false }, actor);
          results.push({ slug, status: result.added ? "added" : "current", version: info.version });
          if (result.added) await app.teams.audit(app.teamId!, actor.id, "plugins.updates.import", `${slug}@${info.version}`);
        });
      } catch (error) {
        // Store codes only: arbitrary network/filesystem messages can expose internal paths.
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z_]+$/.test(error.code) ? error.code : "update_failed";
        results.push({ slug, status: "failed", code });
      } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
    }
    await app.library.mutate(async () => {
      // Do not mark a newly configured policy as checked by an older in-flight run.
      const current = await this.settings();
      if (current?.revision === settings.revision) {
        await app.db.run("UPDATE plugin_update_settings SET last_check = ?, results_json = ? WHERE team_id = ?", [new Date().toISOString(), JSON.stringify(results), app.teamId!]);
      }
    });
  }
}

export function startPluginUpdateScheduler(app: AppContext): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      for (const team of await app.teams.all()) {
        if (stopped) break;
        if (team.status === "active") {
          try { await pluginUpdates(await app.forTeam(team.id)).check(); }
          catch { app.log.error("Plugin library update check failed."); }
        }
      }
    })().catch(() => app.log.error("Plugin library update check failed.")).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await running; for (const team of await app.teams.all()) await pluginUpdates(await app.forTeam(team.id)).idle(); };
}
