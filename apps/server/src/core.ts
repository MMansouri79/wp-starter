/**
 * Single re-export point for the shared build library.
 *
 * The server never reimplements build logic: it calls the same builder-core
 * APIs the CLI and the local GUI use, so registry, snapshot, profile, and build
 * behavior stay identical across all three front ends.
 */
export * from "../../../packages/builder-core/dist/index.js";
