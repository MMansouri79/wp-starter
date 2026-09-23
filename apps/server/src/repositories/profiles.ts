import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { ProfileDocumentV7, ProfileDocumentV8, ProfileDocumentV9 } from "../core.js";
import type { OwnedItem } from "../types.js";

export type ProfileDocument = ProfileDocumentV7 | ProfileDocumentV8 | ProfileDocumentV9;

export interface ProfileItem extends OwnedItem {
  fileName: string;
  sha256: string;
  document: ProfileDocument;
}

interface ProfileRow {
  id: string;
  name: string;
  file_name: string;
  sha256: string;
  document_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toItem(row: ProfileRow): ProfileItem {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    sha256: row.sha256,
    document: JSON.parse(row.document_json) as ProfileDocument,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface SaveProfileInput {
  fileName: string;
  name: string;
  sha256: string;
  document: ProfileDocument;
  createdBy: string | null;
}

export class ProfileItemRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** A profile is keyed by its file name, matching the builder-core profile directory. */
  async save(input: SaveProfileInput): Promise<ProfileItem> {
    const existing = await this.findByFileName(input.fileName);
    const now = new Date().toISOString();

    if (existing) {
      await this.db.run(
        "UPDATE profiles SET name = ?, sha256 = ?, document_json = ?, updated_at = ? WHERE id = ?",
        [input.name, input.sha256, JSON.stringify(input.document), now, existing.id]
      );
      return (await this.findById(existing.id)) as ProfileItem;
    }

    const item: ProfileItem = {
      id: `profile-${input.fileName}`,
      name: input.name,
      fileName: input.fileName,
      sha256: input.sha256,
      document: input.document,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    };

    await this.db.run(
      `INSERT INTO profiles (id, name, file_name, sha256, document_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.name, item.fileName, item.sha256, JSON.stringify(item.document), item.createdBy, item.createdAt, item.updatedAt]
    );

    return item;
  }

  async list(): Promise<ProfileItem[]> {
    const rows = await this.db.all<ProfileRow>("SELECT * FROM profiles ORDER BY name ASC");
    return rows.map(toItem);
  }

  async findById(id: string): Promise<ProfileItem | null> {
    const row = await this.db.get<ProfileRow>("SELECT * FROM profiles WHERE id = ?", [id]);
    return row ? toItem(row) : null;
  }

  async findByFileName(fileName: string): Promise<ProfileItem | null> {
    const row = await this.db.get<ProfileRow>("SELECT * FROM profiles WHERE file_name = ?", [fileName]);
    return row ? toItem(row) : null;
  }

  async requireByFileName(fileName: string): Promise<ProfileItem> {
    const item = await this.findByFileName(fileName);
    if (!item) throw notFound("profile_not_found", "That build profile is no longer in the shared library.");
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM profiles WHERE id = ?", [id]);
  }

  /** Used when a profile is renamed: the previous file name must not linger. */
  async removeByFileName(fileName: string): Promise<void> {
    await this.db.run("DELETE FROM profiles WHERE file_name = ?", [fileName]);
  }
}
