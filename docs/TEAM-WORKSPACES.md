# Private team workspaces

The hosted server stores identity globally and content within private teams. One account may join several teams with a different role in each. The offline CLI, local GUI, portable profiles, and distribution manifests retain their existing formats.

## Permissions

| Role | Content | People |
| --- | --- | --- |
| Owner | Browse/download; upload, edit, delete, build | Invite/manage all team roles, appoint another owner |
| Team admin | Same as owner | Invite/manage editors and viewers |
| Editor | Same as owner | No member or invitation management |
| Viewer | Browse and download existing builds | No member or invitation management |
| Platform administrator | Requires explicit membership and that team's role | Provision/suspend teams, manage global accounts |

Content belongs to the team. `createdBy` remains attribution, not an access rule; removing a membership or deleting its account does not delete its content. CLI-imported items in a team directory may have null attribution and are manageable by team editors. At least one active owner must remain: demotion, removal, account disabling, and account deletion enforce this rule. Owners can transfer ownership by promoting a colleague, then demoting/removing themselves. Team administrators cannot manage other administrators or owners.

New teams start empty. Provisioning returns an initial owner invitation but does not add the platform administrator as a member. An owner can explicitly invite that administrator for support. Team suspension removes browser/API access; queued builds fail when a worker starts them. A build already executing may finish into its original team library. Deletion, billing, SSO, mail delivery, public signup, and shared catalogs are outside this release.

## Identity and invitations

Email/password login and secure cookie sessions remain global. The legacy global `user.role === "admin"` denotes platform administration; legacy `member`/`client` values are ordinary accounts and do not grant team permissions. Team roles live exclusively in `team_memberships`.

Invitations specify a normalized email, team, and role; tokens contain 256 bits of randomness and only their SHA-256 digests are stored. They expire in seven days, are revocable and single-use, and never grant platform administration. The link places the token in `/login.html#invite=...`, keeping it out of HTTP request URLs and referrers. Team owners/admins copy and share links themselves. Existing users sign in and accept with CSRF; new users register through the invitation. Acceptance is transactional and uses a conditional update so simultaneous redemption cannot create extra memberships/accounts. An invitation cannot silently overwrite an existing membership's role.

`WP_STARTER_ALLOW_OPEN_REGISTRATION` is retained for configuration compatibility but is ignored by the hosted application. Legacy account invitation codes cannot be redeemed.

## API and storage boundary

- `/api/auth/login`, `/register`, `/session`, `/logout`, and `/password` retain global authentication. Session responses include accessible `teams`, each with `role` and `capabilities`.
- `GET /api/teams` lists the caller's active teams. Hosted resource endpoints use `/api/teams/:teamId/<existing suffix>`: `state`, `packages`, `configs`, `profiles`, `fonts`, `vnext`, `elementor-templates`, `sample-content`, `build-jobs`, and `builds`. Quota usage is `GET /api/teams/:teamId/quota`.
- Team administration uses `GET /members`, `PUT|DELETE /members/:userId`, `GET|POST /invites`, `DELETE /invites/:id`, and `GET /audit` under that team prefix. Owners/admins can inspect the latest 200 activity records.
- `POST /api/auth/team-invites/accept` accepts `{token}` for an authenticated account. New-account `POST /api/auth/register` keeps the `inviteCode` field, now containing the case-sensitive team token.
- Platform provisioning is `POST /api/admin/teams` with `{name, ownerEmail}`. It returns `{team, invite, token, invitationUrl}` once. `GET /api/admin/teams` lists teams; `POST /api/admin/teams/:teamId/status` takes `{status: "active"|"suspended"}`. `/owner-invite` can reissue an initial owner invitation only while the team has no owner.
- Authenticated mutations require CSRF. Login and invitation-based new-account registration retain their existing throttled public authentication flow. Missing/inaccessible teams and team-scoped items return `404`; viewers' content writes return `403 read_only`.

All content tables have non-null `team_id` and composite `(team_id, id)` primary keys. Package coordinate and profile filename uniqueness are team-local. Repositories are constructed with team scope, and every SQL content operation includes it. A global build repository is used only by the queue, retention coordinator, and platform count reporting.

Each canonical builder library is `<WP_STARTER_DATA_DIR>/teams/<team UUID>/`; database files, runtime lock, migration checkpoint, and operational configuration remain at the data root. SQL stores metadata and attribution; team file registries remain authoritative for payloads. Reconciliation prunes only its team. Registry/profile references and symlink/junction resolution are checked against that root before reads and builds.

One process-wide mutation lock covers API writes and build finalization. Membership is rechecked after acquiring it. Builds persist `team_id` at enqueue time and resolve dependencies/artifacts in that team's context. There is one worker pool and global queue limit; the existing `WP_STARTER_ACCOUNT_QUOTA_BYTES` configuration now supplies each team's storage limit. Uploaded packages, snapshots, fonts, sample assets, and finished builds count toward that team's usage.

## Hosted interface

The selected team is `?team=<UUID>` in the browser URL, not session-wide server state. A single membership opens automatically; multiple memberships show a picker, and zero memberships show how to obtain access. The sidebar offers team switching and settings. Switching aborts pending fetches and performs a full navigation, clearing loaded content/selections; stale responses are rejected. Typography drafts in sessionStorage are namespaced by team. Separate tabs can stay in separate teams.

The hosted transport loads before the shared GUI scripts and maps resource requests, sample images, and generated download links to explicit team URLs. It supports the shared GUI's `profileFile` build input and filename-based history downloads without changing offline GUI files.

## Upgrade

See [server deployment](SERVER-DEPLOYMENT.md#private-team-migration) for the backup, dry-run, migration, verification, and rollback sequence. Do not run the CLI against a live hosted team directory or run multiple server processes/replicas.
