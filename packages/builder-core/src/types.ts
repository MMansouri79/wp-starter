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
  schemaVersion: 1;
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
