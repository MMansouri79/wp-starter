#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStarter, BuilderError, loadProfile } from "../../../packages/builder-core/dist/index.js";

const VERSION = "0.1.0-alpha.1";

function usage(): never {
  console.error(`WP Starter CLI ${VERSION}

Usage:
  wp-starter build --profile <profile.json> --output <starter.zip>

Options:
  --profile   Path to a build profile JSON file.
  --output    Destination ZIP path.
`);
  process.exit(2);
}

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "build") usage();

  const profilePath = getArg("--profile");
  const outputPath = getArg("--output");
  if (!profilePath || !outputPath) usage();

  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
  const bootstrapFile = path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php");

  const profile = await loadProfile(profilePath);

  console.log(`Building profile: ${profile.name}`);
  console.log(`Locale: ${profile.locale}`);
  console.log(`Plugins: ${profile.plugins.length}`);

  const result = await buildStarter({
    profile,
    outputZip: outputPath,
    bootstrapFile,
    builderVersion: VERSION
  });

  console.log("");
  console.log("Build complete.");
  console.log(`Output: ${result.outputZip}`);
  console.log(`SHA-256: ${result.sha256}`);
}

main().catch((error) => {
  if (error instanceof BuilderError) {
    console.error(`[${error.code}] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exit(1);
});
