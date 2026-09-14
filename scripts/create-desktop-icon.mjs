import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(repoRoot, "apps", "desktop", "assets");
const output = path.join(assetsDir, "icon.ico");
const size = 256;
const pixels = Buffer.alloc(size * size * 4, 0);

function setPixel(x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  const x = ax + ratio * dx;
  const y = ay + ratio * dy;
  return Math.hypot(px - x, py - y);
}

const blue = [56, 88, 233, 255];
const white = [255, 255, 255, 255];
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    if (Math.hypot(x - 128, y - 128) <= 121) setPixel(x, y, blue);
  }
}

const strokes = [[68, 82, 91, 174], [91, 174, 128, 116], [128, 116, 165, 174], [165, 174, 188, 82]];
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    if (strokes.some(([ax, ay, bx, by]) => distanceToSegment(x, y, ax, ay, bx, by) <= 13)) setPixel(x, y, white);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

const scanlines = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) {
  scanlines[y * (size * 4 + 1)] = 0;
  pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", header),
  pngChunk("IDAT", deflateSync(scanlines)),
  pngChunk("IEND", Buffer.alloc(0))
]);
const directory = Buffer.alloc(22);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(1, 4);
directory[6] = 0;
directory[7] = 0;
directory.writeUInt16LE(1, 10);
directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(png.length, 14);
directory.writeUInt32LE(22, 18);

await mkdir(assetsDir, { recursive: true });
await writeFile(output, Buffer.concat([directory, png]));
console.log(output);
