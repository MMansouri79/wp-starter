export type PackageKind = "wordpress" | "theme" | "plugin";

export interface PackageInspection {
  kind: PackageKind;
  slug: string;
  name: string;
  version: string;
  packageRoot: string;
  installDir: string;
  mainFile?: string;
  textDomain?: string;
  requiresWordPress?: string;
  requiresPhp?: string;
  requiresPlugins?: string[];
}

export interface PackageRecord {
  kind: PackageKind;
  slug: string;
  name: string;
  version: string;
  installDir: string;
  mainFile?: string;
  textDomain?: string;
  requiresWordPress?: string;
  requiresPhp?: string;
  requiresPlugins?: string[];
  zip: string;
  sha256: string;
  sourceFilename: string;
  addedAt: string;
}

export interface RegistryFile {
  schemaVersion: 1;
  packages: PackageRecord[];
}

export interface ArtifactRef {
  version: string;
  zip: string;
}

export interface ThemeRef extends ArtifactRef {
  slug: string;
}

export interface PluginRef extends ArtifactRef {
  slug: string;
  file: string;
  required?: boolean;
  locales?: string[];
}

export interface LanguageArchiveRef {
  locale: string;
  zip: string;
}

export interface BuildProfile {
  schemaVersion: 1 | 2;
  name: string;
  locale: string;
  wordpress: ArtifactRef;
  theme: ThemeRef;
  plugins: PluginRef[];
  configExport: string;
  languageArchives?: LanguageArchiveRef[];
}

export interface BuildInputHash {
  path: string;
  sha256: string;
}

export interface StarterBuildManifest {
  schemaVersion: 1;
  builderVersion: string;
  builtAt: string;
  profile: string;
  locale: string;
  wordpress: ArtifactRef & { sha256: string };
  theme: ThemeRef & { sha256: string };
  plugins: Array<PluginRef & { sha256: string }>;
  configExport: BuildInputHash;
  languageArchives: Array<LanguageArchiveRef & { sha256: string }>;
}
