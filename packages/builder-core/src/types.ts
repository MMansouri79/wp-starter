import type { VNextBuildPayload } from "./vnext.js";

export type PackageKind = "wordpress" | "theme" | "plugin";

export type SnapshotRequirementStatus = "available" | "missing";

export type FontStyle = "normal" | "italic" | "oblique";
export type FontFormat = "woff2" | "woff" | "ttf" | "otf";

export interface FontFaceRecord {
  family: string;
  weight: number;
  style: FontStyle;
  format: FontFormat;
  filename: string;
  file: string;
  sha256: string;
  variable?: boolean;
}

export interface FontSystemRecord {
  id: string;
  name: string;
  sourceFilename: string;
  addedAt: string;
  faces: FontFaceRecord[];
  skipped: Array<{ filename: string; reason: string }>;
}

export interface FontRegistryFile {
  schemaVersion: 1;
  systems: FontSystemRecord[];
}

export interface ResolvedFontFace extends FontFaceRecord {
  absoluteFile: string;
}

export interface ResolvedFontSystem extends Omit<FontSystemRecord, "faces"> {
  faces: ResolvedFontFace[];
}

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
  sourcePlugins?: SnapshotPluginRequirement[];
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

export type SnapshotAdapterStatus = "portable" | "deferred" | "metadata";

export interface SnapshotAdapterSection {
  key: string;
  label: string;
  count: number;
  values: Record<string, unknown>;
}

export interface SnapshotAdapterInspection {
  key: string;
  label: string;
  status: SnapshotAdapterStatus;
  reason?: string;
  sections: SnapshotAdapterSection[];
  details: Record<string, unknown>;
}

export type SnapshotChangeKind = "added" | "removed" | "changed";

export interface SnapshotBinaryCoordinate {
  slug: string;
  name: string;
  version: string;
  variant?: string;
}

export interface SnapshotBinaryChange {
  kind: SnapshotChangeKind;
  packageKind: PackageKind;
  key: string;
  before?: SnapshotBinaryCoordinate;
  after?: SnapshotBinaryCoordinate;
}

export interface SnapshotValueChange {
  kind: SnapshotChangeKind;
  scope: string;
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface SnapshotPageChange {
  kind: SnapshotChangeKind;
  slug: string;
  before?: { title: string; slug: string };
  after?: { title: string; slug: string };
}

export interface SnapshotAdapterStructureChange {
  kind: SnapshotChangeKind;
  key: string;
  label: string;
  before?: { status: SnapshotAdapterStatus; reason?: string };
  after?: { status: SnapshotAdapterStatus; reason?: string };
}

export interface ConfigSnapshotComparison {
  left: { id: string; name: string; generatedAt: string };
  right: { id: string; name: string; generatedAt: string };
  binary: {
    changes: SnapshotBinaryChange[];
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
  configuration: {
    changes: SnapshotValueChange[];
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
  structures: {
    pages: SnapshotPageChange[];
    adapters: SnapshotAdapterStructureChange[];
    added: number;
    removed: number;
    changed: number;
    total: number;
  };
  safety: {
    changes: SnapshotValueChange[];
    total: number;
  };
  summary: {
    binary: number;
    configuration: number;
    structures: number;
    safety: number;
    total: number;
  };
}

export interface ConfigSnapshotInspection {
  snapshotId: string;
  name: string;
  schemaVersion: number;
  exporterVersion: string;
  generatedAt: string;
  source: {
    wordpressVersion: string;
    phpVersion: string;
    locale: string;
    theme: { slug: string; name: string; version: string };
    plugins: SnapshotPluginRequirement[];
    targetPlugins: SnapshotPluginRequirement[];
  };
  wordpress: {
    options: Record<string, unknown>;
    optionCount: number;
    permalinkStructure: string;
    cleanupDefaultContent: boolean;
    pages: Array<{ title: string; slug: string }>;
  };
  adapters: SnapshotAdapterInspection[];
  safety: Record<string, boolean>;
  totals: {
    wordpressOptions: number;
    adapterOptions: number;
    adapterSettings: number;
    pages: number;
    activePlugins: number;
    targetPlugins: number;
    portableAdapters: number;
    deferredAdapters: number;
  };
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

export interface ProfileDocumentV6 {
  schemaVersion: 6;
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
  fontSystem: { id: string } | null;
  languageArchives?: LanguageArchiveRef[];
}

export interface BuildProfile {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  locale: string;
  wordpress: ArtifactRef;
  theme: ThemeRef | null;
  plugins: PluginRef[];
  configExport: string | null;
  fontSystem?: ResolvedFontSystem | null;
  languageArchives?: LanguageArchiveRef[];
  vnext?: VNextBuildPayload | null;
}

export interface BuildInputHash {
  path: string;
  sha256: string;
}

export interface StarterBuildManifest {
  schemaVersion: 4;
  builderVersion: string;
  builtAt: string;
  profile: string;
  locale: string;
  configurationEnabled: boolean;
  wordpress: ArtifactRef & { sha256: string };
  theme: (ThemeRef & { sha256: string }) | null;
  plugins: Array<PluginRef & { sha256: string }>;
  configExport: BuildInputHash | null;
  fontSystem: {
    id: string;
    name: string;
    faces: Array<Omit<FontFaceRecord, "file"> & { file: string }>;
  } | null;
  languageArchives: Array<LanguageArchiveRef & { sha256: string }>;
  vnext?: { path: string; sha256: string } | null;
}

export interface BuildProgress {
  percent: number;
  stage: string;
  message: string;
  current?: number;
  total?: number;
}
