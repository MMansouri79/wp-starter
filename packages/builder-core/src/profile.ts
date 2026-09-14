import { readFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { exists } from "./fs-utils.js";
import { FontSystemRegistry } from "./fonts.js";
import { PackageRegistry, defaultLibraryDir } from "./registry.js";
import { ConfigSnapshotRegistry } from "./snapshot.js";
import type {
  BuildProfile,
  ConfigSnapshotRecord,
  ElementorTemplateSelection,
  ProfileDocumentV3,
  ProfileDocumentV4,
  ProfileDocumentV5,
  ProfileDocumentV6,
  ProfileDocumentV7
} from "./types.js";

function requireFontDependencies(pluginSlugs: string[], fontSystemId?: string | null): void {
  if (!fontSystemId) return;
  const set = new Set(pluginSlugs);
  if (!set.has("elementor") || !set.has("elementor-pro")) {
    throw new BuilderError("font_dependencies_missing", "A font system requires both Elementor and Elementor Pro in the build profile.");
  }
}

function requireElementorForTemplates(pluginSlugs: string[], templates: unknown[]): void {
  if (templates.length > 0 && !pluginSlugs.includes("elementor")) {
    throw new BuilderError("elementor_required", "Selected Elementor templates require Elementor to remain included in the build profile.");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new BuilderError("invalid_profile", `${field} must be a non-empty string.`);
  return value;
}

export interface LoadProfileOptions { libraryDir?: string; }

async function resolveRegistryArtifacts(raw: any, libraryDir: string): Promise<{ wordpress: any; theme: any | null; plugins: any[] }> {
  const registry = new PackageRegistry(libraryDir);
  const wordpressVariant = typeof raw.wordpress?.variant === "string" && raw.wordpress.variant.trim()
    ? raw.wordpress.variant.trim()
    : typeof raw.locale === "string" && raw.locale.trim() ? raw.locale.trim() : undefined;
  const wordpress = await registry.resolve("wordpress", "wordpress", raw.wordpress.version, wordpressVariant);

  let theme = null;
  if (raw.theme) theme = await registry.resolve("theme", raw.theme.slug, raw.theme.version);

  const plugins = [];
  for (let index = 0; index < raw.plugins.length; index++) {
    const plugin = raw.plugins[index];
    const slug = requireString(plugin.slug, `plugins[${index}].slug`);
    const version = requireString(plugin.version, `plugins[${index}].version`);
    const locales = Array.isArray(plugin.locales) ? plugin.locales.map(String) : undefined;
    if (locales && !locales.includes(raw.locale)) {
      plugins.push({ slug, version, file: typeof plugin.file === "string" && plugin.file ? plugin.file : `${slug}/${slug}.php`, zip: path.join(libraryDir, "__locale-skipped__", `${slug}-${version}.zip`), required: plugin.required !== false, locales });
      continue;
    }
    const record = await registry.resolve("plugin", slug, version);
    if (!record.mainFile) throw new BuilderError("invalid_registry", `Plugin ${slug}@${version} has no detected main plugin file in the package registry.`);
    plugins.push({
      slug: record.slug,
      installDir: record.installDir,
      version,
      file: record.mainFile,
      zip: record.absoluteZip,
      required: plugin.required !== false,
      locales,
      requiresWordPress: record.requiresWordPress,
      requiresPhp: record.requiresPhp,
      requiresPlugins: record.requiresPlugins
    });
  }
  return { wordpress, theme, plugins };
}

async function loadLegacySchema1(raw: any, absolute: string): Promise<BuildProfile> {
  requireString(raw.name, "name"); requireString(raw.locale, "locale"); requireString(raw.wordpress?.version, "wordpress.version"); requireString(raw.wordpress?.zip, "wordpress.zip");
  requireString(raw.theme?.slug, "theme.slug"); requireString(raw.theme?.version, "theme.version"); requireString(raw.theme?.zip, "theme.zip"); requireString(raw.configExport, "configExport");
  if (!Array.isArray(raw.plugins)) throw new BuilderError("invalid_profile", "plugins must be an array.");
  const base = path.dirname(absolute); const resolveLocal = (input: string) => path.resolve(base, input);
  return {
    schemaVersion: 1, name: raw.name, locale: raw.locale,
    wordpress: { version: raw.wordpress.version, zip: resolveLocal(raw.wordpress.zip) },
    theme: { slug: raw.theme.slug, version: raw.theme.version, zip: resolveLocal(raw.theme.zip) },
    plugins: raw.plugins.map((plugin: any, index: number) => ({ slug: requireString(plugin.slug, `plugins[${index}].slug`), file: requireString(plugin.file, `plugins[${index}].file`), version: requireString(plugin.version, `plugins[${index}].version`), zip: resolveLocal(requireString(plugin.zip, `plugins[${index}].zip`)), required: plugin.required !== false, locales: Array.isArray(plugin.locales) ? plugin.locales.map(String) : undefined })),
    configExport: resolveLocal(raw.configExport), fontSystem: null, vnext: null,
    languageArchives: Array.isArray(raw.languageArchives) ? raw.languageArchives.map((archive: any, index: number) => ({ locale: requireString(archive.locale, `languageArchives[${index}].locale`), zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`)) })) : []
  };
}

async function loadLegacySchema2(raw: any, absolute: string, options: LoadProfileOptions): Promise<BuildProfile> {
  requireString(raw.name, "name"); requireString(raw.locale, "locale"); requireString(raw.wordpress?.version, "wordpress.version"); requireString(raw.theme?.slug, "theme.slug"); requireString(raw.theme?.version, "theme.version"); requireString(raw.configExport, "configExport");
  if (!Array.isArray(raw.plugins)) throw new BuilderError("invalid_profile", "plugins must be an array.");
  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir()); const { wordpress, theme, plugins } = await resolveRegistryArtifacts(raw, libraryDir);
  const base = path.dirname(absolute); const resolveLocal = (input: string) => path.resolve(base, input);
  return { schemaVersion: 2, name: raw.name, locale: raw.locale, wordpress: { version: raw.wordpress.version, variant: wordpress.variant, zip: wordpress.absoluteZip }, theme: theme ? { slug: theme.slug, installDir: theme.installDir, version: raw.theme.version, zip: theme.absoluteZip, requiresWordPress: theme.requiresWordPress, requiresPhp: theme.requiresPhp } : null, plugins, configExport: resolveLocal(raw.configExport), fontSystem: null, vnext: null, languageArchives: Array.isArray(raw.languageArchives) ? raw.languageArchives.map((archive: any, index: number) => ({ locale: requireString(archive.locale, `languageArchives[${index}].locale`), zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`)) })) : [] };
}

async function loadRegistryProfile(raw: any, absolute: string, options: LoadProfileOptions, schemaVersion: 3 | 4 | 5 | 6 | 7): Promise<BuildProfile> {
  requireString(raw.name, "name"); requireString(raw.locale, "locale"); requireString(raw.wordpress?.version, "wordpress.version");
  if (schemaVersion >= 4) requireString(raw.wordpress?.variant, "wordpress.variant");
  if (schemaVersion < 5 || raw.theme !== null) { requireString(raw.theme?.slug, "theme.slug"); requireString(raw.theme?.version, "theme.version"); }
  if (schemaVersion < 5 || raw.config !== null) requireString(raw.config?.id, "config.id");
  if (!Array.isArray(raw.plugins)) throw new BuilderError("invalid_profile", "plugins must be an array.");
  if (schemaVersion === 7 && !Array.isArray(raw.elementorTemplates)) throw new BuilderError("invalid_profile", "elementorTemplates must be an array in profile schema v7.");

  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir());
  const { wordpress, theme, plugins } = await resolveRegistryArtifacts(raw, libraryDir);
  const snapshots = new ConfigSnapshotRegistry(libraryDir);
  const snapshot = raw.config?.id ? await snapshots.resolve(raw.config.id) : null;
  const selected: ElementorTemplateSelection[] = schemaVersion === 7 ? raw.elementorTemplates.map((entry: any, index: number) => ({ snapshotId: requireString(entry?.snapshotId, `elementorTemplates[${index}].snapshotId`), templateId: requireString(entry?.templateId, `elementorTemplates[${index}].templateId`) })) : [];
  if (schemaVersion === 7 && selected.length > 0 && !snapshot) throw new BuilderError("invalid_profile", "Elementor template selections require a base configuration snapshot.");
  const elementorTemplates = schemaVersion === 7 ? await snapshots.resolveElementorTemplates(selected, { requireClosed: true }) : undefined;
  requireElementorForTemplates(plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(raw.locale)).map((plugin) => plugin.slug), elementorTemplates || []);
  const fontSystem = schemaVersion >= 6 && raw.fontSystem?.id ? await new FontSystemRegistry(libraryDir).resolve(requireString(raw.fontSystem.id, "fontSystem.id")) : null;
  const base = path.dirname(absolute); const resolveLocal = (input: string) => path.resolve(base, input);
  return {
    schemaVersion, name: raw.name, locale: raw.locale,
    wordpress: { version: raw.wordpress.version, variant: wordpress.variant, zip: wordpress.absoluteZip },
    theme: theme ? { slug: theme.slug, installDir: theme.installDir, version: raw.theme.version, zip: theme.absoluteZip, requiresWordPress: theme.requiresWordPress, requiresPhp: theme.requiresPhp } : null,
    plugins, configExport: snapshot ? snapshot.absoluteZip : null, fontSystem, vnext: raw.vnext ?? null,
    elementorTemplates,
    configurationSnapshotId: raw.config?.id,
    configurationSource: snapshot ? {
      wordpressVersion: snapshot.wordpressVersion,
      locale: snapshot.locale,
      theme: { slug: snapshot.theme.slug, version: snapshot.theme.version },
      plugins: snapshot.plugins.map((plugin) => ({ slug: plugin.slug, version: plugin.version })),
      exportedPlugins: (snapshot.sourcePlugins || snapshot.plugins).map((plugin) => ({ slug: plugin.slug, version: plugin.version }))
    } : undefined,
    languageArchives: Array.isArray(raw.languageArchives) ? raw.languageArchives.map((archive: any, index: number) => ({ locale: requireString(archive.locale, `languageArchives[${index}].locale`), zip: resolveLocal(requireString(archive.zip, `languageArchives[${index}].zip`)) })) : []
  };
}

export async function loadProfile(profilePath: string, options: LoadProfileOptions = {}): Promise<BuildProfile> {
  const absolute = path.resolve(profilePath);
  let raw: any;
  try { raw = JSON.parse(await readFile(absolute, "utf8")); }
  catch (error) { throw new BuilderError("invalid_profile", `Could not read profile JSON: ${error instanceof Error ? error.message : String(error)}`); }
  let profile: BuildProfile;
  if (raw.schemaVersion === 1) profile = await loadLegacySchema1(raw, absolute);
  else if (raw.schemaVersion === 2) profile = await loadLegacySchema2(raw, absolute, options);
  else if ([3, 4, 5, 6, 7].includes(raw.schemaVersion)) profile = await loadRegistryProfile(raw, absolute, options, raw.schemaVersion);
  else throw new BuilderError("invalid_profile", "Only profile schemaVersion 1 through 7 are supported.");

  requireFontDependencies(profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale)).map((plugin) => plugin.slug), profile.fontSystem?.id);
  const requiredPaths = [profile.wordpress.zip, ...(profile.theme ? [profile.theme.zip] : []), ...(profile.configExport ? [profile.configExport] : []), ...profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale)).map((plugin) => plugin.zip), ...(profile.fontSystem?.faces || []).map((face) => face.absoluteFile), ...(profile.languageArchives ?? []).filter((archive) => archive.locale === profile.locale).map((archive) => archive.zip)];
  for (const input of requiredPaths) if (!(await exists(input))) throw new BuilderError("missing_input", `Input file does not exist: ${input}`);
  return profile;
}

export interface CreateProfileFromSnapshotOptions {
  libraryDir?: string; name?: string; locale?: string; excludePlugins?: string[]; wordpressVersion?: string; wordpressVariant?: string; themeVersion?: string; pluginVersions?: Record<string, string>; fontSystemId?: string | null; elementorTemplates?: ElementorTemplateSelection[];
}

export async function createProfileFromSnapshot(snapshotId: string, options: CreateProfileFromSnapshotOptions = {}): Promise<ProfileDocumentV7> {
  if (typeof snapshotId !== "string" || snapshotId.trim() === "") throw new BuilderError("invalid_profile", "A non-empty configuration snapshot ID is required.");
  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir()); const snapshots = new ConfigSnapshotRegistry(libraryDir); const snapshot = await snapshots.resolve(snapshotId); const packages = new PackageRegistry(libraryDir);
  const excluded = new Set((options.excludePlugins ?? []).map((slug) => slug.trim()).filter(Boolean)); const locale = options.locale?.trim() || snapshot.locale; if (!locale) throw new BuilderError("invalid_profile", "Profile locale cannot be empty.");
  const wordpressVersion = options.wordpressVersion?.trim() || snapshot.wordpressVersion; const wordpressVariant = options.wordpressVariant?.trim() || locale || "en_US"; const themeVersion = options.themeVersion?.trim() || snapshot.theme.version; const missing: string[] = [];

  const requestedTemplates = options.elementorTemplates ?? (await snapshots.listElementorTemplatesForSnapshot(snapshotId)).map((template) => ({ snapshotId, templateId: template.templateId }));
  const selectedTemplates = await snapshots.resolveElementorTemplates(requestedTemplates);
  const snapshotPlugins = [...snapshot.plugins];
  if (selectedTemplates.length > 0 && !snapshotPlugins.some((plugin) => plugin.slug === "elementor")) {
    const sourceSnapshots = new Map<string, ConfigSnapshotRecord & { absoluteZip: string }>();
    sourceSnapshots.set(snapshot.id, snapshot);
    for (const selected of selectedTemplates) {
      if (!sourceSnapshots.has(selected.snapshotId)) sourceSnapshots.set(selected.snapshotId, await snapshots.resolve(selected.snapshotId));
    }
    const sourceElementor = [...sourceSnapshots.values()]
      .flatMap((sourceSnapshot) => sourceSnapshot.sourcePlugins?.length ? sourceSnapshot.sourcePlugins : sourceSnapshot.plugins)
      .find((plugin) => plugin.slug === "elementor");
    if (!sourceElementor) requireElementorForTemplates(snapshotPlugins.map((plugin) => plugin.slug), selectedTemplates);
    else snapshotPlugins.push(sourceElementor);
  }
  if (selectedTemplates.length > 0) excluded.delete("elementor");

  try { await packages.resolve("wordpress", "wordpress", wordpressVersion, wordpressVariant); } catch (error) { if (error instanceof BuilderError && error.code === "package_not_found") missing.push(`wordpress:wordpress@${wordpressVersion} (${wordpressVariant})`); else throw error; }
  try { await packages.resolve("theme", snapshot.theme.slug, themeVersion); } catch (error) { if (error instanceof BuilderError && error.code === "package_not_found") missing.push(`theme:${snapshot.theme.slug}@${themeVersion}`); else throw error; }
  const plugins = [];
  for (const plugin of snapshotPlugins) {
    if (excluded.has(plugin.slug)) continue;
    const version = options.pluginVersions?.[plugin.slug]?.trim() || plugin.version;
    try { await packages.resolve("plugin", plugin.slug, version); } catch (error) { if (error instanceof BuilderError && error.code === "package_not_found") missing.push(`plugin:${plugin.slug}@${version}`); else throw error; }
    plugins.push({ slug: plugin.slug, version, required: true });
  }
  requireFontDependencies(plugins.map((plugin) => plugin.slug), options.fontSystemId);
  if (options.fontSystemId) await new FontSystemRegistry(libraryDir).resolve(options.fontSystemId);
  if (missing.length > 0) throw new BuilderError("missing_profile_packages", `Cannot create a build-ready profile because ${missing.length} selected package(s) are missing: ${missing.join(", ")}`);
  return { schemaVersion: 7, name: options.name?.trim() || snapshot.id, locale, wordpress: { version: wordpressVersion, variant: wordpressVariant }, theme: { slug: snapshot.theme.slug, version: themeVersion }, plugins, config: { id: snapshot.id }, fontSystem: options.fontSystemId ? { id: options.fontSystemId } : null, elementorTemplates: selectedTemplates.map((template) => ({ snapshotId: template.snapshotId, templateId: template.templateId })), languageArchives: [] };
}

export interface CreateProfileFromPackagesOptions {
  libraryDir?: string; name: string; locale: string; wordpressVersion: string; wordpressVariant: string; themeSlug?: string | null; themeVersion?: string | null; plugins?: Record<string, string>; fontSystemId?: string | null; elementorTemplates?: ElementorTemplateSelection[];
}

export async function createProfileFromPackages(options: CreateProfileFromPackagesOptions): Promise<ProfileDocumentV7> {
  const libraryDir = path.resolve(options.libraryDir || defaultLibraryDir()); const packages = new PackageRegistry(libraryDir); const name = requireString(options.name, "name").trim(); const locale = requireString(options.locale, "locale").trim(); const wordpressVersion = requireString(options.wordpressVersion, "wordpressVersion").trim(); const wordpressVariant = requireString(options.wordpressVariant, "wordpressVariant").trim();
  if (Array.isArray(options.elementorTemplates) && options.elementorTemplates.length > 0) throw new BuilderError("elementor_template_base_required", "Elementor template selections require a base configuration snapshot.");
  await packages.resolve("wordpress", "wordpress", wordpressVersion, wordpressVariant);
  let theme: { slug: string; version: string } | null = null; const themeSlug = String(options.themeSlug || "").trim(); const themeVersion = String(options.themeVersion || "").trim();
  if (themeSlug || themeVersion) { if (!themeSlug || !themeVersion) throw new BuilderError("invalid_profile", "Both theme slug and theme version are required when a theme is selected."); await packages.resolve("theme", themeSlug, themeVersion); theme = { slug: themeSlug, version: themeVersion }; }
  const plugins = [];
  for (const [slugRaw, versionRaw] of Object.entries(options.plugins ?? {})) { const slug = String(slugRaw).trim(); const version = String(versionRaw).trim(); if (!slug || !version) continue; await packages.resolve("plugin", slug, version); plugins.push({ slug, version, required: true }); }
  plugins.sort((a, b) => a.slug.localeCompare(b.slug));
  requireFontDependencies(plugins.map((plugin) => plugin.slug), options.fontSystemId);
  if (options.fontSystemId) await new FontSystemRegistry(libraryDir).resolve(options.fontSystemId);
  return { schemaVersion: 7, name, locale, wordpress: { version: wordpressVersion, variant: wordpressVariant }, theme, plugins, config: null, fontSystem: options.fontSystemId ? { id: options.fontSystemId } : null, elementorTemplates: [], languageArchives: [] };
}

export type { ProfileDocumentV3, ProfileDocumentV4, ProfileDocumentV5, ProfileDocumentV6, ProfileDocumentV7 };
