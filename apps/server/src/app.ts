import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { loadConfig, appRoot, type ConfigOverrides, type ServerConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { createLogger, type Logger } from "./log.js";
import { AuthService } from "./auth/service.js";
import { BuildRepository } from "./repositories/builds.js";
import { PackageItemRepository } from "./repositories/packages.js";
import { ProfileItemRepository } from "./repositories/profiles.js";
import { ResourceRepository, SampleContentRepository } from "./repositories/resources.js";
import { SnapshotItemRepository } from "./repositories/snapshots.js";
import { UserRepository } from "./repositories/users.js";
import { BuildService } from "./services/builds.js";
import { DiskGuard } from "./services/disk.js";
import { ElementorTemplateService } from "./services/elementor.js";
import { FontProfileService } from "./services/fonts.js";
import { SharedLibrary } from "./services/library.js";
import { PackageService } from "./services/packages.js";
import { ProfileService } from "./services/profiles.js";
import { QuotaService } from "./services/quota.js";
import { SampleContentService } from "./services/sample-content.js";
import { SnapshotService } from "./services/snapshots.js";
import { LibrarySyncService } from "./services/sync.js";
import { VNextResourceService, type VNextApiKind } from "./services/vnext.js";
import { createServer } from "./server.js";
import type { AppContext } from "./app-context.js";

export interface Application {
  app: AppContext;
  server: Server;
  /** Absolute URL the server is listening on; resolved after `listen`. */
  readonly url: string;
  stop(): Promise<void>;
}

export interface StartOptions extends ConfigOverrides {
  /** Skips the filesystem reconciliation pass; used by tests for speed. */
  skipSync?: boolean;
}

/** Reflects the port actually bound, which matters when `port: 0` was requested. */
function boundUrl(server: Server, config: ServerConfig): string {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : config.port;
  const scheme = config.secureCookies ? "https" : "http";
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  return `${scheme}://${host}:${port}`;
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(path.join(appRoot, "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function createApplication(overrides: StartOptions = {}): Promise<Application> {
  const config = loadConfig(overrides);
  const log: Logger = createLogger(config.logLevel);
  const version = await readVersion();

  const db = await openDatabase(config.database, (message) => log.info(message));
  const library = new SharedLibrary(config.dataDir);
  await library.ensureDirectories();

  const auth = new AuthService(db, {
    sessionTtlHours: config.sessionTtlHours,
    allowOpenRegistration: config.allowOpenRegistration
  });
  await auth.ensureBootstrapAdmin(config.bootstrapAdmin);

  const packageItems = new PackageItemRepository(db);
  const snapshotItems = new SnapshotItemRepository(db);
  const profileItems = new ProfileItemRepository(db);
  const buildItems = new BuildRepository(db);
  const sampleItems = new SampleContentRepository(db);

  const resourceItems: Record<VNextApiKind, ResourceRepository> = {
    typography: new ResourceRepository(db, "typography"),
    colors: new ResourceRepository(db, "colors"),
    designSystems: new ResourceRepository(db, "designSystems"),
    templates: new ResourceRepository(db, "templates")
  };
  const fontsRepository = new ResourceRepository(db, "fonts");
  const elementorRepository = new ResourceRepository(db, "elementor");

  const quota = new QuotaService(packageItems, snapshotItems, buildItems, config.accountQuotaBytes);
  const disk = new DiskGuard(library.root, config.minimumFreeBytes);

  const app: AppContext = {
    config,
    version,
    db,
    library,
    log,
    auth,
    quota,
    disk,
    packages: new PackageService(library, packageItems, quota),
    snapshots: new SnapshotService(library, snapshotItems, quota),
    profiles: new ProfileService(library, profileItems),
    vnext: new VNextResourceService(library, resourceItems),
    fonts: new FontProfileService(library, fontsRepository, quota),
    elementor: new ElementorTemplateService(library, elementorRepository),
    sampleContent: new SampleContentService(library, sampleItems, quota),
    builds: new BuildService(
      library,
      buildItems,
      profileItems,
      quota,
      {
        workers: config.buildWorkers,
        builderVersion: version,
        bootstrapFile: config.bootstrapFile,
        retentionHours: config.buildJobRetentionHours,
        pollIntervalMs: 500,
        maxActiveBuilds: Math.max(config.buildWorkers * 2, 4)
      },
      log
    ),
    users: new UserRepository(db),
    buildItems,
    packageItems,
    snapshotItems,
    profileItems,
    resourceItems,
    fontItems: fontsRepository,
    elementorItems: elementorRepository,
    sampleItems
  };

  if (!overrides.skipSync) {
    const sync = new LibrarySyncService(
      library,
      packageItems,
      snapshotItems,
      profileItems,
      resourceItems,
      fontsRepository,
      elementorRepository,
      sampleItems,
      log
    );
    await sync.run();
  }

  const server = createServer({ app });

  return {
    app,
    server,
    get url() {
      return boundUrl(server, config);
    },
    async stop() {
      await app.builds.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    }
  };
}

export async function startApplication(overrides: StartOptions = {}): Promise<Application> {
  const application = await createApplication(overrides);
  const { config } = application.app;

  await new Promise<void>((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(config.port, config.host, () => {
      application.server.off("error", reject);
      resolve();
    });
  });

  await application.app.builds.start();
  application.app.log.info(`WP Starter server ${application.app.version} listening on ${application.url}`);
  application.app.log.info(`Shared library: ${application.app.library.root}`);
  application.app.log.info(`Database driver: ${application.app.db.dialect}`);

  return application;
}
