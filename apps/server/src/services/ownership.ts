import { forbidden } from "../errors.js";
import type { User } from "../types.js";

export interface OwnedRecord {
  teamId?: string;
  createdBy: string | null;
}

export interface OwnershipView {
  createdBy: string | null;
  ownedByCurrentUser: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Content belongs to a team; creator identity is retained only for attribution.
 * A validated request actor carries its current team role. Global administration
 * never grants content privileges. This also covers CLI-imported, unattributed items.
 */
export function ownershipOf(record: OwnedRecord, user: User): OwnershipView {
  const owned = record.createdBy !== null && record.createdBy === user.id;
  const canWrite = user.teamRole !== undefined && user.teamRole !== "viewer" && (!record.teamId || record.teamId === user.teamId);

  return {
    createdBy: record.createdBy,
    ownedByCurrentUser: owned,
    canEdit: canWrite,
    canDelete: canWrite
  };
}

export function assertCanWrite(record: OwnedRecord, user: User, action = "change"): void {
  if (ownershipOf(record, user).canEdit) return;

  throw forbidden("read_only", `An editor role in this team is required to ${action} this item.`);
}
