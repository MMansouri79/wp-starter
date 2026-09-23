import { badRequest, notFound } from "../errors.js";
import { sendJson } from "../http/response.js";
import { requireCsrf, requireUser, queryString } from "./guards.js";
import { buildOwnership, buildView } from "./library.js";
import type { Router } from "../http/router.js";
import type { AppContext } from "../app-context.js";

/**
 * Asynchronous build jobs.
 *
 * The client POSTs a profile file, receives a job id immediately, then polls
 * `GET /api/build-jobs/:id` for staged progress. This keeps long builds off the
 * request thread and works behind a reverse proxy with a short read timeout.
 */
export function registerBuildRoutes(router: Router, app: AppContext): void {
  const { log } = app;

  router.post("/api/build-jobs", async (context) => {
    requireCsrf(context);
    await app.disk.assertWritable();
    const user = requireUser(context);
    const body = await context.readJson();
    const file = String(body.file ?? body.profile ?? "").trim();
    if (!file) throw badRequest("invalid_request", "A profile file is required.");

    const build = await app.builds.enqueue(file, user);
    log.info(`${user.email} queued build ${build.id} from ${file}.`);
    sendJson(context.res, 202, { id: build.id, status: build.status, stage: build.stage, percent: build.percent, message: build.message });
  });

  router.get("/api/build-jobs", async (context) => {
    const viewer = requireUser(context);
    const [builds, names] = await Promise.all([app.builds.list(200), app.users.displayNames()]);
    sendJson(
      context.res,
      200,
      builds.map((build) => ({ ...buildView(build), ...buildOwnership(build, viewer, names) }))
    );
  });

  router.get("/api/build-jobs/:id", async (context) => {
    const viewer = requireUser(context);
    const build = await app.builds.get(context.params.id);
    const view = buildView(build);

    sendJson(context.res, 200, {
      ...view,
      ...buildOwnership(build, viewer, await app.users.displayNames()),
      current: build.percent,
      total: 100,
      result:
        build.status === "complete"
          ? {
              file: build.artifactFile,
              size: build.sizeBytes,
              sha256: build.sha256,
              profile: build.profileName,
              manifest: build.manifest,
              downloadUrl: `/api/builds/${build.id}/download`
            }
          : null,
      error: build.errorCode ? { code: build.errorCode, message: build.errorMessage } : null
    });
  });

  router.delete("/api/build-jobs/:id", async (context) => {
    requireCsrf(context);
    const user = requireUser(context);
    const removed = await app.builds.remove(context.params.id, user);
    sendJson(context.res, 200, { removed: removed.id });
  });

  /**
   * Compatibility alias for the local GUI's `DELETE /api/builds?file=`.
   * It resolves an artifact file name back to its build job.
   */
  router.delete("/api/builds", async (context) => {
    requireCsrf(context);
    const user = requireUser(context);
    const file = queryString(context, "file");
    if (!file) throw badRequest("invalid_request", "A build file name is required.");

    const match = (await app.builds.list(500)).find((build) => build.artifactFile === file);
    if (!match) throw notFound("build_not_found", `No build artifact named ${file} was found.`);

    const removed = await app.builds.remove(match.id, user);
    sendJson(context.res, 200, { removed: removed.id, file });
  });
}
