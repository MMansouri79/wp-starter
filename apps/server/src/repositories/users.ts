import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../db/driver.js";
import { conflict, notFound } from "../errors.js";
import type { PublicUser, Role, User, UserStatus } from "../types.js";

interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  display_name: string;
  role: string;
  password_hash: string;
  status: string;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
}

export interface UserWithSecret extends User {
  passwordHash: string;
}

function toUser(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as Role,
    status: row.status as UserStatus,
    createdAt: row.created_at,
    createdBy: row.created_by,
    lastLoginAt: row.last_login_at,
    passwordHash: row.password_hash
  };
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  createdBy: string | null;
}

export class UserRepository {
  constructor(private readonly db: SqlDatabase) {}

  async count(): Promise<number> {
    const row = await this.db.get<{ total: number }>("SELECT COUNT(*) AS total FROM users");
    return Number(row?.total ?? 0);
  }

  async findByEmail(email: string): Promise<UserWithSecret | null> {
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE email_normalized = ?", [normalizeEmail(email)]);
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<UserWithSecret | null> {
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    return row ? toUser(row) : null;
  }

  async list(): Promise<PublicUser[]> {
    const rows = await this.db.all<UserRow>("SELECT * FROM users ORDER BY created_at ASC");
    return rows.map((row) => publicUser(toUser(row)));
  }

  async displayNames(): Promise<Map<string, string>> {
    const rows = await this.db.all<{ id: string; display_name: string }>("SELECT id, display_name FROM users");
    return new Map(rows.map((row) => [row.id, row.display_name]));
  }

  async create(input: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(input.email);
    if (existing) throw conflict("email_in_use", `An account already exists for ${input.email}.`);

    const user: User = {
      id: randomUUID(),
      email: input.email.trim(),
      displayName: input.displayName.trim() || input.email.trim(),
      role: input.role,
      status: "active",
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
      lastLoginAt: null
    };

    await this.db.run(
      `INSERT INTO users (id, email, email_normalized, display_name, role, password_hash, status, created_at, created_by, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.email,
        normalizeEmail(user.email),
        user.displayName,
        user.role,
        input.passwordHash,
        user.status,
        user.createdAt,
        user.createdBy,
        null
      ]
    );

    return user;
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    const result = await this.require(id);
    await this.db.run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, result.id]);
  }

  async setStatus(id: string, status: UserStatus): Promise<PublicUser> {
    await this.require(id);
    await this.db.run("UPDATE users SET status = ? WHERE id = ?", [status, id]);
    return publicUser(await this.require(id));
  }

  async setRole(id: string, role: Role): Promise<PublicUser> {
    await this.require(id);
    await this.db.run("UPDATE users SET role = ? WHERE id = ?", [role, id]);
    return publicUser(await this.require(id));
  }

  async recordLogin(id: string, at = new Date().toISOString()): Promise<void> {
    await this.db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [at, id]);
  }

  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.db.run("DELETE FROM users WHERE id = ?", [id]);
  }

  private async require(id: string): Promise<UserWithSecret> {
    const user = await this.findById(id);
    if (!user) throw notFound("user_not_found", "That account no longer exists.");
    return user;
  }
}
