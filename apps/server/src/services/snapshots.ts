import path from "node:path";
import { rm } from "node:fs/promises";
import type {
  ConfigSnapshotComparison,
  ConfigSnapshotInspection,
  ConfigSnapshotRecord,
  SnapshotRequirementReport
} from "../core.js";
import { ConfigSnapshotRegistry, BuilderError } from "../core.js";
import type { User } from "../types.js";
import { SnapshotItemRepository, type SnapshotItem } from "../repositories/snapshots.js";
import { SharedLibrary } from "./library.js";
import { QuotaService } from "./quota.js";
import { assertCanWrite } from "./ownership.js";
import { fileSize } from "./packages.js";

export interface AddSnapshotResult {
  item: SnapshotItem;
  added: boolean;
  replaced: boolean;
  report: SnapshotRequirementReport;
}

/**
 * Configuration snapshots are shared read-only: the exporter already guarantees
 * they contain only allowlisted portable settings, so anyone signed in may use
 * one, while only its uploader may replace or remove it.
 */
export class SnapshotService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly items: SnapshotItemRepository,
    private readonly quota: QuotaService
  ) {}

  private registry(): ConfigSnapshotRegistry {
    return this.library.snapshots();
  }

  async list(): Promise<SnapshotItem[]> {
    return this.items.list();
  }

  async add(uploadedFile: string, options: { replace?: boolean }, user: User): Promise<AddSnapshotResult> {
    const registry = this.registry();
    const result = await registry.add(uploadedFile, { replace: options.replace === true });
    const sizeBytes = await fileSize(path.join(this.library.root, result.record.zip));

    if (result.added) await this.quota.assertWithinQuota(user.id, sizeBytes);

    const item = await this.items.upsert(result.record, sizeBytes, user.id);
    const report = await registry.requirements(result.record.id);

    return { item, added: result.added, replaced: result.replaced, report };
  }

  async remove(id: string, user: User): Promise<SnapshotItem> {
    const item = await this.items.requireById(id);
    assertCanWrite(item, user, "remove");

    await this.registry().remove(id);
    await this.items.remove(id);
    return item;
  }

  async requirements(id: string): Promise<SnapshotRequirementReport> {
    await this.items.requireById(id);
    return this.registry().requirements(id);
  }

  async inspect(id: string): Promise<{ inspection: ConfigSnapshotInspection; requirements: SnapshotRequirementReport }> {
    await this.items.requireById(id);
    const registry = this.registry();
    const [inspection, requirements] = await Promise.all([registry.inspect(id), registry.requirements(id)]);
    return { inspection, requirements };
  }

  async compare(leftId: string, rightId: string): Promise<ConfigSnapshotComparison> {
    await this.items.requireById(leftId);
    await this.items.requireById(rightId);
    return this.registry().compare(leftId, rightId);
  }

  async elementorTemplates(): Promise<Awaited<ReturnType<ConfigSnapshotRegistry["listElementorTemplates"]>>> {
    return this.registry().listElementorTemplates();
  }

  /** Keeps the derived Elementor template library in step with imported snapshots. */
  async syncElementorTemplates(): Promise<void> {
    await this.registry().syncElementorTemplateLibrary();
  }
}

export function assertZipUpload(filename: string): void {
  if (!filename.toLowerCase().endsWith(".zip")) {
    throw new BuilderError("invalid_upload", "Only .zip files can be imported.");
  }
}

export async function discardUpload(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

export type { ConfigSnapshotRecord };
