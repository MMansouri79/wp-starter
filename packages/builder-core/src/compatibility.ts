import type { BuildProfile, CompatibilityReport } from "./types.js";
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
  code: "matrix_entry_missing" | "package_version_mismatch" | "dependency_incompatible" | "locale_mismatch" | "theme_mismatch" | "wordpress_mismatch";
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

function activePlugins(profile: BuildProfile): BuildProfile["plugins"] {
  return profile.plugins.filter((plugin) => !plugin.locales || plugin.locales.includes(profile.locale));
}

function samePlugins(expected: Record<string, string>, actual: Record<string, string>): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return expectedKeys.length === actualKeys.length && expectedKeys.every((key) => actual[key] === expected[key]);
}

function samePluginSet(expected: Record<string, string>, actual: Record<string, string>): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return expectedKeys.length === actualKeys.length && expectedKeys.every((key, index) => key === actualKeys[index]);
}

type ParsedVersion = [number, number, number, string | null];

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  const numbers = [Number(match[1]), Number(match[2] || "0"), Number(match[3] || "0")];
  if (!numbers.every((number) => Number.isSafeInteger(number))) return null;
  return [numbers[0], numbers[1], numbers[2], match[4] || null];
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    const left = a[index] as number;
    const right = b[index] as number;
    if (left !== right) return left > right ? 1 : -1;
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  const leftParts = a[3].split(".");
  const rightParts = b[3].split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseConstraint(value: string): { operator: ">=" | ">" | "=" | "<" | "<="; version: string } | null {
  const match = /^(>=|<=|>|<|=)?\s*(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(value.trim());
  if (!match || !parseVersion(match[2])) return null;
  return { operator: (match[1] as ">=" | ">" | "=" | "<" | "<=") || ">=", version: match[2] };
}

function satisfiesConstraint(actual: string, rawConstraint: string): boolean | null {
  const constraint = parseConstraint(rawConstraint);
  if (!constraint) return null;
  const comparison = compareVersions(actual, constraint.version);
  if (comparison === null) return null;
  if (constraint.operator === ">=") return comparison >= 0;
  if (constraint.operator === ">") return comparison > 0;
  if (constraint.operator === "=") return comparison === 0;
  if (constraint.operator === "<") return comparison < 0;
  return comparison <= 0;
}

function dependencyConstraint(raw: string): { slug: string; constraint?: string } | null {
  const match = /^([A-Za-z0-9._-]+)\s*(?:(>=|<=|>|<|=)\s*(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/.exec(raw.trim());
  if (!match) return null;
  return { slug: match[1], constraint: match[3] ? `${match[2]}${match[3]}` : undefined };
}

function dependencyErrors(profile: BuildProfile, phpVersion?: string): string[] {
  const plugins = activePlugins(profile);
  const selected = new Map(plugins.map((plugin) => [plugin.slug, plugin.version]));
  const errors: string[] = [];
  const checkPackage = (label: string, packageRef: { requiresWordPress?: string; requiresPhp?: string; requiresPlugins?: string[] }) => {
    if (packageRef.requiresWordPress) {
      const result = satisfiesConstraint(profile.wordpress.version, packageRef.requiresWordPress);
      if (result !== true) errors.push(`Build blocked: ${label} requires WordPress ${packageRef.requiresWordPress}, but ${profile.wordpress.version} is selected. Solution: choose a compatible WordPress package.`);
    }
    if (packageRef.requiresPhp && phpVersion) {
      const result = satisfiesConstraint(phpVersion, packageRef.requiresPhp);
      if (result !== true) errors.push(`Build blocked: ${label} requires PHP ${packageRef.requiresPhp}, but ${phpVersion} is available. Solution: use a package compatible with the baseline PHP version.`);
    }
    for (const rawDependency of packageRef.requiresPlugins || []) {
      const dependency = dependencyConstraint(rawDependency);
      if (!dependency) {
        errors.push(`Build blocked: ${label} declares an unsupported dependency (${rawDependency}). Solution: re-import a package with valid dependency metadata.`);
        continue;
      }
      const selectedVersion = selected.get(dependency.slug);
      if (!selectedVersion) {
        errors.push(`Build blocked: ${label} requires plugin ${dependency.slug}. Solution: add ${dependency.slug} to the profile.`);
        continue;
      }
      if (dependency.constraint) {
        const result = satisfiesConstraint(selectedVersion, dependency.constraint);
        if (result !== true) errors.push(`Build blocked: ${label} requires ${rawDependency}, but ${dependency.slug}@${selectedVersion} is selected. Solution: choose a compatible ${dependency.slug} version.`);
      }
    }
  };
  if (profile.theme) checkPackage(`Theme ${profile.theme.slug}@${profile.theme.version}`, profile.theme);
  for (const plugin of plugins) checkPackage(`Plugin ${plugin.slug}@${plugin.version}`, plugin);
  return errors;
}

function unsupportedReport(errors: string[], baselineId?: string): CompatibilityReport {
  return { status: "unsupported", ...(baselineId ? { baselineId } : {}), warnings: [], errors };
}

export function compatibilityReport(profile: BuildProfile, matrix = DEFAULT_COMPATIBILITY_MATRIX): CompatibilityReport {
  if (!profile.configExport) {
    // Package-only profiles skip baseline gating but must still satisfy
    // package dependency declarations and locale consistency.
    const errors = dependencyErrors(profile);
    if (profile.wordpress.variant && profile.locale && profile.wordpress.variant !== profile.locale) {
      errors.push(`Build blocked: locale ${profile.locale} does not match the WordPress package locale ${profile.wordpress.variant}. Solution: select the WordPress package for ${profile.locale}.`);
    }
    return errors.length ? unsupportedReport(errors) : { status: "known-good", warnings: [], errors: [] };
  }

  const source = profile.configurationSource;
  const locale = profile.locale;
  const selectedVariant = profile.wordpress.variant || profile.locale;
  const errors: string[] = [];
  if (selectedVariant !== locale) errors.push(`Build blocked: locale ${locale} does not match the WordPress package locale ${selectedVariant}. Solution: select the WordPress package for ${locale}.`);
  if (source && source.locale !== locale) errors.push(`Build blocked: the export uses locale ${source.locale}, but ${locale} is selected. Solution: keep the exported locale.`);
  if (source && (!profile.theme || profile.theme.slug !== source.theme.slug)) {
    errors.push(`Build blocked: the export uses theme ${source.theme.slug}, but ${profile.theme ? profile.theme.slug : "no theme"} is selected. Solution: keep the exported theme slug; its version may be upgraded.`);
  }

  const actualPlugins = pluginMap(profile);
  const sourcePlugins = source ? Object.fromEntries(source.plugins.map((plugin) => [plugin.slug, plugin.version])) : null;
  const exportedPlugins = source ? Object.fromEntries((source.exportedPlugins || source.plugins).map((plugin) => [plugin.slug, plugin.version])) : null;
  const localeTargets = matrix.entries.filter((entry) => !entry.wordpress.variant || entry.wordpress.variant === locale);
  const environmentTargets = localeTargets.filter((entry) =>
    (!entry.theme ? !profile.theme : Boolean(profile.theme && profile.theme.slug === entry.theme.slug))
  );
  const expectedEnvironment = (sourcePlugins ? environmentTargets.find((entry) => samePluginSet(entry.plugins, sourcePlugins)) : undefined) || environmentTargets[0];
  const matchingTargets = environmentTargets.filter((entry) => samePluginSet(entry.plugins, actualPlugins));
  if (!matchingTargets.length) {
    if (!localeTargets.length) {
      errors.push(`Build blocked: no reference baseline is available for locale ${locale}. Solution: use the export locale or add a verified compatibility baseline.`);
    } else if (!environmentTargets.length) {
      errors.push(`Build blocked: theme ${profile.theme?.slug || "default"} is not supported by this reference. Solution: keep the exported theme slug${source ? ` (${source.theme.slug})` : ""}; its version may be upgraded.`);
    } else if (expectedEnvironment) {
      const expectedSlugs = Object.keys(expectedEnvironment.plugins);
      const actualSlugs = Object.keys(actualPlugins);
      const missing = expectedSlugs.filter((slug) => !actualSlugs.includes(slug));
      const extra = actualSlugs.filter((slug) => !expectedSlugs.includes(slug));
      const differences = [
        missing.length ? `Missing: ${missing.join(", ")}.` : "",
        extra.length ? `Extra: ${extra.join(", ")}.` : ""
      ].filter(Boolean).join(" ");
      errors.push(`Build blocked: the profile must use the same plugin list as the reference. ${differences} Solution: add or remove the listed plugins; newer versions are allowed once the plugin list matches.`);
    }
    return unsupportedReport([...errors, ...dependencyErrors(profile)]);
  }

  const baseline = matchingTargets[0];

  if (sourcePlugins && !samePluginSet(baseline.plugins, sourcePlugins)) {
    errors.push("Build blocked: the exported plugin list does not match the published reference. Solution: use the reference target plugin list or a verified compatibility baseline.");
  }

  const warnings: CompatibilityReport["warnings"] = [];
  const checkPackageVersion = (slug: string, exportedVersion: string, selectedVersion: string, label: string): void => {
    const comparison = compareVersions(selectedVersion, exportedVersion);
    if (comparison === null) {
      errors.push(`Build blocked: ${label} version ${selectedVersion} cannot be compared safely. Solution: use a numeric version such as 4.2.1.`);
      return;
    }
    if (comparison < 0) {
      errors.push(`Build blocked: ${label} downgrade is not supported (${exportedVersion} → ${selectedVersion}). Solution: choose ${exportedVersion} or a newer version.`);
    } else if (comparison > 0) {
      warnings.push({
        slug,
        exportedVersion,
        selectedVersion,
        message: `${slug} ${exportedVersion} → ${selectedVersion}`
      });
    }
  };

  checkPackageVersion(
    "wordpress",
    source?.wordpressVersion || baseline.wordpress.version,
    profile.wordpress.version,
    "WordPress"
  );
  if (profile.theme && baseline.theme) {
    checkPackageVersion(
      profile.theme.slug,
      source?.theme.version || baseline.theme.version,
      profile.theme.version,
      `Theme ${profile.theme.slug}`
    );
  }

  for (const [slug, exportedBaselineVersion] of Object.entries(baseline.plugins)) {
    const selectedVersion = actualPlugins[slug];
    checkPackageVersion(slug, exportedPlugins?.[slug] || exportedBaselineVersion, selectedVersion, `Plugin ${slug}`);
  }

  const allErrors = [...errors, ...dependencyErrors(profile, baseline.php)];
  if (allErrors.length) return unsupportedReport(allErrors, baseline.id);
  return {
    status: warnings.length ? "upgrade-warning" : "known-good",
    baselineId: baseline.id,
    warnings,
    errors: []
  };
}

export function compatibilityIssues(profile: BuildProfile, matrix = DEFAULT_COMPATIBILITY_MATRIX): CompatibilityIssue[] {
  const report = compatibilityReport(profile, matrix);
  if (report.status !== "unsupported") return [];
  return report.errors.map((message) => ({
    code: message.includes("dependency") || message.includes("requires") ? "dependency_incompatible" : message.includes("downgrade") || message.includes("compare") ? "package_version_mismatch" : message.includes("Locale") ? "locale_mismatch" : message.includes("Theme") ? "theme_mismatch" : message.includes("WordPress") ? "wordpress_mismatch" : "matrix_entry_missing",
    message
  }));
}

export function assertKnownGoodProfile(profile: BuildProfile, matrix = DEFAULT_COMPATIBILITY_MATRIX): void {
  const report = compatibilityReport(profile, matrix);
  if (report.status === "unsupported") throw new BuilderError("unsupported_compatibility", report.errors.join(" "));
}
