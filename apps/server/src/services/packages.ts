import { stat } from "node:fs/promises";
import path from "node:path";
import type { PackageRecord } from "../core.js";
import type { User } from "../types.js";
import { PackageItemRepository, variantOf, type PackageItem } from "../repositories/packages.js";
import { SharedLibrary } from "./library.js";
import { QuotaService } from "./quota.js";
import { assertCanWrite } from "./ownership.js";

/** Infrastructure plugins are build machinery, not user-selectable packages. */
export function isInfrastructurePackage(record: Pick<PackageRecord, "kind" | "slug">): boolean {
  return record.kind === "plugin" && ["wp-starter-builder", "wp-starter-exporter", "site-starter"].includes(record.slug);
}

export async function fileSize(target: string): Promise<number> {
  const info = await stat(target);
  return info.size;
}

export interface AddPackageResult {
  item: PackageItem;
  added: boolean;
  replaced: boolean;
}

/**
 * Wraps `PackageRegistry` so an upload lands in the canonical shared library and
 * its ownership metadata lands in the database. Checksum verification, conflict
 * handling, and canonical storage paths stay in builder-core.
 */
export class PackageService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly items: PackageItemRepository,
    private readonly quota: QuotaService
  ) {}

  async list(): Promise<PackageItem[]> {
    return this.items.list();
  }

  async add(uploadedFile: string, options: { replace?: boolean }, user: User): Promise<AddPackageResult> {
    const result = await this.library.packages().add(uploadedFile, { replace: options.replace === true });
    const sizeBytes = await fileSize(path.join(this.library.root, result.record.zip));

    if (result.added) await this.quota.assertWithinQuota(user.id, sizeBytes);

    const item = await this.items.upsert({
      record: result.record,
      sizeBytes,
      uploadedBy: user.id
    });

    return { item, added: result.added, replaced: result.replaced };
  }

  async remove(id: string, user: User): Promise<PackageItem> {
    const item = await this.items.requireById(id);
    assertCanWrite(item, user, "remove");

    await this.library.packages().remove(item.kind, item.slug, item.version, item.variant);
    await this.items.remove(item.id);
    return item;
  }

  /** Used when a re-import replaces the bytes of an existing coordinate. */
  variantOf(record: PackageRecord): string {
    return variantOf(record);
  }
}
