import { readFile } from "node:fs/promises";
import { badRequest, notFound } from "../errors.js";
import { sendBytes, sendJson, sendText } from "../http/response.js";
import { receiveUpload, safeFileName } from "../http/body.js";
import { requireCsrf, requireUser, queryString } from "./guards.js";
import { publicUser } from "../repositories/users.js";
import { toItemView, type ItemView } from "../services/view.js";
import { isVNextApiKind, VNEXT_KINDS, type VNextApiKind } from "../services/vnext.js";
import { isInfrastructurePackage } from "../services/packages.js";
import { discardUpload } from "../services/snapshots.js";
import type { BuildRecord, OwnedItem, User } from "../types.js";
import type { Router } from "../http/router.js";
import type { AppContext } from "../app-context.js";

type Decorated<T> = T & ItemView;

function decorate<T extends OwnedItem>(item: T, viewer: User, names: Map<string, string>): Decorated<T> {
  return { ...item, ...toItemView(item, viewer, names) };
}

/**
 * Removes the internal library paths before an item crosses the API boundary.
 * `filePath` is the absolute path and `zip` the library-relative one; clients
 * only ever need the id, so neither is exposed.
 */
function withoutInternalPaths<T extends { filePath?: string; zip?: string }>(item: T): Omit<T, "filePath" | "zip"> {
  const { filePath: _filePath, zip: _zip, ...rest } = item;
  return rest;
}

export function registerLibraryRoutes(router: Router, app: AppContext): void {
  const { config, library, log } = app;

  const viewerOf = (context: Parameters<typeof requireUser>[0]): User => requireUser(context);

  // ---------------------------------------------------------------- state ---

  router.get("/api/state", async (context) => {
    const viewer = viewerOf(context);
    const names = await app.users.displayNames();

    const [packages, snapshots, profiles, vnextAll, fonts, elementorTemplates, sampleLibrary, sampleRows, builds] = await Promise.all([
      app.packageItems.list(),
      app.snapshotItems.list(),
      app.profileItems.list(),
      app.vnext.listAll(),
      app.fonts.list(),
      app.library.elementorTemplates().list(),
      app.sampleContent.list(),
      app.sampleItems.list(),
      app.builds.list(200)
    ]);

    /** Items created outside the web app have no owner; administrators may manage those. */
    const unownedView = (id: string, name: string) => ({
      ...toItemView({ id, name, createdBy: null, createdAt: "", updatedAt: "" }, viewer, names)
    });

    const elementorTemplatesView = await Promise.all(
      elementorTemplates.map(async (record) => {
        const item = await app.elementorItems.findById(record.id);
        return { ...record, ...(item ? toItemView(item, viewer, names) : unownedView(record.id, record.name)) };
      })
    );

    const sampleOwnerById = new Map(sampleRows.map((row) => [row.id, row]));
    const withSampleOwnership = <T extends { id: string; title?: string; name?: string; filename?: string }>(rows: T[]) =>
      rows.map((row) => {
        const owned = sampleOwnerById.get(row.id);
        const label = row.title ?? row.name ?? row.filename ?? row.id;
        return {
          ...row,
          ...(owned
            ? toItemView(owned, viewer, names)
            : unownedView(row.id, label))
        };
      });

    sendJson(context.res, 200, {
      version: app.version,
      library: library.root,
      host: config.baseUrl,
      currentUser: publicUser(viewer),
      capabilities: {
        isAdmin: viewer.role === "admin",
        canCreateProfiles: true,
        canUpload: true
      },
      packages: packages
        .filter((item) => !isInfrastructurePackage(item.document))
        .map((item) => withoutInternalPaths({ ...item.document, sizeBytes: item.sizeBytes, ...toItemView(item, viewer, names) })),
      configs: snapshots.map((item) => withoutInternalPaths({ ...item.document, ...toItemView(item, viewer, names) })),
      profiles: profiles.map((item) => ({ ...app.profiles.summarize(item), ...toItemView(item, viewer, names) })),
      fonts: fonts.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
      vnext: {
        typography: vnextAll.typography.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
        colors: vnextAll.colors.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
        designSystems: vnextAll.designSystems.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
        templates: vnextAll.templates.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) }))
      },
      elementorTemplates: elementorTemplatesView,
      builds: builds.map((build) => ({ ...buildView(build), ...buildOwnership(build, viewer, names) })),
      sampleContent: {
        schemaVersion: sampleLibrary.schemaVersion,
        content: withSampleOwnership(sampleLibrary.content),
        terms: withSampleOwnership(sampleLibrary.terms),
        attributes: withSampleOwnership(sampleLibrary.attributes),
        assets: withSampleOwnership(sampleLibrary.assets)
      },
      quota: await app.quota.usage(viewer.id)
    });
  });

  router.get("/api/vnext", async (context) => {
    const viewer = viewerOf(context);
    const names = await app.users.displayNames();
    const all = await app.vnext.listAll();
    sendJson(context.res, 200, {
      typography: all.typography.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
      colors: all.colors.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
      designSystems: all.designSystems.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) })),
      templates: all.templates.map((item) => ({ ...(item.document as object), ...toItemView(item, viewer, names) }))
    });
  });

  // ------------------------------------------------------------- packages ---

  router.post("/api/packages", async (context) => {
    requireCsrf(context);
    await app.disk.assertWritable();
    const user = viewerOf(context);
    const filename = queryString(context, "filename") ?? "package.zip";
    const upload = await receiveUpload(context.req, config.maxUploadBytes, filename, "wp-starter-server-package");

    try {
      assertZip(filename);
      const result = await app.packages.add(upload.file, { replace: queryString(context, "replace") === "1" }, user);
      log.info(`${user.email} imported ${result.item.kind} ${result.item.slug}@${result.item.version}.`);
      sendJson(context.res, 200, {
        ...result,
        record: withoutInternalPaths(result.item.document),
        item: withoutInternalPaths(result.item),
        added: result.added,
        replaced: result.replaced
      });
    } finally {
      await discardUpload(upload.tempDir);
    }
  });

  router.delete("/api/packages", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);

    const id = queryString(context, "id");
    const item = id
      ? await app.packageItems.requireById(id)
      : await resolvePackageByCoordinate(app, context);

    const removed = await app.packages.remove(item.id, user);
    log.info(`${user.email} removed ${removed.kind} ${removed.slug}@${removed.version}.`);
    sendJson(context.res, 200, { removed: withoutInternalPaths(removed) });
  });

  // ---------------------------------------------------------------- fonts ---

  router.post("/api/fonts", async (context) => {
    requireCsrf(context);
    await app.disk.assertWritable();
    const user = viewerOf(context);
    const filename = queryString(context, "filename") ?? "fonts.zip";
    const upload = await receiveUpload(context.req, config.maxUploadBytes, filename, "wp-starter-server-fonts");

    try {
      assertZip(filename);
      const result = await app.fonts.add(
        upload.file,
        { replace: queryString(context, "replace") !== "0", name: queryString(context, "name") ?? undefined },
        user
      );
      log.info(`${user.email} imported ${result.records.length} font profile(s).`);
      sendJson(context.res, 200, { records: result.records, items: result.items, replaced: result.replaced });
    } finally {
      await discardUpload(upload.tempDir);
    }
  });

  router.delete("/api/fonts", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const id = queryString(context, "id");
    if (!id) throw badRequest("invalid_request", "Font profile id is required.");

    const removed = await app.fonts.remove(id, user);
    log.info(`${user.email} removed font profile ${id}.`);
    sendJson(context.res, 200, { removed: removed.document });
  });

  // ------------------------------------------------------------ snapshots ---

  router.post("/api/configs", async (context) => {
    requireCsrf(context);
    await app.disk.assertWritable();
    const user = viewerOf(context);
    const filename = queryString(context, "filename") ?? "starter-config.zip";
    const upload = await receiveUpload(context.req, config.maxUploadBytes, filename, "wp-starter-server-config");

    try {
      assertZip(filename);
      const result = await app.snapshots.add(upload.file, { replace: queryString(context, "replace") === "1" }, user);
      log.info(`${user.email} imported configuration snapshot ${result.item.name}.`);
      sendJson(context.res, 200, {
        record: withoutInternalPaths(result.item.document),
        item: withoutInternalPaths(result.item),
        added: result.added,
        replaced: result.replaced,
        report: result.report
      });
    } finally {
      await discardUpload(upload.tempDir);
    }
  });

  router.get("/api/configs/compare", async (context) => {
    viewerOf(context);
    const left = queryString(context, "left");
    const right = queryString(context, "right");
    if (!left || !right) throw badRequest("invalid_request", "Both left and right snapshot ids are required.");
    sendJson(context.res, 200, await app.snapshots.compare(left, right));
  });

  router.get("/api/configs/:id/check", async (context) => {
    viewerOf(context);
    sendJson(context.res, 200, await app.snapshots.requirements(context.params.id));
  });

  router.get("/api/configs/:id/inspect", async (context) => {
    viewerOf(context);
    sendJson(context.res, 200, await app.snapshots.inspect(context.params.id));
  });

  router.delete("/api/configs/:id", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const removed = await app.snapshots.remove(context.params.id, user);
    log.info(`${user.email} removed configuration snapshot ${removed.name}.`);
    sendJson(context.res, 200, { removed: withoutInternalPaths(removed) });
  });

  // ------------------------------------------------------------- profiles ---

  router.post("/api/profiles", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const result = await app.profiles.save(await context.readJson(), user);
    log.info(`${user.email} saved build profile ${result.file}.`);
    sendJson(context.res, 200, {
      profile: result.profile,
      file: result.file,
      item: result.item,
      compatibility: result.compatibility
    });
  });

  router.post("/api/profiles/compatibility", async (context) => {
    requireCsrf(context);
    viewerOf(context);
    sendJson(context.res, 200, { compatibility: await app.profiles.previewCompatibility(await context.readJson()) });
  });

  router.get("/api/profiles/:file/compatibility", async (context) => {
    viewerOf(context);
    sendJson(context.res, 200, { compatibility: await app.profiles.compatibilityForFile(context.params.file) });
  });

  router.get("/api/profiles/:file", async (context) => {
    viewerOf(context);
    const { item, profile } = await app.profiles.get(context.params.file);
    sendJson(context.res, 200, { profile, file: item.fileName, item });
  });

  router.delete("/api/profiles/:file", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const removed = await app.profiles.remove(context.params.file, user);
    log.info(`${user.email} deleted build profile ${removed.fileName}.`);
    sendJson(context.res, 200, { removed: removed.fileName });
  });

  // --------------------------------------------------------- vNext assets ---

  for (const kind of VNEXT_KINDS) {
    router.post(`/api/vnext/${kind}`, async (context) => {
      requireCsrf(context);
      const user = viewerOf(context);
      const item = await app.vnext.save(kind, await context.readJson(), user);
      log.info(`${user.email} saved ${kind} resource ${item.name}.`);
      sendJson(context.res, 200, { ...(item.document as object), ...toItemView(item, user, await app.users.displayNames()) });
    });

    router.delete(`/api/vnext/${kind}/:id`, async (context) => {
      requireCsrf(context);
      const user = viewerOf(context);
      const removed = await app.vnext.remove(kind, context.params.id, user);
      log.info(`${user.email} deleted ${kind} resource ${context.params.id}.`);
      sendJson(context.res, 200, { removed: removed.document });
    });
  }

  // -------------------------------------------------- Elementor templates ---

  router.get("/api/elementor-templates", async (context) => {
    viewerOf(context);
    const records = await app.elementor.list({
      search: queryString(context, "search") ?? undefined,
      sourceDomain: queryString(context, "source") ?? undefined,
      type: queryString(context, "type") ?? undefined
    });
    sendJson(context.res, 200, records);
  });

  router.delete("/api/elementor-templates/:id", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const removed = await app.elementor.remove(context.params.id, user);
    log.info(`${user.email} removed Elementor template ${context.params.id}.`);
    sendJson(context.res, 200, { removed: removed.document });
  });

  // -------------------------------------------------------- sample content ---

  router.get("/api/sample-content", async (context) => {
    viewerOf(context);
    sendJson(context.res, 200, await app.sampleContent.list());
  });

  router.post("/api/sample-content", async (context) => {
    requireCsrf(context);
    const user = viewerOf(context);
    const saved = await app.sampleContent.save(await context.readJson(), user);
    log.info(`${user.email} saved sample ${saved.kind} ${saved.slug}.`);
    sendJson(context.res, 200, saved);
  });

  router.post("/api/sample-content/terms", async (context) => {
    requireCsrf(context);
    sendJson(context.res, 200, await app.sampleContent.saveTerm(await context.readJson(), viewerOf(context)));
  });

  router.post("/api/sample-content/attributes", async (context) => {
    requireCsrf(context);
    sendJson(context.res, 200, await app.sampleContent.saveAttribute(await context.readJson(), viewerOf(context)));
  });

  router.delete("/api/sample-content/terms/:id", async (context) => {
    requireCsrf(context);
    await app.sampleContent.remove("terms", context.params.id, viewerOf(context));
    sendJson(context.res, 200, { removed: context.params.id });
  });

  router.delete("/api/sample-content/attributes/:id", async (context) => {
    requireCsrf(context);
    await app.sampleContent.remove("attributes", context.params.id, viewerOf(context));
    sendJson(context.res, 200, { removed: context.params.id });
  });

  router.get("/api/sample-content/assets/:id", async (context) => {
    viewerOf(context);
    const asset = await app.sampleContent.resolveAsset(context.params.id);
    sendBytes(context.res, 200, await readFile(asset.absoluteFile), asset.mime);
  });

  router.put("/api/sample-content/assets/:id", async (context) => {
    requireCsrf(context);
    const body = await context.readJson();
    sendJson(context.res, 200, await app.sampleContent.saveAsset(context.params.id, body, viewerOf(context)));
  });

  router.delete("/api/sample-content/assets/:id", async (context) => {
    requireCsrf(context);
    await app.sampleContent.remove("assets", context.params.id, viewerOf(context));
    sendJson(context.res, 200, { removed: context.params.id });
  });

  router.post("/api/sample-content/:id/duplicate", async (context) => {
    requireCsrf(context);
    sendJson(context.res, 200, await app.sampleContent.duplicate(context.params.id, viewerOf(context)));
  });

  router.post("/api/sample-content/:id/assets", async (context) => {
    requireCsrf(context);
    await app.disk.assertWritable();
    const user = viewerOf(context);
    const filename = queryString(context, "filename") ?? "asset";
    const upload = await receiveUpload(context.req, 52 * 1024 * 1024, filename, "wp-starter-server-sample-asset");

    try {
      const asset = await app.sampleContent.importAsset(
        upload.file,
        {
          kind: queryString(context, "kind") === "download" ? "download" : "image",
          filename,
          alt: queryString(context, "alt") ?? "",
          caption: queryString(context, "caption") ?? "",
          description: queryString(context, "description") ?? ""
        },
        user
      );
      sendJson(context.res, 200, asset);
    } finally {
      await discardUpload(upload.tempDir);
    }
  });

  router.get("/api/sample-content/:id", async (context) => {
    viewerOf(context);
    sendJson(context.res, 200, await app.sampleContent.get(context.params.id));
  });

  router.put("/api/sample-content/:id", async (context) => {
    requireCsrf(context);
    const body = await context.readJson();
    sendJson(context.res, 200, await app.sampleContent.save({ ...body, id: context.params.id }, viewerOf(context)));
  });

  router.delete("/api/sample-content/:id", async (context) => {
    requireCsrf(context);
    await app.sampleContent.remove("content", context.params.id, viewerOf(context));
    sendJson(context.res, 200, { removed: context.params.id });
  });

  // ---------------------------------------------------------------- builds ---

  router.get("/api/builds/:id/download", async (context) => {
    viewerOf(context);
    const build = await app.builds.get(context.params.id);
    if (!build.artifactFile) throw notFound("build_artifact_missing", "This build did not produce an artifact.");

    const data = await readFile(app.builds.artifactPath(build));
    sendBytes(context.res, 200, data, "application/zip", {
      headers: { "Content-Disposition": `attachment; filename="${build.artifactFile.replaceAll('"', "")}"` }
    });
  });

  void sendText;
  void isVNextApiKind;
}

/** Builds are owned like any other shared item, so they reuse the same view. */
export function buildOwnership(build: BuildRecord, viewer: User, names: Map<string, string>): ItemView {
  return toItemView(
    {
      id: build.id,
      name: build.profileName,
      createdBy: build.createdBy,
      createdAt: build.createdAt,
      updatedAt: build.completedAt ?? build.createdAt
    },
    viewer,
    names
  );
}

export function buildView(build: BuildRecord) {
  return {
    id: build.id,
    file: build.artifactFile,
    size: build.sizeBytes,
    modifiedAt: build.completedAt ?? build.startedAt ?? build.createdAt,
    profile: build.profileName,
    profileFile: build.profileFile,
    locale: (build.manifest as { locale?: string } | null)?.locale ?? "",
    sha256: build.sha256 ?? "",
    configurationEnabled: (build.manifest as { configurationEnabled?: boolean } | null)?.configurationEnabled === true,
    compatibility: (build.manifest as { compatibility?: unknown } | null)?.compatibility ?? null,
    status: build.status,
    stage: build.stage,
    percent: build.percent,
    message: build.message,
    createdAt: build.createdAt,
    completedAt: build.completedAt,
    error: build.errorCode ? { code: build.errorCode, message: build.errorMessage } : null
  };
}

function assertZip(filename: string): void {
  if (!filename.toLowerCase().endsWith(".zip")) throw badRequest("invalid_upload", "Only .zip files can be imported.");
}

async function resolvePackageByCoordinate(app: AppContext, context: Parameters<typeof requireUser>[0]) {
  const kind = queryString(context, "kind");
  const slug = queryString(context, "slug");
  const version = queryString(context, "version");
  const variant = queryString(context, "variant") ?? undefined;

  if (!kind || !slug || !version) {
    throw badRequest("invalid_request", "Provide id, or kind, slug and version.");
  }
  if (!["plugin", "theme", "wordpress"].includes(kind)) {
    throw badRequest("invalid_request", "kind must be plugin, theme, or wordpress.");
  }

  const candidates = (await app.packageItems.list()).filter(
    (item) => item.kind === kind && item.slug === slug && item.version === version
  );
  const match = variant
    ? candidates.find((item) => item.variant === variant)
    : candidates.length === 1
      ? candidates[0]
      : kind === "wordpress"
        ? candidates.find((item) => item.variant === "en_US")
        : candidates[0];

  if (!match) throw notFound("package_not_found", `${kind} ${slug}@${version} is not in the shared library.`);
  return match;
}

export function sanitizeDownloadName(value: string): string {
  return safeFileName(value, "starter.zip");
}
