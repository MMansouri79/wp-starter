import type { ElementorTemplateLibraryRecord } from "../core.js";
import type { User } from "../types.js";
import { ResourceRepository, type ResourceItem } from "../repositories/resources.js";
import { SharedLibrary } from "./library.js";
import { assertCanWrite } from "./ownership.js";

/**
 * The Elementor template library is derived from imported configuration
 * snapshots, so it is refreshed by the snapshot service and only deletion is
 * exposed here. A library entry inherits the snapshot uploader's ownership.
 */
export class ElementorTemplateService {
  constructor(private readonly library: SharedLibrary, private readonly items: ResourceRepository) {}

  async list(filters: { search?: string; sourceDomain?: string; type?: string } = {}): Promise<ElementorTemplateLibraryRecord[]> {
    return this.library.elementorTemplates().list(filters);
  }

  async remove(id: string, user: User): Promise<ResourceItem> {
    const item = await this.items.requireById(id);
    assertCanWrite(item, user, "delete");

    await this.library.elementorTemplates().remove(id);
    await this.items.remove(id);
    return item;
  }
}
