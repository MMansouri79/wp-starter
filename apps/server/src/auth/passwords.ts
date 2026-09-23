import { hash, verify } from "@node-rs/argon2";
import { badRequest } from "../errors.js";

/** OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

export const MINIMUM_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < MINIMUM_PASSWORD_LENGTH) {
    throw badRequest("weak_password", `Passwords must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 1024) throw badRequest("weak_password", "Passwords must be at most 1024 characters.");
}
