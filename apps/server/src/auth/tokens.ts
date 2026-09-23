import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Session and invite secrets are stored only as digests. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Human-typable invite code, e.g. `WS7K-2M4Q-9BXD`. */
export function generateInviteCode(groups = 3, groupSize = 4): string {
  const bytes = randomBytes(groups * groupSize);
  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    let part = "";
    for (let index = 0; index < groupSize; index += 1) {
      part += INVITE_ALPHABET[bytes[group * groupSize + index] % INVITE_ALPHABET.length];
    }
    parts.push(part);
  }
  return parts.join("-");
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function inviteHint(code: string): string {
  const normalized = normalizeInviteCode(code);
  return normalized.length <= 4 ? normalized : `…${normalized.slice(-4)}`;
}
