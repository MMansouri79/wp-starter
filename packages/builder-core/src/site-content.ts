import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { exists, writeJson } from "./fs-utils.js";
import { SampleContentRegistry, normalizeSampleContent, normalizeSampleTerm, normalizeSampleGlobalAttribute, validateSampleLibrary, type SampleContentLibrary, type ResolvedSampleContent } from "./sample-content.js";

export interface SiteContentSelection { posts: boolean; products: boolean; }
export function siteContentSelection(raw: unknown): SiteContentSelection {
  if (raw === undefined) return { posts: false, products: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BuilderError("invalid_profile", "siteContent must contain posts and products booleans.");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(k => !["posts", "products"].includes(k)) || typeof value.posts !== "boolean" || typeof value.products !== "boolean") throw new BuilderError("invalid_profile", "siteContent must contain only posts and products booleans.");
  return { posts: value.posts, products: value.products };
}

/** Separate opt-in content document; never merges source content into the sample library. */
export async function resolveSiteContent(root: string, selection: SiteContentSelection): Promise<ResolvedSampleContent> {
  const filename = path.join(root, "starter-site-content.json");
  if (!(await exists(filename))) throw new BuilderError("site_content_not_found", "This snapshot has no exported site content. Re-export with posts or products enabled.");
  let raw: any;
  try { raw = JSON.parse(await readFile(filename, "utf8")); } catch { throw new BuilderError("invalid_site_content", "Could not read starter-site-content.json."); }
  if (raw?.schemaVersion !== 1 || ![raw.content, raw.terms, raw.attributes, raw.assets].every(Array.isArray)) throw new BuilderError("invalid_site_content", "Unsupported site-content schema.");
  const library: SampleContentLibrary = {
    schemaVersion: 1,
    content: raw.content.map((r: any) => {
      if (!r || !["post", "product"].includes(r.kind) || typeof r.id !== "string" || !r.id.startsWith("site-")) throw new BuilderError("invalid_site_content", "Exported content requires namespaced IDs and a supported kind.");
      return normalizeSampleContent(r);
    }),
    terms: raw.terms.map((r: any) => normalizeSampleTerm(r)),
    attributes: raw.attributes.map((r: any) => normalizeSampleGlobalAttribute(r)),
    assets: raw.assets.map((r: any) => {
      if (!r || typeof r.id !== "string" || !/^asset-site-[a-z0-9-]+$/.test(r.id) || !/^sample-assets\/asset-site-[a-z0-9-]+\.(png|jpg|gif|webp|pdf|txt)$/.test(r.file) || !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.size) || r.size <= 0 || r.size > (r.kind === "image" ? 20 : 50) * 1024 ** 2 || !["image", "download", "document"].includes(r.kind) || ["filename", "mime", "alt", "caption", "description"].some(k => typeof r[k] !== "string")) throw new BuilderError("invalid_site_content", "Invalid exported asset metadata or path.");
      return { id: r.id, file: r.file, sha256: r.sha256, size: r.size, kind: r.kind, filename: r.filename, mime: r.mime, alt: r.alt, caption: r.caption, description: r.description };
    })
  };
  validateSampleLibrary(library);
  // Use a private registry under the extraction directory for dependency closure.
  await writeJson(path.join(root, "sample-content.json"), library);
  const registry = new SampleContentRegistry(root);
  const resolved = await registry.resolve(library.content.filter(r => r.kind === "post" ? selection.posts : selection.products).map(r => r.id));
  if (resolved.content.some(r => r.kind === "post" ? !selection.posts : !selection.products)) throw new BuilderError("site_content_selection_required", "ACF relationships reference the other content type. Enable both posts and products to include those relationships.");
  // Reuse signature validation too, without changing exported IDs or the source files.
  const validationRoot = await mkdtemp(path.join(os.tmpdir(), "wp-starter-site-assets-"));
  try {
    const validator = new SampleContentRegistry(validationRoot);
    for (const asset of resolved.assets) {
      if ((await stat(asset.absoluteFile)).size !== asset.size) throw new BuilderError("invalid_site_content", "Exported asset size mismatch.");
      const checked = await validator.importAsset(asset.absoluteFile, { kind: asset.kind, filename: asset.filename });
      if (checked.mime !== asset.mime) throw new BuilderError("invalid_site_content", "Exported asset MIME mismatch.");
    }
  } finally { await rm(validationRoot, { recursive: true, force: true }); }
  return resolved;
}

export async function inspectSiteContent(zip: string, selection: SiteContentSelection = { posts: true, products: true }): Promise<{ posts: number; products: number; acf: boolean; acfPro: boolean }> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-site-content-"));
  try {
    await extractZip(zip, temp);
    if (!(await exists(path.join(temp, "starter-site-content.json")))) return { posts: 0, products: 0, acf: false, acfPro: false };
    const content = await resolveSiteContent(temp, selection);
    return { posts: content.content.filter(r => r.kind === "post").length, products: content.content.filter(r => r.kind === "product").length, acf: content.content.some(r => r.acf?.groups.length), acfPro: content.content.some(r => /"type":"(?:repeater|flexible_content|gallery)"/.test(JSON.stringify(r.acf?.groups))) };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
