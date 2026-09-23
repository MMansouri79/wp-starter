import { migrate } from "./migrations.js";
import type { SqlDatabase } from "./driver.js";
import type { DatabaseConfig } from "../config.js";

export async function openDatabase(
  config: DatabaseConfig,
  log: (message: string) => void = () => undefined
): Promise<SqlDatabase> {
  if (config.driver === "sqlite") {
    const { SqliteDatabase } = await import("./sqlite.js");
    const database = new SqliteDatabase(config.file);
    await migrate(database, log);
    return database;
  }

  const { PostgresDatabase } = await import("./postgres.js");
  const database = await PostgresDatabase.connect({ connectionString: config.connectionString, ssl: config.ssl });
  await migrate(database, log);
  return database;
}

export { migrate } from "./migrations.js";
export type { SqlDatabase, SqlParam, SqlDialect } from "./driver.js";
