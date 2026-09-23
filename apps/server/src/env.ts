import { readFileSync } from "node:fs";

/**
 * Minimal `.env` reader so the server needs no runtime configuration dependency.
 * Existing `process.env` values always win, so systemd/container environments
 * are authoritative over the file.
 */
export function loadEnvFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

export function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function envFlag(name: string, fallback: boolean): boolean {
  const value = envString(name)?.toLowerCase();
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export function envInteger(name: string, fallback: number): number {
  const value = envString(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
