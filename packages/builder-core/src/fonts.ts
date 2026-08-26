import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, sha256File, writeJson } from "./fs-utils.js";
import { defaultLibraryDir } from "./registry.js";
import type { FontFaceRecord, FontRegistryFile, FontStyle, FontSystemRecord, ResolvedFontSystem } from "./types.js";

const FONT_EXTENSION = ".woff2";
const GENERIC_FONT_DIRS = new Set([
  "woff2", "font", "fonts", "webfont", "webfonts", "web", "static", "desktop",
  "files", "file", "assets", "asset", "pro", "free"
]);

function safeId(value: string): string {
  const result = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (result) return result;
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `font-${hash}`;
}

function titleFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return normalizeFamilyName(base);
}

function normalizeFamilyName(value: string): string {
  let result = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // Common Persian-font variant tokens are usually written as a single suffix.
  result = result
    .replace(/\bFa\s+Num\b/gi, "FaNum")
    .replace(/\bNo\s+En\b/gi, "NoEn")
    .replace(/\bFa\s+En\b/gi, "FaEn")
    .replace(/\bEn\s+Num\b/gi, "EnNum")
    .replace(/\s+/g, " ")
    .trim();
  return result;
}

function parseStyle(name: string): FontStyle {
  const normalized = path.basename(name, path.extname(name)).toLowerCase();
  if (/(^|[-_\s])oblique($|[-_\s])/.test(normalized)) return "oblique";
  if (/(^|[-_\s])italic($|[-_\s])/.test(normalized)) return "italic";
  return "normal";
}

function parseWeight(name: string): number {
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, "");
  const numeric = normalized.match(/(?:^|[^0-9])(?:w)?([1-9]00)(?:[^0-9]|$)/);
  if (numeric) return Number(numeric[1]);
  const weights: Array<[RegExp, number]> = [
    [/(thin|hairline)/, 100],
    [/(extralight|ultralight)/, 200],
    [/(light)/, 300],
    [/(regular|normal|book|roman)/, 400],
    [/(medium)/, 500],
    [/(semibold|demibold)/, 600],
    [/(extrabold|ultrabold)/, 800],
    [/(black|heavy|extrablack|ultrablack)/, 900],
    [/(bold)/, 700]
  ];
  for (const [pattern, weight] of weights) if (pattern.test(normalized)) return weight;
  return 400;
}

function looksVariable(name: string): boolean {
  const n = path.basename(name, path.extname(name)).toLowerCase();
  return /(?:^|[-_\s])(variable|vf)(?:$|[-_\s])/.test(n) || /\[[^\]]*(wght|wdth)[^\]]*\]/i.test(n);
}

function deriveFamilyFromFilename(filename: string): string {
  let base = path.basename(filename, path.extname(filename));
  base = base
    .replace(/\[[^\]]+\]/g, "")
    .replace(/(?:^|[-_\s])(?:thin|hairline|extra[-_\s]?light|ultra[-_\s]?light|light|regular|normal|book|roman|medium|semi[-_\s]?bold|demi[-_\s]?bold|bold|extra[-_\s]?bold|ultra[-_\s]?bold|black|heavy|extra[-_\s]?black|ultra[-_\s]?black|italic|oblique|variable|vf|w?[1-9]00)(?=$|[-_\s])/gi, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeFamilyName(base || path.basename(filename, path.extname(filename)));
}

function isGenericDirectory(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return GENERIC_FONT_DIRS.has(normalized) || /^w(?:off)?2?$/.test(normalized) || /^ttf$|^otf$/.test(normalized);
}

function deriveFamily(filename: string, relative: string): string {
  const filenameFamily = deriveFamilyFromFilename(filename);
  const compactFilenameFamily = filenameFamily.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const directories = relative.split("/").slice(0, -1).filter(Boolean);
  for (let i = directories.length - 1; i >= 0; i--) {
    const candidate = directories[i].trim();
    if (!candidate || isGenericDirectory(candidate)) continue;
    // Do not use obvious weight/style-only folders as family names.
    if (/^(thin|hairline|extra\s*light|ultra\s*light|light|regular|normal|book|roman|medium|semi\s*bold|demi\s*bold|bold|extra\s*bold|ultra\s*bold|black|heavy|italic|oblique)$/i.test(candidate)) continue;
    const normalized = normalizeFamilyName(candidate);
    const compactCandidate = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "");
    // Folder names are trusted as the prettier display name only when they actually
    // describe the family inferred from the WOFF2 filename. This avoids folders such
    // as "copy", "old", or "backup" accidentally becoming font-family names.
    if (compactCandidate && (compactCandidate === compactFilenameFamily || compactFilenameFamily.startsWith(compactCandidate) || compactCandidate.startsWith(compactFilenameFamily))) {
      return normalized;
    }
  }
  return filenameFamily;
}

async function detectFace(file: string, relative: string): Promise<{ face?: Omit<FontFaceRecord, "file" | "sha256">; skip?: string }> {
  if (path.extname(file).toLowerCase() !== FONT_EXTENSION) return { skip: "Only WOFF2 font files are used." };

  const filename = path.basename(file);
  if (looksVariable(filename)) {
    return { skip: "Variable WOFF2 font detected. This release creates static Elementor Pro font faces only." };
  }

  return {
    face: {
      family: deriveFamily(filename, relative),
      weight: parseWeight(filename),
      style: parseStyle(filename),
      format: "woff2",
      filename,
      variable: false
    }
  };
}

async function findWoff2Files(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__MACOSX" || entry.name.startsWith(".")) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await findWoff2Files(root, target));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === FONT_EXTENSION) result.push(target);
  }
  return result;
}

interface FaceCandidate {
  file: string;
  relative: string;
  face: Omit<FontFaceRecord, "file" | "sha256">;
}

function candidateRank(candidate: FaceCandidate): string {
  // Prefer the shallowest/shortest path and then lexical order for deterministic duplicate resolution.
  const depth = candidate.relative.split("/").length.toString().padStart(4, "0");
  return `${depth}:${candidate.relative.length.toString().padStart(6, "0")}:${candidate.relative.toLowerCase()}`;
}

export class FontSystemRegistry {
  public readonly root: string;
  private readonly registryFile: string;

  constructor(root = defaultLibraryDir()) {
    this.root = path.resolve(root);
    this.registryFile = path.join(this.root, "fonts.json");
  }

  private async load(): Promise<FontRegistryFile> {
    if (!(await exists(this.registryFile))) return { schemaVersion: 1, systems: [] };
    try {
      const parsed = JSON.parse(await readFile(this.registryFile, "utf8")) as FontRegistryFile;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.systems)) throw new Error("Unsupported font registry schema.");
      return parsed;
    } catch (error) {
      throw new BuilderError("invalid_font_registry", `Could not parse fonts.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async save(registry: FontRegistryFile): Promise<void> {
    await ensureDir(this.root);
    await writeJson(this.registryFile, registry);
  }

  async add(zipPath: string, options: { id?: string; name?: string; replace?: boolean } = {}): Promise<FontSystemRecord[]> {
    const absolute = path.resolve(zipPath);
    if (!(await exists(absolute)) || path.extname(absolute).toLowerCase() !== ".zip") {
      throw new BuilderError("invalid_font_system", "Font profile input must be a ZIP file.");
    }

    const sourceFilename = path.basename(absolute);
    const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-fonts-"));
    try {
      await extractZip(absolute, temp);
      const files = await findWoff2Files(temp);
      if (!files.length) throw new BuilderError("font_files_missing", "No .woff2 font files were found in the font ZIP.");

      const candidates: FaceCandidate[] = [];
      const skippedByFamily = new Map<string, FontSystemRecord["skipped"]>();
      for (const file of files.sort()) {
        const relative = path.relative(temp, file).split(path.sep).join("/");
        const detected = await detectFace(file, relative);
        const fallbackFamily = deriveFamily(path.basename(file), relative);
        if (!detected.face) {
          const list = skippedByFamily.get(fallbackFamily) || [];
          list.push({ filename: relative, reason: detected.skip || "Could not inspect WOFF2 font." });
          skippedByFamily.set(fallbackFamily, list);
          continue;
        }
        candidates.push({ file, relative, face: detected.face });
      }

      if (!candidates.length) throw new BuilderError("font_faces_missing", "No supported static WOFF2 font faces remained after inspection.");

      const grouped = new Map<string, FaceCandidate[]>();
      for (const candidate of candidates) {
        const family = normalizeFamilyName(candidate.face.family);
        candidate.face.family = family;
        const list = grouped.get(family) || [];
        list.push(candidate);
        grouped.set(family, list);
      }

      if (options.name && grouped.size > 1) {
        throw new BuilderError("font_profile_name_ambiguous", "--name can only be used when the ZIP contains one detected font family. Multi-family ZIPs are automatically split into named font profiles.");
      }

      const registry = await this.load();
      const replace = options.replace === true;
      const records: FontSystemRecord[] = [];

      // Re-importing the same archive with replacement removes its previous generated profiles,
      // including the legacy alpha.18 one-big-system record.
      if (replace) {
        const sameSource = registry.systems.filter((entry) => entry.sourceFilename.toLowerCase() === sourceFilename.toLowerCase());
        for (const old of sameSource) {
          registry.systems = registry.systems.filter((entry) => entry.id !== old.id);
          await rm(path.join(this.root, "fonts", old.id), { recursive: true, force: true });
        }
      }

      for (const [detectedFamily, familyCandidates] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const name = normalizeFamilyName(options.name || detectedFamily);
        const id = safeId(options.id && grouped.size === 1 ? options.id : name);
        const existingIndex = registry.systems.findIndex((entry) => entry.id === id);
        if (existingIndex >= 0 && !replace) {
          throw new BuilderError("font_system_conflict", `Font profile ${name} (${id}) already exists. Re-import with replacement enabled to update it.`);
        }

        const systemDir = path.join(this.root, "fonts", id);
        await rm(systemDir, { recursive: true, force: true });
        await ensureDir(systemDir);

        const selected = new Map<string, FaceCandidate>();
        const duplicateNotes: FontSystemRecord["skipped"] = [];
        for (const candidate of familyCandidates) {
          const slot = `${candidate.face.weight}:${candidate.face.style}`;
          const previous = selected.get(slot);
          if (!previous || candidateRank(candidate) < candidateRank(previous)) {
            if (previous) duplicateNotes.push({ filename: previous.relative, reason: `Duplicate ${candidate.face.weight} ${candidate.face.style} WOFF2 face; a preferred copy was kept.` });
            selected.set(slot, candidate);
          } else {
            duplicateNotes.push({ filename: candidate.relative, reason: `Duplicate ${candidate.face.weight} ${candidate.face.style} WOFF2 face; ignored.` });
          }
        }

        const faces: FontFaceRecord[] = [];
        const usedNames = new Set<string>();
        for (const candidate of [...selected.values()].sort((a, b) => a.face.weight - b.face.weight || a.face.style.localeCompare(b.face.style))) {
          let storedName = path.basename(candidate.file).replace(/[^A-Za-z0-9._-]+/g, "_");
          if (usedNames.has(storedName.toLowerCase())) {
            storedName = `${path.basename(storedName, path.extname(storedName))}-${candidate.face.weight}-${candidate.face.style}.woff2`;
          }
          usedNames.add(storedName.toLowerCase());
          const stored = path.join(systemDir, storedName);
          await copyFile(candidate.file, stored);
          faces.push({
            ...candidate.face,
            family: name,
            filename: storedName,
            file: path.relative(this.root, stored).split(path.sep).join("/"),
            sha256: await sha256File(stored)
          });
        }

        const skipped = [...(skippedByFamily.get(detectedFamily) || []), ...duplicateNotes];
        const record: FontSystemRecord = { id, name, sourceFilename, addedAt: new Date().toISOString(), faces, skipped };
        if (existingIndex >= 0) registry.systems[existingIndex] = record;
        else registry.systems.push(record);
        records.push(record);
        await writeJson(path.join(systemDir, "font-system.json"), record);
      }

      registry.systems.sort((a, b) => a.name.localeCompare(b.name));
      await this.save(registry);
      return records;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async list(): Promise<FontSystemRecord[]> {
    return (await this.load()).systems;
  }

  async resolve(id: string): Promise<ResolvedFontSystem> {
    const system = (await this.load()).systems.find((entry) => entry.id === id);
    if (!system) throw new BuilderError("font_system_not_found", `Font profile ${id} is not present in ${this.root}`);
    const faces = [];
    for (const face of system.faces) {
      if (face.format !== "woff2") throw new BuilderError("font_format_unsupported", `Font profile ${system.name} contains legacy ${face.format.toUpperCase()} data. Re-import the original ZIP with the current Builder to create WOFF2-only profiles.`);
      const absoluteFile = path.join(this.root, face.file);
      if (!(await exists(absoluteFile))) throw new BuilderError("font_file_missing", `Font file is missing: ${absoluteFile}`);
      if (await sha256File(absoluteFile) !== face.sha256) throw new BuilderError("font_checksum_mismatch", `Font file checksum mismatch: ${face.filename}`);
      faces.push({ ...face, absoluteFile });
    }
    return { ...system, faces };
  }

  async remove(id: string): Promise<FontSystemRecord> {
    const registry = await this.load();
    const index = registry.systems.findIndex((entry) => entry.id === id);
    if (index < 0) throw new BuilderError("font_system_not_found", `Font profile ${id} is not present.`);
    const [system] = registry.systems.splice(index, 1);
    await rm(path.join(this.root, "fonts", id), { recursive: true, force: true });
    await this.save(registry);
    return system;
  }
}
