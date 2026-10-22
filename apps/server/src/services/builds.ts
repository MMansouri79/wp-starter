import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { BuilderError, buildStarter, compatibilityReport, loadProfile, writeJson, type BuildProgress } from "../core.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import { assertCanWrite } from "./ownership.js";
import { assertTeamPath, validateResolvedPaths, validateTeamFiles } from "./team-paths.js";
import type { BuildRecord, User } from "../types.js";
import { BuildRepository } from "../repositories/builds.js";
import { ProfileItemRepository } from "../repositories/profiles.js";
import { safeFileName } from "../http/body.js";
import { SharedLibrary } from "./library.js";
import { publicErrorMessage } from "../http/public-data.js";
import { QuotaService } from "./quota.js";
import type { Logger } from "../log.js";

export interface BuildServiceOptions {
  workers: number;
  builderVersion: string;
  bootstrapFile: string;
  retentionHours: number;
  pollIntervalMs: number;
  /** Maximum queued+running jobs across all accounts. */
  maxActiveBuilds: number;
  resolveTeam?: (teamId: string) => Promise<BuildService>;
  countActive?: () => Promise<number>;
  canRun?: () => Promise<boolean>;
}

export const DEFAULT_BUILD_OPTIONS: Omit<BuildServiceOptions, "builderVersion" | "bootstrapFile"> = {
  workers: 2,
  retentionHours: 24 * 30,
  pollIntervalMs: 500,
  maxActiveBuilds: 4
};

/** Expired builds are swept once at startup and then on this interval. */
const RETENTION_SWEEP_INTERVAL_MS = 3600_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Server-side build queue.
 *
 * Jobs are persisted in the database so history and progress survive a restart;
 * a restart cannot resume an in-flight build, so interrupted jobs are reported
 * as failed with an actionable message. The actual build is the same
 * `buildStarter` call the CLI and local GUI use.
 */
export class BuildService {
  private running = false;
  private workerLoops: Promise<void>[] = [];
  private claimChain: Promise<unknown> = Promise.resolve();
  private retentionTimer: NodeJS.Timeout | null = null;
  private retentionSweep: Promise<void> | null = null;

  constructor(
    private readonly library: SharedLibrary,
    private readonly builds: BuildRepository,
    private readonly profiles: ProfileItemRepository,
    private readonly quota: QuotaService,
    private readonly options: BuildServiceOptions,
    private readonly log: Logger
  ) {}

  async start(): Promise<void> {
    const interrupted = await this.builds.failInterrupted();
    if (interrupted > 0) this.log.warn(`Marked ${interrupted} interrupted build(s) as failed.`);

    // Retention is enforced by this service because it owns the artifacts.
    await this.sweepExpired();

    this.running = true;
    for (let index = 0; index < this.options.workers; index += 1) {
      this.workerLoops.push(this.loop(index + 1));
    }

    this.retentionTimer = setInterval(() => void this.sweepExpired(), RETENTION_SWEEP_INTERVAL_MS);
    // Never keep the process alive for a retention sweep.
    this.retentionTimer.unref();

    this.log.info(`Build queue started with ${this.options.workers} worker(s).`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    await Promise.allSettled(this.workerLoops);
    await this.retentionSweep;
    this.workerLoops = [];
  }

  async enqueue(profileFileName: string, user: User): Promise<BuildRecord> {
    assertCanWrite({ createdBy: user.id }, user, "build");
    const safe = safeFileName(profileFileName, "");
    if (!safe || !safe.endsWith(".json")) throw badRequest("invalid_request", "A valid profile filename is required.");

    const profile = await this.profiles.findByFileName(safe);
    if (!profile) throw notFound("profile_not_found", "That build profile is no longer in the shared library.");

    const active = await (this.options.countActive?.() ?? this.builds.countActive());
    if (active >= this.options.maxActiveBuilds) {
      throw new HttpError(
        429,
        "build_queue_full",
        `The build queue is full (${active} job(s) waiting or running). Try again when a build finishes.`
      );
    }

    const usage = await this.quota.usage(user.id);
    if (usage.usedBytes >= usage.limitBytes) {
      throw new HttpError(413, "quota_exceeded", "Your storage quota is full. Remove unused builds or packages and try again.");
    }

    return this.builds.enqueue({
      profileId: profile.id,
      profileFile: safe,
      profileName: profile.name,
      createdBy: user.id
    });
  }

  async list(limit = 100): Promise<BuildRecord[]> {
    return this.builds.list(limit);
  }

  async get(id: string): Promise<BuildRecord> {
    return this.builds.requireById(id);
  }

  async remove(id: string, user: User): Promise<BuildRecord> {
    const build = await this.builds.requireById(id);
    assertCanWrite(build, user, "delete");
    if (build.status === "running" || build.status === "queued") {
      throw badRequest("build_active", "Wait for the build to finish before deleting it.");
    }

    if (build.artifactFile) {
      const target = this.artifactPath(build);
      await assertTeamPath(this.library.root, target);
      await rm(target, { force: true });
      await rm(`${target}.json`, { force: true });
    }
    await this.builds.remove(id);
    return build;
  }

  artifactPath(build: BuildRecord): string {
    if (!build.artifactFile) throw notFound("build_artifact_missing", "This build did not produce an artifact.");
    if (safeFileName(build.artifactFile, "") !== build.artifactFile) throw badRequest("unsafe_team_path", "Invalid build artifact path.");
    return path.join(this.library.buildsDir, build.artifactFile);
  }

  /** Deletes finished builds (and their artifacts) past the retention window. */
  async pruneExpired(): Promise<number> {
    return this.library.mutate(() => this.pruneExpiredLocked());
  }

  private async pruneExpiredLocked(): Promise<number> {
    const cutoff = new Date(Date.now() - this.options.retentionHours * 3600_000).toISOString();
    const rows = await this.builds.expired(cutoff);
    let removed = 0;

    for (const build of rows) {
      if (build.status === "running" || build.status === "queued") continue;
      const reference = build.completedAt ?? build.createdAt;
      if (reference >= cutoff) continue;

      const service = this.options.resolveTeam ? await this.options.resolveTeam(build.teamId) : this;
      if (build.artifactFile) {
        const target = service.artifactPath(build);
        await assertTeamPath(service.library.root, target);
        await rm(target, { force: true });
        await rm(`${target}.json`, { force: true });
      }
      await service.builds.remove(build.id);
      removed += 1;
    }

    if (removed > 0) this.log.info(`Pruned ${removed} expired build(s).`);
    return removed;
  }

  /** Runs a sweep, logging instead of throwing so the interval keeps firing. */
  private async sweepExpired(): Promise<void> {
    if (this.retentionSweep) return this.retentionSweep;
    this.retentionSweep = this.pruneExpired().then(() => undefined).catch((error) => {
      this.log.error(`Build retention sweep failed: ${describe(error)}`);
    });
    try {
      await this.retentionSweep;
    } finally { this.retentionSweep = null; }
  }

  private async loop(worker: number): Promise<void> {
    while (this.running) {
      let claimed: BuildRecord | null = null;
      try {
        claimed = await this.claim();
      } catch (error) {
        this.log.error(`Worker ${worker} could not claim a build: ${describe(error)}`);
        await sleep(this.options.pollIntervalMs);
        continue;
      }

      if (!claimed) {
        await sleep(this.options.pollIntervalMs);
        continue;
      }

      this.log.info(`Worker ${worker} started build ${claimed.id} (${claimed.profileName}).`);
      const service = this.options.resolveTeam ? await this.options.resolveTeam(claimed.teamId) : this;
      await service.execute(claimed);
    }
  }

  /** Serialized in-process so two workers never claim the same queued row. */
  private claim(): Promise<BuildRecord | null> {
    const next = this.claimChain.then(() => this.builds.claimNext());
    this.claimChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async execute(build: BuildRecord): Promise<void> {
    let lastPercent = -1;
    let lastStage = "";
    let outputZip: string | null = null;

    try {
      if (this.options.canRun && !await this.options.canRun()) throw new BuilderError("team_suspended", "The team is suspended.");
      await validateTeamFiles(this.library.root);
      await this.builds.update(build.id, { stage: "loading", message: "Resolving the build profile.", percent: 1 });

      const profilePath = path.join(this.library.profilesDir, build.profileFile);
      await assertTeamPath(this.library.root, profilePath);
      const profile = await loadProfile(profilePath, { libraryDir: this.library.root });
      await validateResolvedPaths(this.library.root, profile);
      const compatibility = compatibilityReport(profile);
      if (compatibility.status === "unsupported") {
        throw new BuilderError("unsupported_compatibility", compatibility.errors.join(" "));
      }

      await mkdir(this.library.buildsDir, { recursive: true });
      const outputName = `${safeFileName(profile.name, "starter")}-${build.id}.zip`;
      outputZip = path.join(this.library.buildsDir, outputName);

      const result = await buildStarter({
        profile,
        outputZip,
        bootstrapFile: this.options.bootstrapFile,
        builderVersion: this.options.builderVersion,
        onProgress: async (progress: BuildProgress) => {
          const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
          if (percent === lastPercent && progress.stage === lastStage) return;
          lastPercent = percent;
          lastStage = progress.stage;
          await this.builds.update(build.id, { stage: progress.stage, percent, message: progress.message });
        }
      });

      const sizeBytes = (await stat(outputZip)).size;
      await writeJson(`${outputZip}.json`, {
        schemaVersion: 1,
        file: outputName,
        profile: profile.name,
        profileFile: build.profileFile,
        locale: profile.locale,
        sha256: result.sha256,
        configurationEnabled: result.manifest.configurationEnabled === true,
        compatibility: result.compatibility || result.manifest.compatibility || compatibility,
        createdAt: new Date().toISOString(),
        createdBy: build.createdBy
      });

      await this.library.mutate(async () => {
        await this.quota.assertWithinQuota(build.createdBy ?? "", sizeBytes);
        await this.builds.update(build.id, {
          status: "complete",
          stage: "complete",
          percent: 100,
          message: "Build complete.",
          artifactFile: outputName,
          artifactPath: outputZip,
          sha256: result.sha256,
          sizeBytes,
          manifest: result.manifest,
          completedAt: new Date().toISOString()
        });
      });

      this.log.info(`Build ${build.id} complete (${outputName}, ${sizeBytes} bytes).`);
    } catch (error) {
      if (outputZip) {
        try {
          await rm(outputZip, { force: true });
          await rm(`${outputZip}.json`, { force: true });
        } catch (cleanupError) {
          this.log.error(`Build ${build.id} cleanup failed: ${describe(cleanupError)}`);
        }
      }
      const code = error instanceof BuilderError || error instanceof HttpError ? error.code : "internal_error";
      const message = error instanceof BuilderError || error instanceof HttpError
        ? publicErrorMessage(describe(error), this.library.root)
        : "Build failed unexpectedly. Consult the server log.";
      await this.builds.update(build.id, {
        status: "failed",
        stage: "failed",
        message,
        errorCode: code,
        errorMessage: message,
        completedAt: new Date().toISOString()
      });
      this.log.error(`Build ${build.id} failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
