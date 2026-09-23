# Agent Guide

## Project overview

WP Starter System is an offline-first WordPress starter build system. It has these main parts:

- `packages/builder-core/`: shared TypeScript library for package inspection, registries, profiles, snapshots, compatibility checks, builds, and bootstrap payloads.
- `apps/cli/`: command-line interface built on `builder-core`.
- `apps/gui/`: local GUI that calls the same builder-core APIs.
- `apps/server/`: hosted multi-user server (REST API, sessions, ownership, async build queue) that runs one shared library directory plus a database for accounts and item metadata. It reuses the `apps/gui/public/` assets through a request-time overlay instead of forking them.
- `deploy/`: systemd unit, nginx server block, and backup/disk-monitoring scripts for the server.
- `wordpress/exporter/`: PHP exporter plugin that runs on a reference WordPress site.
- `wordpress/bootstrap/`: PHP MU-plugin shipped in generated distributions.
- `scripts/`: build, packaging, verification, and PHP lint helpers.
- `docs/`: phase notes, package format, compatibility rules, vNext design-system notes, and server deployment steps.
- `profiles/` and `compatibility/`: example profiles and known-good compatibility data.

## Development conventions

- Use Node.js 20 or newer and npm. The repository is an npm workspace with `apps/*` and `packages/*` workspaces.
- TypeScript uses strict mode, ES modules, NodeNext resolution, and declaration/source-map output. Keep imports compatible with NodeNext.
- Keep builder behavior shared in `packages/builder-core`; do not duplicate build logic in the CLI or GUI.
- Preserve schema and manifest compatibility unless the change explicitly updates the relevant documentation, fixtures, and tests.
- Treat configuration portability as allowlist/adapter-based. Do not add broad database or option copying that could include secrets, users, credentials, uploads, orders, or other non-portable state.
- Keep the system offline-capable. Do not introduce runtime network calls or assumptions that WordPress.org or another remote registry is available.
- Do not commit generated output, local packages, private plugin/theme ZIPs, or local configuration files. The repository ignores `dist/`, `artifacts/`, `builds/`, `private-packages/`, `*.local.json`, and logs for this reason.

## Common commands

Run these from the repository root:

```bash
npm install
npm run build       # compile builder-core, the CLI, and apps/server
npm test            # build and run builder-core, GUI, and server tests
npm run lint:php    # lint PHP exporter/bootstrap files
npm run check       # build, tests, and PHP lint
```

Packaging and artifact verification:

```bash
npm run package:builder
npm run package:exporter
npm run verify:artifacts
```

The CLI entry point after compilation is `apps/cli/dist/index.js`. The GUI launcher scripts are `scripts/wp-starter-gui.cmd` and `scripts/wp-starter-gui.ps1`. The server starts with `npm run start:server` (or `node apps/server/dist/index.js`), reads `apps/server/.env` when present, and supports a `migrate` subcommand that applies database migrations without starting the HTTP listener.

Server tests boot an isolated application per test (`apps/server/tests/harness.mjs`): a temporary library directory, in-memory SQLite, and an ephemeral port. Run them with `npx tsc -b apps/server && node --test apps/server/tests/*.test.mjs`; they execute against `apps/server/dist`, so the TypeScript build must run first.

## Server conventions

- Keep `builder-core` permission-agnostic. Ownership, roles, and CSRF checks live in `apps/server/src/api/` and `apps/server/src/services/ownership.ts`; every write path calls `assertCanWrite`.
- Anyone signed in reads the whole shared library; only the creator may edit or delete. Administrators manage people and invitations and get no rights over another account's items. Items with no owner (imported by the CLI) are manageable by administrators only.
- The database stores identity, ownership, and item metadata. Large payloads stay in the shared file store, and builder-core's file registries remain the on-disk source of truth — the database is a mirror, which is why `LibrarySyncService` reconciles items created outside the web app.
- SQL must stay portable across SQLite and PostgreSQL: TEXT identifiers and timestamps, INTEGER 0/1 booleans, `?` placeholders that `toPostgresPlaceholders()` rewrites. Never use `SERIAL` or dialect-specific functions.
- Never leak internal paths to clients: strip `filePath` and `zip` with `withoutInternalPaths` before sending an item, and prefer application-generated UUIDs over database-assigned identifiers.
- Report `BuilderError` codes instead of a generic 500. `apps/server/src/server.ts` maps them to 400 (or 404 for `*_not_found`).
- Deployment changes belong in `deploy/` and must be described in `docs/SERVER-DEPLOYMENT.md`; keep shell scripts LF via `.gitattributes`.

## Testing and verification

- Add or update focused tests under `packages/builder-core/tests/`, `apps/gui/tests/`, or `apps/server/tests/` for behavior changes.
- Run the narrowest relevant test while iterating, then run `npm run check` before handing off a change that affects runtime behavior, schemas, packaging, or PHP.
- For changes to generated distributions, run `npm run verify:artifacts` and inspect the resulting verification output.
- Prefer temporary directories and synthetic package/configuration fixtures used by the existing tests; never use private production packages or real credentials.
- Server tests must cover the security boundary they touch: permission denials return `403 read_only`, cross-account items stay visible but read-only, and CSRF is required for every non-GET API call.

## Change guidance

- Read the relevant phase/design documentation before changing profile, snapshot, compatibility, bootstrap, or design-system behavior.
- Update `CHANGELOG.md` when a user-visible capability, schema, compatibility rule, or packaging behavior changes.
- Keep security-sensitive behavior explicit and testable, especially archive extraction, path handling, installer cleanup, package integrity, and configuration allowlists.
- Preserve existing user changes in a dirty worktree. Avoid destructive Git commands such as `git reset --hard` or `git checkout --` unless explicitly requested.
- Before finishing, review `git diff` and `git status --short`, and report the checks that were run and any environment-dependent checks that could not be run.
