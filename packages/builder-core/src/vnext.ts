import { readFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, writeJson } from "./fs-utils.js";
import type { FontFaceRecord, FontStyle } from "./types.js";

export const VNEXT_SCHEMA_VERSION = 1 as const;
export type TypographyRole = "body" | "links" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "buttons" | "formFields";
export type DesignReferenceKind = "color" | "typography" | "font" | "template" | "object";

export interface FontAsset {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  family: string;
  sourceFilename?: string;
  faces: Array<Omit<FontFaceRecord, "file"> & { file?: string }>;
}

export interface ResponsiveValue<T> {
  desktop: T;
  tablet?: T;
  mobile?: T;
}

export interface TypographyToken {
  fontRole: string;
  weight: number;
  style?: FontStyle;
  size?: ResponsiveValue<string>;
  lineHeight?: ResponsiveValue<string | number>;
  letterSpacing?: ResponsiveValue<string>;
  wordSpacing?: ResponsiveValue<string>;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "overline" | "line-through";
}

export interface TypographyProfile {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  roles: Partial<Record<TypographyRole, TypographyToken>>;
  custom?: Record<string, TypographyToken>;
}

export interface ColorProfile {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  elementor: { primary: string; secondary: string; text: string; accent: string };
  semantic?: Record<string, string>;
}

export interface DesignSystem {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  fontBindings: Record<string, string>;
  typographyProfileId: string;
  colorProfileId: string;
}

export interface BuildProfileVNext {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  name: string;
  locale: string;
  baseProfileFile: string;
  designSystemId: string;
  templateIds?: string[];
}

export interface PortableReference {
  $wpStarterRef: `${DesignReferenceKind}:${string}`;
}

export interface PortableTemplate {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  provider: "elementor";
  type: string;
  document: unknown;
}

export interface VNextBuildPayload {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  designSystem: {
    id: string;
    name: string;
    fontBindings: Record<string, string>;
    fontFamilies: Record<string, string>;
    colors: Record<string, string>;
    typography: Partial<Record<TypographyRole, TypographyToken>> & Record<string, TypographyToken>;
  };
  templates: PortableTemplate[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

const ROLE_NAMES = new Set<TypographyRole>(["body", "links", "h1", "h2", "h3", "h4", "h5", "h6", "buttons", "formFields"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function issue(issues: ValidationIssue[], pathName: string, code: string, message: string): void {
  issues.push({ path: pathName, code, message });
}

function validateId(value: string, pathName: string, issues: ValidationIssue[]): void {
  if (!ID_PATTERN.test(value)) issue(issues, pathName, "invalid_id", "IDs must contain lowercase letters, numbers, dots, underscores, or hyphens.");
}

function validateToken(token: TypographyToken, pathName: string, issues: ValidationIssue[]): void {
  if (!token.fontRole?.trim()) issue(issues, `${pathName}.fontRole`, "missing_font_role", "A logical font role is required.");
  if (!Number.isInteger(token.weight) || token.weight < 100 || token.weight > 900 || token.weight % 100 !== 0) issue(issues, `${pathName}.weight`, "invalid_weight", "Font weight must be an integer from 100 to 900 in increments of 100.");
}

export function validateTypographyProfile(profile: TypographyProfile): ValidationReport {
  const issues: ValidationIssue[] = [];
  validateId(profile.id, "id", issues);
  if (!profile.name?.trim()) issue(issues, "name", "missing_name", "A typography profile name is required.");
  for (const [role, token] of Object.entries(profile.roles || {})) {
    if (!ROLE_NAMES.has(role as TypographyRole)) issue(issues, `roles.${role}`, "unknown_role", `Unsupported typography role: ${role}.`);
    if (token) validateToken(token, `roles.${role}`, issues);
  }
  for (const [name, token] of Object.entries(profile.custom || {})) {
    if (!ID_PATTERN.test(name)) issue(issues, `custom.${name}`, "invalid_token_name", "Custom token names must use lowercase identifier characters.");
    validateToken(token, `custom.${name}`, issues);
  }
  return { valid: issues.length === 0, issues };
}

export function validateColorProfile(profile: ColorProfile): ValidationReport {
  const issues: ValidationIssue[] = [];
  validateId(profile.id, "id", issues);
  if (!profile.name?.trim()) issue(issues, "name", "missing_name", "A color profile name is required.");
  for (const [name, value] of Object.entries(profile.elementor || {})) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) issue(issues, `elementor.${name}`, "invalid_color", "Colors must be hexadecimal values.");
  }
  for (const [name, value] of Object.entries(profile.semantic || {})) {
    if (!ID_PATTERN.test(name)) issue(issues, `semantic.${name}`, "invalid_token_name", "Semantic color names must use lowercase identifier characters.");
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) issue(issues, `semantic.${name}`, "invalid_color", "Colors must be hexadecimal values.");
  }
  return { valid: issues.length === 0, issues };
}

export function validateDesignSystem(system: DesignSystem, typography: TypographyProfile, colors: ColorProfile, fonts: FontAsset[]): ValidationReport {
  const issues: ValidationIssue[] = [...validateTypographyProfile(typography).issues, ...validateColorProfile(colors).issues];
  validateId(system.id, "id", issues);
  if (system.typographyProfileId !== typography.id) issue(issues, "typographyProfileId", "profile_mismatch", "Design system typography profile does not match the selected profile.");
  if (system.colorProfileId !== colors.id) issue(issues, "colorProfileId", "profile_mismatch", "Design system color profile does not match the selected profile.");
  const fontById = new Map(fonts.map((font) => [font.id, font]));
  for (const [role, fontId] of Object.entries(system.fontBindings || {})) {
    const font = fontById.get(fontId);
    if (!font) {
      issue(issues, `fontBindings.${role}`, "font_asset_missing", `Font asset ${fontId} is not available.`);
      continue;
    }
    const requested = [...Object.values(typography.roles || {}), ...Object.values(typography.custom || {})]
      .filter((token): token is TypographyToken => Boolean(token) && token.fontRole === role);
    const weights = new Set(font.faces.map((face) => face.weight));
    for (const token of requested) if (!weights.has(token.weight)) issue(issues, `fontBindings.${role}`, "font_weight_missing", `Font asset ${font.name} does not provide weight ${token.weight} required by ${role}.`);
  }
  return { valid: issues.length === 0, issues };
}

export function assertValidReport(report: ValidationReport, code = "invalid_vnext_resource"): void {
  if (!report.valid) throw new BuilderError(code, report.issues.map((entry) => `${entry.path}: ${entry.message}`).join(" "));
}

export function compileVNextPayload(system: DesignSystem, typography: TypographyProfile, colors: ColorProfile, fonts: FontAsset[], templates: PortableTemplate[] = []): VNextBuildPayload {
  assertValidReport(validateDesignSystem(system, typography, colors, fonts), "invalid_vnext_design_system");
  return {
    schemaVersion: VNEXT_SCHEMA_VERSION,
    designSystem: {
      id: system.id,
      name: system.name,
      fontBindings: { ...system.fontBindings },
      fontFamilies: Object.fromEntries(Object.entries(system.fontBindings).map(([role, fontId]) => [role, fonts.find((font) => font.id === fontId)?.family || ""])),
      colors: { ...colors.elementor, ...(colors.semantic || {}) },
      typography: { ...(typography.roles || {}), ...(typography.custom || {}) } as VNextBuildPayload["designSystem"]["typography"]
    },
    templates: templates.map((template) => ({ ...template }))
  };
}

export function remapPortableTemplate(template: PortableTemplate, mappings: Record<string, string | number>): PortableTemplate {
  const unresolved: string[] = [];
  const visit = (value: unknown, pathName: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${pathName}[${index}]`));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object.$wpStarterRef === "string") {
      const reference = object.$wpStarterRef;
      if (!(reference in mappings)) { unresolved.push(`${pathName}: ${reference}`); return value; }
      return mappings[reference];
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, visit(child, `${pathName}.${key}`)]));
  };
  const document = visit(template.document, "document");
  if (unresolved.length) throw new BuilderError("unresolved_template_reference", `Portable template ${template.id} contains unresolved references: ${unresolved.join(", ")}`);
  return { ...template, document };
}

export class VNextResourceRegistry<T extends { id: string }> {
  public readonly root: string;
  private readonly filename: string;
  constructor(root: string, filename: string) { this.root = path.resolve(root); this.filename = filename; }
  private async load(): Promise<T[]> {
    const file = path.join(this.root, this.filename);
    if (!(await exists(file))) return [];
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Expected an array.");
      return parsed as T[];
    } catch (error) {
      throw new BuilderError("invalid_vnext_registry", `Could not parse ${this.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async list(): Promise<T[]> { return this.load(); }
  async save(value: T): Promise<T> {
    const records = await this.load();
    const index = records.findIndex((item) => item.id === value.id);
    if (index >= 0) records[index] = value; else records.push(value);
    records.sort((left, right) => left.id.localeCompare(right.id));
    await ensureDir(this.root);
    await writeJson(path.join(this.root, this.filename), records);
    return value;
  }
}

export function fontAssetFromLegacy(id: string, name: string, family: string, faces: FontFaceRecord[]): FontAsset {
  return { schemaVersion: VNEXT_SCHEMA_VERSION, id, name, family, faces };
}
