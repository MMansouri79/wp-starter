import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { exists, sha256File } from "../core.js";
import type { ElementorTemplateLibraryRecord } from "../core.js";
import { PackageItemRepository } from "../repositories/packages.js";
import { ProfileItemRepository, type ProfileDocument } from "../repositories/profiles.js";
import { ResourceRepository, SampleContentRepository, RESOURCE_KINDS } from "../repositories/resources.js";
import { SnapshotItemRepository } from "../repositories/snapshots.js";
import { SharedLibrary } from "./library.js";
import type { Logger } from "../log.js";

async function sizeOf(target: string): Promise<number> {
  try {
    return (await stat(target)).size;
  } catch {
    return 0;
  }
}

/**
 * Reconciles the database with the canonical library directory.
 *
 * The file registries stay authoritative for content, and the CLI can still
 * import into the shared directory directly. This pass makes those items visible
 * in the web app as unowned entries and drops ownership rows whose content was
 * removed outside the server.
 */
export class LibrarySyncService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly packages: PackageItemRepository,
    private readonly snapshots: SnapshotItemRepository,
    private readonly profiles: ProfileItemRepository,
    private readonly resources: Record<string, ResourceRepository>,
    private readonly fonts: ResourceRepository,
    private readonly elementor: ResourceRepository,
    private readonly sampleContent: SampleContentRepository,
    private readonly log: Logger
  ) {}

  async run(): Promise<void> {
    const imported = [
      await this.syncPackages(),
      await this.syncSnapshots(),
      await this.syncProfiles(),
      await this.syncResources(),
      await this.syncSampleContent()
    ].reduce((total, value) => total + value, 0);

    if (imported > 0) this.log.info(`Imported ${imported} library item(s) created outside the web app.`);
  }

  private async syncPackages(): Promise<number> {
    let imported = 0;
    const keep = new Set<string>();
    for (const record of await this.library.packages().list()) {
      const variant = record.variant || record.locale || (record.kind === "wordpress" ? "en_US" : "default");
      const existing = await this.packages.findByCoordinate(record.kind, record.slug, record.version, variant);
      const item = await this.packages.upsert({
        record,
        sizeBytes: await sizeOf(path.join(this.library.root, record.zip)),
        uploadedBy: existing?.createdBy ?? null
      });
      keep.add(item.id);
      if (!existing) imported += 1;
    }
    for (const item of await this.packages.list()) if (!keep.has(item.id)) await this.packages.remove(item.id);
    return imported;
  }

  private async syncSnapshots(): Promise<number> {
    let imported = 0;
    const keep = new Set<string>();
    for (const record of await this.library.snapshots().list()) {
      const existing = await this.snapshots.findById(record.id);
      await this.snapshots.upsert(record, await sizeOf(path.join(this.library.root, record.zip)), existing?.createdBy ?? null);
      keep.add(record.id);
      if (!existing) imported += 1;
    }
    for (const item of await this.snapshots.list()) if (!keep.has(item.id)) await this.snapshots.remove(item.id);
    return imported;
  }

  private async syncProfiles(): Promise<number> {
    let imported = 0;
    const directory = this.library.profilesDir;
    if (!(await exists(directory))) return 0;
    const keep = new Set<string>();

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const existing = await this.profiles.findByFileName(entry.name);
      if (existing) keep.add(existing.id);

      const target = path.join(directory, entry.name);
      try {
        const document = JSON.parse(await readFile(target, "utf8")) as ProfileDocument;
        const item = await this.profiles.save({
          fileName: entry.name,
          name: String(document.name || entry.name.replace(/\.json$/i, "")),
          sha256: await sha256File(target),
          document,
          createdBy: existing?.createdBy ?? null
        });
        keep.add(item.id);
        if (!existing) imported += 1;
      } catch (error) {
        this.log.warn(`Skipped unreadable profile ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const item of await this.profiles.list()) if (!keep.has(item.id)) await this.profiles.remove(item.id);
    return imported;
  }

  private async syncResources(): Promise<number> {
    let imported = 0;

    for (const kind of RESOURCE_KINDS) {
      const repository = kind === "fonts" ? this.fonts : kind === "elementor" ? this.elementor : this.resources[kind];
      if (!repository) continue;

      const documents = kind === "elementor"
        ? await this.library.elementorTemplates().list()
        : kind === "fonts"
          ? await this.library.fonts().list()
          : kind === "templates"
            ? await this.library.vnext("templates").list()
            : await this.library.vnext(kind).list();

      const ids: string[] = [];
      for (const document of documents as Array<{ id: string; name?: string }>) {
        ids.push(document.id);
        const existing = await repository.findById(document.id);
        const snapshot = kind === "elementor" ? await this.snapshots.findById((document as ElementorTemplateLibraryRecord).snapshotId) : null;
        if (kind === "elementor" && existing?.createdBy === null && snapshot?.createdBy) {
          await repository.assignUnowned(document.id, snapshot.createdBy);
        }
        await repository.save({
          id: document.id,
          name: String(document.name ?? document.id),
          sha256: "",
          document,
          createdBy: existing?.createdBy ?? snapshot?.createdBy ?? null
        });
        if (!existing) imported += 1;
      }

      await repository.pruneMissing(ids);
    }

    return imported;
  }

  private async syncSampleContent(): Promise<number> {
    const library = await this.library.sampleContent().list();
    const rows: Array<{ resource: "content" | "terms" | "attributes" | "assets"; id: string; name: string; document: unknown }> = [
      ...library.content.map((row) => ({ resource: "content" as const, id: row.id, name: String(row.title), document: row })),
      ...library.terms.map((row) => ({ resource: "terms" as const, id: row.id, name: row.name, document: row })),
      ...library.attributes.map((row) => ({ resource: "attributes" as const, id: row.id, name: row.name, document: row })),
      ...library.assets.map((row) => ({ resource: "assets" as const, id: row.id, name: row.filename, document: row }))
    ];

    let imported = 0;
    for (const row of rows) {
      const existing = await this.sampleContent.findById(row.resource, row.id);
      await this.sampleContent.save(row.resource, {
        id: row.id,
        name: row.name,
        sha256: "",
        document: row.document,
        createdBy: existing?.createdBy ?? null
      });
      if (!existing) imported += 1;
    }

    await this.sampleContent.pruneMissing(rows.map((row) => row.id));
    return imported;
  }
}
