import { HttpError } from "../errors.js";
import { BuildRepository } from "../repositories/builds.js";
import { PackageItemRepository } from "../repositories/packages.js";
import { SnapshotItemRepository } from "../repositories/snapshots.js";
import { ResourceRepository, SampleContentRepository } from "../repositories/resources.js";
import { SharedLibrary } from "./library.js";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FontSystemRecord, SampleAsset } from "../core.js";

export interface QuotaUsage {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
}

/**
 * Disk quotas keep one team from filling the VPS file store. Uploads
 * and build artifacts are both counted.
 */
export class QuotaService {
  constructor(
    private readonly packages: PackageItemRepository,
    private readonly snapshots: SnapshotItemRepository,
    private readonly builds: BuildRepository,
    private readonly limitBytes: number,
    private readonly library: SharedLibrary,
    private readonly fonts: ResourceRepository,
    private readonly samples: SampleContentRepository
  ) {}

  async usage(_userId?: string): Promise<QuotaUsage> {
    const [packages, snapshots, builds] = await Promise.all([
      this.packages.totalBytes(),
      this.snapshots.totalBytes(),
      this.builds.totalBytes()
    ]);
    const files = new Set<string>();
    for (const item of await this.fonts.list<FontSystemRecord>()) {
      item.document.faces.forEach((face) => files.add(face.file));
    }
    for (const item of await this.samples.list<SampleAsset>()) {
      if (item.resource === "assets") files.add(item.document.file);
    }
    let assets = 0;
    for (const file of files) {
      try { assets += (await stat(path.join(this.library.root, file))).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const usedBytes = packages + snapshots + builds + assets;
    return { usedBytes, limitBytes: this.limitBytes, remainingBytes: Math.max(0, this.limitBytes - usedBytes) };
  }

  async assertWithinQuota(userId: string, additionalBytes: number): Promise<void> {
    const usage = await this.usage(userId);
    if (usage.usedBytes + additionalBytes <= this.limitBytes) return;

    const mebibyte = 1024 * 1024;
    throw new HttpError(
      413,
      "quota_exceeded",
      `This would exceed your ${Math.floor(this.limitBytes / mebibyte)} MiB storage quota ` +
        `(${Math.floor(usage.usedBytes / mebibyte)} MiB already stored). Remove unused items and try again.`,
      usage
    );
  }
}
