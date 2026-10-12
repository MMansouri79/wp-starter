# Planning: v1 — Server Hardening & Stabilization

Status: implementation and local checks complete. PostgreSQL integration, remote CI and deployment acceptance remain unverified in this environment.

This phase fixes the four original defects plus the ownership, quota, concurrency, artifact, and reconciliation gaps found in review of `d3312ae` (currently on `feat/sample-content-library`). Each behavior gets regression coverage; `builder-core` stays untouched. Clean-VPS deployment and the two-browser acceptance run are tracked separately in `V1-DEPLOYMENT-ACCEPTANCE.md`.

Previous phase: [V1-SHARED-WEB-APP.md](V1-SHARED-WEB-APP.md).

## Implementation record — 2026-10-05

The interrupted rate-limiter wiring is finished. In addition to the original four fixes, imports now preserve owners and reject foreign replacements before touching canonical files, including font ID collisions and source-aware Elementor template collisions. Missing ownership mirrors are treated as unowned. PostgreSQL transactions use scoped clients; SQLite operations, API writes and build quota finalization are serialized safely. Invite consumption is conditional and concurrent redemption rolls back the losing account.

Quota includes font faces and sample assets. Imports validate quota before canonical mutation; build finalization adds the new ZIP size and cleans rejected ZIPs/sidecars. Artifact names include job UUIDs. Retention runs at startup and hourly without a 1000-row cap, and shutdown waits for an active sweep. Reconciliation refreshes content and removes stale mirrors while retaining owners, including repair of old unowned template mirrors from their source snapshot.

Nested API storage coordinates and internal error paths are stripped. Node engines and lockfile metadata agree on 22.13+. CI covers Node 22/24 and has a PostgreSQL 16 integration job. Coordinated database/file backups, restore instructions, overlay tests, and a separate deployment-acceptance checklist are included. The working version remains alpha.32 until the planned 0.2.0-alpha.1 release is cut.

Verification:

- `npm run check`: passed; 139 tests passed, one PostgreSQL integration test skipped because `WP_STARTER_TEST_PG_URL` is unset; PHP lint passed.
- `npm run verify:artifacts`: passed; Builder ZIP verified with 77 files and independent Exporter ZIP with 5 files.
- Synthetic backup tests exercised archive restoration, failed-dump cleanup, service restart, and unsafe backup-destination rejection under Git Bash. These do not replace the real PostgreSQL/VPS restore rehearsal.
- Focused overlay tests exercised the actual client script's CSRF transport and owner/read-only controls; full two-browser acceptance is outstanding.
- `git diff --check`: passed. Deployment scripts retain LF line endings.
- Not executed: real PostgreSQL integration, remote multi-OS CI, clean-VPS deployment, full browser acceptance, production backup/restore and desktop packaging/signing.

## Findings (verified against commit `d3312ae`)

| # | Issue | Evidence |
|---|---|---|
| 1 | CI Node 20 jobs will fail at import | `.github/workflows/ci.yml:13` matrix `['20','22']`; `apps/server/src/db/sqlite.ts:1` imports `node:sqlite` at module top level (the flag was removed and the module unflagged only in Node 22.13); `package.json` `engines.node` is `">=20"` |
| 2 | Build retention is inert | `pruneExpired()` at `apps/server/src/services/builds.ts:138` has zero callers (no startup call, no interval); configuration is fully wired (`app.ts:118`, `WP_STARTER_BUILD_RETENTION_HOURS=720` in `.env.example:56`); `docs/SERVER-DEPLOYMENT.md:175` claims artifacts are pruned automatically |
| 3 | Internal filesystem paths leak through the API | `/api/health` (`apps/server/src/api/auth.ts:126`) is unauthenticated and returns `library: app.library.root` (`:143`); `/api/state` returns `library: library.root` (`apps/server/src/api/library.ts:81`). Both contradict the `Agents.md` rule: never leak internal paths to clients |
| 4 | No login rate limiting or lockout | `AuthService.login` (`apps/server/src/auth/service.ts:77`) verifies passwords timing-safely but applies no attempt limiting |

## Implementation steps

### 1. Restore CI

- `.github/workflows/ci.yml`: bump the matrix to `['22', '24']`, keeping the three-OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`). The `desktop-windows` job already pins Node 22 and is unaffected.
- `package.json`: `engines.node` → `">=22.13"`.
- Update the documented Node prerequisite in `docs/SERVER-DEPLOYMENT.md` (and the README if it states a version).
- Adjustable default: the alternative is a lazy `node:sqlite` import in `apps/server/src/db/sqlite.ts` so builder-core/GUI/CLI keep running on Node 20 — but server tests still require 22.13+, so CI must move regardless. The Electron desktop app bundles its own runtime and is unaffected either way.

### 2. Wire build retention

- Call `pruneExpired()` once at startup and on an hourly interval (wired from `app.ts` or the builds service start path), with clean shutdown of the timer; keep the existing "Pruned N expired build(s)" log line.
- Test in `apps/server/tests/`: seed an expired finished build plus its artifact in the harness temp library, run the prune cycle, and assert the DB row and files are removed while non-expired builds survive.

### 3. Stop leaking internal paths

- `/api/health`: remove the `library` field (keep `status`, `version`, `database`, `dialect`, `disk`). Health stays unauthenticated for monitoring, but path-free.
- `/api/state`: remove `library: library.root` from the response payload.
- Regression test: assert neither response contains any absolute filesystem path (extend the existing state/auth tests).

### 4. Login rate limiting

- New `apps/server/src/auth/rate-limit.ts`: in-memory fixed-window counters per client IP and per submitted email; lockout after N failed attempts, auto-expiring after the lockout window.
- Configuration: `WP_STARTER_LOGIN_MAX_ATTEMPTS`, `WP_STARTER_LOGIN_LOCKOUT_SECONDS` in `config.ts` and `.env.example`.
- Apply in `AuthService.login` and in invite redemption inside `register`; return a generic `429` that reveals nothing about account existence. A successful login clears the counter.
- Tests: lockout triggers at the threshold, the window expiry clears it, and a successful login resets it.
- Document the single-process scope (counters do not survive restarts or share across replicas) in a code comment and one line in `Agents.md`.

### 5. Small close-outs

- `deploy/scripts/backup-file-store.sh`: rsync/tar backup of the shared file store, with a pointer added to `docs/SERVER-DEPLOYMENT.md` §8 (Backups), which currently only says to use "your usual rsync/snapshot job".
- `CHANGELOG.md` entry describing the fixes under the existing unreleased `0.2.0-alpha.1` section. The earlier alpha.33 proposal is superseded by README's release decision: keep working-tree versions at alpha.32 until the 0.2.0-alpha.1 release is cut.

## Verification / definition of done

- `npm run check` green (compile + all tests + PHP lint) and `npm run verify:artifacts` green.
- New tests pass: retention prune, path-leak regression, rate-limit suite.
- CI matrix green on the next push.
- Explicitly out of scope here: clean-VPS deployment and two-browser acceptance (see follow-up phase).

## Traceability

| Step | Targets | Verification |
|---|---|---|
| 1 | `.github/workflows/ci.yml`, `package.json`, deployment doc | CI matrix green; engines consistent with docs |
| 2 | `app.ts`, `services/builds.ts`, new test | Expired build + artifact removed; live builds untouched |
| 3 | `api/auth.ts`, `api/library.ts`, tests | No absolute paths in any API response |
| 4 | `auth/rate-limit.ts`, `auth/service.ts`, `config.ts`, `.env.example` | Lockout/expiry/reset tests pass |
| 5 | `deploy/scripts/`, `CHANGELOG.md`, version | Files present; changelog entry accurate |

## Follow-up phase: deployment acceptance

**This phase starts only after every step above is done and green.** It covers the two environment-dependent verifications deliberately excluded above, and gets its own planning file (suggested: `docs/planning/V1-DEPLOYMENT-ACCEPTANCE.md`) when it begins.

Scope:

1. **Clean-VPS walkthrough** of `docs/SERVER-DEPLOYMENT.md`: PostgreSQL setup, migrations (`migrate` subcommand), systemd supervision, nginx + Let's Encrypt HTTPS, backup scripts, disk monitoring — executed from a clean server to prove the documentation is complete.
2. **Two-browser acceptance**: owner edits/deletes their own items; a second signed-in user sees everything read-only and receives `403 read_only` on write attempts; admin creates accounts and invites; a client registers through an invite code.

Both steps are environment-dependent: if they cannot run in-session, they are reported as not executed rather than assumed complete.

### Deferred to later planning (recorded, not scheduled)

- `/api/state` pagination (it currently returns the entire library).
- Full browser acceptance for the GUI overlay; focused DOM and transport tests are now included.
- Invite email delivery (invite codes are shown once and relayed by hand).
