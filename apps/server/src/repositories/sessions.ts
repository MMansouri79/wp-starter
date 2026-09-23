import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../db/driver.js";
import type { SessionRecord } from "../types.js";

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  user_agent: string;
  ip_address: string;
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ipAddress: row.ip_address
  };
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
  userAgent: string;
  ipAddress: string;
}

export class SessionRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      csrfToken: input.csrfToken,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      userAgent: input.userAgent.slice(0, 400),
      ipAddress: input.ipAddress.slice(0, 100)
    };

    await this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.csrfToken,
        session.createdAt,
        session.expiresAt,
        session.userAgent,
        session.ipAddress
      ]
    );

    return session;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db.get<SessionRow>("SELECT * FROM sessions WHERE token_hash = ?", [tokenHash]);
    return row ? toSession(row) : null;
  }

  async remove(id: string): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  async removeForUser(userId: string): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }

  async removeExpired(now = new Date().toISOString()): Promise<number> {
    const rows = await this.db.all<{ id: string }>("SELECT id FROM sessions WHERE expires_at <= ?", [now]);
    await this.db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]);
    return rows.length;
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.all<SessionRow>("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC", [userId]);
    return rows.map(toSession);
  }
}
