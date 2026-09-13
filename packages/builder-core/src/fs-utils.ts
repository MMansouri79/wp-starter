import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";

export async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureEmptyDir(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function sha256File(target: string): Promise<string> {
  const data = await readFile(target);
  return createHash("sha256").update(data).digest("hex");
}

export async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  await ensureDir(destination);
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      force: true
    });
  }
}

export async function findWordPressRoot(extractedDir: string): Promise<string> {
  const directAdmin = path.join(extractedDir, "wp-admin");
  const directIncludes = path.join(extractedDir, "wp-includes");
  if (await exists(directAdmin) && await exists(directIncludes)) {
    return extractedDir;
  }

  const entries = await readdir(extractedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extractedDir, entry.name);
    if (await exists(path.join(candidate, "wp-admin")) && await exists(path.join(candidate, "wp-includes"))) {
      return candidate;
    }
  }

  throw new BuilderError("invalid_wordpress_zip", "Could not find wp-admin and wp-includes in the WordPress ZIP.");
}

export async function detectPackageRoot(extractedDir: string, expectedSlug: string): Promise<string> {
  const exact = path.join(extractedDir, expectedSlug);
  if (await exists(exact) && (await stat(exact)).isDirectory()) {
    return exact;
  }

  const entries = await readdir(extractedDir, { withFileTypes: true });
  const visible = entries.filter((entry) => entry.name !== "__MACOSX");

  if (visible.length === 1 && visible[0].isDirectory()) {
    return path.join(extractedDir, visible[0].name);
  }

  return extractedDir;
}

export async function findFileRecursive(rootDir: string, filename: string): Promise<string | null> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === filename) return target;
    if (entry.isDirectory()) {
      const nested = await findFileRecursive(target, filename);
      if (nested) return nested;
    }
  }
  return null;
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(target));
  const absolute = path.resolve(target);
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rename(temporary, absolute);
  } finally {
    await rm(temporary, { force: true });
  }
}
