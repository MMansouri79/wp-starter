import { cp, mkdtemp, rm } from "node:fs/promises";
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
import type { BuildProfile, StarterBuildManifest } from "./types.js";

export interface BuildOptions {
  profile: BuildProfile;
  outputZip: string;
  bootstrapFile: string;
  builderVersion: string;
  keepWorkDir?: boolean;
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
    await ensureEmptyDir(coreExtract);
    await extractZip(profile.wordpress.zip, coreExtract);
    const wordpressRoot = await findWordPressRoot(coreExtract);

    await ensureEmptyDir(staging);
    await copyDirectoryContents(wordpressRoot, staging);

    const contentDir = path.join(staging, "wp-content");
    const muPluginDir = path.join(contentDir, "mu-plugins");
    const starterDataDir = path.join(contentDir, "starter-package");
    const bundledPluginDir = path.join(starterDataDir, "packages", "plugins");
    const bundledThemeDir = path.join(starterDataDir, "packages", "themes");
    const bundledLanguageDir = path.join(starterDataDir, "packages", "languages");

    await Promise.all([
      ensureDir(muPluginDir),
      ensureDir(starterDataDir),
      ensureDir(bundledPluginDir),
      ensureDir(bundledThemeDir),
      ensureDir(bundledLanguageDir)
    ]);

    const themeBundleName = `${safeArtifactName(profile.theme.slug)}-${safeArtifactName(profile.theme.version)}.zip`;
    const themeBundleRelative = `packages/themes/${themeBundleName}`;
    const themeBundlePath = path.join(bundledThemeDir, themeBundleName);
    const themeBundleSha256 = await createCanonicalPackageZip({
      sourceZip: profile.theme.zip,
      installDir: profile.theme.slug,
      outputZip: themeBundlePath,
      workDir: path.join(workRoot, "canonical-theme")
    });

    const activePlugins = profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale));
    const bundledPlugins = [];
    for (let index = 0; index < activePlugins.length; index++) {
      const plugin = activePlugins[index];
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

    await ensureEmptyDir(configExtract);
    await extractZip(profile.configExport, configExtract);
    const configFile = await findFileRecursive(configExtract, "starter-config.json");
    if (!configFile) {
      throw new BuilderError("invalid_config_export", "starter-config.json was not found in the configuration export ZIP.");
    }
    await cp(configFile, path.join(starterDataDir, "starter-config.json"), { force: true });

    await cp(path.resolve(options.bootstrapFile), path.join(muPluginDir, "site-starter-bootstrap.php"), { force: true });

    const manifest: StarterBuildManifest = {
      schemaVersion: 2,
      builderVersion: options.builderVersion,
      builtAt: new Date().toISOString(),
      profile: profile.name,
      locale: profile.locale,
      wordpress: {
        ...profile.wordpress,
        zip: path.basename(profile.wordpress.zip),
        sha256: await sha256File(profile.wordpress.zip)
      },
      theme: {
        ...profile.theme,
        zip: themeBundleRelative,
        sha256: themeBundleSha256
      },
      plugins: bundledPlugins,
      configExport: {
        path: path.basename(profile.configExport),
        sha256: await sha256File(profile.configExport)
      },
      languageArchives: bundledLanguages
    };

    await writeJson(path.join(starterDataDir, "starter-build.json"), manifest);

    const outputZip = path.resolve(options.outputZip);
    await ensureDir(path.dirname(outputZip));
    await createZip(staging, outputZip);

    return {
      outputZip,
      sha256: await sha256File(outputZip),
      manifest
    };
  } finally {
    if (!options.keepWorkDir) {
      await rm(workRoot, { recursive: true, force: true });
    }
  }
}
