import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compatibilityReport,
  createProfileFromPackages,
  createProfileFromSnapshot,
  loadProfile,
  sha256File,
  writeJson,
  type CompatibilityReport
} from "../core.js";
import type { ProfileDocumentV7, ProfileDocumentV8, ProfileDocumentV9 } from "../core.js";
import type { User } from "../types.js";
import { ProfileItemRepository, type ProfileDocument, type ProfileItem } from "../repositories/profiles.js";
import { badRequest, notFound } from "../errors.js";
import { safeFileName } from "../http/body.js";
import { SharedLibrary } from "./library.js";
import { assertCanWrite } from "./ownership.js";

export interface ProfileSummary {
  id: string;
  name: string;
  file: string;
  locale: string;
  wordpress: string;
  theme: string;
  plugins: number;
  config: string;
  fontSystem: string;
  fontSystems: string[];
  designSystem: string;
  elementorTemplates: number;
  sampleContent: number;
  updatedAt: string;
}

export interface SaveProfileResult {
  item: ProfileItem;
  profile: ProfileDocument;
  file: string;
  compatibility: CompatibilityReport;
}

/**
 * Build profiles are editable shared objects. Anyone may read or build from a
 * profile; only its creator may overwrite, rename, or delete it.
 */
export class ProfileService {
  constructor(private readonly library: SharedLibrary, private readonly items: ProfileItemRepository) {}

  async list(): Promise<ProfileItem[]> {
    return this.items.list();
  }

  summarize(item: ProfileItem): ProfileSummary {
    const document = item.document as Record<string, any>;
    const fontSystems = Array.isArray(document.fontSystems)
      ? document.fontSystems.map((font: any) => String(font?.id || "")).filter(Boolean)
      : document.fontSystem?.id
        ? [String(document.fontSystem.id)]
        : [];

    return {
      id: item.id,
      name: String(document.name || item.name),
      file: item.fileName,
      locale: String(document.locale || ""),
      wordpress: document.wordpress
        ? `${String(document.wordpress.version || "")}${document.wordpress.variant ? ` (${document.wordpress.variant})` : ""}`
        : "",
      theme: document.theme ? `${document.theme.slug}@${document.theme.version}` : "WordPress default",
      plugins: Array.isArray(document.plugins) ? document.plugins.length : 0,
      config: String(document.config?.id || ""),
      fontSystem: String(document.fontSystem?.id || ""),
      fontSystems,
      designSystem: String(document.designSystem?.id || ""),
      elementorTemplates: Array.isArray(document.elementorTemplateIds)
        ? document.elementorTemplateIds.length
        : Array.isArray(document.elementorTemplates)
          ? document.elementorTemplates.length
          : 0,
      sampleContent: Array.isArray(document.sampleContentIds) ? document.sampleContentIds.length : 0,
      updatedAt: item.updatedAt
    };
  }

  async get(fileName: string): Promise<{ item: ProfileItem; profile: ProfileDocument }> {
    const item = await this.items.requireByFileName(this.requireProfileFileName(fileName));
    await this.validate(item.fileName, item.document);
    return { item, profile: item.document };
  }

  async compatibilityForFile(fileName: string): Promise<CompatibilityReport> {
    const item = await this.items.requireByFileName(this.requireProfileFileName(fileName));
    return this.reportForDocument(item.document);
  }

  async previewCompatibility(body: Record<string, unknown>): Promise<CompatibilityReport> {
    const document = await this.buildDocument(body);
    return this.reportForDocument(document);
  }

  async save(body: Record<string, unknown>, user: User): Promise<SaveProfileResult> {
    const document = await this.buildDocument(body);
    const name = String(document.name || "profile");
    const fileName = `${safeFileName(name, "profile")}.json`;
    const sourceFile = path.basename(String(body.sourceFile || ""));

    const existing = await this.items.findByFileName(fileName);
    if (existing) assertCanWrite(existing, user, "replace");

    if (sourceFile && sourceFile.endsWith(".json") && sourceFile !== fileName) {
      const previous = await this.items.findByFileName(sourceFile);
      if (previous) assertCanWrite(previous, user, "rename");
    }

    await mkdir(this.library.profilesDir, { recursive: true });
    const target = path.join(this.library.profilesDir, fileName);
    await writeJson(target, document);

    if (sourceFile && sourceFile.endsWith(".json") && sourceFile !== fileName) {
      await rm(path.join(this.library.profilesDir, sourceFile), { force: true });
      await this.items.removeByFileName(sourceFile);
    }

    const item = await this.items.save({
      fileName,
      name,
      sha256: await sha256File(target),
      document,
      createdBy: user.id
    });

    return { item, profile: document, file: fileName, compatibility: await this.reportForDocument(document) };
  }

  async remove(fileName: string, user: User): Promise<ProfileItem> {
    const safe = this.requireProfileFileName(fileName);
    const item = await this.items.requireByFileName(safe);
    assertCanWrite(item, user, "delete");

    await rm(path.join(this.library.profilesDir, safe), { force: true });
    await this.items.remove(item.id);
    return item;
  }

  private requireProfileFileName(value: string): string {
    const safe = safeFileName(value, "");
    if (!safe || !safe.endsWith(".json")) throw badRequest("invalid_request", "A valid profile filename is required.");
    return safe;
  }

  private async validate(fileName: string, document: ProfileDocument): Promise<void> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-starter-server-profile-"));
    const tempProfile = path.join(tempDir, "profile.json");
    try {
      await writeFile(tempProfile, JSON.stringify(document));
      await loadProfile(tempProfile, { libraryDir: this.library.root });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    void fileName;
  }

  private async reportForDocument(document: ProfileDocument): Promise<CompatibilityReport> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wp-starter-server-report-"));
    const tempProfile = path.join(tempDir, "profile.json");
    try {
      await writeFile(tempProfile, JSON.stringify(document));
      const loaded = await loadProfile(tempProfile, { libraryDir: this.library.root });
      return compatibilityReport(loaded);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Mirrors the local GUI's profile editor: a snapshot-based profile when a
   * configuration id is supplied, otherwise a package-only profile.
   */
  private async buildDocument(body: Record<string, unknown>): Promise<ProfileDocumentV7 | ProfileDocumentV8 | ProfileDocumentV9> {
    const configId = String(body.configId || "").trim();
    const name = String(body.name || configId || "profile").trim();
    const locale = String(body.locale || "").trim() || "en_US";
    const pluginVersions = body.pluginVersions && typeof body.pluginVersions === "object" && !Array.isArray(body.pluginVersions)
      ? (body.pluginVersions as Record<string, string>)
      : {};
    const fontSystemIds = Array.isArray(body.fontSystemIds)
      ? body.fontSystemIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const elementorTemplateIds = Array.isArray(body.elementorTemplateIds) ? body.elementorTemplateIds : [];
    const elementorTemplateMappings =
      body.elementorTemplateMappings && typeof body.elementorTemplateMappings === "object" && !Array.isArray(body.elementorTemplateMappings)
        ? (body.elementorTemplateMappings as Record<string, string>)
        : {};
    const sampleContentIds = Array.isArray(body.sampleContentIds)
      ? body.sampleContentIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (configId) {
      return createProfileFromSnapshot(configId, {
        libraryDir: this.library.root,
        name,
        locale,
        excludePlugins: Array.isArray(body.excludedPlugins) ? body.excludedPlugins.map(String) : [],
        wordpressVersion: String(body.wordpressVersion || "").trim() || undefined,
        wordpressVariant: String(body.wordpressVariant || "").trim() || undefined,
        themeVersion: String(body.themeVersion || "").trim() || undefined,
        pluginVersions,
        fontSystemIds,
        fontSystemId: String(body.fontSystemId || "").trim() || null,
        designSystemId: String(body.designSystemId || "").trim() || null,
        elementorTemplates: Array.isArray(body.elementorTemplates) ? (body.elementorTemplates as never) : undefined,
        elementorTemplateIds,
        elementorTemplateMappings,
        sampleContentIds
      });
    }

    return createProfileFromPackages({
      libraryDir: this.library.root,
      name,
      locale,
      wordpressVersion: String(body.wordpressVersion || "").trim(),
      // A package-only profile always targets one WordPress variant. When the
      // caller does not choose one, the profile locale is the natural default.
      wordpressVariant: String(body.wordpressVariant || "").trim() || locale,
      themeSlug: String(body.themeSlug || "").trim() || null,
      themeVersion: String(body.themeVersion || "").trim() || null,
      plugins: pluginVersions,
      fontSystemIds,
      fontSystemId: String(body.fontSystemId || "").trim() || null,
      designSystemId: String(body.designSystemId || "").trim() || null,
      elementorTemplates: Array.isArray(body.elementorTemplates) ? (body.elementorTemplates as never) : undefined,
      elementorTemplateIds,
      elementorTemplateMappings,
      sampleContentIds
    });
  }
}

export function requireProfile(fileName: string): string {
  const safe = safeFileName(fileName, "");
  if (!safe || !safe.endsWith(".json")) throw notFound("profile_not_found", "That build profile is no longer in the shared library.");
  return safe;
}
