import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SqlDatabase } from "../db/driver.js";
import type { Team, TeamMembership, TeamRole, User } from "../types.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { hashToken, randomToken } from "../auth/tokens.js";
import { normalizeEmail } from "../repositories/users.js";

export const TEAM_ROLES: readonly TeamRole[] = ["owner", "admin", "editor", "viewer"];
export function teamRole(value: unknown): TeamRole {
  if (!TEAM_ROLES.includes(value as TeamRole)) throw badRequest("invalid_role", "Choose owner, admin, editor, or viewer.");
  return value as TeamRole;
}
export function teamCapabilities(role: TeamRole) {
  return { canUpload: role !== "viewer", canCreateProfiles: role !== "viewer", canEdit: role !== "viewer", canDelete: role !== "viewer", canBuild: role !== "viewer", canManageMembers: role === "owner" || role === "admin", canManageOwners: role === "owner" };
}
interface TeamRow { id: string; name: string; status: Team["status"]; created_by: string | null; created_at: string; }
interface MembershipRow { team_id: string; user_id: string; role: TeamRole; created_at: string; }
export interface TeamInviteRow { id: string; team_id: string; email: string; role: TeamRole; token_hash: string; created_by: string; created_at: string; expires_at: string; used_at: string | null; used_by: string | null; revoked_at: string | null; }
function toTeam(row: TeamRow): Team { return { id: row.id, name: row.name, status: row.status, createdBy: row.created_by, createdAt: row.created_at }; }
function toMembership(row: MembershipRow): TeamMembership { return { teamId: row.team_id, userId: row.user_id, role: row.role, createdAt: row.created_at }; }
export function publicInvite(row: TeamInviteRow) {
  return { id: row.id, teamId: row.team_id, email: row.email, role: row.role, createdBy: row.created_by, createdAt: row.created_at, expiresAt: row.expires_at, usedAt: row.used_at, revokedAt: row.revoked_at };
}

export class TeamService {
  constructor(private readonly db: SqlDatabase, private readonly dataDir: string) {}
  root(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("team_not_found", "Team not found.");
    return path.join(this.dataDir, "teams", id);
  }
  async find(id: string): Promise<Team | null> {
    const row = await this.db.get<TeamRow>("SELECT * FROM teams WHERE id = ?", [id]);
    return row ? toTeam(row) : null;
  }
  async all(): Promise<Team[]> { return (await this.db.all<TeamRow>("SELECT * FROM teams ORDER BY created_at")).map(toTeam); }
  async membership(teamId: string, userId: string): Promise<TeamMembership | null> {
    const row = await this.db.get<MembershipRow>("SELECT * FROM team_memberships WHERE team_id = ? AND user_id = ?", [teamId, userId]);
    return row ? toMembership(row) : null;
  }
  async requireAccess(teamId: string, user: User): Promise<{ team: Team; membership: TeamMembership; actor: User }> {
    const team = await this.find(teamId);
    const membership = await this.membership(teamId, user.id);
    if (!team || team.status !== "active" || !membership || !TEAM_ROLES.includes(membership.role)) throw notFound("team_not_found", "Team not found.");
    return { team, membership, actor: { ...user, teamRole: membership.role, teamId } };
  }
  async forUser(userId: string) {
    const rows = await this.db.all<TeamRow & { membership_role: TeamRole }>("SELECT t.*, m.role AS membership_role FROM teams t JOIN team_memberships m ON m.team_id = t.id WHERE m.user_id = ? AND t.status = 'active' ORDER BY t.name", [userId]);
    return rows.map(row => ({ ...toTeam(row), role: row.membership_role, capabilities: teamCapabilities(row.membership_role) }));
  }
  async create(name: string, actorId: string): Promise<Team> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) throw badRequest("invalid_team_name", "Team name must contain 1–120 characters.");
    const team: Team = { id: randomUUID(), name: trimmed, status: "active", createdBy: actorId, createdAt: new Date().toISOString() };
    await this.db.run("INSERT INTO teams (id, name, status, created_by, created_at) VALUES (?, ?, ?, ?, ?)", [team.id, team.name, team.status, actorId, team.createdAt]);
    await this.audit(team.id, actorId, "team.create", team.id);
    return team;
  }
  async setStatus(id: string, status: unknown, actorId: string): Promise<void> {
    if (status !== "active" && status !== "suspended") throw badRequest("invalid_status", "Choose active or suspended.");
    if (!await this.find(id)) throw notFound("team_not_found", "Team not found.");
    await this.db.run("UPDATE teams SET status = ? WHERE id = ?", [status, id]);
    await this.audit(id, actorId, `team.${status}`, id);
  }
  async members(teamId: string) {
    return this.db.all<{ userId: string; email: string; displayName: string; role: TeamRole; status: string }>("SELECT m.user_id AS \"userId\", u.email, u.display_name AS \"displayName\", m.role, u.status FROM team_memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY u.display_name", [teamId]);
  }
  async requireManager(teamId: string, actor: User, targetRole?: TeamRole) {
    const { membership } = await this.requireAccess(teamId, actor);
    if (membership.role !== "owner" && membership.role !== "admin") throw forbidden("team_admin_required", "A team administrator role is required.");
    if (targetRole && targetRole !== "editor" && targetRole !== "viewer" && membership.role !== "owner") throw forbidden("owner_required", "Only a team owner can manage owners and administrators.");
    return membership;
  }
  async changeMember(teamId: string, userId: string, role: TeamRole | null, actor: User): Promise<void> {
    const member = await this.membership(teamId, userId);
    if (!member) throw notFound("member_not_found", "Member not found.");
    await this.requireManager(teamId, actor, member.role);
    if (role) await this.requireManager(teamId, actor, role);
    await this.db.transaction(async tx => {
      if (member.role === "owner" && role !== "owner") await this.assertOtherOwner(tx, teamId, userId);
      if (role) await tx.run("UPDATE team_memberships SET role = ? WHERE team_id = ? AND user_id = ?", [role, teamId, userId]);
      else await tx.run("DELETE FROM team_memberships WHERE team_id = ? AND user_id = ?", [teamId, userId]);
      await new TeamService(tx, this.dataDir).audit(teamId, actor.id, role ? `member.role.${role}` : "member.remove", userId);
    });
  }
  private async assertOtherOwner(db: SqlDatabase, teamId: string, userId: string) {
    const row = await db.get<{ total: number }>("SELECT COUNT(*) AS total FROM team_memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.role = 'owner' AND u.status = 'active' AND m.user_id <> ?", [teamId, userId]);
    if (!Number(row?.total)) throw conflict("last_owner", "At least one active team owner must remain.");
  }
  async assertUserCanLeave(userId: string): Promise<void> {
    const rows = await this.db.all<{ team_id: string }>("SELECT team_id FROM team_memberships WHERE user_id = ? AND role = 'owner'", [userId]);
    for (const row of rows) await this.assertOtherOwner(this.db, row.team_id, userId);
  }
  async invite(teamId: string, email: string, role: TeamRole, actor: User, provisioning = false) {
    if (!await this.find(teamId)) throw notFound("team_not_found", "Team not found.");
    if (provisioning) {
      if (actor.role !== "admin") throw forbidden("admin_required", "Platform administration is required.");
      const owners = await this.db.get<{ total: number }>("SELECT COUNT(*) AS total FROM team_memberships WHERE team_id = ? AND role = 'owner'", [teamId]);
      if (role !== "owner" || Number(owners?.total)) throw forbidden("initial_owner_only", "Platform provisioning can only invite the initial owner.");
    } else await this.requireManager(teamId, actor, role);
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw badRequest("invalid_email", "A valid email is required.");
    const token = randomToken(32);
    if (provisioning) await this.db.run("UPDATE team_invites SET revoked_at = ? WHERE team_id = ? AND role = 'owner' AND used_at IS NULL AND revoked_at IS NULL", [new Date().toISOString(), teamId]);
    const invite: TeamInviteRow = { id: randomUUID(), team_id: teamId, email: normalized, role, token_hash: hashToken(token), created_by: actor.id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(), used_at: null, used_by: null, revoked_at: null };
    await this.db.run("INSERT INTO team_invites (id, team_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [invite.id, teamId, normalized, role, invite.token_hash, actor.id, invite.created_at, invite.expires_at]);
    await this.audit(teamId, actor.id, "invite.create", invite.id);
    return { invite: publicInvite(invite), token };
  }
  async validateInvite(token: string, email: string, db = this.db): Promise<TeamInviteRow> {
    const invite = await db.get<TeamInviteRow>("SELECT i.* FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE i.token_hash = ? AND t.status = 'active'", [hashToken(token)]);
    if (!invite || invite.used_at || invite.revoked_at || invite.expires_at <= new Date().toISOString() || invite.email !== normalizeEmail(email)) throw badRequest("invite_invalid", "This invitation is unavailable or does not match your email.");
    return invite;
  }
  async accept(token: string, user: User, db = this.db): Promise<string> {
    return db.transaction(async tx => {
      const invite = await this.reserveInvite(token, user.email, user.id, tx);
      await this.joinInvite(invite, user, tx);
      return invite.team_id;
    });
  }
  /** Reserve before account creation, so a concurrent redemption cannot hit an email uniqueness race. */
  async reserveInvite(token: string, email: string, userId: string, tx: SqlDatabase): Promise<TeamInviteRow> {
    const invite = await this.validateInvite(token, email, tx);
    const claimed = await tx.get<{ id: string }>("UPDATE team_invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL RETURNING id", [new Date().toISOString(), userId, invite.id]);
    if (!claimed) throw badRequest("invite_used", "This invitation has already been used.");
    return invite;
  }
  async joinInvite(invite: TeamInviteRow, user: User, tx: SqlDatabase): Promise<void> {
    const existing = await tx.get("SELECT user_id FROM team_memberships WHERE team_id = ? AND user_id = ?", [invite.team_id, user.id]);
    if (existing) throw conflict("already_member", "You already belong to this team. Ask an owner to change your role.");
    await tx.run("INSERT INTO team_memberships (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)", [invite.team_id, user.id, invite.role, new Date().toISOString()]);
    await new TeamService(tx, this.dataDir).audit(invite.team_id, user.id, "invite.accept", invite.id);
  }
  async invites(teamId: string, actor: User) {
    const manager = await this.requireManager(teamId, actor);
    const rows = await this.db.all<TeamInviteRow>("SELECT * FROM team_invites WHERE team_id = ? ORDER BY created_at DESC", [teamId]);
    return rows.filter(row => manager.role === "owner" || row.role === "editor" || row.role === "viewer").map(publicInvite);
  }
  async revoke(teamId: string, id: string, actor: User) {
    const invite = await this.db.get<TeamInviteRow>("SELECT * FROM team_invites WHERE team_id = ? AND id = ?", [teamId, id]);
    if (!invite) throw notFound("invite_not_found", "Invitation not found.");
    await this.requireManager(teamId, actor, invite.role);
    await this.db.run("UPDATE team_invites SET revoked_at = ? WHERE id = ? AND team_id = ?", [new Date().toISOString(), id, teamId]);
    await this.audit(teamId, actor.id, "invite.revoke", id);
  }
  async audit(teamId: string, actorId: string, action: string, target: string) {
    await this.db.run("INSERT INTO team_audit (id, team_id, actor_id, action, target, created_at) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), teamId, actorId, action, target, new Date().toISOString()]);
  }
}
