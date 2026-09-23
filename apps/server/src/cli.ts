import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { createLogger } from "./log.js";

/** Applies pending migrations without starting the HTTP listener. */
export async function runMigrationsOnly(): Promise<number[]> {
  const config = loadConfig();
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
