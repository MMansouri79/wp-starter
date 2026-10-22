import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { SqlDatabase } from "../db/driver.js";
import { CONTENT_TABLES, LEGACY_TEAM_ID, migrate } from "../db/migrations.js";
import { safeFileName } from "../http/body.js";

const PAYLOAD_ENTRIES = ["registry.json", "configs.json", "fonts.json", "elementor-templates.json", "sample-content.json", "packages", "configs", "fonts", "elementor-templates", "sample-assets", "profiles", "builds", "vnext"];
interface FileCheckpoint { relative: string; sha256: string; }
interface Checkpoint { version: 1; teamId: string; files: FileCheckpoint[]; }
async function present(file: string): Promise<boolean> { try { await stat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function inventory(root: string): Promise<FileCheckpoint[]> {
  const files: FileCheckpoint[] = [];
  async function scan(relative: string) {
    const target = path.join(root, relative);
    const { lstat } = await import("node:fs/promises");
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Migration refuses a symbolic link: ${relative}`);
    if (info.isDirectory()) for (const name of await readdir(target)) await scan(path.join(relative, name));
    else if (info.isFile()) files.push({ relative, sha256: await digest(target) });
  }
  for (const entry of PAYLOAD_ENTRIES) if (await present(path.join(root, entry))) await scan(entry);
  return files;
}
export async function hasLegacyPayload(root: string): Promise<boolean> {
  async function hasFile(target: string): Promise<boolean> {
    const { lstat } = await import("node:fs/promises");
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("Legacy library contains a symbolic link. Review it before migration.");
    if (info.isFile()) return true;
    if (info.isDirectory()) for (const name of await readdir(target)) if (await hasFile(path.join(target, name))) return true;
    return false;
  }
  for (const entry of PAYLOAD_ENTRIES) if (await present(path.join(root, entry)) && await hasFile(path.join(root, entry))) return true;
  return false;
}

/** Run only with the server stopped and a coordinated backup already taken. */
export async function migrateTeamLibrary(db: SqlDatabase, dataDir: string, dryRun = false) {
  const sourceRoot = path.resolve(dataDir);
  const targetRoot = path.join(sourceRoot, "teams", LEGACY_TEAM_ID);
  const checkpointFile = path.join(sourceRoot, "team-migration.checkpoint.json");
  let checkpoint: Checkpoint;
  const savedCheckpoint = await present(checkpointFile) ? checkpointFile : await present(`${checkpointFile}.tmp`) ? `${checkpointFile}.tmp` : null;
  if (savedCheckpoint) {
    checkpoint = JSON.parse(await readFile(savedCheckpoint, "utf8")) as Checkpoint;
    if (checkpoint.version !== 1 || checkpoint.teamId !== LEGACY_TEAM_ID || !Array.isArray(checkpoint.files)) throw new Error("Invalid team migration checkpoint.");
  } else checkpoint = { version: 1, teamId: LEGACY_TEAM_ID, files: await inventory(sourceRoot) };
  for (const file of checkpoint.files) {
    const relative = path.relative(sourceRoot, path.resolve(sourceRoot, file.relative));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !PAYLOAD_ENTRIES.includes(relative.split(path.sep)[0])) throw new Error("Unsafe migration checkpoint path.");
  }
  const counts: Record<string, number> = {};
  for (const table of ["users", ...CONTENT_TABLES]) counts[table] = Number((await db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`))?.total ?? 0);
  const summary = { teamId: LEGACY_TEAM_ID, files: checkpoint.files.length, rows: counts, dryRun };
  if (dryRun) return summary;
  if (savedCheckpoint === `${checkpointFile}.tmp`) await rename(savedCheckpoint, checkpointFile);
  await migrate(db);
  let state = await db.get<{ state: string }>("SELECT state FROM team_migration WHERE id = 'library'");
  // A filesystem-only legacy library must also be upgraded, even when the database was empty.
  if (!await db.get("SELECT id FROM teams WHERE id = ?", [LEGACY_TEAM_ID]) && checkpoint.files.length) {
    await db.run("INSERT INTO teams (id, name, status, created_by, created_at) VALUES (?, 'Our team', 'active', NULL, ?)", [LEGACY_TEAM_ID, new Date().toISOString()]);
    await db.run("UPDATE team_migration SET state = 'pending' WHERE id = 'library'");
    state = { state: "pending" };
  }
  if (state?.state === "complete" && !checkpoint.files.length) return summary;
  if (state?.state === "complete" && await present(checkpointFile)) return summary;
  // Persist the full checksum inventory before moving even the first file.
  if (!await present(checkpointFile)) {
    await writeFile(`${checkpointFile}.tmp`, JSON.stringify(checkpoint, null, 2), { flag: "wx" });
    await rename(`${checkpointFile}.tmp`, checkpointFile);
  }
  await mkdir(targetRoot, { recursive: true });
  for (const file of checkpoint.files) {
    const source = path.join(sourceRoot, file.relative);
    const destination = path.join(targetRoot, file.relative);
    if (await present(destination)) {
      if (await digest(destination) !== file.sha256) throw new Error(`Destination checksum mismatch: ${file.relative}`);
      if (await present(source)) throw new Error(`Both migration source and destination exist: ${file.relative}`);
      continue;
    }
    if (!await present(source) || await digest(source) !== file.sha256) throw new Error(`Source missing or changed: ${file.relative}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    if (await digest(destination) !== file.sha256) throw new Error(`Moved file checksum mismatch: ${file.relative}`);
  }
  for (const file of checkpoint.files) if (await digest(path.join(targetRoot, file.relative)) !== file.sha256) throw new Error("Migration verification failed.");
  if (await hasLegacyPayload(sourceRoot)) throw new Error("Unexpected legacy payload files remain. Keep the server stopped and recover the migration from the coordinated backup.");
  for (const build of await db.all<{ id: string; artifact_file: string }>("SELECT id, artifact_file FROM builds WHERE team_id = ? AND artifact_file IS NOT NULL", [LEGACY_TEAM_ID])) {
    if (safeFileName(build.artifact_file, "") !== build.artifact_file) throw new Error("Unsafe legacy build artifact filename.");
    await db.run("UPDATE builds SET artifact_path = ? WHERE team_id = ? AND id = ?", [path.join(targetRoot, "builds", build.artifact_file), LEGACY_TEAM_ID, build.id]);
  }
  // The empty legacy directories are retained; no recursive delete is needed.
  await db.run("UPDATE team_migration SET state = 'complete' WHERE id = 'library'");
  return summary;
}
