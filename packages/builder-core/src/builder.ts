import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

async function installPackage(zipPath: string, destinationRoot: string, slug: string, workRoot: string): Promise<void> {
  const extractDir = path.join(workRoot, `package-${slug}`);
  await ensureEmptyDir(extractDir);
  await extractZip(zipPath, extractDir);
  const packageRoot = await detectPackageRoot(extractDir, slug);
  const destination = path.join(destinationRoot, slug);
  await rm(destination, { recursive: true, force: true });
  await cp(packageRoot, destination, { recursive: true, force: true });
}

async function installLanguageArchive(zipPath: string, destination: string, workRoot: string, index: number): Promise<void> {
  const extractDir = path.join(workRoot, `language-${index}`);
  await ensureEmptyDir(extractDir);
  await extractZip(zipPath, extractDir);

  const languageDir = path.join(extractDir, "languages");
  try {
    await copyDirectoryContents(languageDir, destination);
    return;
  } catch {
    await copyDirectoryContents(extractDir, destination);
  }
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
    const pluginDir = path.join(contentDir, "plugins");
    const themeDir = path.join(contentDir, "themes");
    const languageDir = path.join(contentDir, "languages");
    const muPluginDir = path.join(contentDir, "mu-plugins");
    const starterDataDir = path.join(contentDir, "starter-package");

    await Promise.all([
      ensureDir(pluginDir),
      ensureDir(themeDir),
      ensureDir(languageDir),
      ensureDir(muPluginDir),
      ensureDir(starterDataDir)
    ]);

    await installPackage(profile.theme.zip, themeDir, profile.theme.slug, workRoot);

    for (const plugin of profile.plugins) {
      if (plugin.locales && !plugin.locales.includes(profile.locale)) {
        continue;
      }
      await installPackage(plugin.zip, pluginDir, plugin.slug, workRoot);
    }

    let languageIndex = 0;
    for (const archive of profile.languageArchives ?? []) {
      if (archive.locale !== profile.locale) continue;
      await installLanguageArchive(archive.zip, languageDir, workRoot, languageIndex++);
    }

    await ensureEmptyDir(configExtract);
    await extractZip(profile.configExport, configExtract);
    const configFile = await findFileRecursive(configExtract, "starter-config.json");
    if (!configFile) {
      throw new BuilderError("invalid_config_export", "starter-config.json was not found in the configuration export ZIP.");
    }
    await cp(configFile, path.join(starterDataDir, "starter-config.json"), { force: true });

    await cp(path.resolve(options.bootstrapFile), path.join(muPluginDir, "site-starter-bootstrap.php"), { force: true });

    const activePlugins = profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale));
    const manifest: StarterBuildManifest = {
      schemaVersion: 1,
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
        zip: path.basename(profile.theme.zip),
        sha256: await sha256File(profile.theme.zip)
      },
      plugins: await Promise.all(activePlugins.map(async (plugin) => ({
        ...plugin,
        zip: path.basename(plugin.zip),
        sha256: await sha256File(plugin.zip)
      }))),
      configExport: {
        path: path.basename(profile.configExport),
        sha256: await sha256File(profile.configExport)
      },
      languageArchives: await Promise.all(
        (profile.languageArchives ?? [])
          .filter((archive) => archive.locale === profile.locale)
          .map(async (archive) => ({
            ...archive,
            zip: path.basename(archive.zip),
            sha256: await sha256File(archive.zip)
          }))
      )
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
