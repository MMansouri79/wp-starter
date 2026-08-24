import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, findFileRecursive, sha256File, writeJson } from "./fs-utils.js";
import { PackageRegistry, defaultLibraryDir } from "./registry.js";
import type {
  ConfigSnapshotFile,
  ConfigSnapshotInspection,
  ConfigSnapshotRecord,
  SnapshotPluginRequirement,
  SnapshotRequirement,
  SnapshotRequirementReport
} from "./types.js";

const INFRASTRUCTURE_PLUGIN_SLUGS = new Set([
  "wp-starter-exporter",
  "site-starter"
]);

export interface AddConfigSnapshotOptions {
  id?: string;
  name?: string;
  replace?: boolean;
}

function safeId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new BuilderError("invalid_config_id", "Configuration snapshot ID is empty after normalization.");
  }
  return normalized;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BuilderError("invalid_config_export", `${field} must be a non-empty string.`);
  }
  return value;
}

function pluginSlugFromFile(file: string): string {
  const normalized = file.replaceAll("\\", "/").replace(/^\/+/, "");
  const first = normalized.split("/")[0] || "";
  if (normalized.includes("/")) return first;
  return first.replace(/\.php$/i, "");
}

function compactTimestamp(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  }
  return parsed.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

async function parseConfigExport(zipPath: string): Promise<{
  generatedAt: string;
  wordpressVersion: string;
  locale: string;
  theme: ConfigSnapshotRecord["theme"];
  plugins: SnapshotPluginRequirement[];
}> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-config-"));
  try {
    await extractZip(zipPath, temp);
    const configFile = await findFileRecursive(temp, "starter-config.json");
    if (!configFile) {
      throw new BuilderError("invalid_config_export", "starter-config.json was not found in the configuration export ZIP.");
    }

    let raw: any;
    try {
      raw = JSON.parse(await readFile(configFile, "utf8"));
    } catch (error) {
      throw new BuilderError("invalid_config_export", `Could not parse starter-config.json: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (raw.schema_version !== 1) {
      throw new BuilderError("invalid_config_export", `Unsupported starter-config schema_version: ${String(raw.schema_version)}`);
    }

    const generatedAt = requireString(raw.generated_at, "generated_at");
    const wordpressVersion = requireString(raw.source?.wordpress_version, "source.wordpress_version");
    const locale = requireString(raw.source?.locale, "source.locale");
    const theme = {
      slug: requireString(raw.source?.theme?.slug, "source.theme.slug"),
      name: requireString(raw.source?.theme?.name, "source.theme.name"),
      version: requireString(raw.source?.theme?.version, "source.theme.version")
    };

    if (!Array.isArray(raw.source?.plugins)) {
      throw new BuilderError("invalid_config_export", "source.plugins must be an array.");
    }

    const plugins: SnapshotPluginRequirement[] = raw.source.plugins
      .filter((plugin: any) => plugin?.active === true)
      .map((plugin: any, index: number) => {
        const file = requireString(plugin.file, `source.plugins[${index}].file`);
        return {
          slug: pluginSlugFromFile(file),
          name: requireString(plugin.name, `source.plugins[${index}].name`),
          version: requireString(plugin.version, `source.plugins[${index}].version`),
          file,
          active: true
        };
      })
      .filter((plugin: SnapshotPluginRequirement) => !INFRASTRUCTURE_PLUGIN_SLUGS.has(plugin.slug));

    return { generatedAt, wordpressVersion, locale, theme, plugins };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}


function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function titleFromKey(value: string): string {
  return value.split("_").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function adapterLabel(key: string): string {
  const known: Record<string, string> = {
    elementor: "Elementor",
    woocommerce: "WooCommerce",
    persian_woocommerce: "Persian WooCommerce",
    filterx: "FilterX"
  };
  return known[key] || titleFromKey(key);
}

async function readFullConfigExport(zipPath: string): Promise<any> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-inspect-"));
  try {
    await extractZip(zipPath, temp);
    const configFile = await findFileRecursive(temp, "starter-config.json");
    if (!configFile) throw new BuilderError("invalid_config_export", "starter-config.json was not found in the configuration export ZIP.");
    try {
      return JSON.parse(await readFile(configFile, "utf8"));
    } catch (error) {
      throw new BuilderError("invalid_config_export", `Could not parse starter-config.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export class ConfigSnapshotRegistry {
  public readonly root: string;
  private readonly registryFile: string;

  constructor(root = defaultLibraryDir()) {
    this.root = path.resolve(root);
    this.registryFile = path.join(this.root, "configs.json");
  }

  private async load(): Promise<ConfigSnapshotFile> {
    if (!(await exists(this.registryFile))) {
      return { schemaVersion: 1, snapshots: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.registryFile, "utf8"));
    } catch (error) {
      throw new BuilderError("invalid_config_registry", `Could not parse configs.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    const registry = parsed as ConfigSnapshotFile;
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.snapshots)) {
      throw new BuilderError("invalid_config_registry", "Unsupported or invalid configuration snapshot registry format.");
    }
    return registry;
  }

  private async save(registry: ConfigSnapshotFile): Promise<void> {
    await ensureDir(this.root);
    await writeJson(this.registryFile, registry);
  }

  async add(zipPath: string, options: AddConfigSnapshotOptions = {}): Promise<{ record: ConfigSnapshotRecord; added: boolean; replaced: boolean }> {
    const absolute = path.resolve(zipPath);
    if (!(await exists(absolute))) {
      throw new BuilderError("missing_input", `Configuration export ZIP does not exist: ${absolute}`);
    }

    const parsed = await parseConfigExport(absolute);
    const id = safeId(options.id || `snapshot-${compactTimestamp(parsed.generatedAt)}`);
    const name = options.name?.trim() || `Reference ${parsed.generatedAt}`;
    const hash = await sha256File(absolute);
    const relativeZip = path.join("configs", id, "config.zip");
    const storedZip = path.join(this.root, relativeZip);
    const registry = await this.load();
    const existingIndex = registry.snapshots.findIndex((entry) => entry.id === id);

    if (existingIndex >= 0) {
      const existing = registry.snapshots[existingIndex];
      if (existing.sha256 === hash && await exists(path.join(this.root, existing.zip))) {
        return { record: existing, added: false, replaced: false };
      }
      if (!options.replace) {
        throw new BuilderError("config_conflict", `Configuration snapshot ${id} already exists with different bytes. Use --replace only if intentional.`);
      }
    }

    await ensureDir(path.dirname(storedZip));
    await copyFile(absolute, storedZip);

    const record: ConfigSnapshotRecord = {
      id,
      name,
      generatedAt: parsed.generatedAt,
      wordpressVersion: parsed.wordpressVersion,
      locale: parsed.locale,
      theme: parsed.theme,
      plugins: parsed.plugins,
      zip: relativeZip.split(path.sep).join("/"),
      sha256: hash,
      sourceFilename: path.basename(absolute),
      addedAt: new Date().toISOString()
    };

    let replaced = false;
    if (existingIndex >= 0) {
      registry.snapshots[existingIndex] = record;
      replaced = true;
    } else {
      registry.snapshots.push(record);
    }
    registry.snapshots.sort((a, b) => a.id.localeCompare(b.id));
    await this.save(registry);
    await writeJson(path.join(path.dirname(storedZip), "snapshot.json"), record);
    return { record, added: true, replaced };
  }

  async list(): Promise<ConfigSnapshotRecord[]> {
    return (await this.load()).snapshots;
  }

  async resolve(id: string): Promise<ConfigSnapshotRecord & { absoluteZip: string }> {
    const registry = await this.load();
    const record = registry.snapshots.find((entry) => entry.id === id);
    if (!record) {
      throw new BuilderError("config_not_found", `Configuration snapshot ${id} is not present in ${this.root}`);
    }
    const absoluteZip = path.join(this.root, record.zip);
    if (!(await exists(absoluteZip))) {
      throw new BuilderError("config_file_missing", `Configuration snapshot exists in the registry but its ZIP is missing: ${absoluteZip}`);
    }
    const actualHash = await sha256File(absoluteZip);
    if (actualHash !== record.sha256) {
      throw new BuilderError("config_checksum_mismatch", `Configuration snapshot checksum mismatch for ${id}. Re-import it before building.`);
    }
    return { ...record, absoluteZip };
  }

  async remove(id: string): Promise<ConfigSnapshotRecord> {
    const registry = await this.load();
    const index = registry.snapshots.findIndex((entry) => entry.id === id);
    if (index < 0) throw new BuilderError("config_not_found", `Configuration snapshot ${id} is not present.`);
    const [record] = registry.snapshots.splice(index, 1);
    await rm(path.join(this.root, "configs", id), { recursive: true, force: true });
    await this.save(registry);
    return record;
  }

  async inspect(id: string): Promise<ConfigSnapshotInspection> {
    const snapshot = await this.resolve(id);
    const raw = await readFullConfigExport(snapshot.absoluteZip);
    if (Number(raw?.schema_version) !== 1) {
      throw new BuilderError("invalid_config_export", `Unsupported starter-config schema_version: ${String(raw?.schema_version)}`);
    }

    const wordpress = recordObject(raw.wordpress);
    const wordpressOptions = recordObject(wordpress.options);
    const rawPages = Array.isArray(wordpress.pages) ? wordpress.pages : [];
    const pages = rawPages
      .filter((page: any) => page && typeof page === "object")
      .map((page: any) => ({ title: String(page.title || ""), slug: String(page.slug || "") }))
      .filter((page: { title: string; slug: string }) => page.title || page.slug);

    const adaptersObject = recordObject(raw.adapters);
    const adapters: ConfigSnapshotInspection["adapters"] = Object.entries(adaptersObject).map(([key, adapterValue]) => {
      const adapter = recordObject(adapterValue);
      const declaredStatus = String(adapter.status || "");
      const deferred = declaredStatus.toLowerCase().includes("deferred");
      const sections: ConfigSnapshotInspection["adapters"][number]["sections"] = [];
      const details: Record<string, unknown> = {};

      for (const [sectionKey, sectionValue] of Object.entries(adapter)) {
        if (["status", "reason"].includes(sectionKey)) continue;
        const sectionObject = recordObject(sectionValue);
        if (Object.keys(sectionObject).length > 0) {
          sections.push({
            key: sectionKey,
            label: titleFromKey(sectionKey),
            count: Object.keys(sectionObject).length,
            values: sectionObject
          });
        } else {
          details[sectionKey] = sectionValue;
        }
      }

      return {
        key,
        label: adapterLabel(key),
        status: deferred ? "deferred" : sections.length ? "portable" : "metadata",
        reason: typeof adapter.reason === "string" ? adapter.reason : undefined,
        sections,
        details
      };
    });

    const source = recordObject(raw.source);
    const sourceTheme = recordObject(source.theme);
    const sourcePlugins = Array.isArray(source.plugins) ? source.plugins : [];
    const plugins: SnapshotPluginRequirement[] = sourcePlugins
      .filter((plugin: any) => plugin?.active === true)
      .map((plugin: any) => {
        const file = String(plugin.file || "");
        return {
          slug: pluginSlugFromFile(file),
          name: String(plugin.name || pluginSlugFromFile(file)),
          version: String(plugin.version || ""),
          file,
          active: true as const
        };
      })
      .filter((plugin: SnapshotPluginRequirement) => !INFRASTRUCTURE_PLUGIN_SLUGS.has(plugin.slug));

    const safetyRaw = recordObject(raw.safety);
    const safety: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(safetyRaw)) safety[key] = value === true;

    const adapterOptions = adapters.reduce((sum, adapter) => sum + (adapter.sections.find((section) => section.key === "options")?.count || 0), 0);
    const adapterSettings = adapters.reduce((sum, adapter) => sum + adapter.sections.filter((section) => section.key !== "options").reduce((part, section) => part + section.count, 0), 0);

    return {
      snapshotId: snapshot.id,
      name: snapshot.name,
      schemaVersion: Number(raw.schema_version),
      exporterVersion: typeof raw.exporter_version === "string" ? raw.exporter_version : "unknown",
      generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : snapshot.generatedAt,
      source: {
        wordpressVersion: String(source.wordpress_version || snapshot.wordpressVersion),
        phpVersion: String(source.php_version || "unknown"),
        locale: String(source.locale || snapshot.locale),
        theme: {
          slug: String(sourceTheme.slug || snapshot.theme.slug),
          name: String(sourceTheme.name || snapshot.theme.name),
          version: String(sourceTheme.version || snapshot.theme.version)
        },
        plugins
      },
      wordpress: {
        options: wordpressOptions,
        optionCount: Object.keys(wordpressOptions).length,
        permalinkStructure: String(wordpress.permalink_structure || ""),
        cleanupDefaultContent: wordpress.cleanup_default_content === true,
        pages
      },
      adapters,
      safety,
      totals: {
        wordpressOptions: Object.keys(wordpressOptions).length,
        adapterOptions,
        adapterSettings,
        pages: pages.length,
        activePlugins: plugins.length,
        portableAdapters: adapters.filter((adapter) => adapter.status === "portable").length,
        deferredAdapters: adapters.filter((adapter) => adapter.status === "deferred").length
      }
    };
  }

  async requirements(id: string, packages = new PackageRegistry(this.root)): Promise<SnapshotRequirementReport> {
    const snapshot = await this.resolve(id);
    const available = await packages.list();

    const requirement = (
      kind: SnapshotRequirement["kind"], slug: string, version: string, name: string, variant?: string
    ): SnapshotRequirement => {
      const match = available.find((record) =>
        record.kind === kind && record.slug === slug && record.version === version &&
        (!variant || (record.variant || record.locale || (record.kind === "wordpress" ? "en_US" : "default")) === variant)
      );
      return { kind, slug, version, name, variant, status: match ? "available" : "missing" };
    };

    const requirements: SnapshotRequirement[] = [
      requirement("wordpress", "wordpress", snapshot.wordpressVersion, "WordPress", snapshot.locale),
      requirement("theme", snapshot.theme.slug, snapshot.theme.version, snapshot.theme.name),
      ...snapshot.plugins.map((plugin) => requirement("plugin", plugin.slug, plugin.version, plugin.name))
    ];

    return {
      snapshotId: snapshot.id,
      locale: snapshot.locale,
      requirements,
      available: requirements.filter((entry) => entry.status === "available").length,
      missing: requirements.filter((entry) => entry.status === "missing").length
    };
  }
}
