import path from "node:path";
import { stat } from "node:fs/promises";
import type { FontSystemRecord } from "../core.js";
import type { User } from "../types.js";
import { ResourceRepository, type ResourceItem } from "../repositories/resources.js";
import { SharedLibrary } from "./library.js";
import { assertCanWrite } from "./ownership.js";
import { QuotaService } from "./quota.js";

export interface AddFontsResult {
  records: FontSystemRecord[];
  items: ResourceItem<FontSystemRecord>[];
  replaced: string[];
}

/**
 * Font Profiles wrap `FontSystemRegistry`. Re-importing an archive replaces the
 * profiles generated from that same archive, so ownership of those profiles is
 * checked before the registry is allowed to touch them.
 */
export class FontProfileService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly items: ResourceRepository,
    private readonly quota: QuotaService
  ) {}

  async list(): Promise<ResourceItem[]> {
    return this.items.list();
  }

  async add(
    uploadedFile: string,
    options: { replace?: boolean; name?: string },
    user: User
  ): Promise<AddFontsResult> {
    const registry = this.library.fonts();
    const sourceFilename = path.basename(uploadedFile);
    const replace = options.replace !== false;
    const replaced: string[] = [];

    if (replace) {
      const sameSource = (await registry.list()).filter(
        (entry) => entry.sourceFilename.toLowerCase() === sourceFilename.toLowerCase()
      );
      for (const entry of sameSource) {
        const owned = await this.items.findById<FontSystemRecord>(entry.id);
        if (owned) assertCanWrite(owned, user, "replace");
        replaced.push(entry.id);
      }
    }

    const records = await registry.add(uploadedFile, { replace, name: options.name });
    const items: ResourceItem<FontSystemRecord>[] = [];

    for (const record of records) {
      const existing = await this.items.findById<FontSystemRecord>(record.id);
      const bytes = await this.measure(record);
      if (!existing) await this.quota.assertWithinQuota(user.id, bytes);

      items.push(
        await this.items.save({
          id: record.id,
          name: record.name,
          sha256: this.hashOf(record),
          document: record,
          createdBy: existing?.createdBy ?? user.id
        })
      );
    }

    return { records, items, replaced };
  }

  async remove(id: string, user: User): Promise<ResourceItem> {
    const item = await this.items.requireById(id);
    assertCanWrite(item, user, "delete");

    await this.library.designSystems().assertFontNotReferenced(id);
    await this.library.fonts().remove(id);
    await this.items.remove(id);
    return item;
  }

  /** Total stored bytes for the archive that produced this profile. */
  private async measure(record: FontSystemRecord): Promise<number> {
    let total = 0;
    for (const face of record.faces) {
      try {
        total += (await stat(path.join(this.library.root, face.file))).size;
      } catch {
        // A missing face is reported by the registry when the profile is resolved.
      }
    }
    return total;
  }

  private hashOf(record: FontSystemRecord): string {
    return record.faces.map((face) => face.sha256).join("");
  }
}
