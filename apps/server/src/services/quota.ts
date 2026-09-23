import { HttpError } from "../errors.js";
import { BuildRepository } from "../repositories/builds.js";
import { PackageItemRepository } from "../repositories/packages.js";
import { SnapshotItemRepository } from "../repositories/snapshots.js";

export interface QuotaUsage {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
}

/**
 * Disk quotas keep one account from filling the shared VPS file store. Uploads
 * and build artifacts are both counted.
 */
export class QuotaService {
  constructor(
    private readonly packages: PackageItemRepository,
    private readonly snapshots: SnapshotItemRepository,
    private readonly builds: BuildRepository,
    private readonly limitBytes: number
  ) {}

  async usage(userId: string): Promise<QuotaUsage> {
    const [packages, snapshots, builds] = await Promise.all([
      this.packages.bytesForUser(userId),
      this.snapshots.bytesForUser(userId),
      this.builds.bytesForUser(userId)
    ]);
    const usedBytes = packages + snapshots + builds;
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
