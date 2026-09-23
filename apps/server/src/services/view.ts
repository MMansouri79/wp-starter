import type { OwnedItem, User } from "../types.js";
import { ownershipOf } from "./ownership.js";

export interface ItemView {
  id: string;
  name: string;
  createdBy: string | null;
  ownerName: string | null;
  ownedByCurrentUser: boolean;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Decorates ownership metadata for the web client so it can render "Shared by"
 * labels, owner badges, and read-only controls without duplicating the rule.
 */
export function toItemView(item: OwnedItem, viewer: User, ownerNames: Map<string, string>): ItemView {
  const ownership = ownershipOf(item, viewer);
  return {
    id: item.id,
    name: item.name,
    createdBy: item.createdBy,
    ownerName: item.createdBy ? ownerNames.get(item.createdBy) ?? "Unknown account" : null,
    ownedByCurrentUser: ownership.ownedByCurrentUser,
    canEdit: ownership.canEdit,
    canDelete: ownership.canDelete,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}
