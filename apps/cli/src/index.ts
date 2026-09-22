#!/usr/bin/env node
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildStarter,
  BuilderError,
  defaultLibraryDir,
  FontSystemRegistry,
  inspectPackage,
  loadProfile,
  PackageRegistry,
  ConfigSnapshotRegistry,
  createProfileFromSnapshot,
  assertKnownGoodProfile,
  compatibilityReport,
  writeJson,
  DesignSystemResourceService,
  ElementorTemplateLibrary
} from "../../../packages/builder-core/dist/index.js";
import type { PackageKind } from "../../../packages/builder-core/dist/index.js";

const { version: VERSION } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

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
  wp-starter config compare <left-id> <right-id> [--library <dir>]
  wp-starter config remove <id> [--library <dir>]
  wp-starter compatibility check <profile.json> [--library <dir>]
  wp-starter font add <fonts.zip> [--name <name>] [--library <dir>] [--replace]
  wp-starter font list [--library <dir>]
  wp-starter font remove <id> [--library <dir>]
  wp-starter resource <typography|colors|design-systems> <add|list|remove> [file-or-id] [--library <dir>]
  wp-starter template list [--library <dir>]
  wp-starter template remove <library-id> [--library <dir>]
  wp-starter profile create <config-id> --output <profile.json> [--name <name>] [--locale <locale>] [--wordpress-version <version>] [--wordpress-variant <locale>] [--theme-version <version>] [--plugin-version <slug=version>]... [--exclude-plugin <slug>]... [--font-system <id>]... [--design-system <id>] [--template <library-id>]... [--template-mapping <source=target>]... [--library <dir>] [--replace]
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

  if (action === "compare") {
    const right = process.argv[5];
    if (!input || input.startsWith("--") || !right || right.startsWith("--")) usage();
    const comparison = await registry.compare(input, right);
    console.log(`${comparison.left.name}  ->  ${comparison.right.name}`);
    console.table([
      { Category: "Binary", Changes: comparison.summary.binary },
      { Category: "Configuration", Changes: comparison.summary.configuration },
      { Category: "Structures", Changes: comparison.summary.structures },
      { Category: "Safety", Changes: comparison.summary.safety }
    ]);
    if (comparison.binary.changes.length) {
      console.log("\nBinary changes:");
      console.table(comparison.binary.changes.map((change) => ({
        Change: change.kind,
        Type: change.packageKind,
        Package: change.key,
        Before: change.before ? `${change.before.slug}@${change.before.version}${change.before.variant ? ` (${change.before.variant})` : ""}` : "",
        After: change.after ? `${change.after.slug}@${change.after.version}${change.after.variant ? ` (${change.after.variant})` : ""}` : ""
      })));
    }
    if (comparison.configuration.changes.length) {
      console.log("\nConfiguration changes:");
      console.table(comparison.configuration.changes.map((change) => ({ Change: change.kind, Scope: change.scope, Path: change.path })));
    }
    console.log(`\nTotal changes: ${comparison.summary.total}`);
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

  if (action === "compare") {
    const right = process.argv[5];
    if (!input || input.startsWith("--") || !right || right.startsWith("--")) usage();
    const comparison = await registry.compare(input, right);
    console.log(`${comparison.left.name}  ->  ${comparison.right.name}`);
    console.table([
      { Category: "Binary", Changes: comparison.summary.binary },
      { Category: "Configuration", Changes: comparison.summary.configuration },
      { Category: "Structures", Changes: comparison.summary.structures },
      { Category: "Safety", Changes: comparison.summary.safety }
    ]);
    if (comparison.binary.changes.length) {
      console.log("\nBinary changes:");
      console.table(comparison.binary.changes.map((change) => ({
        Change: change.kind,
        Type: change.packageKind,
        Package: change.key,
        Before: change.before ? `${change.before.slug}@${change.before.version}${change.before.variant ? ` (${change.before.variant})` : ""}` : "",
        After: change.after ? `${change.after.slug}@${change.after.version}${change.after.variant ? ` (${change.after.variant})` : ""}` : ""
      })));
    }
    if (comparison.configuration.changes.length) {
      console.log("\nConfiguration changes:");
      console.table(comparison.configuration.changes.map((change) => ({ Change: change.kind, Scope: change.scope, Path: change.path })));
    }
    console.log(`\nTotal changes: ${comparison.summary.total}`);
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

async function handleFont(): Promise<void> {
  const action = process.argv[3];
  const input = process.argv[4];
  const registry = new FontSystemRegistry(libraryDir());
  if (action === "add") {
    if (!input || input.startsWith("--")) usage();
    const records = await registry.add(input, { name: getArg("--name") ?? undefined, replace: hasFlag("--replace") });
    console.log(`Added ${records.length} font profile${records.length === 1 ? "" : "s"}: ${records.map((record) => record.name).join(", ")}`);
    for (const record of records) {
      console.log(`\n${record.name} (${record.id})`);
      console.table(record.faces.map((face) => ({ Weight: face.weight, Style: face.style, Format: face.format, File: face.filename })));
      if (record.skipped.length) console.table(record.skipped.map((item) => ({ Ignored: item.filename, Reason: item.reason })));
    }
    return;
  }
  if (action === "list") {
    const records = await registry.list();
    console.table(records.map((record) => ({ ID: record.id, Name: record.name, Faces: record.faces.length, Skipped: record.skipped.length })));
    return;
  }
  if (action === "remove") {
    if (!input || input.startsWith("--")) usage();
    await new DesignSystemResourceService(libraryDir()).assertFontNotReferenced(input);
    const removed = await registry.remove(input);
    console.log(`Removed font profile: ${removed.name} (${removed.id})`);
    return;
  }
  usage();
}

async function handleResource(): Promise<void> {
  const kind = process.argv[3];
  const action = process.argv[4];
  const input = process.argv[5];
  const service = new DesignSystemResourceService(libraryDir());
  const normalizedKind = kind === "design-systems" ? "designSystems" : kind;
  if (!(["typography", "colors", "designSystems"] as string[]).includes(String(normalizedKind))) usage();
  const registry = service[normalizedKind as "typography" | "colors" | "designSystems"];
  if (action === "list") {
    console.log(JSON.stringify(await registry.list(), null, 2));
    return;
  }
  if (!input || input.startsWith("--")) usage();
  if (action === "add") {
    let value: any;
    try { value = JSON.parse(await readFile(path.resolve(input), "utf8")); }
    catch (error) { throw new BuilderError("invalid_vnext_resource", `Could not read resource JSON: ${error instanceof Error ? error.message : String(error)}`); }
    const saved = normalizedKind === "typography" ? await service.saveTypography(value) : normalizedKind === "colors" ? await service.saveColors(value) : await service.saveDesignSystem(value);
    console.log(`Saved ${kind} resource: ${saved.id}`);
    return;
  }
  if (action === "remove") {
    const removed = await service.remove(normalizedKind as "typography" | "colors" | "designSystems", input);
    console.log(`Removed ${kind} resource: ${removed.id}`);
    return;
  }
  usage();
}

async function handleTemplate(): Promise<void> {
  const action = process.argv[3]; const input = process.argv[4]; const library = new ElementorTemplateLibrary(libraryDir());
  if (action === "list") { console.log(JSON.stringify(await library.list(), null, 2)); return; }
  if (action === "remove" && input && !input.startsWith("--")) { const removed = await library.remove(input); console.log(`Removed template: ${removed.id}`); return; }
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
      excludePlugins: getArgs("--exclude-plugin"),
      fontSystemIds: getArgs("--font-system"),
      designSystemId: getArg("--design-system"),
      elementorTemplates: hasFlag("--elementor-template") ? getArgs("--elementor-template").map((entry) => {
        const split = entry.indexOf("=");
        if (split <= 0 || split === entry.length - 1) throw new BuilderError("invalid_profile", `--elementor-template must use snapshot-id=template-id: ${entry}`);
        return { snapshotId: entry.slice(0, split), templateId: entry.slice(split + 1) };
      }) : undefined,
      elementorTemplateIds: getArgs("--template"),
      elementorTemplateMappings: Object.fromEntries(getArgs("--template-mapping").map((entry) => { const split=entry.indexOf("="); if(split<=0||split===entry.length-1) throw new BuilderError("invalid_profile", `--template-mapping must use source=target: ${entry}`); return [entry.slice(0,split),entry.slice(split+1)]; }))
    });

    await writeJson(absoluteOutput, profile);

    console.log(`Created profile: ${profile.name}`);
    console.log(`Output: ${absoluteOutput}`);
    console.log(`Config: ${profile.config.id}`);
    console.log(`Locale: ${profile.locale}`);
    console.log(`WordPress: ${profile.wordpress.version}${profile.wordpress.variant ? ` (${profile.wordpress.variant})` : ""}`);
    console.log(`Theme: ${profile.theme ? `${profile.theme.slug}@${profile.theme.version}` : "WordPress default"}`);
    console.log(`Plugins: ${profile.plugins.length}`);
    console.log(`Font profiles: ${profile.schemaVersion === 8 && profile.designSystem?.id ? "owned by design system" : profile.fontSystems?.map((font) => font.id).join(", ") || profile.fontSystem?.id || "none"}`);
    console.log(`Design system: ${"designSystem" in profile ? profile.designSystem?.id || "none" : "none"}`);
    return;
  }

  if (action === "check") {
    if (!input || input.startsWith("--")) usage();
    const profile = await loadProfile(input, { libraryDir: libraryDir() });
    assertKnownGoodProfile(profile);
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

async function handleCompatibility(): Promise<void> {
  const action = process.argv[3];
  const input = process.argv[4];
  if (action !== "check" || !input || input.startsWith("--")) usage();
  const profile = await loadProfile(input, { libraryDir: libraryDir() });
  const report = compatibilityReport(profile);
  if (report.status === "unsupported") {
    throw new BuilderError("unsupported_compatibility", report.errors.join(" "));
  }
  console.log(`Status: ${report.status === "upgrade-warning" ? "UPGRADE WARNING" : "KNOWN-GOOD"}`);
  if (report.baselineId) console.log(`Baseline: ${report.baselineId}`);
  const wordpressWarning = report.warnings.find((warning) => warning.slug === "wordpress");
  const themeWarning = profile.theme ? report.warnings.find((warning) => warning.slug === profile.theme?.slug) : undefined;
  const pluginWarnings = report.warnings.filter((warning) => warning.slug !== "wordpress" && warning !== themeWarning);
  if (wordpressWarning) console.log(`WordPress upgrade: ${wordpressWarning.exportedVersion} → ${wordpressWarning.selectedVersion}`);
  if (themeWarning) console.log(`Theme upgrade: ${themeWarning.slug}: ${themeWarning.exportedVersion} → ${themeWarning.selectedVersion}`);
  if (pluginWarnings.length) {
    console.log("");
    console.log("Plugin upgrades:");
    for (const warning of pluginWarnings) console.log(`- ${warning.slug}: ${warning.exportedVersion} → ${warning.selectedVersion}`);
  }
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
  const report = compatibilityReport(profile);
  if (report.status === "unsupported") throw new BuilderError("unsupported_compatibility", report.errors.join(" "));
  if (report.status === "upgrade-warning") {
    console.log("Build allowed with warnings:");
    for (const warning of report.warnings) console.log(`${warning.slug}: ${warning.exportedVersion} → ${warning.selectedVersion}`);
    console.log("Exported settings will be preserved. The selected plugin versions are newer than the reference site and should be tested.");
    console.log("");
  }

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
  if (result.compatibility.status === "upgrade-warning") console.log("Compatibility: UPGRADE WARNING");
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

  if (command === "font") {
    await handleFont();
    return;
  }

  if (command === "resource") {
    await handleResource();
    return;
  }

  if (command === "template") { await handleTemplate(); return; }

  if (command === "profile") {
    await handleProfile();
    return;
  }

  if (command === "compatibility") {
    await handleCompatibility();
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
