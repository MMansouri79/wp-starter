import { spawn } from "node:child_process";
import { open, stat } from "node:fs/promises";
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

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new BuilderError("archive_command_failed", `${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

function psQuote(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

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

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
      `$src=${psQuote(path.resolve(zipPath))};`,
      `$dst=${psQuote(path.resolve(destination))};`,
      "[System.IO.Compression.ZipFile]::ExtractToDirectory($src,$dst);"
    ].join(" ");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }

  await run("unzip", ["-q", path.resolve(zipPath), "-d", path.resolve(destination)]);
}

export async function createZip(sourceDir: string, destinationZip: string): Promise<void> {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.IO.Compression;",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
      `$src=${psQuote(path.resolve(sourceDir))};`,
      `$dst=${psQuote(path.resolve(destinationZip))};`,
      "if (Test-Path $dst) { Remove-Item -Force $dst };",
      "$root=[System.IO.Path]::GetFullPath($src);",
      "$archive=[System.IO.Compression.ZipFile]::Open($dst,[System.IO.Compression.ZipArchiveMode]::Create);",
      "try {",
      "Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {",
      "$relative=$_.FullName.Substring($root.Length).TrimStart([char]92,[char]47);",
      "$entryName=$relative.Replace([char]92,[char]47);",
      "[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$entryName,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;",
      "};",
      "} finally { $archive.Dispose(); }"
    ].join(" ");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }

  await run("zip", ["-qr", path.resolve(destinationZip), "."], path.resolve(sourceDir));
}
