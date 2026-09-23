import { forbidden } from "../errors.js";
import type { User } from "../types.js";

export interface OwnedRecord {
  createdBy: string | null;
}

export interface OwnershipView {
  createdBy: string | null;
  ownedByCurrentUser: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Sharing rule for the hosted app: everyone signed in can read the whole shared
 * library, but only the account that created an item may change or delete it.
 *
 * Items with no owner were imported outside the web app (for example with the
 * CLI against the shared library directory). Nobody can claim them, so
 * administrators may clean those up; administrators gain no rights over items
 * that belong to another account.
 */
export function ownershipOf(record: OwnedRecord, user: User): OwnershipView {
  const owned = record.createdBy !== null && record.createdBy === user.id;
  const unowned = record.createdBy === null;
  const managesUnowned = unowned && user.role === "admin";

  return {
    createdBy: record.createdBy,
    ownedByCurrentUser: owned,
    canEdit: owned || managesUnowned,
    canDelete: owned || managesUnowned
  };
}

export function assertCanWrite(record: OwnedRecord, user: User, action = "change"): void {
  if (ownershipOf(record, user).canEdit) return;

  if (record.createdBy === null) {
    throw forbidden("read_only", `This item has no owner, so only an administrator can ${action} it.`);
  }
  throw forbidden("read_only", `Only the account that created this item can ${action} it.`);
}
