import { copyFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, sha256File, writeJson } from "./fs-utils.js";
import { inspectPackage } from "./package-inspector.js";
import type { PackageKind, PackageRecord, RegistryFile } from "./types.js";

export interface AddPackageOptions {
  kind?: PackageKind;
  replace?: boolean;
}

export function defaultLibraryDir(): string {
  const env = process.env.WP_STARTER_HOME?.trim();
  return path.resolve(env || path.join(os.homedir(), ".wp-starter"));
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._+-]+$/.test(value)) {
    throw new BuilderError("invalid_package_coordinate", `${label} contains unsupported filesystem characters: ${value}`);
  }
  return value;
}

function defaultVariant(kind: PackageKind): string {
  return kind === "wordpress" ? "en_US" : "default";
}

function recordVariant(record: Pick<PackageRecord, "kind" | "variant" | "locale">): string {
  return record.variant || record.locale || defaultVariant(record.kind);
}

export class PackageRegistry {
  public readonly root: string;
  private readonly registryFile: string;

  constructor(root = defaultLibraryDir()) {
    this.root = path.resolve(root);
    this.registryFile = path.join(this.root, "registry.json");
  }

  private async load(): Promise<RegistryFile> {
    if (!(await exists(this.registryFile))) {
      return { schemaVersion: 2, packages: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.registryFile, "utf8"));
    } catch (error) {
      throw new BuilderError("invalid_registry", `Could not parse registry.json: ${error instanceof Error ? error.message : String(error)}`);
    }

    const registry = parsed as RegistryFile;
    if (![1, 2].includes(registry.schemaVersion) || !Array.isArray(registry.packages)) {
      throw new BuilderError("invalid_registry", "Unsupported or invalid package registry format.");
    }

    if (registry.schemaVersion === 1) {
      registry.schemaVersion = 2;
      registry.packages = registry.packages.map((record) => record.kind === "wordpress"
        ? { ...record, variant: record.variant || record.locale || "en_US", locale: record.locale || record.variant || "en_US" }
        : record
      );
    }

    return registry;
  }

  private async save(registry: RegistryFile): Promise<void> {
    await ensureDir(this.root);
    registry.schemaVersion = 2;
    await writeJson(this.registryFile, registry);
  }

  async add(zipPath: string, options: AddPackageOptions = {}): Promise<{ record: PackageRecord; added: boolean; replaced: boolean }> {
    const absolute = path.resolve(zipPath);
    const inspection = await inspectPackage(absolute, options.kind);
    safeSegment(inspection.slug, "slug");
    safeSegment(inspection.version, "version");

    const variant = inspection.variant || inspection.locale || defaultVariant(inspection.kind);
    safeSegment(variant, "variant");

    const hash = await sha256File(absolute);
    const relativeZip = inspection.kind === "wordpress"
      ? path.join("packages", inspection.kind, inspection.slug, inspection.version, variant, "package.zip")
      : path.join("packages", inspection.kind, inspection.slug, inspection.version, "package.zip");
    const storedZip = path.join(this.root, relativeZip);
    const registry = await this.load();
    const existingIndex = registry.packages.findIndex((record) =>
      record.kind === inspection.kind &&
      record.slug === inspection.slug &&
      record.version === inspection.version &&
      recordVariant(record) === variant
    );

    if (existingIndex >= 0) {
      const existing = registry.packages[existingIndex];
      if (existing.sha256 === hash && await exists(path.join(this.root, existing.zip))) {
        return { record: existing, added: false, replaced: false };
      }
      if (!options.replace) {
        const suffix = inspection.kind === "wordpress" ? ` (${variant})` : "";
        throw new BuilderError(
          "package_conflict",
          `${inspection.kind} ${inspection.slug}@${inspection.version}${suffix} already exists with different bytes. Use --replace only if you intentionally want to replace that exact package variant.`
        );
      }
    }

    await ensureDir(path.dirname(storedZip));
    await copyFile(absolute, storedZip);

    const record: PackageRecord = {
      kind: inspection.kind,
      slug: inspection.slug,
      name: inspection.name,
      version: inspection.version,
      installDir: inspection.installDir,
      variant: inspection.kind === "wordpress" ? variant : undefined,
      locale: inspection.kind === "wordpress" ? (inspection.locale || variant) : undefined,
      mainFile: inspection.mainFile,
      textDomain: inspection.textDomain,
      requiresWordPress: inspection.requiresWordPress,
      requiresPhp: inspection.requiresPhp,
      requiresPlugins: inspection.requiresPlugins,
      zip: relativeZip.split(path.sep).join("/"),
      sha256: hash,
      sourceFilename: path.basename(absolute),
      addedAt: new Date().toISOString()
    };

    let replaced = false;
    if (existingIndex >= 0) {
      registry.packages[existingIndex] = record;
      replaced = true;
    } else {
      registry.packages.push(record);
    }

    registry.packages.sort((a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.slug.localeCompare(b.slug) ||
      a.version.localeCompare(b.version) ||
      recordVariant(a).localeCompare(recordVariant(b))
    );
    await this.save(registry);
    await writeJson(path.join(path.dirname(storedZip), "package.json"), record);

    return { record, added: true, replaced };
  }

  async list(kind?: PackageKind): Promise<PackageRecord[]> {
    const registry = await this.load();
    return registry.packages.filter((record) => !kind || record.kind === kind);
  }

  async resolve(kind: PackageKind, slug: string, version: string, variant?: string): Promise<PackageRecord & { absoluteZip: string }> {
    const registry = await this.load();
    const candidates = registry.packages.filter((entry) => entry.kind === kind && entry.slug === slug && entry.version === version);
    let record: PackageRecord | undefined;

    if (variant) {
      record = candidates.find((entry) => recordVariant(entry) === variant);
    } else if (candidates.length === 1) {
      record = candidates[0];
    } else if (kind === "wordpress") {
      record = candidates.find((entry) => recordVariant(entry) === "en_US");
    } else {
      record = candidates[0];
    }

    if (!record) {
      const suffix = variant ? ` (${variant})` : "";
      throw new BuilderError("package_not_found", `${kind} ${slug}@${version}${suffix} is not available in the package library at ${this.root}`);
    }

    const absoluteZip = path.join(this.root, record.zip);
    if (!(await exists(absoluteZip))) {
      throw new BuilderError("package_file_missing", `Registry entry exists but its ZIP is missing: ${absoluteZip}`);
    }

    const actualHash = await sha256File(absoluteZip);
    if (actualHash !== record.sha256) {
      throw new BuilderError("package_checksum_mismatch", `Package checksum mismatch for ${kind} ${slug}@${version}. Re-add the package before building.`);
    }

    return { ...record, absoluteZip };
  }

  async remove(kind: PackageKind, slug: string, version: string, variant?: string): Promise<PackageRecord> {
    const registry = await this.load();
    const candidates = registry.packages
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.kind === kind && entry.slug === slug && entry.version === version);

    let match = variant
      ? candidates.find(({ entry }) => recordVariant(entry) === variant)
      : candidates.length === 1 ? candidates[0] : kind === "wordpress"
        ? candidates.find(({ entry }) => recordVariant(entry) === "en_US")
        : candidates[0];

    if (!match) {
      throw new BuilderError("package_not_found", `${kind} ${slug}@${version}${variant ? ` (${variant})` : ""} is not present in the package library.`);
    }

    const [record] = registry.packages.splice(match.index, 1);
    const relativeParts = record.zip.replaceAll("\\", "/").split("/");
    const isLegacyWordPressPath = record.kind === "wordpress" && relativeParts.length === 5;
    if (isLegacyWordPressPath) {
      await rm(path.join(this.root, record.zip), { force: true });
      await rm(path.join(this.root, path.dirname(record.zip), "package.json"), { force: true });
    } else {
      const target = path.join(this.root, path.dirname(record.zip));
      await rm(target, { recursive: true, force: true });
    }
    await this.save(registry);
    return record;
  }
}
