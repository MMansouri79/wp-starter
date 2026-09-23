import type { SqlDatabase } from "../db/driver.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../errors.js";
import { InviteRepository } from "../repositories/invites.js";
import { SessionRepository } from "../repositories/sessions.js";
import { publicUser, UserRepository, type UserWithSecret } from "../repositories/users.js";
import type { Invite, PublicUser, Role, SessionRecord, User } from "../types.js";
import { assertPasswordStrength, hashPassword, verifyPassword } from "./passwords.js";
import { generateInviteCode, hashToken, inviteHint, normalizeInviteCode, randomToken } from "./tokens.js";

export const SESSION_COOKIE = "wp_starter_session";

export interface SessionMeta {
  userAgent: string;
  ipAddress: string;
}

export interface AuthenticatedSession {
  user: User;
  session: SessionRecord;
}

export interface LoginResult extends AuthenticatedSession {
  token: string;
}

export interface AuthOptions {
  sessionTtlHours: number;
  allowOpenRegistration: boolean;
}

export interface BootstrapAdminInput {
  email: string;
  password: string;
}

export class AuthService {
  private readonly users: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly invites: InviteRepository;

  constructor(private readonly db: SqlDatabase, private readonly options: AuthOptions) {
    this.users = new UserRepository(db);
    this.sessions = new SessionRepository(db);
    this.invites = new InviteRepository(db);
  }

  get userRepository(): UserRepository {
    return this.users;
  }

  get sessionRepository(): SessionRepository {
    return this.sessions;
  }

  get inviteRepository(): InviteRepository {
    return this.invites;
  }

  /**
   * Creates the very first administrator from configuration. Runs only when the
   * database has no accounts at all, so it can never reset a live instance.
   */
  async ensureBootstrapAdmin(input: BootstrapAdminInput | null): Promise<PublicUser | null> {
    if (!input) return null;
    if ((await this.users.count()) > 0) return null;
    assertPasswordStrength(input.password);
    const created = await this.users.create({
      email: input.email,
      displayName: input.email.split("@")[0] || "Administrator",
      role: "admin",
      passwordHash: await hashPassword(input.password),
      createdBy: null
    });
    return publicUser(created);
  }

  async login(email: string, password: string, meta: SessionMeta): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    // Verify even when the account is unknown so timing does not reveal existence.
    const reference = user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const matches = await verifyPassword(reference, password);

    if (!user || !matches) throw unauthorized("Email or password is incorrect.");
    if (user.status !== "active") throw forbidden("account_disabled", "That account has been disabled.");

    const created = await this.createSession(user, meta);
    await this.users.recordLogin(user.id);
    return created;
  }

  /**
   * Client onboarding. An invite code is always required unless open
   * registration was explicitly enabled for this deployment.
   */
  async register(input: {
    email: string;
    password: string;
    displayName?: string;
    inviteCode?: string;
    meta: SessionMeta;
  }): Promise<LoginResult> {
    assertPasswordStrength(input.password);

    const code = input.inviteCode ? normalizeInviteCode(input.inviteCode) : "";
    if (!code && !this.options.allowOpenRegistration) {
      throw badRequest("invite_required", "An invitation code is required to create an account.");
    }

    const invite = code ? await this.invites.findByCodeHash(hashToken(code)) : null;
    if (code) {
      if (!invite) throw badRequest("invite_invalid", "That invitation code is not valid.");
      if (invite.usedAt) throw badRequest("invite_used", "That invitation code has already been used.");
      if (Date.parse(invite.expiresAt) <= Date.now()) throw badRequest("invite_expired", "That invitation code has expired.");
      if (invite.email && invite.email.toLowerCase() !== input.email.trim().toLowerCase()) {
        throw badRequest("invite_email_mismatch", `That invitation is reserved for ${invite.email}.`);
      }
    }

    const role: Role = invite?.role ?? "client";
    const passwordHash = await hashPassword(input.password);

    return this.db.transaction(async (tx) => {
      const users = new UserRepository(tx);
      const sessions = new SessionRepository(tx);
      const invites = new InviteRepository(tx);

      const user = await users.create({
        email: input.email,
        displayName: input.displayName?.trim() || input.email.split("@")[0] || "Member",
        role,
        passwordHash,
        createdBy: invite ? invite.createdBy : null
      });

      if (invite) await invites.consume(invite.id, user.id);

      return this.issueSession(sessions, user, input.meta);
    });
  }

  private async createSession(user: UserWithSecret, meta: SessionMeta): Promise<LoginResult> {
    return this.issueSession(this.sessions, user, meta);
  }

  private async issueSession(sessions: SessionRepository, user: User, meta: SessionMeta): Promise<LoginResult> {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.options.sessionTtlHours * 3600_000).toISOString();

    const session = await sessions.create({
      userId: user.id,
      tokenHash: hashToken(token),
      csrfToken,
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress
    });

    return { user, session, token };
  }

  async resolveSession(token: string | null): Promise<AuthenticatedSession | null> {
    if (!token) return null;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (!session) return null;

    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.sessions.remove(session.id);
      return null;
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== "active") {
      await this.sessions.remove(session.id);
      return null;
    }

    return { user, session };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (session) await this.sessions.remove(session.id);
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw notFound("user_not_found", "That account no longer exists.");
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw unauthorized("The current password is incorrect.");
    }
    assertPasswordStrength(nextPassword);
    await this.users.setPassword(userId, await hashPassword(nextPassword));
  }

  async listUsers(): Promise<PublicUser[]> {
    return this.users.list();
  }

  async createUser(input: { email: string; displayName?: string; role: Role; password: string }, actorId: string): Promise<PublicUser> {
    assertPasswordStrength(input.password);
    const created = await this.users.create({
      email: input.email,
      displayName: input.displayName?.trim() || input.email.split("@")[0] || "Member",
      role: input.role,
      passwordHash: await hashPassword(input.password),
      createdBy: actorId
    });
    return publicUser(created);
  }

  async setUserStatus(id: string, status: User["status"], actorId: string): Promise<PublicUser> {
    if (id === actorId && status !== "active") {
      throw badRequest("cannot_disable_self", "You cannot disable your own account.");
    }
    if (status !== "active") await this.assertNotLastAdmin(id);
    const updated = await this.users.setStatus(id, status);
    if (status !== "active") await this.sessions.removeForUser(id);
    return updated;
  }

  async setUserRole(id: string, role: Role, actorId: string): Promise<PublicUser> {
    if (id === actorId && role !== "admin") {
      throw badRequest("cannot_demote_self", "You cannot remove your own administrator role.");
    }
    if (role !== "admin") await this.assertNotLastAdmin(id);
    return this.users.setRole(id, role);
  }

  async resetUserPassword(id: string, password: string): Promise<void> {
    assertPasswordStrength(password);
    await this.users.setPassword(id, await hashPassword(password));
    await this.sessions.removeForUser(id);
  }

  async removeUser(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw badRequest("cannot_remove_self", "You cannot delete your own account.");
    await this.assertNotLastAdmin(id);
    await this.sessions.removeForUser(id);
    await this.users.remove(id);
  }

  private async assertNotLastAdmin(id: string): Promise<void> {
    const admins = await this.db.get<{ total: number }>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
      [id]
    );
    if (Number(admins?.total ?? 0) === 0) {
      throw conflict("last_admin", "At least one active administrator must remain.");
    }
  }

  async createInvite(
    input: { email?: string | null; role: Role; expiresInDays?: number },
    actorId: string
  ): Promise<{ invite: Invite; code: string }> {
    const days = Math.min(Math.max(input.expiresInDays ?? 14, 1), 365);
    const code = generateInviteCode();
    const invite = await this.invites.create({
      codeHash: hashToken(code),
      codeHint: inviteHint(code),
      email: input.email?.trim() || null,
      role: input.role,
      createdBy: actorId,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString()
    });
    return { invite, code };
  }

  async listInvites(): Promise<Invite[]> {
    return this.invites.list();
  }

  async revokeInvite(id: string): Promise<void> {
    const invite = await this.invites.findById(id);
    if (!invite) throw notFound("invite_not_found", "That invitation no longer exists.");
    await this.invites.remove(id);
  }
}
