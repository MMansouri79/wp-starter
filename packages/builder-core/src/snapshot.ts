import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, findFileRecursive, sha256File, writeJson } from "./fs-utils.js";
import { PackageRegistry, defaultLibraryDir } from "./registry.js";
import { validatePortableSnapshot } from "./snapshot-policy.js";
import { ElementorTemplateLibrary } from "./template-library.js";
import type {
  ConfigSnapshotFile,
  ConfigSnapshotInspection,
  ConfigSnapshotComparison,
  SnapshotBinaryChange,
  SnapshotValueChange,
  SnapshotPageChange,
  SnapshotAdapterStructureChange,
  ConfigSnapshotRecord,
  SnapshotPluginRequirement,
  SnapshotRequirement,
  SnapshotRequirementReport,
  ElementorTemplateSummary,
  ResolvedElementorTemplate,
  ElementorTemplateSelection
} from "./types.js";

const INFRASTRUCTURE_PLUGIN_SLUGS = new Set([
  "wp-starter-exporter",
  "site-starter",
  "wp-starter-bootstrap"
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

export const UNKNOWN_SOURCE_DOMAIN = "Unknown — legacy export";

function sourceDomain(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return UNKNOWN_SOURCE_DOMAIN;
  const domain = value.trim();
  const hostname = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
  const ipv6 = /^(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}$/;
  if (domain.length > 253 || /[/?#[\]@]/.test(domain) || (!hostname.test(domain) && !ipv6.test(domain))) {
    throw new BuilderError("invalid_config_export", "source.site_domain must contain only a valid hostname.");
  }
  return domain.toLowerCase();
}

function collectTemplateDependencies(value: unknown): string[] {
  const dependencies = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    const object = current as Record<string, unknown>;
    const reference = object.$wpStarterRef;
    if (typeof reference === "string" && reference.startsWith("template:") && reference.slice("template:".length)) {
      dependencies.add(reference.slice("template:".length));
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return [...dependencies].sort((a, b) => a.localeCompare(b));
}

function summarizeElementorTemplates(raw: any, snapshotId: string, snapshotName: string): ElementorTemplateSummary[] {
  const rows = Array.isArray(raw?.adapters?.elementor?.templates) ? raw.adapters.elementor.templates : [];
  const exportedAt = typeof raw?.generated_at === "string" ? raw.generated_at : "";
  return rows
    .filter((template: any) => template && typeof template === "object" && typeof template.id === "string" && typeof template.name === "string")
    .map((template: any, index: number) => ({
      templateId: template.id,
      name: template.name,
      type: typeof template.type === "string" && template.type ? template.type : "generic",
      sourceDomain: sourceDomain(raw?.source?.site_domain),
      snapshotId,
      snapshotName,
      exportDate: exportedAt,
      documentLocation: `starter-config.json:adapters.elementor.templates[${index}].document`,
      dependencies: collectTemplateDependencies(template.document)
    }));
}

function normalizeStoredTemplateSummary(value: any, record: ConfigSnapshotRecord & { absoluteZip?: string }, index: number): ElementorTemplateSummary {
  const sourceValue = typeof value?.sourceDomain === "string" && value.sourceDomain !== UNKNOWN_SOURCE_DOMAIN
    ? value.sourceDomain
    : record.sourceDomain;
  return {
    templateId: requireString(value?.templateId, `elementorTemplates[${index}].templateId`),
    name: requireString(value?.name, `elementorTemplates[${index}].name`),
    type: typeof value?.type === "string" && value.type ? value.type : "generic",
    sourceDomain: sourceDomain(sourceValue === UNKNOWN_SOURCE_DOMAIN ? undefined : sourceValue),
    snapshotId: record.id,
    snapshotName: record.name,
    exportDate: typeof value?.exportDate === "string" && value.exportDate ? value.exportDate : record.generatedAt,
    documentLocation: typeof value?.documentLocation === "string" && value.documentLocation
      ? value.documentLocation
      : `starter-config.json:adapters.elementor.templates[${index}].document`,
    dependencies: Array.isArray(value?.dependencies)
      ? [...new Set(value.dependencies.filter((dependency: unknown): dependency is string => typeof dependency === "string" && dependency.length > 0))].sort((left, right) => left.localeCompare(right))
      : []
  };
}

async function parseConfigExport(zipPath: string): Promise<{
  generatedAt: string;
  wordpressVersion: string;
  locale: string;
  theme: ConfigSnapshotRecord["theme"];
  plugins: SnapshotPluginRequirement[];
  sourcePlugins: SnapshotPluginRequirement[];
  sourceDomain: string;
}> {
  const raw = await readFullConfigExport(zipPath);
  const schema = Number(raw.schema_version);
  if (![1, 2].includes(schema)) throw new BuilderError("invalid_config_export", `Unsupported starter-config schema_version: ${String(raw.schema_version)}`);

  const generatedAt = requireString(raw.generated_at, "generated_at");
  const wordpressVersion = requireString(raw.source?.wordpress_version, "source.wordpress_version");
  const locale = requireString(raw.source?.locale, "source.locale");
  const theme = {
    slug: requireString(raw.source?.theme?.slug, "source.theme.slug"),
    name: requireString(raw.source?.theme?.name, "source.theme.name"),
    version: requireString(raw.source?.theme?.version, "source.theme.version")
  };

  const mapPluginRows = (rows: any[], activeOnly: boolean): SnapshotPluginRequirement[] => rows
    .filter((plugin: any) => !activeOnly || plugin?.active === true)
    .map((plugin: any, index: number) => {
      const file = requireString(plugin.file, `${activeOnly ? "source.plugins" : "targets.plugins"}[${index}].file`);
      return {
        slug: pluginSlugFromFile(file),
        name: requireString(plugin.name, `plugin[${index}].name`),
        version: requireString(plugin.version, `plugin[${index}].version`),
        file,
        active: true as const
      };
    })
    .filter((plugin: SnapshotPluginRequirement) => !INFRASTRUCTURE_PLUGIN_SLUGS.has(plugin.slug));

  if (!Array.isArray(raw.source?.plugins)) throw new BuilderError("invalid_config_export", "source.plugins must be an array.");
  const sourcePlugins = mapPluginRows(raw.source.plugins, true);
  const targetRows = schema >= 2 ? raw.targets?.plugins : raw.source.plugins;
  if (!Array.isArray(targetRows)) throw new BuilderError("invalid_config_export", schema >= 2 ? "targets.plugins must be an array." : "source.plugins must be an array.");
  const plugins = mapPluginRows(targetRows, schema < 2);
  return { generatedAt, wordpressVersion, locale, theme, plugins, sourcePlugins, sourceDomain: schema >= 2 ? sourceDomain(raw.source?.site_domain) : UNKNOWN_SOURCE_DOMAIN };
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
    let raw: any;
    try { raw = JSON.parse(await readFile(configFile, "utf8")); }
    catch (error) { throw new BuilderError("invalid_config_export", `Could not parse starter-config.json: ${error instanceof Error ? error.message : String(error)}`); }
    const schema = Number(raw?.schema_version);
    if (![1, 2].includes(schema)) throw new BuilderError("invalid_config_export", `Unsupported starter-config schema_version: ${String(raw?.schema_version)}`);
    validatePortableSnapshot(raw);
    return raw;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** Read and validate only the portable export document. Callers should avoid exposing the returned document. */
export async function readConfigExport(zipPath: string): Promise<any> {
  return readFullConfigExport(zipPath);
}


function stableValue(value: unknown): string {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableValue(obj[key])}`).join(",")}}`;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function summarizeKinds<T extends { kind: "added" | "removed" | "changed" }>(changes: T[]) {
  return {
    added: changes.filter((change) => change.kind === "added").length,
    removed: changes.filter((change) => change.kind === "removed").length,
    changed: changes.filter((change) => change.kind === "changed").length,
    total: changes.length
  };
}

function compareValueRecords(scope: string, left: Record<string, unknown>, right: Record<string, unknown>, prefix = ""): SnapshotValueChange[] {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changes: SnapshotValueChange[] = [];
  for (const key of keys) {
    const leftHas = Object.prototype.hasOwnProperty.call(left, key);
    const rightHas = Object.prototype.hasOwnProperty.call(right, key);
    const path = prefix ? `${prefix}.${key}` : key;
    if (!leftHas && rightHas) changes.push({ kind: "added", scope, path, after: right[key] });
    else if (leftHas && !rightHas) changes.push({ kind: "removed", scope, path, before: left[key] });
    else if (!valuesEqual(left[key], right[key])) changes.push({ kind: "changed", scope, path, before: left[key], after: right[key] });
  }
  return changes;
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
        await new ElementorTemplateLibrary(this.root).importSnapshot(await readConfigExport(absolute), existing);
        return { record: existing, added: false, replaced: false };
      }
      if (!options.replace) {
        throw new BuilderError("config_conflict", `Configuration snapshot ${id} already exists with different bytes. Use --replace only if intentional.`);
      }
    }

    await ensureDir(path.dirname(storedZip));
    await copyFile(absolute, storedZip);

    const fullExport = await readConfigExport(absolute);
    const record: ConfigSnapshotRecord = {
      id,
      name,
      generatedAt: parsed.generatedAt,
      wordpressVersion: parsed.wordpressVersion,
      locale: parsed.locale,
      theme: parsed.theme,
      plugins: parsed.plugins,
      sourcePlugins: parsed.sourcePlugins,
      zip: relativeZip.split(path.sep).join("/"),
      sha256: hash,
      sourceFilename: path.basename(absolute),
      addedAt: new Date().toISOString(),
      ...(parsed.sourceDomain !== UNKNOWN_SOURCE_DOMAIN ? { sourceDomain: parsed.sourceDomain } : {}),
      elementorTemplates: summarizeElementorTemplates(fullExport, id, name)
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
    await new ElementorTemplateLibrary(this.root).importSnapshot(fullExport, record);
    return { record, added: true, replaced };
  }

  async list(): Promise<ConfigSnapshotRecord[]> {
    return (await this.load()).snapshots;
  }

  /** Lazily migrates snapshots imported by older Builder releases. */
  async syncElementorTemplateLibrary(): Promise<void> {
    const library = new ElementorTemplateLibrary(this.root);
    let existing = await library.list();
    for (const record of (await this.load()).snapshots) {
      const resolved = await this.resolve(record.id);
      const raw = await readConfigExport(resolved.absoluteZip);
      const rows = (Array.isArray(raw?.adapters?.elementor?.templates) ? raw.adapters.elementor.templates : []).filter((row: any) => {
        const type = String(row?.type || "generic").trim().toLowerCase();
        const name = String(row?.name || "").trim().toLowerCase();
        return type !== "kit" && type !== "elementor-kit" && name !== "default kit";
      });
      const domain = record.sourceDomain || UNKNOWN_SOURCE_DOMAIN;
      const complete = rows.every((row: any) => {
        const supplied = row?.sourceId ?? row?.source_id;
        const normalized = supplied === undefined || supplied === null ? "" : String(supplied).trim();
        const identity = normalized && normalized !== "0" ? normalized : String(row?.id || "");
        return existing.some((item) => item.sourceDomain === domain && (item.sourceTemplateId === identity || item.sourceTemplateId === String(row?.id || "")));
      });
      if (!complete) {
        await library.importSnapshot(raw, record);
        existing = await library.list();
      }
    }
  }

  /**
   * Return the source-aware Elementor inventory without returning any full
   * documents. Old registry records are lazily inspected from their ZIPs.
   */
  async listElementorTemplates(): Promise<ElementorTemplateSummary[]> {
    const records = await this.load();
    const inventory: ElementorTemplateSummary[] = [];
    for (const record of records.snapshots) {
      const resolved = await this.resolve(record.id);
      const summaries = Array.isArray(record.elementorTemplates)
        ? record.elementorTemplates.map((summary, index) => normalizeStoredTemplateSummary(summary, record, index))
        : summarizeElementorTemplates(await readConfigExport(resolved.absoluteZip), record.id, record.name);
      inventory.push(...summaries);
    }
    return inventory.sort((left, right) => left.sourceDomain.localeCompare(right.sourceDomain) || left.name.localeCompare(right.name) || left.snapshotId.localeCompare(right.snapshotId) || left.templateId.localeCompare(right.templateId));
  }

  async listElementorTemplatesForSnapshot(id: string): Promise<ElementorTemplateSummary[]> {
    const record = await this.resolve(id);
    const summaries = Array.isArray(record.elementorTemplates)
      ? record.elementorTemplates.map((summary, index) => normalizeStoredTemplateSummary(summary, record, index))
      : summarizeElementorTemplates(await readConfigExport(record.absoluteZip), record.id, record.name);
    return summaries;
  }

  async resolveElementorTemplates(selection: ElementorTemplateSelection[], options: { requireClosed?: boolean } = {}): Promise<ResolvedElementorTemplate[]> {
    if (!Array.isArray(selection)) throw new BuilderError("invalid_profile", "elementorTemplates must be an array.");
    const requested = selection.map((entry, index) => {
      if (!entry || typeof entry !== "object") throw new BuilderError("invalid_profile", `elementorTemplates[${index}] must be an object.`);
      return { snapshotId: requireString(entry.snapshotId, `elementorTemplates[${index}].snapshotId`), templateId: requireString(entry.templateId, `elementorTemplates[${index}].templateId`) };
    });
    const unique = new Set<string>();
    for (const entry of requested) {
      const key = `${entry.snapshotId}\u0000${entry.templateId}`;
      if (unique.has(key)) throw new BuilderError("invalid_profile", `elementorTemplates contains duplicate selection ${entry.snapshotId}:${entry.templateId}.`);
      unique.add(key);
    }

    const summaryCache = new Map<string, { record: ConfigSnapshotRecord & { absoluteZip: string }; summaries: ElementorTemplateSummary[] }>();
    const getSnapshot = async (snapshotId: string) => {
      let cached = summaryCache.get(snapshotId);
      if (cached) return cached;
      const record = await this.resolve(snapshotId);
      const summaries = Array.isArray(record.elementorTemplates)
        ? record.elementorTemplates.map((summary, index) => normalizeStoredTemplateSummary(summary, record, index))
        : summarizeElementorTemplates(await readConfigExport(record.absoluteZip), record.id, record.name);
      cached = { record, summaries };
      summaryCache.set(snapshotId, cached);
      return cached;
    };
    const resolved: ResolvedElementorTemplate[] = [];
    const queue = [...requested];
    for (let index = 0; index < queue.length; index++) {
      const entry = queue[index];
      const snapshot = await getSnapshot(entry.snapshotId);
      const summary = snapshot.summaries.find((candidate) => candidate.templateId === entry.templateId);
      if (!summary) throw new BuilderError("elementor_template_not_found", `Elementor template ${entry.templateId} is not present in source export ${entry.snapshotId}.`);
      const resolvedSummary: ResolvedElementorTemplate = { ...summary, sourceZip: snapshot.record.absoluteZip };
      resolved.push(resolvedSummary);
      for (const dependencyId of summary.dependencies) {
        const dependency = snapshot.summaries.find((candidate) => candidate.templateId === dependencyId);
        if (!dependency) {
          throw new BuilderError(
            "elementor_template_dependency_missing",
            `Elementor template "${summary.name}" (${summary.type}) from snapshot "${snapshot.record.name}" requires source template "${dependencyId}", but that template was not included in the export. Re-import the snapshot with the dependency included, or remove "${summary.name}" from the profile.`,
          );
        }
        const dependencyKey = `${entry.snapshotId}\u0000${dependencyId}`;
        if (!unique.has(dependencyKey)) {
          if (options.requireClosed) {
            throw new BuilderError(
              "elementor_template_dependency_unselected",
              `Elementor template "${summary.name}" from snapshot "${snapshot.record.name}" requires "${dependency.name}". Select that template too, or remove "${summary.name}" from the profile.`,
            );
          }
          unique.add(dependencyKey);
          queue.push({ snapshotId: entry.snapshotId, templateId: dependencyId });
        }
      }
    }
    return resolved;
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
    const schema = Number(raw?.schema_version);

    const wordpress = recordObject(raw.wordpress);
    const wordpressOptions = recordObject(wordpress.options);
    const rawPages = Array.isArray(wordpress.pages) ? wordpress.pages : [];
    const pages = rawPages
      .filter((page: any) => page && typeof page === "object")
      .map((page: any) => ({ title: String(page.title || ""), slug: String(page.slug || page.role || "") }))
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
        if (key === "elementor" && sectionKey === "templates") {
          const summaries = summarizeElementorTemplates(raw, snapshot.id, snapshot.name);
          details.templates = summaries;
          details.template_count = summaries.length;
          continue;
        }
        if (key === "code_snippets" && sectionKey === "snippets") {
          const list = Array.isArray(sectionValue) ? sectionValue : [];
          details.snippets = list.map((item: any) => ({ name: String(item?.name || ""), scope: String(item?.scope || ""), active: item?.active === true, type: String(item?.type || "") }));
          details.snippet_count = list.length;
          continue;
        }
        const sectionObject = recordObject(sectionValue);
        if (Object.keys(sectionObject).length > 0) sections.push({ key: sectionKey, label: titleFromKey(sectionKey), count: Object.keys(sectionObject).length, values: sectionObject });
        else details[sectionKey] = sectionValue;
      }
      return { key, label: adapterLabel(key), status: deferred ? "deferred" : sections.length || (key === "code_snippets" && Array.isArray(adapter.snippets)) ? "portable" : "metadata", reason: typeof adapter.reason === "string" ? adapter.reason : undefined, sections, details };
    });

    const source = recordObject(raw.source);
    const sourceTheme = recordObject(source.theme);
    const toPlugin = (plugin: any): SnapshotPluginRequirement => {
      const file = String(plugin.file || "");
      return { slug: pluginSlugFromFile(file), name: String(plugin.name || pluginSlugFromFile(file)), version: String(plugin.version || ""), file, active: true };
    };
    const sourcePlugins: SnapshotPluginRequirement[] = (Array.isArray(source.plugins) ? source.plugins : []).filter((plugin: any) => plugin?.active === true).map(toPlugin).filter((plugin) => !INFRASTRUCTURE_PLUGIN_SLUGS.has(plugin.slug));
    const targetRows = schema >= 2 ? recordObject(raw.targets).plugins : sourcePlugins;
    const targetPlugins: SnapshotPluginRequirement[] = Array.isArray(targetRows) ? targetRows.map(toPlugin).filter((plugin) => !INFRASTRUCTURE_PLUGIN_SLUGS.has(plugin.slug)) : sourcePlugins;

    const safetyRaw = recordObject(raw.safety);
    const safety: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(safetyRaw)) safety[key] = value === true;
    const adapterOptions = adapters.reduce((sum, adapter) => sum + (adapter.sections.find((section) => section.key === "options")?.count || 0), 0);
    const adapterSettings = adapters.reduce((sum, adapter) => sum + adapter.sections.filter((section) => section.key !== "options").reduce((part, section) => part + section.count, 0), 0);

    return {
      snapshotId: snapshot.id, name: snapshot.name, schemaVersion: schema, exporterVersion: typeof raw.exporter_version === "string" ? raw.exporter_version : "unknown", generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : snapshot.generatedAt,
      source: { siteDomain: schema >= 2 ? sourceDomain(source.site_domain) : UNKNOWN_SOURCE_DOMAIN, wordpressVersion: String(source.wordpress_version || snapshot.wordpressVersion), phpVersion: String(source.php_version || "unknown"), locale: String(source.locale || snapshot.locale), theme: { slug: String(sourceTheme.slug || snapshot.theme.slug), name: String(sourceTheme.name || snapshot.theme.name), version: String(sourceTheme.version || snapshot.theme.version) }, plugins: sourcePlugins, targetPlugins },
      wordpress: { options: wordpressOptions, optionCount: Object.keys(wordpressOptions).length, permalinkStructure: String(wordpress.permalink_structure || ""), cleanupDefaultContent: wordpress.cleanup_default_content === true, pages },
      adapters, safety,
      totals: { wordpressOptions: Object.keys(wordpressOptions).length, adapterOptions, adapterSettings, pages: pages.length, activePlugins: sourcePlugins.length, targetPlugins: targetPlugins.length, portableAdapters: adapters.filter((adapter) => adapter.status === "portable").length, deferredAdapters: adapters.filter((adapter) => adapter.status === "deferred").length }
    };
  }


  async compare(leftId: string, rightId: string): Promise<ConfigSnapshotComparison> {
    if (!leftId || !rightId) throw new BuilderError("invalid_comparison", "Two configuration snapshot IDs are required.");
    if (leftId === rightId) throw new BuilderError("invalid_comparison", "Choose two different configuration snapshots to compare.");

    const [left, right] = await Promise.all([this.inspect(leftId), this.inspect(rightId)]);

    const binaryChanges: SnapshotBinaryChange[] = [];
    const leftWp = { slug: "wordpress", name: "WordPress", version: left.source.wordpressVersion, variant: left.source.locale };
    const rightWp = { slug: "wordpress", name: "WordPress", version: right.source.wordpressVersion, variant: right.source.locale };
    if (!valuesEqual(leftWp, rightWp)) binaryChanges.push({ kind: "changed", packageKind: "wordpress", key: "wordpress", before: leftWp, after: rightWp });

    const leftTheme = left.source.theme;
    const rightTheme = right.source.theme;
    const leftThemeCoord = { slug: leftTheme.slug, name: leftTheme.name, version: leftTheme.version };
    const rightThemeCoord = { slug: rightTheme.slug, name: rightTheme.name, version: rightTheme.version };
    if (!valuesEqual(leftThemeCoord, rightThemeCoord)) binaryChanges.push({ kind: "changed", packageKind: "theme", key: "theme", before: leftThemeCoord, after: rightThemeCoord });

    const leftPlugins = new Map(left.source.targetPlugins.map((plugin) => [plugin.slug, plugin]));
    const rightPlugins = new Map(right.source.targetPlugins.map((plugin) => [plugin.slug, plugin]));
    const pluginSlugs = [...new Set([...leftPlugins.keys(), ...rightPlugins.keys()])].sort();
    for (const slug of pluginSlugs) {
      const before = leftPlugins.get(slug);
      const after = rightPlugins.get(slug);
      if (!before && after) {
        binaryChanges.push({ kind: "added", packageKind: "plugin", key: slug, after: { slug, name: after.name, version: after.version } });
      } else if (before && !after) {
        binaryChanges.push({ kind: "removed", packageKind: "plugin", key: slug, before: { slug, name: before.name, version: before.version } });
      } else if (before && after && before.version !== after.version) {
        binaryChanges.push({ kind: "changed", packageKind: "plugin", key: slug, before: { slug, name: before.name, version: before.version }, after: { slug, name: after.name, version: after.version } });
      }
    }

    const configurationChanges: SnapshotValueChange[] = [
      ...compareValueRecords("WordPress", left.wordpress.options, right.wordpress.options)
    ];
    if (left.wordpress.permalinkStructure !== right.wordpress.permalinkStructure) {
      configurationChanges.push({ kind: "changed", scope: "WordPress", path: "permalink_structure", before: left.wordpress.permalinkStructure, after: right.wordpress.permalinkStructure });
    }
    if (left.wordpress.cleanupDefaultContent !== right.wordpress.cleanupDefaultContent) {
      configurationChanges.push({ kind: "changed", scope: "WordPress", path: "cleanup_default_content", before: left.wordpress.cleanupDefaultContent, after: right.wordpress.cleanupDefaultContent });
    }

    const leftAdapters = new Map(left.adapters.map((adapter) => [adapter.key, adapter]));
    const rightAdapters = new Map(right.adapters.map((adapter) => [adapter.key, adapter]));
    const adapterKeys = [...new Set([...leftAdapters.keys(), ...rightAdapters.keys()])].sort();
    const adapterStructureChanges: SnapshotAdapterStructureChange[] = [];
    for (const key of adapterKeys) {
      const before = leftAdapters.get(key);
      const after = rightAdapters.get(key);
      const label = after?.label || before?.label || adapterLabel(key);
      if (!before && after) {
        adapterStructureChanges.push({ kind: "added", key, label, after: { status: after.status, reason: after.reason } });
      } else if (before && !after) {
        adapterStructureChanges.push({ kind: "removed", key, label, before: { status: before.status, reason: before.reason } });
      } else if (before && after) {
        if (before.status !== after.status || before.reason !== after.reason) {
          adapterStructureChanges.push({ kind: "changed", key, label, before: { status: before.status, reason: before.reason }, after: { status: after.status, reason: after.reason } });
        }
        const beforeSections = new Map(before.sections.map((section) => [section.key, section]));
        const afterSections = new Map(after.sections.map((section) => [section.key, section]));
        const sectionKeys = [...new Set([...beforeSections.keys(), ...afterSections.keys()])].sort();
        for (const sectionKey of sectionKeys) {
          configurationChanges.push(...compareValueRecords(label, beforeSections.get(sectionKey)?.values || {}, afterSections.get(sectionKey)?.values || {}, sectionKey));
        }
        configurationChanges.push(...compareValueRecords(label, before.details || {}, after.details || {}, "metadata"));
      }
    }

    const leftPages = new Map(left.wordpress.pages.map((page) => [page.slug, page]));
    const rightPages = new Map(right.wordpress.pages.map((page) => [page.slug, page]));
    const pageSlugs = [...new Set([...leftPages.keys(), ...rightPages.keys()])].sort();
    const pageChanges: SnapshotPageChange[] = [];
    for (const slug of pageSlugs) {
      const before = leftPages.get(slug);
      const after = rightPages.get(slug);
      if (!before && after) pageChanges.push({ kind: "added", slug, after });
      else if (before && !after) pageChanges.push({ kind: "removed", slug, before });
      else if (before && after && !valuesEqual(before, after)) pageChanges.push({ kind: "changed", slug, before, after });
    }

    const safetyChanges = compareValueRecords("Safety", left.safety, right.safety);
    const binarySummary = summarizeKinds(binaryChanges);
    const configurationSummary = summarizeKinds(configurationChanges);
    const structuralAll = [...pageChanges, ...adapterStructureChanges];
    const structureSummary = summarizeKinds(structuralAll);

    return {
      left: { id: left.snapshotId, name: left.name, generatedAt: left.generatedAt },
      right: { id: right.snapshotId, name: right.name, generatedAt: right.generatedAt },
      binary: { changes: binaryChanges, ...binarySummary },
      configuration: { changes: configurationChanges, ...configurationSummary },
      structures: { pages: pageChanges, adapters: adapterStructureChanges, ...structureSummary },
      safety: { changes: safetyChanges, total: safetyChanges.length },
      summary: {
        binary: binaryChanges.length,
        configuration: configurationChanges.length,
        structures: structuralAll.length,
        safety: safetyChanges.length,
        total: binaryChanges.length + configurationChanges.length + structuralAll.length + safetyChanges.length
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

function identifierPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

/** Stable ID used only inside a composed build configuration. */
export function namespaceElementorTemplateId(snapshotId: string, templateId: string): string {
  return `${identifierPart(snapshotId)}--${identifierPart(templateId)}`;
}

function rewriteSameSnapshotTemplateReferences(value: unknown, snapshotId: string, selectedIds: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((child) => rewriteSameSnapshotTemplateReferences(child, snapshotId, selectedIds));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (typeof object.$wpStarterRef === "string" && object.$wpStarterRef.startsWith("template:")) {
    const dependencyId = object.$wpStarterRef.slice("template:".length);
    if (selectedIds.has(dependencyId)) return { ...object, $wpStarterRef: `template:${namespaceElementorTemplateId(snapshotId, dependencyId)}` };
  }
  return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, rewriteSameSnapshotTemplateReferences(child, snapshotId, selectedIds)]));
}

/**
 * Read selected template documents from their source snapshots and compose a
 * collision-safe Elementor collection. The result contains no source-only
 * metadata, so it can be placed directly into starter-config.json.
 */
export async function composeElementorTemplates(selected: ResolvedElementorTemplate[]): Promise<Array<{ id: string; name: string; type: string; document: unknown }>> {
  const documentsBySource = new Map<string, any>();
  for (const item of selected) {
    if (!documentsBySource.has(item.sourceZip)) documentsBySource.set(item.sourceZip, await readConfigExport(item.sourceZip));
  }
  const selectedBySnapshot = new Map<string, Set<string>>();
  for (const item of selected) {
    if (!selectedBySnapshot.has(item.snapshotId)) selectedBySnapshot.set(item.snapshotId, new Set());
    selectedBySnapshot.get(item.snapshotId)!.add(item.templateId);
  }

  return selected.map((item) => {
    const raw = documentsBySource.get(item.sourceZip);
    const rows = Array.isArray(raw?.adapters?.elementor?.templates) ? raw.adapters.elementor.templates : [];
    const source = rows.find((candidate: any) => candidate && candidate.id === item.templateId);
    if (!source) throw new BuilderError("elementor_template_not_found", `Elementor template ${item.templateId} is not present in source export ${item.snapshotId}.`);
    return {
      id: namespaceElementorTemplateId(item.snapshotId, item.templateId),
      name: String(source.name || item.name),
      type: String(source.type || item.type || "generic"),
      document: rewriteSameSnapshotTemplateReferences(source.document, item.snapshotId, selectedBySnapshot.get(item.snapshotId) || new Set())
    };
  });
}
