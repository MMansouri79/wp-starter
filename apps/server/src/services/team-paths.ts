import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { badRequest } from "../errors.js";

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
/** Also checks existing parent directories, so junctions/symlinks cannot bypass containment. */
export async function assertTeamPath(root: string, target: string): Promise<void> {
  if (!inside(root, path.resolve(target))) throw badRequest("unsafe_team_path", "A resource path escapes the team library.");
  const canonicalRoot = await realpath(root);
  let parent = path.resolve(target);
  for (;;) {
    try {
      if (!inside(canonicalRoot, await realpath(parent))) throw badRequest("unsafe_team_path", "A resource path escapes the team library.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parent = path.dirname(parent);
    }
  }
}
export async function validateResolvedPaths(root: string, value: unknown): Promise<void> {
  if (typeof value === "string" && path.isAbsolute(value)) await assertTeamPath(root, value);
  else if (Array.isArray(value)) for (const child of value) await validateResolvedPaths(root, child);
  else if (value && typeof value === "object") for (const child of Object.values(value)) await validateResolvedPaths(root, child);
}
/** Validate canonical registries before builder-core resolves or reads their file references. */
export async function validateTeamFiles(root: string): Promise<void> {
  if ((await lstat(root)).isSymbolicLink()) throw badRequest("unsafe_team_path", "Team libraries cannot be symbolic links.");
  async function check(value: unknown, base: string): Promise<void> {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && ["zip", "file", "documentFile", "configExport"].includes(key) && child) {
        if (path.win32.isAbsolute(child) && !path.isAbsolute(child)) throw badRequest("unsafe_team_path", "A resource path escapes the team library.");
        await assertTeamPath(root, path.resolve(base, child));
      } else await check(child, base);
    }
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.isSymbolicLink()) await assertTeamPath(root, path.join(root, entry.name));
    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json")) {
      const file = path.join(root, entry.name); await assertTeamPath(root, file);
      await check(JSON.parse(await readFile(file, "utf8")), root);
    }
  }
  for (const dir of ["vnext", "profiles"]) {
    const directory = path.join(root, dir);
    await assertTeamPath(root, directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json")) {
        const file = path.join(directory, entry.name);
        await assertTeamPath(root, file);
        await check(JSON.parse(await readFile(file, "utf8")), dir === "profiles" ? directory : root);
      }
    }
  }
}
