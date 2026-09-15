import type { ResolvedDesignSystem, VNextBuildPayload } from "./vnext.js";

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
  /** Optional on legacy registry records; derived from the export when absent. */
  sourceDomain?: string;
  /** Lightweight inventory only. Elementor documents are never stored here. */
  elementorTemplates?: ElementorTemplateSummary[];
}

export interface ConfigSnapshotFile {
  schemaVersion: 1;
  snapshots: ConfigSnapshotRecord[];
}

export interface ElementorTemplateSummary {
  templateId: string;
  name: string;
  type: string;
  sourceDomain: string;
  snapshotId: string;
  snapshotName: string;
  exportDate: string;
  documentLocation: string;
  dependencies: string[];
}

export interface ResolvedElementorTemplate extends ElementorTemplateSummary {
  /** Internal build-time source path; never serialized into GUI/profile state. */
  sourceZip: string;
}

export interface ElementorGlobalReference {
  reference: string;
  kind: "color" | "typography";
  sourceId: string;
  name: string;
}

export interface ElementorTemplateLibraryRecord {
  id: string;
  sourceTemplateId: string;
  name: string;
  type: string;
  sourceDomain: string;
  snapshotId: string;
  snapshotName: string;
  exportDate: string;
  importedAt: string;
  updatedAt: string;
  documentFile: string;
  sha256: string;
  dependencies: string[];
  globalReferences: ElementorGlobalReference[];
}

export interface ResolvedElementorLibraryTemplate extends ElementorTemplateLibraryRecord {
  document: unknown[];
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
    siteDomain: string;
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
  /** Registry metadata carried on loaded profiles; omitted from stored profile documents. */
  installDir?: string;
  requiresWordPress?: string;
  requiresPhp?: string;
}

export interface ThemeRef extends ArtifactRef {
  slug: string;
}

export interface PluginRef extends ArtifactRef {
  slug: string;
  file: string;
  required?: boolean;
  locales?: string[];
  /** Registry metadata carried on loaded profiles; omitted from stored profile documents. */
  requiresPlugins?: string[];
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

export interface ElementorTemplateSelection {
  snapshotId: string;
  templateId: string;
}

export interface ProfileDocumentV7 {
  schemaVersion: 7;
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
  /** Optional multi-font extension; fontSystem remains for legacy single-font profiles. */
  fontSystems?: Array<{ id: string }>;
  elementorTemplates: ElementorTemplateSelection[];
  languageArchives?: LanguageArchiveRef[];
}

export interface ProfileDocumentV8 {
  schemaVersion: 8;
  name: string;
  locale: string;
  wordpress: { version: string; variant: string };
  theme: { slug: string; version: string } | null;
  plugins: Array<{ slug: string; version: string; required?: boolean; locales?: string[] }>;
  config: { id: string } | null;
  designSystem: { id: string } | null;
  /** Standalone profiles are allowed only when no design system is selected. */
  fontSystems?: Array<{ id: string }>;
  /** Canonical snapshot-independent selections. */
  elementorTemplateIds?: string[];
  elementorTemplateMappings?: Record<string, string>;
  /** Interim v8 compatibility; new profiles do not write this field. */
  elementorTemplates?: ElementorTemplateSelection[];
  languageArchives?: LanguageArchiveRef[];
}

export interface BuildProfile {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  name: string;
  locale: string;
  wordpress: ArtifactRef;
  theme: ThemeRef | null;
  plugins: PluginRef[];
  configExport: string | null;
  fontSystem?: ResolvedFontSystem | null;
  /** Resolved standalone font profiles. Legacy profiles use fontSystem. */
  fontSystems?: ResolvedFontSystem[];
  designSystem?: ResolvedDesignSystem | null;
  languageArchives?: LanguageArchiveRef[];
  vnext?: VNextBuildPayload | null;
  /** Resolved v7 selections, including source ZIPs for composition. */
  elementorTemplates?: ResolvedElementorTemplate[];
  elementorLibraryTemplates?: ResolvedElementorLibraryTemplate[];
  elementorTemplateMappings?: Record<string, string>;
  configurationSnapshotId?: string;
  /** Export metadata resolved from a configuration snapshot at load time. */
  configurationSource?: {
    wordpressVersion: string;
    locale: string;
    theme: { slug: string; version: string };
    plugins: Array<{ slug: string; version: string }>;
    exportedPlugins?: Array<{ slug: string; version: string }>;
  };
}

export type CompatibilityStatus = "known-good" | "upgrade-warning" | "unsupported";

export interface CompatibilityWarning {
  slug: string;
  exportedVersion: string;
  selectedVersion: string;
  message: string;
}

export interface CompatibilityReport {
  status: CompatibilityStatus;
  baselineId?: string;
  warnings: CompatibilityWarning[];
  errors: string[];
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
  /** Multiple standalone font profiles; fontSystem mirrors the first for older installers. */
  fontSystems?: Array<{
    id: string;
    name: string;
    faces: Array<Omit<FontFaceRecord, "file"> & { file: string }>;
  }>;
  languageArchives: Array<LanguageArchiveRef & { sha256: string }>;
  vnext?: { path: string; sha256: string } | null;
  elementorTemplatePayload?: { path: string; sha256: string } | null;
  designSystem?: {
    id: string;
    sha256: string;
    typography: { id: string; sha256: string };
    colors: { id: string; sha256: string };
    fontProfiles: Array<{
      id: string;
      name: string;
      faces: Array<Omit<FontFaceRecord, "file"> & { file: string }>;
    }>;
  } | null;
  elementorTemplates: Array<{
    snapshotId: string;
    templateId: string;
    name: string;
    type: string;
    libraryId?: string;
    sourceDomain?: string;
  }>;
  compatibility?: CompatibilityReport;
}

export interface BuildProgress {
  percent: number;
  stage: string;
  message: string;
  current?: number;
  total?: number;
}
