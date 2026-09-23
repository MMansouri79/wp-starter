import type { ServerConfig } from "./config.js";
import type { SqlDatabase } from "./db/driver.js";
import type { Logger } from "./log.js";
import type { AuthService } from "./auth/service.js";
import type { BuildRepository } from "./repositories/builds.js";
import type { PackageItemRepository } from "./repositories/packages.js";
import type { ProfileItemRepository } from "./repositories/profiles.js";
import type { ResourceRepository, SampleContentRepository } from "./repositories/resources.js";
import type { SnapshotItemRepository } from "./repositories/snapshots.js";
import type { UserRepository } from "./repositories/users.js";
import type { BuildService } from "./services/builds.js";
import type { DiskGuard } from "./services/disk.js";
import type { ElementorTemplateService } from "./services/elementor.js";
import type { FontProfileService } from "./services/fonts.js";
import type { SharedLibrary } from "./services/library.js";
import type { PackageService } from "./services/packages.js";
import type { ProfileService } from "./services/profiles.js";
import type { QuotaService } from "./services/quota.js";
import type { SampleContentService } from "./services/sample-content.js";
import type { SnapshotService } from "./services/snapshots.js";
import type { VNextApiKind, VNextResourceService } from "./services/vnext.js";

/**
 * Everything a request handler needs. Built once at startup so the API layer
 * holds no module-level state and tests can construct isolated instances.
 */
export interface AppContext {
  config: ServerConfig;
  version: string;
  db: SqlDatabase;
  library: SharedLibrary;
  log: Logger;

  auth: AuthService;
  quota: QuotaService;
  disk: DiskGuard;
  packages: PackageService;
  snapshots: SnapshotService;
  profiles: ProfileService;
  vnext: VNextResourceService;
  fonts: FontProfileService;
  elementor: ElementorTemplateService;
  sampleContent: SampleContentService;
  builds: BuildService;

  users: UserRepository;
  buildItems: BuildRepository;
  packageItems: PackageItemRepository;
  snapshotItems: SnapshotItemRepository;
  profileItems: ProfileItemRepository;
  resourceItems: Record<VNextApiKind, ResourceRepository>;
  fontItems: ResourceRepository;
  elementorItems: ResourceRepository;
  sampleItems: SampleContentRepository;
}
