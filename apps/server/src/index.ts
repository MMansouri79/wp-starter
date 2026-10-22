#!/usr/bin/env node
import path from "node:path";
import { appRoot } from "./config.js";
import { loadEnvFile } from "./env.js";
import { startApplication } from "./app.js";
import { runMigrationsOnly, runTeamMigration } from "./cli.js";

loadEnvFile(path.join(appRoot, ".env"));

const [command = "start", ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === "migrate-teams") {
    process.stdout.write(`${JSON.stringify(await runTeamMigration(rest.includes("--dry-run")), null, 2)}\n`);
    return;
  }
  if (command === "migrate") {
    const applied = await runMigrationsOnly();
    process.stdout.write(`Applied ${applied.length} migration(s): ${applied.join(", ") || "none"}\n`);
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(
      [
        "wp-starter-server <command>",
        "",
        "Commands:",
        "  start (default)  Run the shared web application",
        "  migrate          Apply pending database migrations and exit",
        "  migrate-teams    Move the legacy library after a coordinated backup (supports --dry-run)",
        "",
        "Configuration is read from apps/server/.env and the process environment.",
        "See docs/SERVER-DEPLOYMENT.md."
      ].join("\n") + "\n"
    );
    return;
  }

  if (command !== "start") {
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exitCode = 2;
    return;
  }

  void rest;
  const application = await startApplication();

  const shutdown = async (signal: string) => {
    application.app.log.info(`Received ${signal}, shutting down.`);
    await application.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
