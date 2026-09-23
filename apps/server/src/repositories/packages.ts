import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { PackageKind, PackageRecord } from "../core.js";
import type { OwnedItem } from "../types.js";

export interface PackageItem extends OwnedItem {
  kind: PackageKind;
  slug: string;
  version: string;
  variant: string;
  sha256: string;
  filePath: string;
  sizeBytes: number;
  document: PackageRecord;
}

interface PackageRow {
  id: string;
  kind: string;
  slug: string;
  version: string;
  variant: string;
  name: string;
  sha256: string;
  file_path: string;
  size_bytes: number;
  document_json: string;
  uploaded_by: string | null;
  created_at: string;
}

export function variantOf(record: Pick<PackageRecord, "kind" | "variant" | "locale">): string {
  return record.variant || record.locale || (record.kind === "wordpress" ? "en_US" : "default");
}

function toItem(row: PackageRow): PackageItem {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PackageKind,
    slug: row.slug,
    version: row.version,
    variant: row.variant,
    sha256: row.sha256,
    filePath: row.file_path,
    sizeBytes: Number(row.size_bytes),
    document: JSON.parse(row.document_json) as PackageRecord,
    createdBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.created_at
  };
}

export interface UpsertPackageInput {
  record: PackageRecord;
  sizeBytes: number;
  uploadedBy: string | null;
}

export class PackageItemRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Mirrors a builder-core registry record; replaces the row when the bytes changed. */
  async upsert(input: UpsertPackageInput): Promise<PackageItem> {
    const { record } = input;
    const variant = variantOf(record);
    const existing = await this.findByCoordinate(record.kind, record.slug, record.version, variant);
    const now = new Date().toISOString();

    if (existing) {
      await this.db.run(
        `UPDATE packages SET name = ?, sha256 = ?, file_path = ?, size_bytes = ?, document_json = ?, uploaded_by = ?, created_at = ?
         WHERE id = ?`,
        [record.name, record.sha256, record.zip, input.sizeBytes, JSON.stringify(record), input.uploadedBy, now, existing.id]
      );
      return (await this.findById(existing.id)) as PackageItem;
    }

    const item: PackageItem = {
      id: record.kind === "wordpress" ? `wp-${record.slug}-${record.version}-${variant}` : `${record.kind}-${record.slug}-${record.version}`,
      name: record.name,
      kind: record.kind,
      slug: record.slug,
      version: record.version,
      variant,
      sha256: record.sha256,
      filePath: record.zip,
      sizeBytes: input.sizeBytes,
      document: record,
      createdBy: input.uploadedBy,
      createdAt: now,
      updatedAt: now
    };

    await this.db.run(
      `INSERT INTO packages (id, kind, slug, version, variant, name, sha256, file_path, size_bytes, document_json, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.kind,
        item.slug,
        item.version,
        item.variant,
        item.name,
        item.sha256,
        item.filePath,
        item.sizeBytes,
        JSON.stringify(record),
        item.createdBy,
        item.createdAt
      ]
    );

    return item;
  }

  async list(): Promise<PackageItem[]> {
    const rows = await this.db.all<PackageRow>(
      "SELECT * FROM packages ORDER BY kind ASC, slug ASC, version ASC, variant ASC"
    );
    return rows.map(toItem);
  }

  async findById(id: string): Promise<PackageItem | null> {
    const row = await this.db.get<PackageRow>("SELECT * FROM packages WHERE id = ?", [id]);
    return row ? toItem(row) : null;
  }

  async findByCoordinate(kind: string, slug: string, version: string, variant: string): Promise<PackageItem | null> {
    const row = await this.db.get<PackageRow>(
      "SELECT * FROM packages WHERE kind = ? AND slug = ? AND version = ? AND variant = ?",
      [kind, slug, version, variant]
    );
    return row ? toItem(row) : null;
  }

  async requireById(id: string): Promise<PackageItem> {
    const item = await this.findById(id);
    if (!item) throw notFound("package_not_found", "That package is no longer in the shared library.");
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM packages WHERE id = ?", [id]);
  }

  async totalBytes(): Promise<number> {
    const row = await this.db.get<{ total: number }>("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM packages");
    return Number(row?.total ?? 0);
  }

  async bytesForUser(userId: string): Promise<number> {
    const row = await this.db.get<{ total: number }>(
      "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM packages WHERE uploaded_by = ?",
      [userId]
    );
    return Number(row?.total ?? 0);
  }
}
