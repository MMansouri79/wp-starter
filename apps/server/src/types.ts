export type Role = "admin" | "member" | "client";

export const ROLES: readonly Role[] = ["admin", "member", "client"];

export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
}

/** The subset safe to return to a browser. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
  ipAddress: string;
}

export interface Invite {
  id: string;
  codeHint: string;
  email: string | null;
  role: Role;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

/**
 * Ownership metadata shared by every shared-library item. Payload bytes live in
 * the file store; these rows answer "who owns this and when did it change".
 */
export interface OwnedItem {
  id: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BuildStatus = "queued" | "running" | "complete" | "failed";

export interface BuildRecord {
  id: string;
  status: BuildStatus;
  stage: string;
  percent: number;
  message: string;
  profileId: string | null;
  profileFile: string;
  profileName: string;
  artifactFile: string | null;
  sha256: string | null;
  sizeBytes: number;
  manifest: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
