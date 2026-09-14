import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, writeJson } from "./fs-utils.js";
import { FontSystemRegistry } from "./fonts.js";
import type { FontFaceRecord, FontStyle, ResolvedFontSystem } from "./types.js";

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

export type TypographyUnit = "px" | "rem" | "em" | "%" | "vw" | "vh" | "lh" | "rlh" | "";
export interface TypographyDimension { value: number; unit: TypographyUnit; }

export interface TypographyToken {
  fontRole: string;
  weight: number;
  style?: FontStyle;
  size?: ResponsiveValue<TypographyDimension>;
  lineHeight?: ResponsiveValue<TypographyDimension>;
  letterSpacing?: ResponsiveValue<TypographyDimension>;
  wordSpacing?: ResponsiveValue<TypographyDimension>;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "overline" | "line-through";
}

export interface TypographyProfile {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  roles: Partial<Record<TypographyRole, TypographyToken>>;
  custom?: Record<string, TypographyToken>;
  fontSlots?: Record<string, { name: string }>;
  customRoleNames?: Record<string, string>;
}

export interface NamedColorToken { id: string; name: string; value: string; }

export interface ColorProfile {
  schemaVersion: typeof VNEXT_SCHEMA_VERSION;
  id: string;
  name: string;
  elementor: { primary: string; secondary: string; text: string; accent: string };
  semantic?: Record<string, string>;
  custom?: NamedColorToken[];
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
    colorNames?: Record<string, string>;
    typography: Partial<Record<TypographyRole, TypographyToken>> & Record<string, TypographyToken>;
    typographyNames?: Record<string, string>;
    resources: {
      typography: { id: string; sha256: string };
      colors: { id: string; sha256: string };
    };
    fontProfiles?: Array<{
      id: string;
      name: string;
      faces: Array<Omit<FontFaceRecord, "file"> & { file: string }>;
    }>;
  };
  templates: PortableTemplate[];
  selectedTemplates?: Array<{ snapshotId: string; templateId: string; name: string; type: string }>;
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
const ELEMENTOR_COLOR_ROLES = new Set(["primary", "secondary", "text", "accent"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DIMENSION_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(px|rem|em|%|vw|vh|lh|rlh)?$/i;
const TYPOGRAPHY_UNITS = new Set<TypographyUnit>(["px", "rem", "em", "%", "vw", "vh", "lh", "rlh", ""]);

function issue(issues: ValidationIssue[], pathName: string, code: string, message: string): void {
  issues.push({ path: pathName, code, message });
}

function validateId(value: unknown, pathName: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) issue(issues, pathName, "invalid_id", "IDs must contain lowercase letters, numbers, dots, underscores, or hyphens.");
}

function normalizeDimension(value: unknown, pathName: string, allowUnitless: boolean): TypographyDimension {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const unit = typeof object.unit === "string" ? object.unit.toLowerCase() as TypographyUnit : undefined;
    if (typeof object.value === "number" && Number.isFinite(object.value) && unit !== undefined && TYPOGRAPHY_UNITS.has(unit) && (allowUnitless || unit !== "")) return { value: object.value, unit };
  }
  if (typeof value === "number" && Number.isFinite(value) && allowUnitless) return { value, unit: "" };
  if (typeof value === "string") {
    const match = value.trim().match(DIMENSION_PATTERN);
    if (match) {
      const unit = (match[2] || "").toLowerCase() as TypographyUnit;
      if (allowUnitless || unit !== "") return { value: Number(match[1]), unit };
    }
  }
  throw new BuilderError("invalid_typography_value", `${pathName} must contain an explicit numeric value and unit${allowUnitless ? " (or a unitless numeric value)" : ""}.`);
}

function normalizeResponsive(value: unknown, pathName: string, allowUnitless: boolean): ResponsiveValue<TypographyDimension> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || !("desktop" in value)) throw new BuilderError("invalid_typography_value", `${pathName} must define a desktop value.`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!["desktop", "tablet", "mobile"].includes(key)) throw new BuilderError("invalid_typography_value", `${pathName}.${key} is not a supported breakpoint.`);
  const result: ResponsiveValue<TypographyDimension> = { desktop: normalizeDimension(object.desktop, `${pathName}.desktop`, allowUnitless) };
  if (object.tablet !== undefined) result.tablet = normalizeDimension(object.tablet, `${pathName}.tablet`, allowUnitless);
  if (object.mobile !== undefined) result.mobile = normalizeDimension(object.mobile, `${pathName}.mobile`, allowUnitless);
  return result;
}

function normalizeToken(token: TypographyToken, pathName: string): TypographyToken {
  if (!token || typeof token !== "object" || Array.isArray(token)) throw new BuilderError("invalid_typography_token", `${pathName} must be an object.`);
  return {
    fontRole: String(token.fontRole || "").trim(),
    weight: Number(token.weight),
    ...(token.style ? { style: token.style } : {}),
    ...(token.size !== undefined ? { size: normalizeResponsive(token.size, `${pathName}.size`, false) } : {}),
    ...(token.lineHeight !== undefined ? { lineHeight: normalizeResponsive(token.lineHeight, `${pathName}.lineHeight`, true) } : {}),
    ...(token.letterSpacing !== undefined ? { letterSpacing: normalizeResponsive(token.letterSpacing, `${pathName}.letterSpacing`, true) } : {}),
    ...(token.wordSpacing !== undefined ? { wordSpacing: normalizeResponsive(token.wordSpacing, `${pathName}.wordSpacing`, true) } : {}),
    ...(token.textTransform ? { textTransform: token.textTransform } : {}),
    ...(token.textDecoration ? { textDecoration: token.textDecoration } : {})
  };
}

export function normalizeTypographyProfile(profile: TypographyProfile): TypographyProfile {
  const roles = Object.fromEntries(Object.entries(profile.roles || {}).map(([name, token]) => [name, normalizeToken(token as TypographyToken, `roles.${name}`)]));
  const custom = Object.fromEntries(Object.entries(profile.custom || {}).map(([name, token]) => [name, normalizeToken(token, `custom.${name}`)]));
  const usedSlots = new Set([...Object.values(roles), ...Object.values(custom)].map((token) => (token as TypographyToken).fontRole).filter(Boolean));
  const legacySlotName = (id: string) => id === "body" || id === "primary" ? "Body font" : id === "heading" || id === "headings" ? "Heading font" : id === "accent" ? "Accent font" : id.replace(/[-_]+/g, " ").replace(/^./, (value) => value.toUpperCase());
  const fontSlots = Object.fromEntries([...usedSlots].map((id) => [id, { name: String(profile.fontSlots?.[id]?.name || legacySlotName(id)).trim() }]));
  const normalized: TypographyProfile = { schemaVersion: VNEXT_SCHEMA_VERSION, id: String(profile.id || "").trim(), name: String(profile.name || "").trim(), roles, fontSlots };
  if (Object.keys(custom).length) normalized.custom = custom;
  if (profile.customRoleNames) normalized.customRoleNames = Object.fromEntries(Object.entries(profile.customRoleNames).map(([id, name]) => [id, String(name).trim()]));
  assertValidReport(validateTypographyProfile(normalized));
  return normalized;
}

function validateResponsive(value: ResponsiveValue<TypographyDimension> | undefined, pathName: string, allowUnitless: boolean, issues: ValidationIssue[]): void {
  if (!value) return;
  for (const breakpoint of ["desktop", "tablet", "mobile"] as const) {
    const dimension = value[breakpoint];
    if (!dimension) continue;
    if (!Number.isFinite(dimension.value) || !TYPOGRAPHY_UNITS.has(dimension.unit) || (!allowUnitless && dimension.unit === "")) issue(issues, `${pathName}.${breakpoint}`, "invalid_dimension", "Typography dimensions require a finite value and an allowed explicit unit.");
  }
}

function validateToken(token: TypographyToken, pathName: string, issues: ValidationIssue[]): void {
  if (!token.fontRole?.trim()) issue(issues, `${pathName}.fontRole`, "missing_font_slot", "A font slot is required.");
  else if (!ID_PATTERN.test(token.fontRole)) issue(issues, `${pathName}.fontRole`, "invalid_font_slot", "Font slot IDs must use lowercase identifier characters.");
  if (!Number.isInteger(token.weight) || token.weight < 100 || token.weight > 900 || token.weight % 100 !== 0) issue(issues, `${pathName}.weight`, "invalid_weight", "Font weight must be an integer from 100 to 900 in increments of 100.");
  if (token.style && !["normal", "italic", "oblique"].includes(token.style)) issue(issues, `${pathName}.style`, "invalid_style", "Font style must be normal, italic, or oblique.");
  validateResponsive(token.size, `${pathName}.size`, false, issues);
  validateResponsive(token.lineHeight, `${pathName}.lineHeight`, true, issues);
  validateResponsive(token.letterSpacing, `${pathName}.letterSpacing`, true, issues);
  validateResponsive(token.wordSpacing, `${pathName}.wordSpacing`, true, issues);
  if (token.textTransform && !["none", "uppercase", "lowercase", "capitalize"].includes(token.textTransform)) issue(issues, `${pathName}.textTransform`, "invalid_transform", "Unsupported text transform.");
  if (token.textDecoration && !["none", "underline", "overline", "line-through"].includes(token.textDecoration)) issue(issues, `${pathName}.textDecoration`, "invalid_decoration", "Unsupported text decoration.");
}

export function validateTypographyProfile(profile: TypographyProfile): ValidationReport {
  const issues: ValidationIssue[] = [];
  validateId(profile.id, "id", issues);
  if (typeof profile.name !== "string" || !profile.name.trim()) issue(issues, "name", "missing_name", "A typography profile name is required.");
  for (const [role, token] of Object.entries(profile.roles || {})) {
    if (!ROLE_NAMES.has(role as TypographyRole)) issue(issues, `roles.${role}`, "unknown_role", `Unsupported typography role: ${role}.`);
    if (token) validateToken(token, `roles.${role}`, issues);
  }
  for (const [name, token] of Object.entries(profile.custom || {})) {
    if (!ID_PATTERN.test(name)) issue(issues, `custom.${name}`, "invalid_token_name", "Custom token names must use lowercase identifier characters.");
    validateToken(token, `custom.${name}`, issues);
  }
  for (const [name, token] of [...Object.entries(profile.roles || {}), ...Object.entries(profile.custom || {})]) if (token && !profile.fontSlots?.[token.fontRole]) issue(issues, `typography.${name}.fontRole`, "font_slot_missing", `Font slot ${token.fontRole} is not defined by this profile.`);
  for (const [id, slot] of Object.entries(profile.fontSlots || {})) {
    if (!ID_PATTERN.test(id)) issue(issues, `fontSlots.${id}`, "invalid_font_slot", "Font slot IDs must use lowercase identifier characters.");
    if (!slot?.name?.trim()) issue(issues, `fontSlots.${id}.name`, "missing_name", "A friendly font slot name is required.");
  }
  const slotNames = Object.values(profile.fontSlots || {}).map((slot) => slot.name.trim().toLowerCase());
  if (new Set(slotNames).size !== slotNames.length) issue(issues, "fontSlots", "duplicate_name", "Font slot names must be unique.");
  const customNames = Object.values(profile.customRoleNames || {}).map((name) => String(name).trim().toLowerCase());
  if (customNames.some((name) => !name)) issue(issues, "customRoleNames", "missing_name", "Custom typography rows require friendly names.");
  if (new Set(customNames).size !== customNames.length) issue(issues, "customRoleNames", "duplicate_name", "Custom typography names must be unique.");
  return { valid: issues.length === 0, issues };
}

export function validateColorProfile(profile: ColorProfile): ValidationReport {
  const issues: ValidationIssue[] = [];
  validateId(profile.id, "id", issues);
  if (typeof profile.name !== "string" || !profile.name.trim()) issue(issues, "name", "missing_name", "A color profile name is required.");
  for (const name of Object.keys(profile.elementor || {})) if (!["primary", "secondary", "text", "accent"].includes(name)) issue(issues, `elementor.${name}`, "unknown_color_role", "Only primary, secondary, text, and accent are Elementor color roles.");
  for (const name of ["primary", "secondary", "text", "accent"] as const) {
    const value = profile.elementor?.[name];
    if (!HEX_PATTERN.test(value || "")) issue(issues, `elementor.${name}`, "invalid_color", "A hexadecimal Elementor color is required.");
  }
  for (const [name, value] of Object.entries(profile.semantic || {})) {
    if (!ID_PATTERN.test(name)) issue(issues, `semantic.${name}`, "invalid_token_name", "Semantic color names must use lowercase identifier characters.");
    if (["primary", "secondary", "text", "accent"].includes(name)) issue(issues, `semantic.${name}`, "duplicate_color_role", "Semantic colors cannot replace the four Elementor color roles.");
    if (!HEX_PATTERN.test(value)) issue(issues, `semantic.${name}`, "invalid_color", "Colors must be hexadecimal values.");
  }
  const customIds = new Set<string>(); const customNames = new Set<string>();
  for (const [index, token] of (profile.custom || []).entries()) {
    if (!ID_PATTERN.test(token.id || "")) issue(issues, `custom[${index}].id`, "invalid_token_name", "Custom color token IDs must use lowercase identifier characters.");
    if (!token.name?.trim()) issue(issues, `custom[${index}].name`, "missing_name", "A custom color name is required.");
    if (!HEX_PATTERN.test(token.value || "")) issue(issues, `custom[${index}].value`, "invalid_color", "Colors must be hexadecimal values.");
    if (customIds.has(token.id)) issue(issues, `custom[${index}].id`, "duplicate_id", "Custom color token IDs must be unique.");
    const normalizedName = token.name.trim().toLowerCase(); if (customNames.has(normalizedName)) issue(issues, `custom[${index}].name`, "duplicate_name", "Custom color names must be unique.");
    customIds.add(token.id); customNames.add(normalizedName);
  }
  return { valid: issues.length === 0, issues };
}

function normalizeColorProfile(value: ColorProfile): ColorProfile {
  const customInput = Array.isArray(value.custom)
    ? value.custom
    : Object.entries(value.semantic || {}).map(([id, color]) => ({ id, name: id.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()), value: color }));
  const custom = customInput.map((token) => {
    const rawId = String(token.id || `color-${randomUUID().slice(0, 8)}`).trim().toLowerCase();
    const id = ELEMENTOR_COLOR_ROLES.has(rawId) ? `custom-${rawId}` : rawId;
    return { id, name: String(token.name || "").trim(), value: String(token.value || "").toLowerCase() };
  });
  return {
    schemaVersion: VNEXT_SCHEMA_VERSION,
    id: String(value.id || "").trim(),
    name: String(value.name || "").trim(),
    elementor: Object.fromEntries(Object.entries(value.elementor || {}).map(([key, color]) => [key, String(color).toLowerCase()])) as ColorProfile["elementor"],
    ...(custom.length ? { custom } : {})
  };
}

export function validateDesignSystem(system: DesignSystem, typography: TypographyProfile, colors: ColorProfile, fonts: FontAsset[]): ValidationReport {
  const issues: ValidationIssue[] = [...validateTypographyProfile(typography).issues, ...validateColorProfile(colors).issues];
  validateId(system.id, "id", issues);
  if (typeof system.name !== "string" || !system.name.trim()) issue(issues, "name", "missing_name", "A design-system name is required.");
  validateId(system.typographyProfileId, "typographyProfileId", issues);
  validateId(system.colorProfileId, "colorProfileId", issues);
  if (system.typographyProfileId !== typography.id) issue(issues, "typographyProfileId", "profile_mismatch", "Design system typography profile does not match the selected profile.");
  if (system.colorProfileId !== colors.id) issue(issues, "colorProfileId", "profile_mismatch", "Design system color profile does not match the selected profile.");
  const fontById = new Map(fonts.map((font) => [font.id, font]));
  const tokens = [...Object.entries(typography.roles || {}), ...Object.entries(typography.custom || {})].filter((entry): entry is [string, TypographyToken] => Boolean(entry[1]));
  for (const [tokenName, token] of tokens) if (!system.fontBindings?.[token.fontRole]) issue(issues, `typography.${tokenName}.fontRole`, "font_binding_missing", `Font slot ${typography.fontSlots?.[token.fontRole]?.name || token.fontRole} has no font assignment.`);
  for (const [role, fontId] of Object.entries(system.fontBindings || {})) {
    if (!ID_PATTERN.test(role)) issue(issues, `fontBindings.${role}`, "invalid_font_slot", "Font slot IDs must use lowercase identifier characters.");
    validateId(fontId, `fontBindings.${role}`, issues);
    const font = fontById.get(fontId);
    if (!font) {
      issue(issues, `fontBindings.${role}`, "font_asset_missing", `Font asset ${fontId} is not available.`);
      continue;
    }
    const requested = [...Object.values(typography.roles || {}), ...Object.values(typography.custom || {})]
      .filter((token): token is TypographyToken => Boolean(token) && token.fontRole === role);
    const faces = new Set(font.faces.map((face) => `${face.weight}:${face.style}`));
    for (const token of requested) if (!faces.has(`${token.weight}:${token.style || "normal"}`)) issue(issues, `fontBindings.${role}`, "font_face_missing", `Font profile ${font.name} does not provide ${token.weight} ${token.style || "normal"} required by ${role}.`);
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
      colors: { ...colors.elementor, ...(colors.semantic || {}), ...Object.fromEntries((colors.custom || []).map((token) => [token.id, token.value])) },
      colorNames: { primary: "Primary", secondary: "Secondary", text: "Text", accent: "Accent", ...Object.fromEntries(Object.keys(colors.semantic || {}).map((id) => [id, id.replace(/[-_]+/g, " ")])), ...Object.fromEntries((colors.custom || []).map((token) => [token.id, token.name])) },
      typography: { ...(typography.roles || {}), ...(typography.custom || {}) } as VNextBuildPayload["designSystem"]["typography"],
      typographyNames: { body: "Body", links: "Links", h1: "H1", h2: "H2", h3: "H3", h4: "H4", h5: "H5", h6: "H6", buttons: "Buttons", formFields: "Form Fields", ...(typography.customRoleNames || {}) },
      resources: {
        typography: { id: typography.id, sha256: resourceHash(typography) },
        colors: { id: colors.id, sha256: resourceHash(colors) }
      }
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
  async get(id: string): Promise<T> {
    const value = (await this.load()).find((entry) => entry.id === id);
    if (!value) throw new BuilderError("vnext_resource_not_found", `${this.filename} does not contain resource ${id}.`);
    return value;
  }
  async save(value: T): Promise<T> {
    const records = await this.load();
    const index = records.findIndex((item) => item.id === value.id);
    if (index >= 0) records[index] = value; else records.push(value);
    records.sort((left, right) => left.id.localeCompare(right.id));
    await ensureDir(this.root);
    await writeJson(path.join(this.root, this.filename), records);
    return value;
  }
  async remove(id: string): Promise<T> {
    const records = await this.load();
    const index = records.findIndex((entry) => entry.id === id);
    if (index < 0) throw new BuilderError("vnext_resource_not_found", `${this.filename} does not contain resource ${id}.`);
    const [removed] = records.splice(index, 1);
    await writeJson(path.join(this.root, this.filename), records);
    return removed;
  }
}

export interface ResolvedDesignSystem {
  system: DesignSystem;
  typography: TypographyProfile;
  colors: ColorProfile;
  fontProfiles: ResolvedFontSystem[];
  payload: VNextBuildPayload;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  return value;
}

export function resourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export type VNextResourceKind = "typography" | "colors" | "designSystems";

export class DesignSystemResourceService {
  public readonly libraryRoot: string;
  public readonly resourceRoot: string;
  readonly typography: VNextResourceRegistry<TypographyProfile>;
  readonly colors: VNextResourceRegistry<ColorProfile>;
  readonly designSystems: VNextResourceRegistry<DesignSystem>;

  constructor(libraryRoot: string) {
    this.libraryRoot = path.resolve(libraryRoot);
    this.resourceRoot = path.join(this.libraryRoot, "vnext");
    this.typography = new VNextResourceRegistry(this.resourceRoot, "typography.json");
    this.colors = new VNextResourceRegistry(this.resourceRoot, "colors.json");
    this.designSystems = new VNextResourceRegistry(this.resourceRoot, "design-systems.json");
  }

  async saveTypography(value: TypographyProfile): Promise<TypographyProfile> {
    const normalized = normalizeTypographyProfile({ ...value, id: value.id || this.generatedId("typography", value.name) });
    await this.assertUniqueName(this.typography, normalized.id, normalized.name, "typography profile");
    for (const system of (await this.designSystems.list()).filter((entry) => entry.typographyProfileId === normalized.id)) await this.resolveValue(system, [], normalized);
    return this.typography.save(normalized);
  }

  async saveColors(value: ColorProfile): Promise<ColorProfile> {
    const normalized: ColorProfile = normalizeColorProfile({ ...value, id: String(value.id || this.generatedId("colors", value.name)).trim() });
    assertValidReport(validateColorProfile(normalized));
    await this.assertUniqueName(this.colors, normalized.id, normalized.name, "color profile");
    for (const system of (await this.designSystems.list()).filter((entry) => entry.colorProfileId === normalized.id)) await this.resolveValue(system, [], undefined, normalized);
    return this.colors.save(normalized);
  }

  async saveDesignSystem(value: DesignSystem): Promise<DesignSystem> {
    const normalized: DesignSystem = {
      schemaVersion: VNEXT_SCHEMA_VERSION,
      id: String(value.id || this.generatedId("design-system", value.name)).trim(), name: String(value.name || "").trim(),
      typographyProfileId: String(value.typographyProfileId || "").trim(), colorProfileId: String(value.colorProfileId || "").trim(),
      fontBindings: Object.fromEntries(Object.entries(value.fontBindings || {}).map(([role, id]) => [role.trim(), String(id).trim()]))
    };
    await this.resolveValue(normalized);
    await this.assertUniqueName(this.designSystems, normalized.id, normalized.name, "design system");
    return this.designSystems.save(normalized);
  }

  async resolve(id: string, templates: PortableTemplate[] = []): Promise<ResolvedDesignSystem> {
    return this.resolveValue(await this.designSystems.get(id), templates);
  }

  private async resolveValue(system: DesignSystem, templates: PortableTemplate[] = [], typographyOverride?: TypographyProfile, colorsOverride?: ColorProfile): Promise<ResolvedDesignSystem> {
    const typography = typographyOverride || normalizeTypographyProfile(await this.typography.get(system.typographyProfileId));
    const colors = colorsOverride || normalizeColorProfile(await this.colors.get(system.colorProfileId));
    const uniqueIds = [...new Set(Object.values(system.fontBindings || {}))];
    const fontProfiles = await Promise.all(uniqueIds.map((id) => new FontSystemRegistry(this.libraryRoot).resolve(id)));
    const assets = fontProfiles.map((font) => fontAssetFromLegacy(font.id, font.name, font.faces[0]?.family || font.name, font.faces));
    assertValidReport(validateDesignSystem(system, typography, colors, assets), "invalid_vnext_design_system");
    return { system, typography, colors, fontProfiles, payload: compileVNextPayload(system, typography, colors, assets, templates) };
  }

  async remove(kind: VNextResourceKind, id: string): Promise<TypographyProfile | ColorProfile | DesignSystem> {
    if (kind === "typography" || kind === "colors") {
      const systems = await this.designSystems.list();
      const references = systems.filter((system) => kind === "typography" ? system.typographyProfileId === id : system.colorProfileId === id);
      if (references.length) throw new BuilderError("vnext_resource_in_use", `Resource ${id} is referenced by design system(s): ${references.map((entry) => entry.id).join(", ")}.`);
      return kind === "typography" ? this.typography.remove(id) : this.colors.remove(id);
    }
    const profilesDir = path.join(this.libraryRoot, "profiles");
    if (await exists(profilesDir)) {
      for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const profile = JSON.parse(await readFile(path.join(profilesDir, entry.name), "utf8"));
          if (profile?.schemaVersion === 8 && profile?.designSystem?.id === id) throw new BuilderError("vnext_resource_in_use", `Design system ${id} is referenced by profile ${entry.name}.`);
        } catch (error) {
          if (error instanceof BuilderError) throw error;
        }
      }
    }
    return this.designSystems.remove(id);
  }

  async assertFontNotReferenced(id: string): Promise<void> {
    const references = (await this.designSystems.list()).filter((system) => Object.values(system.fontBindings || {}).includes(id));
    if (references.length) throw new BuilderError("font_system_in_use", `Font profile ${id} is referenced by design system(s): ${references.map((entry) => entry.id).join(", ")}.`);
  }

  private generatedId(kind: string, name: string): string {
    const slug = String(name || kind).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || kind;
    return `${slug}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  }

  private async assertUniqueName<T extends { id: string; name?: string }>(registry: VNextResourceRegistry<T>, id: string, name: string, label: string): Promise<void> {
    const duplicate = (await registry.list()).find((entry) => entry.id !== id && String(entry.name || "").trim().toLowerCase() === name.trim().toLowerCase());
    if (duplicate) throw new BuilderError("duplicate_resource_name", `Another ${label} is already named ${name}.`);
  }
}

export function fontAssetFromLegacy(id: string, name: string, family: string, faces: FontFaceRecord[]): FontAsset {
  return { schemaVersion: VNEXT_SCHEMA_VERSION, id, name, family, faces };
}
