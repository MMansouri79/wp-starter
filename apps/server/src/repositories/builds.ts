import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { BuildRecord, BuildStatus } from "../types.js";

interface BuildRow {
  team_id: string;
  id: string;
  status: string;
  stage: string;
  percent: number;
  message: string;
  profile_id: string | null;
  profile_file: string;
  profile_name: string;
  artifact_file: string | null;
  artifact_path: string | null;
  sha256: string | null;
  size_bytes: number;
  manifest_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function toBuild(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    status: row.status as BuildStatus,
    stage: row.stage,
    percent: Number(row.percent),
    message: row.message,
    profileId: row.profile_id,
    profileFile: row.profile_file,
    profileName: row.profile_name,
    artifactFile: row.artifact_file,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export interface EnqueueBuildInput {
  profileId: string | null;
  profileFile: string;
  profileName: string;
  createdBy: string | null;
}

export interface BuildPatch {
  status?: BuildStatus;
  stage?: string;
  percent?: number;
  message?: string;
  artifactFile?: string | null;
  artifactPath?: string | null;
  sha256?: string | null;
  sizeBytes?: number;
  manifest?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

const PATCH_COLUMNS: Record<keyof BuildPatch, string> = {
  status: "status",
  stage: "stage",
  percent: "percent",
  message: "message",
  artifactFile: "artifact_file",
  artifactPath: "artifact_path",
  sha256: "sha256",
  sizeBytes: "size_bytes",
  manifest: "manifest_json",
  errorCode: "error_code",
  errorMessage: "error_message",
  startedAt: "started_at",
  completedAt: "completed_at"
};

export class BuildRepository {
  constructor(private readonly db: SqlDatabase, public readonly teamId: string | null = null) {}

  async enqueue(input: EnqueueBuildInput): Promise<BuildRecord> {
    if (!this.teamId) throw new Error("A team is required to enqueue a build.");
    const record: BuildRecord = {
      teamId: this.teamId!,
      id: randomUUID(),
      status: "queued",
      stage: "queued",
      percent: 0,
      message: "Waiting for a build worker.",
      profileId: input.profileId,
      profileFile: input.profileFile,
      profileName: input.profileName,
      artifactFile: null,
      sha256: null,
      sizeBytes: 0,
      manifest: null,
      errorCode: null,
      errorMessage: null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null
    };

    await this.db.run(`INSERT INTO builds (team_id, id, status, stage, percent, message, profile_id, profile_file, profile_name, artifact_file, artifact_path, sha256, size_bytes, manifest_json, error_code, error_message, created_by, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [this.teamId,
        record.id,
        record.status,
        record.stage,
        record.percent,
        record.message,
        record.profileId,
        record.profileFile,
        record.profileName,
        null,
        null,
        null,
        0,
        null,
        null,
        null,
        record.createdBy,
        record.createdAt,
        null,
        null
      ]
    );

    return record;
  }

  async list(limit = 100): Promise<BuildRecord[]> {
    const rows = await this.db.all<BuildRow>("SELECT * FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) ORDER BY created_at DESC LIMIT ?", [this.teamId, this.teamId, limit]);
    return rows.map(toBuild);
  }

  async findById(id: string): Promise<BuildRecord | null> {
    if (!this.teamId) throw new Error("Team scope is required for a build lookup.");
    const row = await this.db.get<BuildRow>("SELECT * FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND id = ?", [this.teamId, this.teamId, id]);
    return row ? toBuild(row) : null;
  }
  async findByArtifactFile(file: string): Promise<BuildRecord | null> {
    if (!this.teamId) throw new Error("Team scope is required for an artifact lookup.");
    const row = await this.db.get<BuildRow>("SELECT * FROM builds WHERE team_id = ? AND artifact_file = ?", [this.teamId, file]);
    return row ? toBuild(row) : null;
  }

  async expired(cutoff: string): Promise<BuildRecord[]> {
    const rows = await this.db.all<BuildRow>("SELECT * FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND status NOT IN ('queued', 'running') AND COALESCE(completed_at, created_at) < ?", [this.teamId, this.teamId, cutoff]);
    return rows.map(toBuild);
  }

  async requireById(id: string): Promise<BuildRecord> {
    const record = await this.findById(id);
    if (!record) throw notFound("build_not_found", "That build no longer exists.");
    return record;
  }

  /** Oldest queued job, claimed for a worker. Callers serialize claims in-process. */
  async claimNext(): Promise<BuildRecord | null> {
    const next = await this.db.get<{ id: string; team_id: string }>("SELECT id, team_id FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND status = 'queued' ORDER BY created_at ASC LIMIT 1", [this.teamId, this.teamId]
    );
    if (!next) return null;

    await this.db.run("UPDATE builds SET status = 'running', stage = 'starting', message = ?, started_at = ? WHERE id = ? AND status = 'queued' AND team_id = ?", ["Starting build.", new Date().toISOString(), next.id, next.team_id]
    );

    return new BuildRepository(this.db, next.team_id).findById(next.id);
  }

  async update(id: string, patch: BuildPatch): Promise<void> {
    if (!this.teamId) throw new Error("Team scope is required for a build update.");
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];

    for (const [key, column] of Object.entries(PATCH_COLUMNS) as Array<[keyof BuildPatch, string]>) {
      const value = patch[key];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(key === "manifest" ? (value === null ? null : JSON.stringify(value)) : (value as string | number | null));
    }

    if (!assignments.length) return;
    values.push(id);
    await this.db.run(`UPDATE builds SET ${assignments.join(", ")} WHERE id = ? AND (CAST(? AS TEXT) IS NULL OR team_id = ?)`, [...values, this.teamId, this.teamId]);
  }

  async remove(id: string): Promise<void> {
    if (!this.teamId) throw new Error("Team scope is required for a build deletion.");
    await this.db.run("DELETE FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND id = ?", [this.teamId, this.teamId, id]);
  }

  /** A restart cannot resume an in-flight job, so it is reported as failed. */
  async failInterrupted(): Promise<number> {
    const rows = await this.db.all<{ id: string; team_id: string }>("SELECT id, team_id FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND status = 'running'", [this.teamId, this.teamId]);
    for (const row of rows) {
      await this.db.run("UPDATE builds SET status = 'failed', stage = 'failed', message = ?, error_code = ?, error_message = ?, completed_at = ? WHERE id = ? AND team_id = ?", [
          "Build was interrupted by a server restart.",
          "build_interrupted",
          "The server restarted before this build finished. Start it again from the profile.",
          new Date().toISOString(),
          row.id,
          row.team_id
        ]
      );
    }
    return rows.length;
  }

  async countActive(): Promise<number> {
    const row = await this.db.get<{ total: number }>("SELECT COUNT(*) AS total FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?) AND status IN ('queued', 'running')", [this.teamId, this.teamId]
    );
    return Number(row?.total ?? 0);
  }

  async totalBytes(): Promise<number> {
    const row = await this.db.get<{ total: number }>("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM builds WHERE (CAST(? AS TEXT) IS NULL OR team_id = ?)", [this.teamId, this.teamId]
    );
    return Number(row?.total ?? 0);
  }
}
