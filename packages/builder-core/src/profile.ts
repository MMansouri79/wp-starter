import { readFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { exists } from "./fs-utils.js";
import type { BuildProfile } from "./types.js";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BuilderError("invalid_profile", `${field} must be a non-empty string.`);
  }
  return value;
}

export async function loadProfile(profilePath: string): Promise<BuildProfile> {
  const absolute = path.resolve(profilePath);
  const raw = JSON.parse(await readFile(absolute, "utf8"));

  if (raw.schemaVersion !== 1) {
    throw new BuilderError("invalid_profile", "Only profile schemaVersion 1 is supported.");
  }

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

  const profile: BuildProfile = {
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

  const requiredPaths = [
    profile.wordpress.zip,
    profile.theme.zip,
    profile.configExport,
    ...profile.plugins.map((plugin) => plugin.zip),
    ...(profile.languageArchives ?? []).map((archive) => archive.zip)
  ];

  for (const input of requiredPaths) {
    if (!(await exists(input))) {
      throw new BuilderError("missing_input", `Input file does not exist: ${input}`);
    }
  }

  return profile;
}
