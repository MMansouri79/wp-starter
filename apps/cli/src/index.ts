#!/usr/bin/env node
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildStarter,
  BuilderError,
  defaultLibraryDir,
  inspectPackage,
  loadProfile,
  PackageRegistry,
  ConfigSnapshotRegistry,
  createProfileFromSnapshot
} from "../../../packages/builder-core/dist/index.js";
import type { PackageKind } from "../../../packages/builder-core/dist/index.js";

const VERSION = "0.1.0-alpha.13";

function usage(exitCode = 2): never {
  const stream = exitCode === 0 ? console.log : console.error;
  stream(`WP Starter CLI ${VERSION}

Usage:
  wp-starter package add <package.zip> [--type plugin|theme|wordpress] [--library <dir>] [--replace]
  wp-starter package inspect <package.zip> [--type plugin|theme|wordpress]
  wp-starter package list [--type plugin|theme|wordpress] [--library <dir>]
  wp-starter package remove --type <type> --slug <slug> --version <version> [--variant <variant>] [--library <dir>]
  wp-starter config add <starter-config.zip> [--id <id>] [--name <name>] [--library <dir>] [--replace]
  wp-starter config list [--library <dir>]
  wp-starter config check <id> [--library <dir>]
  wp-starter config remove <id> [--library <dir>]
  wp-starter profile create <config-id> --output <profile.json> [--name <name>] [--locale <locale>] [--wordpress-version <version>] [--wordpress-variant <locale>] [--theme-version <version>] [--plugin-version <slug=version>]... [--exclude-plugin <slug>]... [--library <dir>] [--replace]
  wp-starter profile check <profile.json> [--library <dir>]
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

function getArgs(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === name) values.push(process.argv[i + 1]);
  }
  return values;
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
    if (record.variant) console.log(`Variant: ${record.variant}`);
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
      variant: inspected.variant ?? null,
      locale: inspected.locale ?? null,
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
      Variant: record.variant ?? "",
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
    const removed = await registry.remove(kind, slug, version, getArg("--variant") ?? undefined);
    console.log(`Removed: ${removed.kind} ${removed.slug}@${removed.version}`);
    return;
  }

  usage();
}


async function printRequirementReport(registry: ConfigSnapshotRegistry, id: string): Promise<void> {
  const report = await registry.requirements(id);
  const rows = report.requirements.map((item) => ({
    Status: item.status === "available" ? "OK" : "MISSING",
    Type: item.kind,
    Slug: item.slug,
    Version: item.version,
    Name: item.name
  }));
  console.table(rows);
  console.log(`Available: ${report.available}`);
  console.log(`Missing: ${report.missing}`);
}

async function handleConfig(): Promise<void> {
  const action = process.argv[3];
  const input = process.argv[4];
  const registry = new ConfigSnapshotRegistry(libraryDir());

  if (action === "add") {
    if (!input || input.startsWith("--")) usage();
    const result = await registry.add(input, {
      id: getArg("--id") ?? undefined,
      name: getArg("--name") ?? undefined,
      replace: hasFlag("--replace")
    });
    const record = result.record;
    console.log(`${result.replaced ? "Replaced" : result.added ? "Imported" : "Already present"}: ${record.id}`);
    console.log(`Name: ${record.name}`);
    console.log(`WordPress: ${record.wordpressVersion}`);
    console.log(`Locale: ${record.locale}`);
    console.log(`Theme: ${record.theme.slug}@${record.theme.version}`);
    console.log(`Plugins: ${record.plugins.length}`);
    console.log(`SHA-256: ${record.sha256}`);
    console.log(`Library: ${registry.root}`);
    console.log("");
    console.log("Package requirements:");
    await printRequirementReport(registry, record.id);
    return;
  }

  if (action === "list") {
    const records = await registry.list();
    if (records.length === 0) {
      console.log(`No configuration snapshots in ${registry.root}`);
      return;
    }
    console.table(records.map((record) => ({
      ID: record.id,
      Name: record.name,
      WordPress: record.wordpressVersion,
      Locale: record.locale,
      Theme: `${record.theme.slug}@${record.theme.version}`,
      Plugins: record.plugins.length
    })));
    console.log(`Library: ${registry.root}`);
    return;
  }

  if (action === "check") {
    if (!input || input.startsWith("--")) usage();
    await printRequirementReport(registry, input);
    return;
  }

  if (action === "remove") {
    if (!input || input.startsWith("--")) usage();
    const removed = await registry.remove(input);
    console.log(`Removed configuration snapshot: ${removed.id}`);
    return;
  }

  usage();
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function handleProfile(): Promise<void> {
  const action = process.argv[3];
  const input = process.argv[4];

  if (action === "create") {
    if (!input || input.startsWith("--")) usage();
    const output = getArg("--output");
    if (!output) usage();

    const absoluteOutput = path.resolve(output);
    if (await fileExists(absoluteOutput) && !hasFlag("--replace")) {
      throw new BuilderError(
        "profile_exists",
        `Profile already exists: ${absoluteOutput}. Use --replace only if you intend to overwrite it.`
      );
    }

    const pluginVersions = Object.fromEntries(getArgs("--plugin-version").map((entry) => {
      const split = entry.indexOf("=");
      if (split <= 0 || split === entry.length - 1) throw new BuilderError("invalid_profile", `--plugin-version must use slug=version: ${entry}`);
      return [entry.slice(0, split), entry.slice(split + 1)];
    }));
    const profile = await createProfileFromSnapshot(input, {
      libraryDir: libraryDir(),
      name: getArg("--name") ?? undefined,
      locale: getArg("--locale") ?? undefined,
      wordpressVersion: getArg("--wordpress-version") ?? undefined,
      wordpressVariant: getArg("--wordpress-variant") ?? undefined,
      themeVersion: getArg("--theme-version") ?? undefined,
      pluginVersions,
      excludePlugins: getArgs("--exclude-plugin")
    });

    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, JSON.stringify(profile, null, 2) + "\n", "utf8");

    console.log(`Created profile: ${profile.name}`);
    console.log(`Output: ${absoluteOutput}`);
    console.log(`Config: ${profile.config.id}`);
    console.log(`Locale: ${profile.locale}`);
    console.log(`WordPress: ${profile.wordpress.version}${profile.wordpress.variant ? ` (${profile.wordpress.variant})` : ""}`);
    console.log(`Theme: ${profile.theme ? `${profile.theme.slug}@${profile.theme.version}` : "WordPress default"}`);
    console.log(`Plugins: ${profile.plugins.length}`);
    return;
  }

  if (action === "check") {
    if (!input || input.startsWith("--")) usage();
    const profile = await loadProfile(input, { libraryDir: libraryDir() });
    console.log(`Profile: ${profile.name}`);
    console.log(`Schema: ${profile.schemaVersion}`);
    console.log(`Locale: ${profile.locale}`);
    console.log(`WordPress: ${profile.wordpress.version}${profile.wordpress.variant ? ` (${profile.wordpress.variant})` : ""}`);
    console.log(`Theme: ${profile.theme ? `${profile.theme.slug}@${profile.theme.version}` : "WordPress default"}`);
    console.table(profile.plugins
      .filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale))
      .map((plugin) => ({
        Slug: plugin.slug,
        Version: plugin.version,
        "Main file": plugin.file,
        Required: plugin.required !== false ? "yes" : "no"
      })));
    console.log("Profile inputs resolve successfully.");
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
  if (profile.schemaVersion >= 2) console.log(`Package library: ${library}`);

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

  if (command === "config") {
    await handleConfig();
    return;
  }

  if (command === "profile") {
    await handleProfile();
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
