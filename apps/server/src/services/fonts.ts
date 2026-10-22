import path from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import { FontSystemRegistry, type FontSystemRecord } from "../core.js";
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
    return this.library.mutate(() => this.addLocked(uploadedFile, options, user));
  }

  private async addLocked(uploadedFile: string, options: { replace?: boolean; name?: string }, user: User): Promise<AddFontsResult> {
    const registry = this.library.fonts();
    const sourceFilename = path.basename(uploadedFile);
    const replace = options.replace !== false;
    const replaced: string[] = [];
    const staging = await mkdtemp(path.join(os.tmpdir(), "wp-starter-font-stage-"));
    try {
      const prepared = await new FontSystemRegistry(staging).add(uploadedFile, { name: options.name });
      const current = await registry.list();
      let previousBytes = 0;
      let newBytes = 0;
      for (const record of prepared) newBytes += await this.measure(record, staging);
      for (const record of current) {
        if (!prepared.some((row) => row.id === record.id) && !(replace && record.sourceFilename.toLowerCase() === sourceFilename.toLowerCase())) continue;
        const owned = await this.items.findById<FontSystemRecord>(record.id);
        assertCanWrite(owned ?? { createdBy: null }, user, "replace");
        if (!prepared.some((row) => row.id === record.id)) await this.library.designSystems().assertFontNotReferenced(record.id);
        previousBytes += await this.measure(record);
      }
      await this.quota.assertWithinQuota(user.id, Math.max(0, newBytes - previousBytes));

      if (replace) {
        const sameSource = (await registry.list()).filter(
          (entry) => entry.sourceFilename.toLowerCase() === sourceFilename.toLowerCase()
        );
        for (const entry of sameSource) {
          const owned = await this.items.findById<FontSystemRecord>(entry.id);
          assertCanWrite(owned ?? { createdBy: null }, user, "replace");
          replaced.push(entry.id);
        }
      }

      const records = await registry.add(uploadedFile, { replace, name: options.name });
      const items: ResourceItem<FontSystemRecord>[] = [];

      for (const record of records) {
        const existing = await this.items.findById<FontSystemRecord>(record.id);

        items.push(
          await this.items.save({
            id: record.id,
            name: record.name,
            sha256: this.hashOf(record),
            document: record,
            createdBy: existing ? existing.createdBy : current.some((row) => row.id === record.id) ? null : user.id
          })
        );
      }

      await this.items.pruneMissing((await registry.list()).map((row) => row.id));
      return { records, items, replaced };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
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
  private async measure(record: FontSystemRecord, root = this.library.root): Promise<number> {
    let total = 0;
    for (const face of record.faces) {
      try {
        total += (await stat(path.join(root, face.file))).size;
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
