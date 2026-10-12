import { stat } from "node:fs/promises";
import path from "node:path";
import { exists, inspectPackage, sha256File, type PackageRecord } from "../core.js";
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
    return this.library.mutate(() => this.addLocked(uploadedFile, options, user));
  }

  private async addLocked(uploadedFile: string, options: { replace?: boolean }, user: User): Promise<AddPackageResult> {
    const inspection = await inspectPackage(uploadedFile);
    const variant = variantOf(inspection);
    const existing = await this.items.findByCoordinate(inspection.kind, inspection.slug, inspection.version, variant);
    const stored = (await this.library.packages().list()).find((row) =>
      row.kind === inspection.kind && row.slug === inspection.slug && row.version === inspection.version && variantOf(row) === variant);
    if (stored && stored.sha256 === await sha256File(uploadedFile) && await exists(path.join(this.library.root, stored.zip))) {
      const item = existing ?? await this.items.upsert({ record: stored, sizeBytes: await fileSize(path.join(this.library.root, stored.zip)), uploadedBy: null });
      return { item, added: false, replaced: false };
    }
    if (stored || existing) assertCanWrite(existing ?? { createdBy: null }, user, "replace");
    await this.quota.assertWithinQuota(user.id, Math.max(0, (await fileSize(uploadedFile)) - (existing?.sizeBytes ?? 0)));
    const result = await this.library.packages().add(uploadedFile, { replace: options.replace === true });
    const sizeBytes = await fileSize(path.join(this.library.root, result.record.zip));

    const item = await this.items.upsert({
      record: result.record,
      sizeBytes,
      uploadedBy: existing ? existing.createdBy : stored ? null : user.id
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
