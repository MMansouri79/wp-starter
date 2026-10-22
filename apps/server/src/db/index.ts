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
    try { await migrate(database, log); } catch (error) { await database.close(); throw error; }
    return database;
  }

  const { PostgresDatabase } = await import("./postgres.js");
  const database = await PostgresDatabase.connect({ connectionString: config.connectionString, ssl: config.ssl });
  try { await migrate(database, log); } catch (error) { await database.close(); throw error; }
  return database;
}

export { migrate } from "./migrations.js";
export type { SqlDatabase, SqlParam, SqlDialect } from "./driver.js";
