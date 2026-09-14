import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, writeJson } from "./fs-utils.js";
import type { ElementorGlobalReference, ElementorTemplateLibraryRecord, ResolvedElementorLibraryTemplate } from "./types.js";

const UNKNOWN_SOURCE_DOMAIN = "Unknown — legacy export";

interface TemplateLibraryFile { schemaVersion: 1; templates: ElementorTemplateLibraryRecord[]; }

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function hash(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function libraryId(domain: string, snapshotId: string, sourceTemplateId: string): string {
  const owner = domain === UNKNOWN_SOURCE_DOMAIN ? `snapshot:${snapshotId}` : `site:${domain}`;
  return `tpl-${createHash("sha256").update(`${owner}\0${sourceTemplateId}`).digest("hex").slice(0, 20)}`;
}

function references(value: unknown): { dependencies: string[]; globals: string[] } {
  const dependencies = new Set<string>(); const globals = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    if (typeof row.$wpStarterRef === "string") {
      if (row.$wpStarterRef.startsWith("template:")) dependencies.add(row.$wpStarterRef.slice(9));
      else if (/^(?:elementor:)?(?:color|typography):/.test(row.$wpStarterRef)) globals.add(row.$wpStarterRef);
    }
    Object.values(row).forEach(visit);
  };
  visit(value); return { dependencies: [...dependencies].sort(), globals: [...globals].sort() };
}

function normalizedGlobalReferences(template: any, document: unknown): ElementorGlobalReference[] {
  const found = references(document).globals;
  const supplied = Array.isArray(template?.globalReferences) ? template.globalReferences : [];
  const byRef = new Map<string, ElementorGlobalReference>();
  for (const value of supplied) {
    const reference = typeof value?.reference === "string" ? value.reference : "";
    const match = reference.match(/^(?:elementor:)?(color|typography):(.+)$/);
    if (!match || !found.includes(reference)) continue;
    byRef.set(reference, { reference, kind: match[1] as "color" | "typography", sourceId: String(value.sourceId || match[2]), name: String(value.name || value.title || match[2]) });
  }
  for (const reference of found) {
    if (byRef.has(reference)) continue;
    const match = reference.match(/^(?:elementor:)?(color|typography):(.+)$/)!;
    byRef.set(reference, { reference, kind: match[1] as "color" | "typography", sourceId: match[2], name: match[2].replace(/[-_]+/g, " ") });
  }
  return [...byRef.values()].sort((a, b) => a.reference.localeCompare(b.reference));
}

export class ElementorTemplateLibrary {
  readonly root: string; private readonly registryFile: string; private readonly documentsDir: string;
  constructor(root: string) { this.root = path.resolve(root); this.registryFile = path.join(this.root, "elementor-templates.json"); this.documentsDir = path.join(this.root, "elementor-templates"); }
  private async load(): Promise<TemplateLibraryFile> {
    if (!(await exists(this.registryFile))) return { schemaVersion: 1, templates: [] };
    const parsed = JSON.parse(await readFile(this.registryFile, "utf8"));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.templates)) throw new BuilderError("invalid_template_registry", "Unsupported Elementor template library registry.");
    return parsed;
  }
  private async save(file: TemplateLibraryFile): Promise<void> { await writeJson(this.registryFile, file); }

  async importSnapshot(raw: any, snapshot: { id: string; name: string; generatedAt: string; sourceDomain?: string }): Promise<ElementorTemplateLibraryRecord[]> {
    const rows = (Array.isArray(raw?.adapters?.elementor?.templates) ? raw.adapters.elementor.templates : [])
      .filter((row: any) => {
        const type = String(row?.type || "generic").trim().toLowerCase();
        const name = String(row?.name || "").trim().toLowerCase();
        return type !== "kit" && type !== "elementor-kit" && name !== "default kit";
      })
      .filter((row: any) => typeof row?.id === "string" && row.id && typeof row?.name === "string" && Array.isArray(row?.document));
    const domain = snapshot.sourceDomain || UNKNOWN_SOURCE_DOMAIN;
    const registry = await this.load();
    const now = new Date().toISOString();
    const sourceIdentity = (row: any): string => {
      const supplied = row?.sourceId ?? row?.source_id;
      const normalized = supplied === undefined || supplied === null ? "" : String(supplied).trim();
      return normalized && normalized !== "0" ? normalized : String(row.id);
    };

    // Exporter IDs are portable display/document IDs, not source identity. A
    // title or slug change must still update the same library asset when the
    // source post ID is unchanged. Reuse an older row's ID when importing the
    // first source-aware export so existing profiles keep working.
    const idMap = new Map<string, string>();
    for (const row of rows) {
      const desiredId = libraryId(domain, snapshot.id, sourceIdentity(row));
      const legacyMatches = registry.templates.filter((entry) => entry.sourceDomain === domain && entry.sourceTemplateId === row.id);
      const nameTypeMatches = registry.templates.filter((entry) => entry.sourceDomain === domain && entry.name === row.name && entry.type === String(row.type || "generic"));
      const existing = registry.templates.find((entry) => entry.id === desiredId) || legacyMatches[0] || (nameTypeMatches.length === 1 ? nameTypeMatches[0] : undefined);
      idMap.set(row.id, existing?.id || desiredId);
    }
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== "object") return value;
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = rewrite(item);
      if (typeof output.$wpStarterRef === "string" && output.$wpStarterRef.startsWith("template:")) {
        const target = output.$wpStarterRef.slice(9); if (idMap.has(target)) output.$wpStarterRef = `template:${idMap.get(target)}`;
      }
      return output;
    };
    const imported: ElementorTemplateLibraryRecord[] = [];
    await ensureDir(this.documentsDir);
    for (const row of rows) {
      const id = idMap.get(row.id)!; const document = rewrite(row.document) as unknown[]; const refs = references(document);
      const existing = registry.templates.find((entry) => entry.id === id); const documentFile = `elementor-templates/${id}.json`;
      await writeJson(path.join(this.root, documentFile), document);
      const record: ElementorTemplateLibraryRecord = {
        id, sourceTemplateId: sourceIdentity(row), name: row.name, type: String(row.type || "generic"), sourceDomain: domain,
        snapshotId: snapshot.id, snapshotName: snapshot.name, exportDate: snapshot.generatedAt,
        importedAt: existing?.importedAt || now, updatedAt: now, documentFile, sha256: hash(document),
        dependencies: refs.dependencies, globalReferences: normalizedGlobalReferences(row, document)
      };
      if (existing) registry.templates[registry.templates.indexOf(existing)] = record; else registry.templates.push(record);
      imported.push(record);
    }
    registry.templates.sort((a, b) => a.sourceDomain.localeCompare(b.sourceDomain) || a.name.localeCompare(b.name)); await this.save(registry);
    return imported;
  }

  async list(filters: { search?: string; sourceDomain?: string; type?: string } = {}): Promise<ElementorTemplateLibraryRecord[]> {
    const search = String(filters.search || "").trim().toLowerCase();
    return (await this.load()).templates.filter((row) => {
      const type = row.type.trim().toLowerCase();
      const name = row.name.trim().toLowerCase();
      return type !== "kit" && type !== "elementor-kit" && name !== "default kit" && (!search || `${row.name} ${row.sourceDomain} ${row.type}`.toLowerCase().includes(search)) && (!filters.sourceDomain || row.sourceDomain === filters.sourceDomain) && (!filters.type || row.type === filters.type);
    });
  }
  async resolve(ids: string[], options: { requireClosed?: boolean } = {}): Promise<ResolvedElementorLibraryTemplate[]> {
    if (!Array.isArray(ids)) throw new BuilderError("invalid_profile", "elementorTemplateIds must be an array.");
    const registry = await this.load(); const byId = new Map(registry.templates.map((row) => [row.id, row])); const seen = new Set<string>(); const queue = [...ids]; const output: ResolvedElementorLibraryTemplate[] = [];
    for (let index = 0; index < queue.length; index++) {
      const id = String(queue[index] || "").trim(); if (!id) throw new BuilderError("invalid_profile", `elementorTemplateIds[${index}] must be non-empty.`); if (seen.has(id)) continue; seen.add(id);
      const row = byId.get(id); if (!row) throw new BuilderError("elementor_template_not_found", `Elementor template library asset ${id} was not found.`);
      for (const dependency of row.dependencies) {
        if (!byId.has(dependency)) {
          const exportedReference = dependency.startsWith("missing-") ? dependency.slice("missing-".length) : dependency;
          const sourceHint = dependency.startsWith("missing-")
            ? `a source template that was not included in the imported export (export reference ${exportedReference})`
            : `library asset ${dependency}`;
          throw new BuilderError(
            "elementor_template_dependency_missing",
            `Elementor template "${row.name}" (${row.type}) from ${row.sourceDomain} requires ${sourceHint}. Re-import snapshot "${row.snapshotName}" with the dependency included, or remove "${row.name}" from the profile.`,
          );
        }
        if (!seen.has(dependency)) {
          if (options.requireClosed && !ids.includes(dependency)) {
            throw new BuilderError(
              "elementor_template_dependency_unselected",
              `Elementor template "${row.name}" from ${row.sourceDomain} requires "${byId.get(dependency)!.name}". Select that template too, or remove "${row.name}" from the profile.`,
            );
          }
          queue.push(dependency);
        }
      }
      const documentPath = path.join(this.root, row.documentFile); const document = JSON.parse(await readFile(documentPath, "utf8"));
      if (hash(document) !== row.sha256) throw new BuilderError("elementor_template_checksum_mismatch", `Elementor template ${row.name} failed its checksum check.`);
      output.push({ ...row, document });
    }
    return output;
  }
  async remove(id: string): Promise<ElementorTemplateLibraryRecord> {
    const registry = await this.load(); const index = registry.templates.findIndex((row) => row.id === id); if (index < 0) throw new BuilderError("elementor_template_not_found", `Elementor template ${id} was not found.`);
    const dependent = registry.templates.find((row) => row.dependencies.includes(id)); if (dependent) throw new BuilderError("resource_in_use", `Template is required by ${dependent.name}.`);
    const profilesDir = path.join(this.root, "profiles");
    if (await exists(profilesDir)) for (const entry of await readdir(profilesDir, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(".json")) {
      const profile = JSON.parse(await readFile(path.join(profilesDir, entry.name), "utf8")); if (Array.isArray(profile.elementorTemplateIds) && profile.elementorTemplateIds.includes(id)) throw new BuilderError("resource_in_use", `Template is used by profile ${profile.name || entry.name}.`);
    }
    const [removed] = registry.templates.splice(index, 1); await rm(path.join(this.root, removed.documentFile), { force: true }); await this.save(registry); return removed;
  }
}
