export type PackageKind = "wordpress" | "theme" | "plugin";

export type SnapshotRequirementStatus = "available" | "missing";

export interface PackageInspection {
  kind: PackageKind;
  slug: string;
  name: string;
  version: string;
  packageRoot: string;
  installDir: string;
  variant?: string;
  locale?: string;
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
  variant?: string;
  locale?: string;
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
  schemaVersion: 1 | 2;
  packages: PackageRecord[];
}

export interface SnapshotPluginRequirement {
  slug: string;
  name: string;
  version: string;
  file: string;
  active: true;
}

export interface ConfigSnapshotRecord {
  id: string;
  name: string;
  generatedAt: string;
  wordpressVersion: string;
  locale: string;
  theme: { slug: string; name: string; version: string };
  plugins: SnapshotPluginRequirement[];
  zip: string;
  sha256: string;
  sourceFilename: string;
  addedAt: string;
}

export interface ConfigSnapshotFile {
  schemaVersion: 1;
  snapshots: ConfigSnapshotRecord[];
}

export interface SnapshotRequirement {
  kind: PackageKind;
  slug: string;
  version: string;
  name: string;
  variant?: string;
  status: SnapshotRequirementStatus;
}

export interface SnapshotRequirementReport {
  snapshotId: string;
  locale: string;
  requirements: SnapshotRequirement[];
  available: number;
  missing: number;
}

export interface ArtifactRef {
  version: string;
  zip: string;
  variant?: string;
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

export interface ProfileDocumentV3 {
  schemaVersion: 3;
  name: string;
  locale: string;
  wordpress: { version: string };
  theme: { slug: string; version: string };
  plugins: Array<{
    slug: string;
    version: string;
    required?: boolean;
    locales?: string[];
  }>;
  config: { id: string };
  languageArchives?: LanguageArchiveRef[];
}

export interface ProfileDocumentV4 {
  schemaVersion: 4;
  name: string;
  locale: string;
  wordpress: { version: string; variant: string };
  theme: { slug: string; version: string };
  plugins: Array<{
    slug: string;
    version: string;
    required?: boolean;
    locales?: string[];
  }>;
  config: { id: string };
  languageArchives?: LanguageArchiveRef[];
}

export interface ProfileDocumentV5 {
  schemaVersion: 5;
  name: string;
  locale: string;
  wordpress: { version: string; variant: string };
  theme: { slug: string; version: string } | null;
  plugins: Array<{
    slug: string;
    version: string;
    required?: boolean;
    locales?: string[];
  }>;
  config: { id: string } | null;
  languageArchives?: LanguageArchiveRef[];
}

export interface BuildProfile {
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  name: string;
  locale: string;
  wordpress: ArtifactRef;
  theme: ThemeRef | null;
  plugins: PluginRef[];
  configExport: string | null;
  languageArchives?: LanguageArchiveRef[];
}

export interface BuildInputHash {
  path: string;
  sha256: string;
}

export interface StarterBuildManifest {
  schemaVersion: 3;
  builderVersion: string;
  builtAt: string;
  profile: string;
  locale: string;
  configurationEnabled: boolean;
  wordpress: ArtifactRef & { sha256: string };
  theme: (ThemeRef & { sha256: string }) | null;
  plugins: Array<PluginRef & { sha256: string }>;
  configExport: BuildInputHash | null;
  languageArchives: Array<LanguageArchiveRef & { sha256: string }>;
}

export interface BuildProgress {
  percent: number;
  stage: string;
  message: string;
  current?: number;
  total?: number;
}
