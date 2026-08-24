#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStarter,
  BuilderError,
  defaultLibraryDir,
  inspectPackage,
  loadProfile,
  PackageRegistry
} from "../../../packages/builder-core/dist/index.js";
import type { PackageKind } from "../../../packages/builder-core/dist/index.js";

const VERSION = "0.1.0-alpha.2";

function usage(exitCode = 2): never {
  const stream = exitCode === 0 ? console.log : console.error;
  stream(`WP Starter CLI ${VERSION}

Usage:
  wp-starter package add <package.zip> [--type plugin|theme|wordpress] [--library <dir>] [--replace]
  wp-starter package inspect <package.zip> [--type plugin|theme|wordpress]
  wp-starter package list [--type plugin|theme|wordpress] [--library <dir>]
  wp-starter package remove --type <type> --slug <slug> --version <version> [--library <dir>]
  wp-starter library path [--library <dir>]
  wp-starter build --profile <profile.json> --output <starter.zip> [--library <dir>]

The default package library is:
  ${defaultLibraryDir()}

Set WP_STARTER_HOME or pass --library to use a different library.
`);
  process.exit(exitCode);
}

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function getKind(value: string | null): PackageKind | undefined {
  if (value === null) return undefined;
  if (value === "plugin" || value === "theme" || value === "wordpress") return value;
  throw new BuilderError("invalid_package_type", `Unsupported package type: ${value}`);
}

function libraryDir(): string {
  return path.resolve(getArg("--library") || defaultLibraryDir());
}

async function handlePackage(): Promise<void> {
  const action = process.argv[3];
  const input = process.argv[4];

  if (action === "add") {
    if (!input || input.startsWith("--")) usage();
    const registry = new PackageRegistry(libraryDir());
    const result = await registry.add(input, {
      kind: getKind(getArg("--type")),
      replace: hasFlag("--replace")
    });
    const record = result.record;
    console.log(`${result.replaced ? "Replaced" : result.added ? "Added" : "Already present"}: ${record.name}`);
    console.log(`Type: ${record.kind}`);
    console.log(`Slug: ${record.slug}`);
    console.log(`Version: ${record.version}`);
    if (record.mainFile) console.log(`Main file: ${record.mainFile}`);
    console.log(`SHA-256: ${record.sha256}`);
    console.log(`Library: ${registry.root}`);
    return;
  }

  if (action === "inspect") {
    if (!input || input.startsWith("--")) usage();
    const inspected = await inspectPackage(input, getKind(getArg("--type")));
    console.log(JSON.stringify({
      type: inspected.kind,
      name: inspected.name,
      slug: inspected.slug,
      version: inspected.version,
      mainFile: inspected.mainFile ?? null,
      textDomain: inspected.textDomain ?? null,
      requiresWordPress: inspected.requiresWordPress ?? null,
      requiresPhp: inspected.requiresPhp ?? null,
      requiresPlugins: inspected.requiresPlugins ?? []
    }, null, 2));
    return;
  }

  if (action === "list") {
    const kind = getKind(getArg("--type"));
    const registry = new PackageRegistry(libraryDir());
    const records = await registry.list(kind);
    if (records.length === 0) {
      console.log(`No${kind ? ` ${kind}` : ""} packages in ${registry.root}`);
      return;
    }

    const rows = records.map((record) => ({
      Type: record.kind,
      Slug: record.slug,
      Version: record.version,
      Name: record.name,
      "Main file": record.mainFile ?? ""
    }));
    console.table(rows);
    console.log(`Library: ${registry.root}`);
    return;
  }

  if (action === "remove") {
    const kind = getKind(getArg("--type"));
    const slug = getArg("--slug");
    const version = getArg("--version");
    if (!kind || !slug || !version) usage();
    const registry = new PackageRegistry(libraryDir());
    const removed = await registry.remove(kind, slug, version);
    console.log(`Removed: ${removed.kind} ${removed.slug}@${removed.version}`);
    return;
  }

  usage();
}

async function handleBuild(): Promise<void> {
  const profilePath = getArg("--profile");
  const outputPath = getArg("--output");
  if (!profilePath || !outputPath) usage();

  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
  const bootstrapFile = path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php");
  const library = libraryDir();

  const profile = await loadProfile(profilePath, { libraryDir: library });

  console.log(`Building profile: ${profile.name}`);
  console.log(`Locale: ${profile.locale}`);
  console.log(`Plugins: ${profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale)).length}`);
  if (profile.schemaVersion === 2) console.log(`Package library: ${library}`);

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

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "package") {
    await handlePackage();
    return;
  }

  if (command === "library" && process.argv[3] === "path") {
    console.log(libraryDir());
    return;
  }

  if (command === "build") {
    await handleBuild();
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") usage(0);
  usage();
}

main().catch((error) => {
  if (error instanceof BuilderError) {
    console.error(`[${error.code}] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exit(1);
});
