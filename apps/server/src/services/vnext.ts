import { badRequest } from "../errors.js";
import { resourceHash, type VNextResourceKind } from "../core.js";
import type { User } from "../types.js";
import { ResourceRepository, type ResourceItem, type ResourceKind } from "../repositories/resources.js";
import { SharedLibrary } from "./library.js";
import { assertCanWrite } from "./ownership.js";

export const VNEXT_KINDS = ["typography", "colors", "designSystems", "templates"] as const;
export type VNextApiKind = (typeof VNEXT_KINDS)[number];

export function isVNextApiKind(value: string): value is VNextApiKind {
  return (VNEXT_KINDS as readonly string[]).includes(value);
}

const DELETABLE_KINDS: readonly VNextResourceKind[] = ["typography", "colors", "designSystems"];

/**
 * Typography Profiles, Color Profiles, Design Systems, and Portable Templates.
 *
 * Validation, id generation, and dependency protection stay in builder-core's
 * `DesignSystemResourceService`; this service adds the shared-library ownership
 * record and refuses writes from accounts that do not own the resource.
 */
export class VNextResourceService {
  constructor(
    private readonly library: SharedLibrary,
    private readonly repositories: Record<VNextApiKind, ResourceRepository>
  ) {}

  async list(kind: VNextApiKind): Promise<ResourceItem[]> {
    return this.repositories[kind].list();
  }

  async listAll(): Promise<Record<VNextApiKind, ResourceItem[]>> {
    const [typography, colors, designSystems, templates] = await Promise.all([
      this.repositories.typography.list(),
      this.repositories.colors.list(),
      this.repositories.designSystems.list(),
      this.repositories.templates.list()
    ]);
    return { typography, colors, designSystems, templates };
  }

  async save(kind: VNextApiKind, body: Record<string, unknown>, user: User): Promise<ResourceItem> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw badRequest("invalid_vnext_resource", "A resource name is required.");

    const repository = this.repositories[kind];
    const existing = typeof body.id === "string" && body.id ? await repository.findById(body.id) : null;
    if (existing) assertCanWrite(existing, user, "replace");

    const saved = await this.write(kind, body);
    const id = String((saved as { id?: unknown }).id ?? "");
    if (!id) throw badRequest("invalid_vnext_resource", "The saved resource did not return an identifier.");

    return repository.save({
      id,
      name: String((saved as { name?: unknown }).name ?? name),
      sha256: resourceHash(saved),
      document: saved,
      createdBy: existing?.createdBy ?? user.id
    });
  }

  async remove(kind: VNextApiKind, id: string, user: User): Promise<ResourceItem> {
    if (!id) throw badRequest("invalid_vnext_resource", "A resource id is required.");

    const repository = this.repositories[kind];
    const existing = await repository.requireById(id);
    assertCanWrite(existing, user, "delete");

    if ((DELETABLE_KINDS as readonly string[]).includes(kind)) {
      await this.library.designSystems().remove(kind as VNextResourceKind, id);
    } else {
      await this.library.vnext("templates").remove(id);
    }

    await repository.remove(id);
    return existing;
  }

  private async write(kind: VNextApiKind, body: Record<string, unknown>): Promise<unknown> {
    const designSystems = this.library.designSystems();
    if (kind === "typography") return designSystems.saveTypography(body as never);
    if (kind === "colors") return designSystems.saveColors(body as never);
    if (kind === "designSystems") return designSystems.saveDesignSystem(body as never);
    return this.library.vnext("templates").save(body as never);
  }

  repositoryFor(kind: VNextApiKind): ResourceRepository {
    return this.repositories[kind];
  }

  static resourceKindFor(kind: VNextApiKind): ResourceKind {
    return kind;
  }
}
