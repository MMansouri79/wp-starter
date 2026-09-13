import { cp, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createZip, extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import {
  copyDirectoryContents,
  detectPackageRoot,
  ensureDir,
  ensureEmptyDir,
  findFileRecursive,
  findWordPressRoot,
  sha256File,
  writeJson
} from "./fs-utils.js";
import type { BuildProfile, BuildProgress, StarterBuildManifest } from "./types.js";

export interface BuildOptions {
  profile: BuildProfile;
  outputZip: string;
  bootstrapFile: string;
  builderVersion: string;
  keepWorkDir?: boolean;
  onProgress?: (progress: BuildProgress) => void | Promise<void>;
}

function safeArtifactName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function safeInstallDir(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new BuilderError("invalid_install_dir", `Package install directory contains unsupported characters: ${value}`);
  }
  return value;
}

async function emit(options: BuildOptions, progress: BuildProgress): Promise<void> {
  if (options.onProgress) await options.onProgress(progress);
}

async function createCanonicalPackageZip(options: {
  sourceZip: string;
  installDir: string;
  outputZip: string;
  workDir: string;
}): Promise<string> {
  const installDir = safeInstallDir(options.installDir);
  const extractDir = path.join(options.workDir, "extract");
  const stageDir = path.join(options.workDir, "stage");
  const canonicalRoot = path.join(stageDir, installDir);

  await ensureEmptyDir(extractDir);
  await extractZip(options.sourceZip, extractDir);
  const detectedRoot = await detectPackageRoot(extractDir, installDir);

  await ensureEmptyDir(stageDir);
  await ensureDir(canonicalRoot);
  await copyDirectoryContents(detectedRoot, canonicalRoot);

  await ensureDir(path.dirname(options.outputZip));
  await createZip(stageDir, options.outputZip);
  return sha256File(options.outputZip);
}

export async function buildStarter(options: BuildOptions): Promise<{ outputZip: string; sha256: string; manifest: StarterBuildManifest }> {
  const { profile } = options;
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "wp-starter-"));
  const coreExtract = path.join(workRoot, "wordpress-extract");
  const staging = path.join(workRoot, "distribution");
  const configExtract = path.join(workRoot, "config-export");

  try {
    await emit(options, { percent: 2, stage: "prepare", message: "Preparing build workspace…" });
    await ensureEmptyDir(coreExtract);

    await emit(options, { percent: 8, stage: "wordpress", message: "Extracting WordPress core…" });
    await extractZip(profile.wordpress.zip, coreExtract);
    const wordpressRoot = await findWordPressRoot(coreExtract);

    await emit(options, { percent: 16, stage: "wordpress", message: "Staging WordPress distribution…" });
    await ensureEmptyDir(staging);
    await copyDirectoryContents(wordpressRoot, staging);

    const contentDir = path.join(staging, "wp-content");
    const muPluginDir = path.join(contentDir, "mu-plugins");
    const payloadName = `.wp-starter-${randomBytes(10).toString("hex")}`;
    const starterDataDir = path.join(contentDir, payloadName);
    const bundledPluginDir = path.join(starterDataDir, "packages", "plugins");
    const bundledThemeDir = path.join(starterDataDir, "packages", "themes");
    const bundledLanguageDir = path.join(starterDataDir, "packages", "languages");
    const bundledFontDir = path.join(starterDataDir, "fonts");

    await Promise.all([
      ensureDir(muPluginDir),
      ensureDir(starterDataDir),
      ensureDir(bundledPluginDir),
      ensureDir(bundledThemeDir),
      ensureDir(bundledLanguageDir),
      ensureDir(bundledFontDir)
    ]);

    let bundledTheme: StarterBuildManifest["theme"] = null;
    if (profile.theme) {
      await emit(options, { percent: 24, stage: "theme", message: `Packaging theme ${profile.theme.slug}@${profile.theme.version}…` });
      const themeBundleName = `${safeArtifactName(profile.theme.slug)}-${safeArtifactName(profile.theme.version)}.zip`;
      const themeBundleRelative = `packages/themes/${themeBundleName}`;
      const themeBundlePath = path.join(bundledThemeDir, themeBundleName);
      const themeBundleSha256 = await createCanonicalPackageZip({
        sourceZip: profile.theme.zip,
        installDir: profile.theme.slug,
        outputZip: themeBundlePath,
        workDir: path.join(workRoot, "canonical-theme")
      });
      bundledTheme = {
        ...profile.theme,
        zip: themeBundleRelative,
        sha256: themeBundleSha256
      };
    } else {
      await emit(options, { percent: 24, stage: "theme", message: "Using the WordPress default theme." });
    }

    const activePlugins = profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale));
    const bundledPlugins = [];
    const pluginStart = 30;
    const pluginEnd = 66;
    for (let index = 0; index < activePlugins.length; index++) {
      const plugin = activePlugins[index];
      const percent = activePlugins.length ? pluginStart + Math.floor(((index + 1) / activePlugins.length) * (pluginEnd - pluginStart)) : pluginEnd;
      await emit(options, {
        percent,
        stage: "plugins",
        message: `Packaging ${plugin.slug}@${plugin.version}…`,
        current: index + 1,
        total: activePlugins.length
      });
      const bundleName = `${safeArtifactName(plugin.slug)}-${safeArtifactName(plugin.version)}.zip`;
      const bundleRelative = `packages/plugins/${bundleName}`;
      const bundlePath = path.join(bundledPluginDir, bundleName);
      const sha256 = await createCanonicalPackageZip({
        sourceZip: plugin.zip,
        installDir: plugin.slug,
        outputZip: bundlePath,
        workDir: path.join(workRoot, `canonical-plugin-${index}`)
      });

      bundledPlugins.push({
        ...plugin,
        zip: bundleRelative,
        sha256
      });
    }
    if (activePlugins.length === 0) {
      await emit(options, { percent: pluginEnd, stage: "plugins", message: "No plugins selected for this build." });
    }

    await emit(options, { percent: 72, stage: "languages", message: "Packaging language archives…" });
    const bundledLanguages = await Promise.all(
      (profile.languageArchives ?? [])
        .filter((archive) => archive.locale === profile.locale)
        .map(async (archive, index) => {
          const bundleName = `${safeArtifactName(archive.locale)}-${index + 1}.zip`;
          const bundleRelative = `packages/languages/${bundleName}`;
          await cp(archive.zip, path.join(bundledLanguageDir, bundleName), { force: true });
          return {
            ...archive,
            zip: bundleRelative,
            sha256: await sha256File(archive.zip)
          };
        })
    );

    let bundledFontSystem: StarterBuildManifest["fontSystem"] = null;
    if (profile.fontSystem) {
      await emit(options, { percent: 75, stage: "fonts", message: `Packaging font system ${profile.fontSystem.name}…` });
      const faces = [];
      for (let index = 0; index < profile.fontSystem.faces.length; index++) {
        const face = profile.fontSystem.faces[index];
        const safeFile = `${index + 1}-${safeArtifactName(face.filename)}`;
        const relative = `fonts/${safeFile}`;
        const target = path.join(bundledFontDir, safeFile);
        await cp(face.absoluteFile, target, { force: true });
        faces.push({
          family: face.family, weight: face.weight, style: face.style, format: face.format, filename: face.filename,
          file: relative, sha256: await sha256File(target), variable: face.variable === true
        });
      }
      bundledFontSystem = { id: profile.fontSystem.id, name: profile.fontSystem.name, faces };
    } else {
      await emit(options, { percent: 75, stage: "fonts", message: "No font system selected." });
    }

    let configExport: StarterBuildManifest["configExport"] = null;
    if (profile.configExport) {
      await emit(options, { percent: 78, stage: "configuration", message: "Embedding configuration snapshot…" });
      await ensureEmptyDir(configExtract);
      await extractZip(profile.configExport, configExtract);
      const configFile = await findFileRecursive(configExtract, "starter-config.json");
      if (!configFile) {
        throw new BuilderError("invalid_config_export", "starter-config.json was not found in the configuration export ZIP.");
      }
      await cp(configFile, path.join(starterDataDir, "starter-config.json"), { force: true });
      configExport = {
        path: path.basename(profile.configExport),
        sha256: await sha256File(profile.configExport)
      };
    } else {
      await emit(options, { percent: 78, stage: "configuration", message: "No configuration snapshot selected. Settings import will be skipped." });
    }

    let vnext: StarterBuildManifest["vnext"] = null;
    if (profile.vnext) {
      await emit(options, { percent: 80, stage: "design_system", message: "Embedding vNext design-system resources…" });
      const designSystemPath = path.join(starterDataDir, "starter-design-system.json");
      await writeJson(designSystemPath, profile.vnext);
      vnext = { path: "starter-design-system.json", sha256: await sha256File(designSystemPath) };
    }

    await emit(options, { percent: 82, stage: "bootstrap", message: "Adding offline bootstrap…" });
    await cp(path.resolve(options.bootstrapFile), path.join(muPluginDir, "site-starter-bootstrap.php"), { force: true });

    const manifest: StarterBuildManifest = {
      schemaVersion: 4,
      builderVersion: options.builderVersion,
      builtAt: new Date().toISOString(),
      profile: profile.name,
      locale: profile.locale,
      configurationEnabled: Boolean(profile.configExport),
      wordpress: {
        ...profile.wordpress,
        zip: path.basename(profile.wordpress.zip),
        sha256: await sha256File(profile.wordpress.zip)
      },
      theme: bundledTheme,
      plugins: bundledPlugins,
      configExport,
      fontSystem: bundledFontSystem,
      languageArchives: bundledLanguages,
      vnext
    };

    await emit(options, { percent: 87, stage: "manifest", message: "Writing build manifest…" });
    await writeJson(path.join(starterDataDir, "starter-build.json"), manifest);

    const outputZip = path.resolve(options.outputZip);
    await ensureDir(path.dirname(outputZip));
    await emit(options, { percent: 92, stage: "archive", message: "Creating final WordPress ZIP…" });
    await createZip(staging, outputZip);

    await emit(options, { percent: 98, stage: "checksum", message: "Calculating final checksum…" });
    const sha256 = await sha256File(outputZip);
    await emit(options, { percent: 100, stage: "complete", message: "Build complete." });

    return {
      outputZip,
      sha256,
      manifest
    };
  } finally {
    if (!options.keepWorkDir) {
      await rm(workRoot, { recursive: true, force: true });
    }
  }
}
