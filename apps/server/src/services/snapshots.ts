import path from "node:path";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import type {
  ConfigSnapshotComparison,
  ConfigSnapshotInspection,
  ConfigSnapshotRecord,
  SnapshotRequirementReport
} from "../core.js";
import { ConfigSnapshotRegistry, ElementorTemplateLibrary, BuilderError, exists } from "../core.js";
import { ResourceRepository } from "../repositories/resources.js";
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
    private readonly quota: QuotaService,
    private readonly templates: ResourceRepository
  ) {}

  private registry(): ConfigSnapshotRegistry {
    return this.library.snapshots();
  }

  async list(): Promise<SnapshotItem[]> {
    return this.items.list();
  }

  async add(uploadedFile: string, options: { replace?: boolean }, user: User): Promise<AddSnapshotResult> {
    return this.library.mutate(() => this.addLocked(uploadedFile, options, user));
  }

  private async addLocked(uploadedFile: string, options: { replace?: boolean }, user: User): Promise<AddSnapshotResult> {
    const registry = this.registry();
    const staging = await mkdtemp(path.join(os.tmpdir(), "wp-starter-snapshot-stage-"));
    try {
      const templateRegistry = path.join(this.library.root, "elementor-templates.json");
      if (await exists(templateRegistry)) await copyFile(templateRegistry, path.join(staging, "elementor-templates.json"));
      const prepared = await new ConfigSnapshotRegistry(staging).add(uploadedFile);
      const existing = await this.items.findById(prepared.record.id);
      const stored = (await registry.list()).find((row) => row.id === prepared.record.id);
      if (stored?.sha256 === prepared.record.sha256 && await exists(path.join(this.library.root, stored.zip))) {
        const item = existing ?? await this.items.upsert(stored, await fileSize(path.join(this.library.root, stored.zip)), null);
        return { item, added: false, replaced: false, report: await registry.requirements(stored.id) };
      }
      if (stored || existing) assertCanWrite(existing ?? { createdBy: null }, user, "replace");
      const documents = (await new ElementorTemplateLibrary(staging).list()).filter((row) => row.snapshotId === prepared.record.id);
      const currentTemplates = await this.library.elementorTemplates().list();
      for (const document of documents) {
        const owned = await this.templates.findById(document.id);
        if (owned || currentTemplates.some((row) => row.id === document.id)) assertCanWrite(owned ?? { createdBy: null }, user, "replace");
      }
      await this.quota.assertWithinQuota(user.id, Math.max(0, (await fileSize(uploadedFile)) - (existing?.sizeBytes ?? 0)));
      const result = await registry.add(uploadedFile, { replace: options.replace === true });
      const sizeBytes = await fileSize(path.join(this.library.root, result.record.zip));

      const item = await this.items.upsert(result.record, sizeBytes, existing ? existing.createdBy : stored ? null : user.id);
      for (const document of await this.library.elementorTemplates().list()) {
        if (!documents.some((row) => row.id === document.id)) continue;
        await this.templates.save({ id: document.id, name: document.name, sha256: document.sha256, document, createdBy: item.createdBy });
      }
      const report = await registry.requirements(result.record.id);

      return { item, added: result.added, replaced: result.replaced, report };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
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
