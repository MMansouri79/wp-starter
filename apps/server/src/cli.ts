import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { createLogger } from "./log.js";
import { migrateTeamLibrary } from "./services/team-migration.js";
import { assertServerStopped } from "./services/server-lock.js";

/** Applies pending migrations without starting the HTTP listener. */
export async function runMigrationsOnly(): Promise<number[]> {
  const config = loadConfig();
  await assertServerStopped(config.dataDir);
  const log = createLogger(config.logLevel);
  const applied: number[] = [];

  const db = await openDatabase(config.database, (message) => {
    log.info(message);
    const match = /Applied migration (\d+)/.exec(message);
    if (match) applied.push(Number(match[1]));
  });

  await db.close();
  return applied;
}

export async function runTeamMigration(dryRun: boolean) {
  const config = loadConfig();
  await assertServerStopped(config.dataDir);
  const db = config.database.driver === "sqlite"
    ? new (await import("./db/sqlite.js")).SqliteDatabase(config.database.file)
    : await (await import("./db/postgres.js")).PostgresDatabase.connect({ connectionString: config.database.connectionString, ssl: config.database.ssl });
  try { return await migrateTeamLibrary(db, config.dataDir, dryRun); }
  finally { await db.close(); }
}
