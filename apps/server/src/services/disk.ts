import { statfs } from "node:fs/promises";
import { HttpError } from "../errors.js";

export interface DiskStatus {
  freeBytes: number;
  totalBytes: number;
  usedPercent: number;
  /** False once free space drops below the configured reserve. */
  ok: boolean;
}

/**
 * Guards the shared file store against a full disk.
 *
 * Uploads and builds write large archives, so the server refuses new writes
 * once free space falls under a reserve instead of failing halfway through a
 * build. The health endpoint reports the same numbers so monitoring can alert
 * before writes start failing.
 */
export class DiskGuard {
  constructor(private readonly root: string, private readonly minimumFreeBytes: number) {}

  async status(): Promise<DiskStatus> {
    try {
      const stats = await statfs(this.root);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
      return { freeBytes, totalBytes, usedPercent, ok: freeBytes >= this.minimumFreeBytes };
    } catch {
      // A platform without statfs support must not block writes.
      return { freeBytes: Number.POSITIVE_INFINITY, totalBytes: 0, usedPercent: 0, ok: true };
    }
  }

  /** Rejects a write that the file store cannot hold. */
  async assertWritable(): Promise<void> {
    const status = await this.status();
    if (status.ok) return;

    const freeMiB = Math.floor(status.freeBytes / (1024 * 1024));
    const reserveMiB = Math.floor(this.minimumFreeBytes / (1024 * 1024));
    throw new HttpError(
      507,
      "disk_full",
      `The shared file store has ${freeMiB} MiB free, below the ${reserveMiB} MiB reserve. Free space on the server before uploading or building.`
    );
  }
}
