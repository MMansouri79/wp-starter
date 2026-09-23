import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../db/driver.js";
import { notFound } from "../errors.js";
import type { Invite, Role } from "../types.js";

interface InviteRow {
  id: string;
  code_hash: string;
  code_hint: string;
  email: string | null;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    codeHint: row.code_hint,
    email: row.email,
    role: row.role as Role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by
  };
}

export interface CreateInviteInput {
  codeHash: string;
  codeHint: string;
  email: string | null;
  role: Role;
  createdBy: string;
  expiresAt: string;
}

export class InviteRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(input: CreateInviteInput): Promise<Invite> {
    const invite: Invite = {
      id: randomUUID(),
      codeHint: input.codeHint,
      email: input.email,
      role: input.role,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      usedAt: null,
      usedBy: null
    };

    await this.db.run(
      `INSERT INTO invites (id, code_hash, code_hint, email, role, created_by, created_at, expires_at, used_at, used_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invite.id,
        input.codeHash,
        invite.codeHint,
        invite.email,
        invite.role,
        invite.createdBy,
        invite.createdAt,
        invite.expiresAt,
        null,
        null
      ]
    );

    return invite;
  }

  async list(): Promise<Invite[]> {
    const rows = await this.db.all<InviteRow>("SELECT * FROM invites ORDER BY created_at DESC");
    return rows.map(toInvite);
  }

  async findByCodeHash(codeHash: string): Promise<Invite | null> {
    const row = await this.db.get<InviteRow>("SELECT * FROM invites WHERE code_hash = ?", [codeHash]);
    return row ? toInvite(row) : null;
  }

  async findById(id: string): Promise<Invite | null> {
    const row = await this.db.get<InviteRow>("SELECT * FROM invites WHERE id = ?", [id]);
    return row ? toInvite(row) : null;
  }

  /** Marks the invite used. The caller must run this inside a transaction with user creation. */
  async consume(id: string, userId: string, at = new Date().toISOString()): Promise<void> {
    const invite = await this.findById(id);
    if (!invite) throw notFound("invite_not_found", "That invitation no longer exists.");
    await this.db.run("UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?", [at, userId, id]);
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM invites WHERE id = ?", [id]);
  }
}
