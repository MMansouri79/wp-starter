import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./archive.js";
import { BuilderError } from "./errors.js";
import { ensureDir, exists, sha256File, writeJson } from "./fs-utils.js";
import { defaultLibraryDir } from "./registry.js";
import type { FontFaceRecord, FontFormat, FontRegistryFile, FontStyle, FontSystemRecord, ResolvedFontSystem } from "./types.js";

const FONT_EXTENSIONS = new Set<FontFormat>(["woff2", "woff", "ttf", "otf"]);

function safeId(value: string): string {
  const result = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!result) throw new BuilderError("invalid_font_system", "Font system name could not be converted into a safe identifier.");
  return result;
}

function titleFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
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

function deriveFamily(filename: string): string {
  let base = path.basename(filename, path.extname(filename));
  base = base
    .replace(/\[[^\]]+\]/g, "")
    .replace(/(?:^|[-_\s])(?:thin|hairline|extra[-_\s]?light|ultra[-_\s]?light|light|regular|normal|book|roman|medium|semi[-_\s]?bold|demi[-_\s]?bold|bold|extra[-_\s]?bold|ultra[-_\s]?bold|black|heavy|extra[-_\s]?black|ultra[-_\s]?black|italic|oblique|variable|vf|w?[1-9]00)(?=$|[-_\s])/gi, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || titleFromFilename(filename);
}

function decodeUtf16Be(buffer: Buffer): string {
  const swapped = Buffer.alloc(buffer.length);
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString("utf16le").replace(/\0/g, "").trim();
}

function parseSfntMetadata(buffer: Buffer): { family?: string; weight?: number; italic?: boolean; variable?: boolean } {
  if (buffer.length < 12) return {};
  const signature = buffer.toString("ascii", 0, 4);
  if (!["OTTO", "true", "typ1"].includes(signature) && buffer.readUInt32BE(0) !== 0x00010000) return {};
  const numTables = buffer.readUInt16BE(4);
  if (12 + numTables * 16 > buffer.length) return {};
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const pos = 12 + i * 16;
    const tag = buffer.toString("ascii", pos, pos + 4);
    const offset = buffer.readUInt32BE(pos + 8);
    const length = buffer.readUInt32BE(pos + 12);
    if (offset + length <= buffer.length) tables.set(tag, { offset, length });
  }

  const result: { family?: string; weight?: number; italic?: boolean; variable?: boolean } = {};
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    result.weight = Math.min(900, Math.max(100, Math.round(buffer.readUInt16BE(os2.offset + 4) / 100) * 100));
    if (os2.length >= 64) {
      const fsSelection = buffer.readUInt16BE(os2.offset + 62);
      result.italic = (fsSelection & 0x1) !== 0;
    }
  }
  result.variable = tables.has("fvar");

  const name = tables.get("name");
  if (name && name.length >= 6) {
    const base = name.offset;
    const count = buffer.readUInt16BE(base + 2);
    const stringOffset = buffer.readUInt16BE(base + 4);
    let best: { priority: number; text: string } | undefined;
    for (let i = 0; i < count; i++) {
      const pos = base + 6 + i * 12;
      if (pos + 12 > base + name.length) break;
      const platform = buffer.readUInt16BE(pos);
      const language = buffer.readUInt16BE(pos + 4);
      const nameId = buffer.readUInt16BE(pos + 6);
      const length = buffer.readUInt16BE(pos + 8);
      const offset = buffer.readUInt16BE(pos + 10);
      if (![1, 16].includes(nameId)) continue;
      const start = base + stringOffset + offset;
      if (start + length > base + name.length || length === 0) continue;
      const raw = buffer.subarray(start, start + length);
      const text = platform === 0 || platform === 3 ? decodeUtf16Be(raw) : raw.toString("latin1").trim();
      if (!text) continue;
      const priority = (nameId === 16 ? 100 : 50) + (platform === 3 ? 10 : 0) + (language === 0x0409 ? 5 : 0);
      if (!best || priority > best.priority) best = { priority, text };
    }
    if (best) result.family = best.text;
  }
  return result;
}

async function detectFace(file: string, relative: string): Promise<{ face?: Omit<FontFaceRecord, "file" | "sha256">; skip?: string }> {
  const ext = path.extname(file).slice(1).toLowerCase() as FontFormat;
  if (!FONT_EXTENSIONS.has(ext)) return { skip: "Unsupported font format." };
  if (ext === "otf") return { skip: "OTF is not a native Elementor Pro custom-font upload field. Use WOFF2, WOFF or TTF for this release." };

  const filename = path.basename(file);
  let family = deriveFamily(filename);
  let weight = parseWeight(filename);
  let style = parseStyle(filename);
  let variable = looksVariable(filename);

  if (ext === "ttf" || ext === "otf") {
    try {
      const metadata = parseSfntMetadata(await readFile(file));
      if (metadata.family) family = metadata.family;
      if (metadata.weight) weight = metadata.weight;
      if (metadata.italic) style = "italic";
      if (metadata.variable) variable = true;
    } catch {
      // Filename analysis remains the fallback.
    }
  }

  if (variable) return { skip: "Variable font detected. Static faces are supported in this test release; variable ranges will be added separately." };
  return {
    face: {
      family,
      weight,
      style,
      format: ext,
      filename,
      variable: false
    }
  };
}

async function findFontFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__MACOSX" || entry.name.startsWith(".")) continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await findFontFiles(root, target));
    else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase() as FontFormat)) result.push(target);
  }
  return result;
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

  async add(zipPath: string, options: { id?: string; name?: string; replace?: boolean } = {}): Promise<FontSystemRecord> {
    const absolute = path.resolve(zipPath);
    if (!(await exists(absolute)) || path.extname(absolute).toLowerCase() !== ".zip") {
      throw new BuilderError("invalid_font_system", "Font system input must be a ZIP file.");
    }
    const defaultName = titleFromFilename(path.basename(absolute));
    const name = String(options.name || defaultName).trim() || defaultName;
    const id = safeId(options.id || name);
    const temp = await mkdtemp(path.join(os.tmpdir(), "wp-starter-fonts-"));
    try {
      await extractZip(absolute, temp);
      const files = await findFontFiles(temp);
      if (!files.length) throw new BuilderError("font_files_missing", "No .woff2, .woff, .ttf or .otf files were found in the font ZIP.");

      const registry = await this.load();
      const existingIndex = registry.systems.findIndex((entry) => entry.id === id);
      if (existingIndex >= 0 && !options.replace) throw new BuilderError("font_system_conflict", `Font system ${id} already exists. Remove it or import with replacement enabled.`);

      const systemDir = path.join(this.root, "fonts", id);
      await rm(systemDir, { recursive: true, force: true });
      await ensureDir(systemDir);
      const faces: FontFaceRecord[] = [];
      const skipped: FontSystemRecord["skipped"] = [];
      const usedNames = new Set<string>();

      for (const file of files.sort()) {
        const relative = path.relative(temp, file).split(path.sep).join("/");
        const detected = await detectFace(file, relative);
        if (!detected.face) {
          skipped.push({ filename: relative, reason: detected.skip || "Could not inspect font." });
          continue;
        }
        let storedName = path.basename(file).replace(/[^A-Za-z0-9._-]+/g, "_");
        if (usedNames.has(storedName.toLowerCase())) {
          storedName = `${path.basename(storedName, path.extname(storedName))}-${faces.length + 1}${path.extname(storedName)}`;
        }
        usedNames.add(storedName.toLowerCase());
        const stored = path.join(systemDir, storedName);
        await copyFile(file, stored);
        faces.push({
          ...detected.face,
          filename: storedName,
          file: path.relative(this.root, stored).split(path.sep).join("/"),
          sha256: await sha256File(stored)
        });
      }

      if (!faces.length) throw new BuilderError("font_faces_missing", "No supported static font faces remained after inspection.");
      faces.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style) || a.format.localeCompare(b.format));
      const record: FontSystemRecord = { id, name, sourceFilename: path.basename(absolute), addedAt: new Date().toISOString(), faces, skipped };
      if (existingIndex >= 0) registry.systems[existingIndex] = record;
      else registry.systems.push(record);
      registry.systems.sort((a, b) => a.name.localeCompare(b.name));
      await this.save(registry);
      await writeJson(path.join(systemDir, "font-system.json"), record);
      return record;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async list(): Promise<FontSystemRecord[]> {
    return (await this.load()).systems;
  }

  async resolve(id: string): Promise<ResolvedFontSystem> {
    const system = (await this.load()).systems.find((entry) => entry.id === id);
    if (!system) throw new BuilderError("font_system_not_found", `Font system ${id} is not present in ${this.root}`);
    const faces = [];
    for (const face of system.faces) {
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
    if (index < 0) throw new BuilderError("font_system_not_found", `Font system ${id} is not present.`);
    const [system] = registry.systems.splice(index, 1);
    await rm(path.join(this.root, "fonts", id), { recursive: true, force: true });
    await this.save(registry);
    return system;
  }
}
