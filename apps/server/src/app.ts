import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { loadConfig, appRoot, type ConfigOverrides, type ServerConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { createLogger, type Logger } from "./log.js";
import { AuthService } from "./auth/service.js";
import { LoginRateLimiter } from "./auth/rate-limit.js";
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
import { TeamService } from "./services/teams.js";
import { MutationLock } from "./services/mutex.js";
import { hasLegacyPayload } from "./services/team-migration.js";
import { acquireServerLock } from "./services/server-lock.js";
import { validateTeamFiles } from "./services/team-paths.js";
import { startPluginUpdateScheduler } from "./services/plugin-updates.js";
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
  try {
    const migration = await db.get<{ state: string }>("SELECT state FROM team_migration WHERE id = 'library'");
    if (migration?.state !== "complete" || await hasLegacyPayload(config.dataDir)) {
      await db.close();
      throw new Error("Team library migration is incomplete. Stop the server, back up the database and files, then run migrate-teams. See docs/SERVER-DEPLOYMENT.md.");
    }
    const mutations = new MutationLock();
    const library = new SharedLibrary(config.dataDir, mutations);
    await mkdir(config.dataDir, { recursive: true });
    const teams = new TeamService(db, config.dataDir);

    const auth = new AuthService(db, {
      sessionTtlHours: config.sessionTtlHours,
      allowOpenRegistration: false,
      rateLimiter: new LoginRateLimiter({ maxAttempts: config.loginMaxAttempts, lockoutSeconds: config.loginLockoutSeconds })
    });
    await auth.ensureBootstrapAdmin(config.bootstrapAdmin);

    const packageItems = new PackageItemRepository(db, "");
    const snapshotItems = new SnapshotItemRepository(db, "");
    const profileItems = new ProfileItemRepository(db, "");
    const buildItems = new BuildRepository(db);
    const sampleItems = new SampleContentRepository(db, "");

    const resourceItems: Record<VNextApiKind, ResourceRepository> = {
      typography: new ResourceRepository(db, "typography", ""),
      colors: new ResourceRepository(db, "colors", ""),
      designSystems: new ResourceRepository(db, "designSystems", ""),
      templates: new ResourceRepository(db, "templates", "")
    };
    const fontsRepository = new ResourceRepository(db, "fonts", "");
    const elementorRepository = new ResourceRepository(db, "elementor", "");

    const quota = new QuotaService(packageItems, snapshotItems, buildItems, config.accountQuotaBytes, library, fontsRepository, sampleItems);
    const disk = new DiskGuard(library.root, config.minimumFreeBytes);

    const app: AppContext = {
      teams,
      teamId: null,
      forTeam: (id) => forTeam(id),
      config,
      version,
      db,
      library,
      log,
      auth,
      quota,
      disk,
      packages: new PackageService(library, packageItems, quota),
      snapshots: new SnapshotService(library, snapshotItems, quota, elementorRepository),
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
          maxActiveBuilds: Math.max(config.buildWorkers * 2, 4),
          resolveTeam: async (id) => (await forTeam(id)).builds
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

    const contexts = new Map<string, Promise<AppContext>>();
    function forTeam(id: string): Promise<AppContext> {
      const cached = contexts.get(id);
      if (cached) return cached;
      const pending = makeTeamContext(app, id, mutations, overrides.skipSync ?? false);
      contexts.set(id, pending);
      pending.catch(() => contexts.delete(id));
      return pending;
    }
    for (const team of await teams.all()) await forTeam(team.id);

    const server = createServer({ app });
    const stopPluginUpdates = startPluginUpdateScheduler(app);

    return {
      app,
      server,
      get url() {
        return boundUrl(server, config);
      },
      async stop() {
        await stopPluginUpdates();
        await app.builds.stop();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await db.close();
      }
    };
  } catch (error) { await db.close(); throw error; }
}

async function makeTeamContext(base: AppContext, id: string, mutations: MutationLock, skipSync: boolean): Promise<AppContext> {
  if (!await base.teams.find(id)) throw new Error("Unknown team.");
  const library = new SharedLibrary(base.teams.root(id), mutations);
  await library.ensureDirectories();
  await validateTeamFiles(library.root);
  const { db, config, log, version } = base;
  const packageItems = new PackageItemRepository(db, id);
  const snapshotItems = new SnapshotItemRepository(db, id);
  const profileItems = new ProfileItemRepository(db, id);
  const buildItems = new BuildRepository(db, id);
  const sampleItems = new SampleContentRepository(db, id);
  const resourceItems: Record<VNextApiKind, ResourceRepository> = {
    typography: new ResourceRepository(db, "typography", id), colors: new ResourceRepository(db, "colors", id),
    designSystems: new ResourceRepository(db, "designSystems", id), templates: new ResourceRepository(db, "templates", id)
  };
  const fontItems = new ResourceRepository(db, "fonts", id);
  const elementorItems = new ResourceRepository(db, "elementor", id);
  const quota = new QuotaService(packageItems, snapshotItems, buildItems, config.accountQuotaBytes, library, fontItems, sampleItems);
  const context: AppContext = {
    ...base, teamId: id, library, packageItems, snapshotItems, profileItems, buildItems, sampleItems, resourceItems, fontItems, elementorItems, quota,
    disk: new DiskGuard(library.root, config.minimumFreeBytes),
    packages: new PackageService(library, packageItems, quota), snapshots: new SnapshotService(library, snapshotItems, quota, elementorItems),
    profiles: new ProfileService(library, profileItems), vnext: new VNextResourceService(library, resourceItems),
    fonts: new FontProfileService(library, fontItems, quota), elementor: new ElementorTemplateService(library, elementorItems),
    sampleContent: new SampleContentService(library, sampleItems, quota),
    builds: new BuildService(library, buildItems, profileItems, quota, {
      workers: 0, builderVersion: version, bootstrapFile: config.bootstrapFile, retentionHours: config.buildJobRetentionHours,
      pollIntervalMs: 500, maxActiveBuilds: Math.max(config.buildWorkers * 2, 4), countActive: () => base.buildItems.countActive(),
      canRun: async () => (await base.teams.find(id))?.status === "active"
    }, log)
  };
  if (!skipSync) await new LibrarySyncService(library, packageItems, snapshotItems, profileItems, resourceItems, fontItems, elementorItems, sampleItems, log).run();
  return context;
}

export async function startApplication(overrides: StartOptions = {}): Promise<Application> {
  const releaseLock = await acquireServerLock(loadConfig(overrides).dataDir);
  let application: Application;
  try { application = await createApplication(overrides); }
  catch (error) { await releaseLock(); throw error; }
  const stop = application.stop;
  let stopped = false;
  application.stop = async () => {
    if (stopped) return;
    stopped = true;
    try { await stop(); } finally { await releaseLock(); }
  };
  const { config } = application.app;

  try { await new Promise<void>((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(config.port, config.host, () => {
      application.server.off("error", reject);
      resolve();
    });
  }); } catch (error) { await application.stop(); throw error; }

  try { await application.app.builds.start(); } catch (error) { await application.stop(); throw error; }
  application.app.log.info(`WP Starter server ${application.app.version} listening on ${application.url}`);
  application.app.log.info(`Team file-store root: ${application.app.library.root}`);
  application.app.log.info(`Database driver: ${application.app.db.dialect}`);

  return application;
}
