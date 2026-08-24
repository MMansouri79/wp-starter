import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { exists } from "./fs-utils.js";
import type { PackageKind, PackageInspection } from "./types.js";

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (!normalized) {
    throw new BuilderError("invalid_package_slug", `Could not derive a safe package slug from: ${value}`);
  }

  return normalized;
}

function readHeader(source: string, header: string): string | null {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^[\\t /*#@]*${escaped}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return match ? match[1].trim() : null;
}

async function candidateRoots(extractRoot: string): Promise<string[]> {
  const roots = [extractRoot];
  const entries = await readdir(extractRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "__MACOSX") {
      roots.push(path.join(extractRoot, entry.name));
    }
  }
  return roots;
}


async function detectWordPressLocale(root: string): Promise<string> {
  const languages = path.join(root, "wp-content", "languages");
  if (!(await exists(languages))) return "en_US";

  const counts = new Map<string, number>();
  async function scan(current: string, depth = 0): Promise<void> {
    if (depth > 2) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await scan(target, depth + 1);
        continue;
      }
      const match = entry.name.match(/(?:^|[-_])([a-z]{2,3}_[A-Z]{2})(?=\.(?:mo|po|l10n\.php)$)/);
      if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    }
  }
  await scan(languages);
  if (counts.size === 0) return "en_US";
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

async function inspectWordPress(extractRoot: string): Promise<PackageInspection | null> {
  for (const root of await candidateRoots(extractRoot)) {
    if (!(await exists(path.join(root, "wp-admin"))) || !(await exists(path.join(root, "wp-includes")))) {
      continue;
    }

    const versionFile = path.join(root, "wp-includes/version.php");
    if (!(await exists(versionFile))) {
      continue;
    }

    const source = await readFile(versionFile, "utf8");
    const match = source.match(/\$wp_version\s*=\s*['\"]([^'\"]+)['\"]/);
    if (!match) {
      throw new BuilderError("invalid_wordpress_package", "WordPress package was detected but wp-includes/version.php did not expose $wp_version.");
    }

    const localPackage = source.match(/\$wp_local_package\s*=\s*['"]([^'"]+)['"]/);
    const locale = localPackage?.[1] || await detectWordPressLocale(root);
    return {
      kind: "wordpress",
      slug: "wordpress",
      name: "WordPress",
      version: match[1],
      packageRoot: root,
      installDir: "wordpress",
      variant: locale,
      locale
    };
  }
  return null;
}

async function inspectTheme(extractRoot: string): Promise<PackageInspection | null> {
  for (const root of await candidateRoots(extractRoot)) {
    const styleFile = path.join(root, "style.css");
    if (!(await exists(styleFile))) continue;

    const source = (await readFile(styleFile, "utf8")).slice(0, 32768);
    const name = readHeader(source, "Theme Name");
    if (!name) continue;

    const version = readHeader(source, "Version");
    if (!version) {
      throw new BuilderError("missing_package_version", `Theme \"${name}\" does not declare a Version header.`);
    }

    const textDomain = readHeader(source, "Text Domain");
    const rootName = root === extractRoot ? null : path.basename(root);
    const slug = normalizeSlug(rootName || textDomain || name);
    const installDir = rootName || slug;

    return {
      kind: "theme",
      slug,
      name,
      version,
      packageRoot: root,
      installDir,
      textDomain: textDomain ?? undefined,
      requiresWordPress: readHeader(source, "Requires at least") ?? undefined,
      requiresPhp: readHeader(source, "Requires PHP") ?? undefined
    };
  }
  return null;
}

async function findPhpFiles(root: string, current: string = root, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const entries = await readdir(current, { withFileTypes: true });
  const matches: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__MACOSX" || entry.name.startsWith(".")) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findPhpFiles(root, target, depth + 1));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".php")) {
      matches.push(target);
    }
  }
  return matches;
}

async function inspectPlugin(extractRoot: string): Promise<PackageInspection | null> {
  const phpFiles = await findPhpFiles(extractRoot);
  const candidates: Array<{
    file: string;
    name: string;
    version: string | null;
    textDomain: string | null;
    requiresWordPress: string | null;
    requiresPhp: string | null;
    requiresPlugins: string | null;
  }> = [];

  for (const file of phpFiles) {
    const source = (await readFile(file, "utf8")).slice(0, 32768);
    const name = readHeader(source, "Plugin Name");
    if (!name) continue;
    candidates.push({
      file,
      name,
      version: readHeader(source, "Version"),
      textDomain: readHeader(source, "Text Domain"),
      requiresWordPress: readHeader(source, "Requires at least"),
      requiresPhp: readHeader(source, "Requires PHP"),
      requiresPlugins: readHeader(source, "Requires Plugins")
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const depthA = normalizeSlashes(path.relative(extractRoot, a.file)).split("/").length;
    const depthB = normalizeSlashes(path.relative(extractRoot, b.file)).split("/").length;
    return depthA - depthB;
  });

  const candidate = candidates[0];
  if (!candidate.version) {
    throw new BuilderError("missing_package_version", `Plugin \"${candidate.name}\" does not declare a Version header.`);
  }

  const relativeFromExtract = path.relative(extractRoot, candidate.file);
  const pathParts = relativeFromExtract.split(path.sep);
  let packageRoot = extractRoot;
  let slugSource = candidate.textDomain || path.basename(candidate.file, path.extname(candidate.file));

  if (pathParts.length > 1) {
    packageRoot = path.join(extractRoot, pathParts[0]);
    slugSource = pathParts[0];
  }

  const slug = normalizeSlug(slugSource);
  const installDir = packageRoot === extractRoot ? slug : path.basename(packageRoot);
  const mainRelative = normalizeSlashes(path.relative(packageRoot, candidate.file));
  const mainFile = `${installDir}/${mainRelative}`;

  return {
    kind: "plugin",
    slug,
    name: candidate.name,
    version: candidate.version,
    packageRoot,
    installDir,
    mainFile,
    textDomain: candidate.textDomain ?? undefined,
    requiresWordPress: candidate.requiresWordPress ?? undefined,
    requiresPhp: candidate.requiresPhp ?? undefined,
    requiresPlugins: candidate.requiresPlugins
      ? candidate.requiresPlugins.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined
  };
}

export async function inspectPackage(zipPath: string, kindHint?: PackageKind): Promise<PackageInspection> {
  const absolute = path.resolve(zipPath);
  if (!(await exists(absolute))) {
    throw new BuilderError("missing_input", `Package ZIP does not exist: ${absolute}`);
  }
  if (path.extname(absolute).toLowerCase() !== ".zip") {
    throw new BuilderError("invalid_package", "Package input must be a .zip file.");
  }

  const workRoot = await mkdtemp(path.join(os.tmpdir(), "wp-starter-inspect-"));
  try {
    await extractZip(absolute, workRoot);

    const inspectors: Array<[PackageKind, () => Promise<PackageInspection | null>]> = [
      ["wordpress", () => inspectWordPress(workRoot)],
      ["theme", () => inspectTheme(workRoot)],
      ["plugin", () => inspectPlugin(workRoot)]
    ];

    if (kindHint) {
      const inspector = inspectors.find(([kind]) => kind === kindHint);
      if (!inspector) throw new BuilderError("invalid_package_type", `Unsupported package type: ${kindHint}`);
      const result = await inspector[1]();
      if (!result) {
        throw new BuilderError("package_type_mismatch", `The ZIP does not look like a ${kindHint} package.`);
      }
      return result;
    }

    for (const [, inspect] of inspectors) {
      const result = await inspect();
      if (result) return result;
    }

    throw new BuilderError("unknown_package", "Could not detect this ZIP as WordPress core, a WordPress theme, or a WordPress plugin.");
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
