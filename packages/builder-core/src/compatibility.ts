import type { BuildProfile } from "./types.js";
import { BuilderError } from "./errors.js";

export interface CompatibilityMatrixEntry {
  id: string;
  status: "known-good";
  wordpress: { version: string; variant?: string };
  php: string;
  theme?: { slug: string; version: string };
  plugins: Record<string, string>;
  notes?: string;
}

export interface CompatibilityMatrix {
  schemaVersion: 1;
  generatedAt: string;
  entries: CompatibilityMatrixEntry[];
}

export interface CompatibilityIssue {
  code: "matrix_entry_missing" | "package_version_mismatch";
  message: string;
}

export const DEFAULT_COMPATIBILITY_MATRIX: CompatibilityMatrix = {
  schemaVersion: 1,
  generatedAt: "2026-09-13T00:00:00Z",
  entries: [
    {
      id: "elementor-en-wp71",
      status: "known-good",
      wordpress: { version: "7.1", variant: "en_US" },
      php: "8.2",
      theme: { slug: "hello-elementor", version: "3.4.9" },
      plugins: { "classic-editor": "1.7.0", elementor: "4.0.8", "elementor-pro": "4.0.4" },
      notes: "Reference Elementor baseline."
    },
    {
      id: "ecommerce-fa-wp71",
      status: "known-good",
      wordpress: { version: "7.1", variant: "fa_IR" },
      php: "8.2",
      theme: { slug: "hello-elementor", version: "3.4.9" },
      plugins: {
        "classic-editor": "1.7.0",
        elementor: "4.0.8",
        "elementor-pro": "4.0.4",
        woocommerce: "10.9.4",
        "persian-woocommerce": "10.0.4",
        filterx: "0.6.1"
      },
      notes: "Reference Persian commerce baseline."
    }
  ]
};

function pluginMap(profile: BuildProfile): Record<string, string> {
  return Object.fromEntries(profile.plugins
    .filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale))
    .map((plugin) => [plugin.slug, plugin.version]));
}

function samePlugins(expected: Record<string, string>, actual: Record<string, string>): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return expectedKeys.length === actualKeys.length && expectedKeys.every((key) => actual[key] === expected[key]);
}

export function compatibilityIssues(profile: BuildProfile, matrix = DEFAULT_COMPATIBILITY_MATRIX): CompatibilityIssue[] {
  if (!profile.configExport) return [];
  const actualPlugins = pluginMap(profile);
  const matchingWordPress = matrix.entries.filter((entry) =>
    entry.wordpress.version === profile.wordpress.version &&
    (!entry.wordpress.variant || entry.wordpress.variant === (profile.wordpress.variant || profile.locale))
  );
  const match = matchingWordPress.find((entry) =>
    (!entry.theme || (profile.theme?.slug === entry.theme.slug && profile.theme.version === entry.theme.version)) &&
    samePlugins(entry.plugins, actualPlugins)
  );
  if (match) return [];

  const expected = matchingWordPress.map((entry) => `${entry.id}: ${Object.entries(entry.plugins).map(([slug, version]) => `${slug}@${version}`).join(", ")}`).join(" | ");
  return [{
    code: "matrix_entry_missing",
    message: `No known-good compatibility entry matches ${profile.wordpress.version} (${profile.wordpress.variant || profile.locale}), ${profile.theme ? `${profile.theme.slug}@${profile.theme.version}` : "default theme"}, and plugins ${Object.entries(actualPlugins).map(([slug, version]) => `${slug}@${version}`).join(", ") || "none"}.${expected ? ` Available entries for this WordPress target: ${expected}.` : ""}`
  }];
}

export function assertKnownGoodProfile(profile: BuildProfile, matrix = DEFAULT_COMPATIBILITY_MATRIX): void {
  const issues = compatibilityIssues(profile, matrix);
  if (issues.length) throw new BuilderError("unsupported_compatibility", issues.map((issue) => issue.message).join(" "));
}

