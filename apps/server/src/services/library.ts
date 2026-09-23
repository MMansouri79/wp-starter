import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  ConfigSnapshotRegistry,
  DesignSystemResourceService,
  ElementorTemplateLibrary,
  FontSystemRegistry,
  PackageRegistry,
  SampleContentRegistry,
  VNextResourceRegistry
} from "../core.js";

export const VNEXT_FILES = {
  typography: "typography.json",
  colors: "colors.json",
  designSystems: "design-systems.json",
  templates: "templates.json"
} as const;

export type VNextKind = keyof typeof VNEXT_FILES;

export function isVNextKind(value: string): value is VNextKind {
  return Object.hasOwn(VNEXT_FILES, value);
}

/**
 * The one canonical library every account shares. builder-core keeps using its
 * file registries here; the database mirrors ownership metadata for the web app.
 */
export class SharedLibrary {
  public readonly root: string;
  public readonly profilesDir: string;
  public readonly buildsDir: string;
  public readonly vnextDir: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.profilesDir = path.join(this.root, "profiles");
    this.buildsDir = path.join(this.root, "builds");
    this.vnextDir = path.join(this.root, "vnext");
  }

  async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.profilesDir, { recursive: true }),
      mkdir(this.buildsDir, { recursive: true }),
      mkdir(this.vnextDir, { recursive: true })
    ]);
  }

  packages(): PackageRegistry {
    return new PackageRegistry(this.root);
  }

  snapshots(): ConfigSnapshotRegistry {
    return new ConfigSnapshotRegistry(this.root);
  }

  fonts(): FontSystemRegistry {
    return new FontSystemRegistry(this.root);
  }

  elementorTemplates(): ElementorTemplateLibrary {
    return new ElementorTemplateLibrary(this.root);
  }

  sampleContent(): SampleContentRegistry {
    return new SampleContentRegistry(this.root);
  }

  designSystems(): DesignSystemResourceService {
    return new DesignSystemResourceService(this.root);
  }

  vnext(kind: VNextKind): VNextResourceRegistry<{ id: string }> {
    return new VNextResourceRegistry<{ id: string }>(this.vnextDir, VNEXT_FILES[kind]);
  }
}
