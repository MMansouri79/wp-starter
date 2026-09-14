# Agent Guide

## Project overview

WP Starter System is an offline-first WordPress starter build system. It has three main parts:

- `packages/builder-core/`: shared TypeScript library for package inspection, registries, profiles, snapshots, compatibility checks, builds, and bootstrap payloads.
- `apps/cli/`: command-line interface built on `builder-core`.
- `apps/gui/`: local GUI that calls the same builder-core APIs.
- `wordpress/exporter/`: PHP exporter plugin that runs on a reference WordPress site.
- `wordpress/bootstrap/`: PHP MU-plugin shipped in generated distributions.
- `scripts/`: build, packaging, verification, and PHP lint helpers.
- `docs/`: phase notes, package format, compatibility rules, and vNext design-system notes.
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
npm run build       # compile builder-core and CLI
npm test            # build and run Node/GUI tests
npm run lint:php    # lint PHP exporter/bootstrap files
npm run check       # build, tests, and PHP lint
```

Packaging and artifact verification:

```bash
npm run package:builder
npm run package:exporter
npm run verify:artifacts
```

The CLI entry point after compilation is `apps/cli/dist/index.js`. The GUI launcher scripts are `scripts/wp-starter-gui.cmd` and `scripts/wp-starter-gui.ps1`.

## Testing and verification

- Add or update focused tests under `packages/builder-core/tests/` or `apps/gui/tests/` for behavior changes.
- Run the narrowest relevant test while iterating, then run `npm run check` before handing off a change that affects runtime behavior, schemas, packaging, or PHP.
- For changes to generated distributions, run `npm run verify:artifacts` and inspect the resulting verification output.
- Prefer temporary directories and synthetic package/configuration fixtures used by the existing tests; never use private production packages or real credentials.

## Change guidance

- Read the relevant phase/design documentation before changing profile, snapshot, compatibility, bootstrap, or design-system behavior.
- Update `CHANGELOG.md` when a user-visible capability, schema, compatibility rule, or packaging behavior changes.
- Keep security-sensitive behavior explicit and testable, especially archive extraction, path handling, installer cleanup, package integrity, and configuration allowlists.
- Preserve existing user changes in a dirty worktree. Avoid destructive Git commands such as `git reset --hard` or `git checkout --` unless explicitly requested.
- Before finishing, review `git diff` and `git status --short`, and report the checks that were run and any environment-dependent checks that could not be run.
