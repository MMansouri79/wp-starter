import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { OwnedItem } from "../types.js";

/**
 * Dedicated table per vNext/sample resource so ownership queries stay simple
 * and each resource type can grow its own columns later.
 */
export const RESOURCE_TABLES = {
  typography: "typography_profiles",
  colors: "color_profiles",
  designSystems: "design_systems",
  fonts: "font_profiles",
  templates: "portable_templates",
  elementor: "elementor_templates"
} as const;

export type ResourceKind = keyof typeof RESOURCE_TABLES;

export const RESOURCE_KINDS = Object.keys(RESOURCE_TABLES) as ResourceKind[];

export type SampleResourceKind = "content" | "terms" | "attributes" | "assets";

export interface ResourceItem<T = unknown> extends OwnedItem {
  sha256: string;
  document: T;
}

interface ResourceRow {
  id: string;
  name: string;
  sha256: string;
  document_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toItem<T>(row: ResourceRow): ResourceItem<T> {
  return {
    id: row.id,
    name: row.name,
    sha256: row.sha256,
    document: JSON.parse(row.document_json) as T,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface SaveResourceInput<T> {
  id: string;
  name: string;
  sha256: string;
  document: T;
  createdBy: string | null;
}

/**
 * Ownership mirror for the builder-core vNext resource registries. The registry
 * files remain the source of truth for content; this table answers who owns it.
 */
export class ResourceRepository {
  private readonly table: string;

  constructor(private readonly db: SqlDatabase, kind: ResourceKind) {
    this.table = RESOURCE_TABLES[kind];
    if (!this.table) throw new Error(`Unsupported resource kind: ${String(kind)}`);
  }

  async save<T>(input: SaveResourceInput<T>): Promise<ResourceItem<T>> {
    const existing = await this.findById<T>(input.id);
    const now = new Date().toISOString();

    if (existing) {
      await this.db.run(
        `UPDATE ${this.table} SET name = ?, sha256 = ?, document_json = ?, updated_at = ? WHERE id = ?`,
        [input.name, input.sha256, JSON.stringify(input.document), now, input.id]
      );
      return (await this.findById<T>(input.id)) as ResourceItem<T>;
    }

    await this.db.run(
      `INSERT INTO ${this.table} (id, name, sha256, document_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.id, input.name, input.sha256, JSON.stringify(input.document), input.createdBy, now, now]
    );

    return {
      id: input.id,
      name: input.name,
      sha256: input.sha256,
      document: input.document,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    };
  }

  async list<T>(): Promise<ResourceItem<T>[]> {
    const rows = await this.db.all<ResourceRow>(`SELECT * FROM ${this.table} ORDER BY name ASC`);
    return rows.map((row) => toItem<T>(row));
  }

  async findById<T>(id: string): Promise<ResourceItem<T> | null> {
    const row = await this.db.get<ResourceRow>(`SELECT * FROM ${this.table} WHERE id = ?`, [id]);
    return row ? toItem<T>(row) : null;
  }

  async requireById<T>(id: string): Promise<ResourceItem<T>> {
    const item = await this.findById<T>(id);
    if (!item) throw notFound("resource_not_found", "That shared resource no longer exists.");
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, [id]);
  }

  /** Drops rows whose ids are no longer present in the file registry. */
  async pruneMissing(ids: string[]): Promise<number> {
    const rows = await this.db.all<{ id: string }>(`SELECT id FROM ${this.table}`);
    const keep = new Set(ids);
    const stale = rows.filter((row) => !keep.has(row.id));
    for (const row of stale) await this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, [row.id]);
    return stale.length;
  }
}

interface SampleRow extends ResourceRow {
  resource: string;
}

export interface SampleResourceItem<T = unknown> extends ResourceItem<T> {
  resource: SampleResourceKind;
}

export class SampleContentRepository {
  constructor(private readonly db: SqlDatabase) {}

  async save<T>(resource: SampleResourceKind, input: SaveResourceInput<T>): Promise<SampleResourceItem<T>> {
    const existing = await this.findById<T>(resource, input.id);
    const now = new Date().toISOString();

    if (existing) {
      await this.db.run(
        "UPDATE sample_content SET name = ?, sha256 = ?, document_json = ?, updated_at = ? WHERE id = ?",
        [input.name, input.sha256, JSON.stringify(input.document), now, input.id]
      );
      return { ...(await this.findById<T>(resource, input.id)) as SampleResourceItem<T> };
    }

    await this.db.run(
      `INSERT INTO sample_content (id, resource, name, sha256, document_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, resource, input.name, input.sha256, JSON.stringify(input.document), input.createdBy, now, now]
    );

    return {
      id: input.id,
      resource,
      name: input.name,
      sha256: input.sha256,
      document: input.document,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    };
  }

  async list<T>(): Promise<SampleResourceItem<T>[]> {
    const rows = await this.db.all<SampleRow>("SELECT * FROM sample_content ORDER BY name ASC");
    return rows.map((row) => ({ ...toItem<T>(row), resource: row.resource as SampleResourceKind }));
  }

  async findById<T>(resource: SampleResourceKind, id: string): Promise<SampleResourceItem<T> | null> {
    const row = await this.db.get<SampleRow>("SELECT * FROM sample_content WHERE resource = ? AND id = ?", [resource, id]);
    return row ? { ...toItem<T>(row), resource } : null;
  }

  async remove(resource: SampleResourceKind, id: string): Promise<void> {
    await this.db.run("DELETE FROM sample_content WHERE resource = ? AND id = ?", [resource, id]);
  }

  async pruneMissing(ids: string[]): Promise<number> {
    const rows = await this.db.all<{ id: string }>("SELECT id FROM sample_content");
    const keep = new Set(ids);
    const stale = rows.filter((row) => !keep.has(row.id));
    for (const row of stale) await this.db.run("DELETE FROM sample_content WHERE id = ?", [row.id]);
    return stale.length;
  }
}
