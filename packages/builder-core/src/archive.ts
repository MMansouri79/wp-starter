import { inflateRawSync, deflateRawSync } from "node:zlib";
import { open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BuilderError } from "./errors.js";
import { ensureDir } from "./fs-utils.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;
const MAX_ENTRIES = 200_000;
const MAX_UNCOMPRESSED_TOTAL = 4 * 1024 * 1024 * 1024;
const MAX_SINGLE_ENTRY = 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 2_000;

function validateEntryName(rawName: string): string {
  if (!rawName || rawName.includes("\0")) {
    throw new BuilderError("unsafe_archive", "ZIP contains an empty or invalid entry name.");
  }
  const normalized = rawName.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:\//.test(normalized)) {
    throw new BuilderError("unsafe_archive", `ZIP contains an absolute path: ${rawName}`);
  }
  const parts = normalized.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "..")) {
    throw new BuilderError("unsafe_archive", `ZIP contains a path traversal entry: ${rawName}`);
  }
  if (parts.some((part) => /[\u0000-\u001F]/.test(part))) {
    throw new BuilderError("unsafe_archive", `ZIP contains control characters in an entry name: ${rawName}`);
  }
  return normalized;
}

export interface ZipValidationSummary {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
}

/**
 * Validate central-directory metadata before an archive is handed to the OS
 * extractor. This prevents Zip Slip, encrypted payloads, symlinks and obvious
 * decompression bombs without adding a runtime npm dependency.
 */
export async function validateZipArchive(zipPath: string): Promise<ZipValidationSummary> {
  const absolute = path.resolve(zipPath);
  const info = await stat(absolute);
  if (!info.isFile() || info.size < 22) {
    throw new BuilderError("invalid_archive", "ZIP file is missing or too small to be valid.");
  }

  const handle = await open(absolute, "r");
  try {
    const tailSize = Math.min(info.size, MAX_EOCD_SEARCH);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, info.size - tailSize);

    let eocdOffset = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw new BuilderError("invalid_archive", "ZIP end-of-central-directory record was not found.");

    const disk = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
    const entries = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);

    if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) {
      throw new BuilderError("unsupported_archive", "Multi-disk ZIP archives are not supported.");
    }
    if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new BuilderError("unsupported_archive", "ZIP64 archives are not accepted by the starter package validator.");
    }
    if (entries > MAX_ENTRIES) {
      throw new BuilderError("unsafe_archive", `ZIP contains too many entries (${entries}).`);
    }
    if (centralOffset + centralSize > info.size) {
      throw new BuilderError("invalid_archive", "ZIP central directory points outside the archive.");
    }

    let cursor = centralOffset;
    let totalCompressed = 0;
    let totalUncompressed = 0;
    const header = Buffer.alloc(46);

    for (let index = 0; index < entries; index++) {
      const readHeader = await handle.read(header, 0, 46, cursor);
      if (readHeader.bytesRead !== 46 || header.readUInt32LE(0) !== CENTRAL_SIGNATURE) {
        throw new BuilderError("invalid_archive", `ZIP central directory entry ${index + 1} is malformed.`);
      }

      const madeBy = header.readUInt16LE(4);
      const flags = header.readUInt16LE(8);
      const compressed = header.readUInt32LE(20);
      const uncompressed = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const externalAttributes = header.readUInt32LE(38);
      const localOffset = header.readUInt32LE(42);

      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) {
        throw new BuilderError("unsupported_archive", "ZIP64 entries are not accepted by the starter package validator.");
      }
      if ((flags & 0x1) !== 0) {
        throw new BuilderError("unsafe_archive", "Encrypted ZIP entries are not accepted.");
      }
      if (nameLength <= 0 || nameLength > 32_768) {
        throw new BuilderError("unsafe_archive", "ZIP contains an unreasonable entry name length.");
      }

      const nameBuffer = Buffer.alloc(nameLength);
      const nameRead = await handle.read(nameBuffer, 0, nameLength, cursor + 46);
      if (nameRead.bytesRead !== nameLength) throw new BuilderError("invalid_archive", "ZIP entry name is truncated.");
      const rawName = nameBuffer.toString("utf8");
      const normalizedName = validateEntryName(rawName);

      // The high byte of "version made by" identifies the originating OS.
      // For UNIX archives the upper 16 bits of external attributes contain
      // the file mode. Refuse symlinks because extractors can otherwise escape
      // the destination even when every textual path is safe.
      const madeByOs = (madeBy >>> 8) & 0xff;
      if (madeByOs === 3) {
        const unixMode = (externalAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
          throw new BuilderError("unsafe_archive", `ZIP contains a symbolic link: ${rawName}`);
        }
      }

      const isDirectory = normalizedName.endsWith("/");
      if (!isDirectory && uncompressed > MAX_SINGLE_ENTRY) {
        throw new BuilderError("unsafe_archive", `ZIP entry is too large after extraction: ${rawName}`);
      }
      if (!isDirectory && compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO && uncompressed > 16 * 1024 * 1024) {
        throw new BuilderError("unsafe_archive", `ZIP entry has a suspicious compression ratio: ${rawName}`);
      }

      totalCompressed += compressed;
      totalUncompressed += uncompressed;
      if (totalUncompressed > MAX_UNCOMPRESSED_TOTAL) {
        throw new BuilderError("unsafe_archive", "ZIP would expand beyond the 4 GB safety limit.");
      }
      if (localOffset >= centralOffset) {
        throw new BuilderError("invalid_archive", `ZIP local entry offset is invalid: ${rawName}`);
      }

      cursor += 46 + nameLength + extraLength + commentLength;
      if (cursor > centralOffset + centralSize) {
        throw new BuilderError("invalid_archive", "ZIP central directory length is inconsistent.");
      }
    }

    return { entries, compressedBytes: totalCompressed, uncompressedBytes: totalUncompressed };
  } finally {
    await handle.close();
  }
}

export async function extractZip(zipPath: string, destination: string): Promise<void> {
  await validateZipArchive(zipPath);
  await ensureDir(destination);

  for (const entry of await readZipEntries(zipPath)) {
    const target = path.join(destination, entry.name);
    if (entry.name.endsWith("/")) {
      await ensureDir(target);
      continue;
    }
    await ensureDir(path.dirname(target));
    await writeFile(target, entry.data);
  }
}

export async function createZip(sourceDir: string, destinationZip: string): Promise<void> {
  const root = path.resolve(sourceDir);
  const files = await collectFiles(root);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = await readFile(file.absolute);
    const compressed = deflateRawSync(data, { level: 9 });
    const method = compressed.length < data.length ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length + payload.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    payload.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  await ensureDir(path.dirname(path.resolve(destinationZip)));
  await writeFile(destinationZip, Buffer.concat([...locals, centralData, end]));
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const archive = await readFile(path.resolve(zipPath));
  let eocd = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - MAX_EOCD_SEARCH); index--) {
    if (archive.readUInt32LE(index) === EOCD_SIGNATURE) { eocd = index; break; }
  }
  if (eocd < 0) throw new BuilderError("invalid_archive", "ZIP end-of-central-directory record was not found.");
  const entries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > archive.length) throw new BuilderError("invalid_archive", "ZIP central directory points outside the archive.");

  const result: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entries; index++) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new BuilderError("invalid_archive", `ZIP central directory entry ${index + 1} is malformed.`);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const name = validateEntryName(rawName);
    cursor += 46 + nameLength + extraLength + commentLength;
    if ((flags & 0x1) !== 0) throw new BuilderError("unsafe_archive", `Encrypted ZIP entries are not accepted: ${name}`);
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new BuilderError("invalid_archive", `ZIP local entry is invalid: ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressedData = archive.subarray(dataStart, dataStart + compressedSize);
    if (compressedData.length !== compressedSize) throw new BuilderError("invalid_archive", `ZIP entry is truncated: ${name}`);
    let data: Buffer;
    try {
      data = method === 0 ? Buffer.from(compressedData) : method === 8 ? inflateRawSync(compressedData) : (() => { throw new BuilderError("unsupported_archive", `ZIP compression method ${method} is not supported: ${name}`); })();
    } catch (error) {
      if (error instanceof BuilderError) throw error;
      throw new BuilderError("invalid_archive", `Could not extract ZIP entry ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (data.length !== uncompressedSize) throw new BuilderError("invalid_archive", `ZIP entry size mismatch: ${name}`);
    if (crc32(data) !== archive.readUInt32LE(cursor - (46 + nameLength + extraLength + commentLength) + 16)) throw new BuilderError("invalid_archive", `ZIP entry checksum mismatch: ${name}`);
    result.push({ name, data });
  }
  return result;
}

async function collectFiles(root: string, current = root): Promise<Array<{ absolute: string; name: string }>> {
  const result: Array<{ absolute: string; name: string }> = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) result.push({ absolute, name: path.relative(root, absolute).split(path.sep).join("/") });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}
