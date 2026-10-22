import { BuilderError } from "./errors.js";

export interface AcfField { key: string; name: string; label: string; type: string; sub_fields?: AcfField[]; layouts?: Array<{ key: string; name: string; label: string; sub_fields: AcfField[] }>; [key: string]: unknown; }
export interface AcfGroup { key: string; title: string; fields: AcfField[]; location: Array<Array<{ param: "post_type"; operator: "=="; value: "post" | "product" }>>; }
export interface AcfContent { groups: AcfGroup[]; values: Record<string, unknown>; }
export interface AcfReference { $siteRef: "asset" | "content" | "term"; id: string; }
export function acfReferences(value: unknown): AcfReference[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(acfReferences);
  const row = value as Record<string, unknown>;
  if ("$siteRef" in row) return [row as unknown as AcfReference];
  return Object.values(row).flatMap(acfReferences);
}
const types = new Set(["text", "textarea", "number", "range", "email", "url", "wysiwyg", "select", "checkbox", "radio", "button_group", "true_false", "date_picker", "date_time_picker", "time_picker", "color_picker", "link", "file", "image", "gallery", "post_object", "relationship", "taxonomy", "group", "repeater", "flexible_content", "tab", "accordion", "message"]);
const settings = new Set(["key", "name", "label", "type", "instructions", "required", "choices", "return_format", "multiple", "allow_null", "ui", "ajax", "min", "max", "step", "prepend", "append", "placeholder", "maxlength", "rows", "new_lines", "toolbar", "media_upload", "tabs", "display_format", "first_day", "layout", "button_label", "collapsed", "min_width", "min_height", "max_width", "max_height", "min_size", "max_size", "mime_types", "preview_size", "library", "post_type", "taxonomy", "field_type", "save_terms", "load_terms", "add_term", "filters", "elements", "sub_fields", "layouts", "conditional_logic", "wrapper", "message", "esc_html", "endpoint", "placement"]);
export function normalizeAcf(raw: unknown): AcfContent | undefined {
  if (raw === undefined) return undefined;
  const fail = (message: string): never => { throw new BuilderError("invalid_site_acf", message); };
  const json = (value: unknown, depth = 0): unknown => {
    if (depth > 30) fail("ACF nesting exceeds 30 levels.");
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value === "string") { if (value.length > 1000000 || value.includes("\0")) fail("Invalid ACF text."); return value; }
    if (Array.isArray(value)) { if (value.length > 10000) fail("Too many ACF values."); return value.map(v => json(v, depth + 1)); }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (Object.keys(row).some(k => ["__proto__", "constructor", "prototype"].includes(k))) fail("Reserved ACF key.");
      if ("$siteRef" in row && (! ["asset", "content", "term"].includes(String(row.$siteRef)) || !/^[a-z][a-z0-9-]{0,79}$/.test(String(row.id)) || Object.keys(row).length !== 2)) fail("Invalid ACF reference.");
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, json(v, depth + 1)]));
    }
    return fail("Invalid ACF value.");
  };
  const fieldKeys = new Set<string>();
  const field = (r: any, depth = 0): AcfField => {
    if (depth > 20 || !r || !/^field_[a-zA-Z0-9_-]+$/.test(r.key) || typeof r.name !== "string" || typeof r.label !== "string" || !types.has(r.type) || Object.keys(r).some(k => !settings.has(k))) fail("Unsupported ACF field definition.");
    if (fieldKeys.has(r.key)) fail("Duplicate ACF field key.");
    fieldKeys.add(r.key);
    if (r.name.startsWith("_") || /password|secret|token|credential|api[_-]?key/i.test(r.name)) fail("Credential or reserved metadata fields cannot be exported as ACF content.");
    const out = json(r) as AcfField;
    if (r.sub_fields !== undefined) { if (!Array.isArray(r.sub_fields)) fail("Invalid ACF subfields."); out.sub_fields = r.sub_fields.map((f: unknown) => field(f, depth + 1)); }
    if (r.layouts !== undefined) {
      if (!Array.isArray(r.layouts)) fail("Invalid ACF layouts.");
      out.layouts = r.layouts.map((l: any) => { if (!l || !/^layout_[a-zA-Z0-9_-]+$/.test(l.key) || typeof l.name !== "string" || typeof l.label !== "string" || !Array.isArray(l.sub_fields) || Object.keys(l).some(k => !["key", "name", "label", "sub_fields", "display", "min", "max"].includes(k))) fail("Invalid ACF layout."); return { ...l, sub_fields: l.sub_fields.map((f: unknown) => field(f, depth + 1)) }; });
    }
    return out;
  };
  const r = raw as any;
  if (!r || !Array.isArray(r.groups) || !r.values || typeof r.values !== "object" || Array.isArray(r.values) || Object.keys(r).some(k => !["groups", "values"].includes(k))) fail("Invalid ACF content.");
  const keys = new Set<string>();
  const groups: AcfGroup[] = r.groups.map((g: any) => {
    if (!g || !/^group_[a-zA-Z0-9_-]+$/.test(g.key) || typeof g.title !== "string" || !Array.isArray(g.fields) || !Array.isArray(g.location) || !g.location.length || Object.keys(g).some(k => !["key", "title", "fields", "location"].includes(k))) fail("Invalid ACF field group.");
    const fields = g.fields.map((f: unknown) => field(f));
    for (const f of fields) { if (keys.has(f.key)) fail("Duplicate ACF field key."); keys.add(f.key); }
    for (const rules of g.location) { if (!Array.isArray(rules) || !rules.length) fail("Invalid ACF location."); for (const rule of rules) if (rule.param !== "post_type" || rule.operator !== "==" || !["post", "product"].includes(rule.value) || Object.keys(rule).length !== 3) fail("Only portable post/product ACF locations are supported."); }
    return { key: g.key, title: g.title, fields, location: g.location };
  });
  if (Object.keys(r.values).some(k => !keys.has(k))) fail("ACF values must reference exported field keys.");
  return { groups, values: json(r.values) as Record<string, unknown> };
}
