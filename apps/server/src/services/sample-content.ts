import path from "node:path";
import { stat } from "node:fs/promises";
import type {
  ResolvedSampleContent,
  SampleAsset,
  SampleContent,
  SampleContentLibrary,
  SampleGlobalAttribute,
  SampleTerm
} from "../core.js";
import type { User } from "../types.js";
import { SampleContentRepository, type SampleResourceKind } from "../repositories/resources.js";
import { badRequest } from "../errors.js";
import { SharedLibrary } from "./library.js";
import { assertCanWrite } from "./ownership.js";
import { QuotaService } from "./quota.js";

function nameOf(resource: SampleResourceKind, document: unknown): string {
  const row = document as Record<string, unknown>;
  if (resource === "content") return String(row.title ?? "Untitled");
  if (resource === "assets") return String(row.filename ?? "Asset");
  return String(row.name ?? "Untitled");
}

/**
 * Sample Content authoring. Validation and the logical-reference graph stay in
 * `SampleContentRegistry`; this service adds per-row ownership so an invited
 * client can read a teammate's samples but only edit their own.
 */
export class SampleContentService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly items: SampleContentRepository,
    private readonly quota: QuotaService
  ) {}

  private registry() {
    return this.library.sampleContent();
  }

  async list(): Promise<SampleContentLibrary> {
    return this.registry().list();
  }

  async get(contentId: string): Promise<SampleContent> {
    return this.registry().get(contentId);
  }

  async resolveAsset(assetId: string): Promise<SampleAsset & { absoluteFile: string }> {
    return this.registry().resolveAsset(assetId);
  }

  async resolve(ids: string[]): Promise<ResolvedSampleContent> {
    return this.registry().resolve(ids);
  }

  async save(body: Record<string, unknown>, user: User): Promise<SampleContent> {
    const id = typeof body.id === "string" && body.id ? body.id : undefined;
    const existing = id ? await this.items.findById<SampleContent>("content", id) : null;
    if (existing) assertCanWrite(existing, user, "replace");

    const saved = await this.registry().save(body, id);
    await this.items.save("content", {
      id: saved.id,
      name: nameOf("content", saved),
      sha256: "",
      document: saved,
      createdBy: existing?.createdBy ?? user.id
    });
    return saved;
  }

  async saveTerm(body: Record<string, unknown>, user: User): Promise<SampleTerm> {
    const id = typeof body.id === "string" && body.id ? body.id : undefined;
    const existing = id ? await this.items.findById<SampleTerm>("terms", id) : null;
    if (existing) assertCanWrite(existing, user, "replace");

    const saved = await this.registry().saveTerm(body, id);
    await this.items.save("terms", {
      id: saved.id,
      name: nameOf("terms", saved),
      sha256: "",
      document: saved,
      createdBy: existing?.createdBy ?? user.id
    });
    return saved;
  }

  async saveAttribute(body: Record<string, unknown>, user: User): Promise<SampleGlobalAttribute> {
    const id = typeof body.id === "string" && body.id ? body.id : undefined;
    const existing = id ? await this.items.findById<SampleGlobalAttribute>("attributes", id) : null;
    if (existing) assertCanWrite(existing, user, "replace");

    const saved = await this.registry().saveAttribute(body, id);
    await this.items.save("attributes", {
      id: saved.id,
      name: nameOf("attributes", saved),
      sha256: "",
      document: saved,
      createdBy: existing?.createdBy ?? user.id
    });
    return saved;
  }

  /**
   * Duplicating is a read-then-create operation: the copy belongs to the viewer,
   * so it is allowed even for samples another account authored.
   */
  async duplicate(contentId: string, user: User): Promise<SampleContent> {
    const copy = await this.registry().duplicate(contentId);
    await this.items.save("content", {
      id: copy.id,
      name: nameOf("content", copy),
      sha256: "",
      document: copy,
      createdBy: user.id
    });
    return copy;
  }

  async importAsset(
    uploadedFile: string,
    options: { kind: "image" | "download"; filename?: string; alt?: string; caption?: string; description?: string },
    user: User
  ): Promise<SampleAsset> {
    const size = (await stat(uploadedFile)).size;
    await this.quota.assertWithinQuota(user.id, size);

    const asset = await this.registry().importAsset(uploadedFile, options);
    await this.items.save("assets", {
      id: asset.id,
      name: nameOf("assets", asset),
      sha256: asset.sha256,
      document: asset,
      createdBy: user.id
    });
    return asset;
  }

  async saveAsset(assetId: string, body: Record<string, unknown>, user: User): Promise<SampleAsset> {
    const existing = await this.items.findById<SampleAsset>("assets", assetId);
    if (existing) assertCanWrite(existing, user, "replace");

    const asset = await this.registry().saveAsset(assetId, body);
    await this.items.save("assets", {
      id: asset.id,
      name: nameOf("assets", asset),
      sha256: asset.sha256,
      document: asset,
      createdBy: existing?.createdBy ?? user.id
    });
    return asset;
  }

  async remove(resource: SampleResourceKind, id: string, user: User): Promise<void> {
    if (!["content", "terms", "attributes", "assets"].includes(resource)) {
      throw badRequest("invalid_request", "Unsupported sample content resource.");
    }

    const existing = await this.items.findById(resource, id);
    if (existing) assertCanWrite(existing, user, "delete");

    await this.registry().remove(resource, id);
    await this.items.remove(resource, id);
  }

  /** Removes ownership rows for samples that were deleted outside the web app. */
  async prune(ids: string[]): Promise<number> {
    return this.items.pruneMissing(ids);
  }

  assetPath(asset: SampleAsset): string {
    return path.join(this.library.root, asset.file);
  }
}
