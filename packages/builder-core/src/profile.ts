import { readFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { exists } from "./fs-utils.js";
import { PackageRegistry, defaultLibraryDir } from "./registry.js";
import { ConfigSnapshotRegistry } from "./snapshot.js";
import type { BuildProfile, ProfileDocumentV3 } from "./types.js";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BuilderError("invalid_profile", `${field} must be a non-empty string.`);
  }
  return value;
}

export interface LoadProfileOptions {
  libraryDir?: string;
}


async function resolveRegistryArtifacts(raw: any, libraryDir: string): Promise<{ wordpress: any; theme: any; plugins: any[] }> {
  const registry = new PackageRegistry(libraryDir);
  const wordpress = await registry.resolve("wordpress", "wordpress", raw.wordpress.version);
  const theme = await registry.resolve("theme", raw.theme.slug, raw.theme.version);

  const plugins = [];
  for (let index = 0; index < raw.plugins.length; index++) {
    const plugin = raw.plugins[index];
    const slug = requireString(plugin.slug, `plugins[${index}].slug`);
    const version = requireString(plugin.version, `plugins[${index}].version`);
    const locales = Array.isArray(plugin.locales) ? plugin.locales.map(String) : undefined;

    if (locales && !locales.includes(raw.locale)) {
      plugins.push({
        slug,
        version,
        file: typeof plugin.file === "string" && plugin.file ? plugin.file : `${slug}/${slug}.php`,
        zip: path.join(libraryDir, "__locale-skipped__", `${slug}-${version}.zip`),
        required: plugin.required !== false,
        locales
      });
      continue;
    }

    const record = await registry.resolve("plugin", slug, version);
    if (!record.mainFile) {
      throw new BuilderError("invalid_registry", `Plugin ${slug}@${version} has no detected main plugin file in the package registry.`);
    }

    plugins.push({
      slug: record.installDir,
      version,
      file: record.mainFile,
      zip: record.absoluteZip,
      required: plugin.required !== false,
      locales
    });
  }

  return { wordpress, theme, plugins };
}

async function loadSchema1(raw: any, absolute: string): Promise<BuildProfile> {
  requireString(raw.name, "name");
  requireString(raw.locale, "locale");
  requireString(raw.wordpress?.version, "wordpress.version");
  requireString(raw.wordpress?.zip, "wordpress.zip");
  requireString(raw.theme?.slug, "theme.slug");
  requireString(raw.theme?.version, "theme.version");
  requireString(raw.theme?.zip, "theme.zip");
  requireString(raw.configExport, "configExport");

  if (!Array.isArray(raw.plugins)) {
    throw new BuilderError("invalid_profile", "plugins must be an array.");
  }

  const base = path.dirname(absolute);
  const resolveLocal = (input: string) => path.resolve(base, input);

  return {
    schemaVersion: 1,
    name: raw.name,
    locale: raw.locale,
    wordpress: {
      version: raw.wordpress.version,
      zip: resolveLocal(raw.wordpress.zip)
    },
    theme: {
      slug: raw.theme.slug,
      version: raw.theme.version,
      zip: resolveLocal(raw.theme.zip)
    },
    plugins: raw.plugins.map((plugin: any, index: number) => ({
      slug: requireString(plugin.slug, `plugins[${index}].slug`),
      file: requireString(plugin.file, `plugins[${index}].file`),
      version: requireString(plugin.version, `plugins[${index}].version`),
      zip: resolveLocal(requireString(plugin.zip, `plugins[${index}].zip`)),
      required: plugin.required !== false,
      locales: Array.isArray(plugin.locales) ? plugin.locales.map(String) : undefined
    })),
    configExport: resolveLocal(raw.configExport),
    languageArchives: Array.isArray(raw.languageArchives)
      ? raw.languageArchives.map((archive: any, index: number) => ({
          locale: requireString(archive.locale, `languageArchives[${index}].locale`),
          zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`))
        }))
      : []
  };
}

async function loadSchema2(raw: any, absolute: string, options: LoadProfileOptions): Promise<BuildProfile> {
  requireString(raw.name, "name");
  requireString(raw.locale, "locale");
  requireString(raw.wordpress?.version, "wordpress.version");
  requireString(raw.theme?.slug, "theme.slug");
  requireString(raw.theme?.version, "theme.version");
  requireString(raw.configExport, "configExport");

  if (!Array.isArray(raw.plugins)) {
    throw new BuilderError("invalid_profile", "plugins must be an array.");
  }

  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir());
  const { wordpress, theme, plugins } = await resolveRegistryArtifacts(raw, libraryDir);
  const base = path.dirname(absolute);
  const resolveLocal = (input: string) => path.resolve(base, input);

  return {
    schemaVersion: 2,
    name: raw.name,
    locale: raw.locale,
    wordpress: { version: raw.wordpress.version, zip: wordpress.absoluteZip },
    theme: { slug: theme.installDir, version: raw.theme.version, zip: theme.absoluteZip },
    plugins,
    configExport: resolveLocal(raw.configExport),
    languageArchives: Array.isArray(raw.languageArchives)
      ? raw.languageArchives.map((archive: any, index: number) => ({
          locale: requireString(archive.locale, `languageArchives[${index}].locale`),
          zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`))
        }))
      : []
  };
}

async function loadSchema3(raw: any, absolute: string, options: LoadProfileOptions): Promise<BuildProfile> {
  requireString(raw.name, "name");
  requireString(raw.locale, "locale");
  requireString(raw.wordpress?.version, "wordpress.version");
  requireString(raw.theme?.slug, "theme.slug");
  requireString(raw.theme?.version, "theme.version");
  requireString(raw.config?.id, "config.id");

  if (!Array.isArray(raw.plugins)) {
    throw new BuilderError("invalid_profile", "plugins must be an array.");
  }

  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir());
  const { wordpress, theme, plugins } = await resolveRegistryArtifacts(raw, libraryDir);
  const snapshot = await new ConfigSnapshotRegistry(libraryDir).resolve(raw.config.id);
  const base = path.dirname(absolute);
  const resolveLocal = (input: string) => path.resolve(base, input);

  return {
    schemaVersion: 3,
    name: raw.name,
    locale: raw.locale,
    wordpress: { version: raw.wordpress.version, zip: wordpress.absoluteZip },
    theme: { slug: theme.installDir, version: raw.theme.version, zip: theme.absoluteZip },
    plugins,
    configExport: snapshot.absoluteZip,
    languageArchives: Array.isArray(raw.languageArchives)
      ? raw.languageArchives.map((archive: any, index: number) => ({
          locale: requireString(archive.locale, `languageArchives[${index}].locale`),
          zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`))
        }))
      : []
  };
}

export async function loadProfile(profilePath: string, options: LoadProfileOptions = {}): Promise<BuildProfile> {
  const absolute = path.resolve(profilePath);
  let raw: any;
  try {
    raw = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new BuilderError("invalid_profile", `Could not read profile JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  let profile: BuildProfile;
  if (raw.schemaVersion === 1) {
    profile = await loadSchema1(raw, absolute);
  } else if (raw.schemaVersion === 2) {
    profile = await loadSchema2(raw, absolute, options);
  } else if (raw.schemaVersion === 3) {
    profile = await loadSchema3(raw, absolute, options);
  } else {
    throw new BuilderError("invalid_profile", "Only profile schemaVersion 1, 2 and 3 are supported.");
  }

  const requiredPaths = [
    profile.wordpress.zip,
    profile.theme.zip,
    profile.configExport,
    ...profile.plugins
      .filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale))
      .map((plugin) => plugin.zip),
    ...(profile.languageArchives ?? [])
      .filter((archive) => archive.locale === profile.locale)
      .map((archive) => archive.zip)
  ];

  for (const input of requiredPaths) {
    if (!(await exists(input))) {
      throw new BuilderError("missing_input", `Input file does not exist: ${input}`);
    }
  }

  return profile;
}


export interface CreateProfileFromSnapshotOptions {
  libraryDir?: string;
  name?: string;
}

/**
 * Create a schema v3 profile pinned to the exact package coordinates recorded
 * by a configuration snapshot. The snapshot is treated as the source of truth
 * for the initial profile, while the generated JSON remains editable later so
 * a developer can deliberately move individual package versions forward.
 */
export async function createProfileFromSnapshot(
  snapshotId: string,
  options: CreateProfileFromSnapshotOptions = {}
): Promise<ProfileDocumentV3> {
  if (typeof snapshotId !== "string" || snapshotId.trim() === "") {
    throw new BuilderError("invalid_profile", "A non-empty configuration snapshot ID is required.");
  }

  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir());
  const snapshots = new ConfigSnapshotRegistry(libraryDir);
  const snapshot = await snapshots.resolve(snapshotId);
  const report = await snapshots.requirements(snapshotId, new PackageRegistry(libraryDir));

  if (report.missing > 0) {
    const missing = report.requirements
      .filter((item) => item.status === "missing")
      .map((item) => `${item.kind}:${item.slug}@${item.version}`)
      .join(", ");
    throw new BuilderError(
      "missing_profile_packages",
      `Cannot create a build-ready profile because ${report.missing} required package(s) are missing: ${missing}`
    );
  }

  return {
    schemaVersion: 3,
    name: options.name?.trim() || snapshot.id,
    locale: snapshot.locale,
    wordpress: { version: snapshot.wordpressVersion },
    theme: { slug: snapshot.theme.slug, version: snapshot.theme.version },
    plugins: snapshot.plugins.map((plugin) => ({
      slug: plugin.slug,
      version: plugin.version,
      required: true
    })),
    config: { id: snapshot.id },
    languageArchives: []
  };
}
