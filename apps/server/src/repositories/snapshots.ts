import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { ConfigSnapshotRecord } from "../core.js";
import type { OwnedItem } from "../types.js";

export interface SnapshotItem extends OwnedItem {
  sha256: string;
  filePath: string;
  sizeBytes: number;
  wordpressVersion: string;
  locale: string;
  generatedAt: string;
  document: ConfigSnapshotRecord;
}

interface SnapshotRow {
  id: string;
  name: string;
  sha256: string;
  file_path: string;
  size_bytes: number;
  wordpress_version: string;
  locale: string;
  generated_at: string;
  document_json: string;
  uploaded_by: string | null;
  created_at: string;
}

function toItem(row: SnapshotRow): SnapshotItem {
  return {
    id: row.id,
    name: row.name,
    sha256: row.sha256,
    filePath: row.file_path,
    sizeBytes: Number(row.size_bytes),
    wordpressVersion: row.wordpress_version,
    locale: row.locale,
    generatedAt: row.generated_at,
    document: JSON.parse(row.document_json) as ConfigSnapshotRecord,
    createdBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.created_at
  };
}

export class SnapshotItemRepository {
  constructor(private readonly db: SqlDatabase) {}

  async upsert(record: ConfigSnapshotRecord, sizeBytes: number, uploadedBy: string | null): Promise<SnapshotItem> {
    const existing = await this.findById(record.id);
    const now = new Date().toISOString();

    if (existing) {
      await this.db.run(
        `UPDATE snapshots SET name = ?, sha256 = ?, file_path = ?, size_bytes = ?, wordpress_version = ?, locale = ?, generated_at = ?, document_json = ?, uploaded_by = ?, created_at = ?
         WHERE id = ?`,
        [
          record.name,
          record.sha256,
          record.zip,
          sizeBytes,
          record.wordpressVersion,
          record.locale,
          record.generatedAt,
          JSON.stringify(record),
          uploadedBy,
          now,
          record.id
        ]
      );
      return (await this.findById(record.id)) as SnapshotItem;
    }

    await this.db.run(
      `INSERT INTO snapshots (id, name, sha256, file_path, size_bytes, wordpress_version, locale, generated_at, document_json, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.name,
        record.sha256,
        record.zip,
        sizeBytes,
        record.wordpressVersion,
        record.locale,
        record.generatedAt,
        JSON.stringify(record),
        uploadedBy,
        now
      ]
    );

    return (await this.findById(record.id)) as SnapshotItem;
  }

  async list(): Promise<SnapshotItem[]> {
    const rows = await this.db.all<SnapshotRow>("SELECT * FROM snapshots ORDER BY generated_at DESC, created_at DESC");
    return rows.map(toItem);
  }

  async findById(id: string): Promise<SnapshotItem | null> {
    const row = await this.db.get<SnapshotRow>("SELECT * FROM snapshots WHERE id = ?", [id]);
    return row ? toItem(row) : null;
  }

  async requireById(id: string): Promise<SnapshotItem> {
    const item = await this.findById(id);
    if (!item) throw notFound("snapshot_not_found", "That configuration snapshot is no longer in the shared library.");
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM snapshots WHERE id = ?", [id]);
  }

  async bytesForUser(userId: string): Promise<number> {
    const row = await this.db.get<{ total: number }>(
      "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM snapshots WHERE uploaded_by = ?",
      [userId]
    );
    return Number(row?.total ?? 0);
  }
}
