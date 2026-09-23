import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import { badRequest, HttpError } from "../errors.js";

export function safeFileName(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "request_too_large", "Request body is too large.");
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("invalid_json", "Request body is not valid JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("invalid_json", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

export interface ReceivedUpload {
  tempDir: string;
  file: string;
  sizeBytes: number;
}

/**
 * Streams an upload to a private temporary directory. Nothing is written into
 * the shared library until the payload has been inspected and verified.
 */
export async function receiveUpload(
  req: IncomingMessage,
  maxBytes: number,
  filename: unknown,
  prefix: string
): Promise<ReceivedUpload> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "upload_too_large", `Uploads are limited to ${Math.floor(maxBytes / (1024 * 1024))} MiB.`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const file = path.join(tempDir, safeFileName(path.basename(String(filename ?? "upload")), "upload.zip"));

  let size = 0;
  let exceeded = false;
  req.on("data", (chunk) => {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) exceeded = true;
  });

  try {
    await pipeline(req, createWriteStream(file));
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  if (exceeded) {
    await rm(tempDir, { recursive: true, force: true });
    throw new HttpError(413, "upload_too_large", `Uploads are limited to ${Math.floor(maxBytes / (1024 * 1024))} MiB.`);
  }

  const info = await stat(file);
  return { tempDir, file, sizeBytes: info.size };
}

export function requireString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest("invalid_request", `${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest("invalid_request", `${field} must be at most ${maxLength} characters.`);
  return trimmed;
}

export function optionalString(value: unknown, field: string, maxLength = 500): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, field, maxLength);
}
