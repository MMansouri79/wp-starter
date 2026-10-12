import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MutationLock } from "../services/mutex.js";
import { normalizeParams, type SqlDatabase, type SqlParam } from "./driver.js";

/**
 * Embedded driver backed by the Node built-in SQLite module.
 *
 * It exists so local development and the server test suite can run the full
 * stack without provisioning PostgreSQL. Production deployments should use the
 * PostgreSQL driver; see `docs/SERVER-DEPLOYMENT.md`.
 */
export class SqliteDatabase implements SqlDatabase {
  public readonly dialect = "sqlite" as const;
  private readonly connection: DatabaseSync;
  private depth = 0;
  private readonly operations = new MutationLock();
  private closed = false;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.connection = new DatabaseSync(file);
    this.connection.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
  }

  async all<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    return this.operations.run(async () => this.connection.prepare(sql).all(...normalizeParams(params)) as T[]);
  }

  async get<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): Promise<T | undefined> {
    return this.operations.run(async () => this.connection.prepare(sql).get(...normalizeParams(params)) as T | undefined);
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    await this.operations.run(async () => { this.connection.prepare(sql).run(...normalizeParams(params)); });
  }

  async exec(sql: string): Promise<void> {
    await this.operations.run(async () => { this.connection.exec(sql); });
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return this.operations.run(() => this.runTransaction(work));
  }

  private async runTransaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.depth > 0) return work(this);
    this.connection.exec("BEGIN IMMEDIATE");
    this.depth += 1;
    try {
      const result = await work(this);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  async close(): Promise<void> {
    await this.operations.run(async () => {
      if (this.closed) return;
      this.closed = true;
      this.connection.close();
    });
  }
}
