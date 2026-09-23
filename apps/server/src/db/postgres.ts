import { Pool, type PoolClient } from "pg";
import { normalizeParams, toPostgresPlaceholders, type SqlDatabase, type SqlParam } from "./driver.js";

/**
 * Production driver. `pg` is the only third-party runtime dependency of the
 * server; this module is imported dynamically so SQLite-only installs never
 * load it.
 */
export class PostgresDatabase implements SqlDatabase {
  public readonly dialect = "postgres" as const;
  private readonly pool: Pool;
  private client: PoolClient | null = null;
  private depth = 0;
  private closed = false;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async connect(options: { connectionString: string; ssl: boolean }): Promise<PostgresDatabase> {
    const pool = new Pool({
      connectionString: options.connectionString,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      max: 10
    });
    const database = new PostgresDatabase(pool);
    await database.all("SELECT 1 AS ok");
    return database;
  }

  private async query<T>(sql: string, params: readonly SqlParam[], mode: "all" | "get"): Promise<T> {
    const text = toPostgresPlaceholders(sql);
    const values = normalizeParams(params);
    const executor = this.client ?? this.pool;
    const result = await executor.query(text, values as unknown[]);
    return (mode === "all" ? result.rows : result.rows[0]) as T;
  }

  async all<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    return this.query<T[]>(sql, params, "all");
  }

  async get<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): Promise<T | undefined> {
    return this.query<T | undefined>(sql, params, "get");
  }

  async run(sql: string, params: readonly SqlParam[] = []): Promise<void> {
    await this.all(sql, params);
  }

  async exec(sql: string): Promise<void> {
    const executor = this.client ?? this.pool;
    await executor.query(sql);
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.depth > 0) return work(this);
    const client = await this.pool.connect();
    this.client = client;
    this.depth += 1;
    try {
      await client.query("BEGIN");
      const result = await work(this);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
      this.client = null;
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
