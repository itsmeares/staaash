import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createState,
  type PreviewEnv,
  type Scenario,
  scenarios,
  PreviewError,
  requireUser,
  password,
  uploadLimits,
  isDeleted,
} from "./state";
import type { Assets } from "./media";
import { mountAuth } from "./auth";
import { mountViews } from "./routes";
import { mountFiles } from "./files";
import { mountAdmin } from "./admin-routes";
import { mountShares } from "./shares";
import { mountUploads } from "./uploads";

function checkOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new PreviewError(
      403,
      "Open preview controls on this preview's address.",
    );
}
/** A fresh sample drive whose file sizes match the sample bytes. */
export function seedState(assets: Assets, scenario?: Scenario) {
  const state = createState(scenario);
  for (const file of state.files) file.sizeBytes = assets.size(file.asset);
  return state;
}
/**
 * The sample API. `session` finds the visitor's drive and sets `state`,
 * `assets` and `site`: cookie sessions in dev, the browser's saved drive in
 * the demo.
 */
export function createPreviewApp(session: MiddlewareHandler<PreviewEnv>) {
  const streams = new Set<() => void>();
  const app = new Hono<PreviewEnv>();
  app.onError((error, c) => {
    if (error instanceof PreviewError)
      return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: error.issues[0]?.message ?? "Invalid sample request.",
          code: "INVALID_REQUEST",
        },
        400,
      );
    console.error("[ui preview]", error);
    return c.json(
      {
        error:
          "The sample API could not answer this request. Check the preview log.",
        code: "UI_PREVIEW_ERROR",
      },
      500,
    );
  });
  app.use("*", async (c, next) => {
    checkOrigin(c.req.raw);
    await next();
  });
  app.use("*", session);
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("*", (c, next) =>
    bodyLimit({
      maxSize: uploadLimits(c.var.state).total + 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: "This upload is larger than the sample drive allows.",
            code: "UI_PREVIEW_LIMIT",
          },
          413,
        ),
    })(c, next),
  );
  app.get("/__ui/state", (c) => {
    const state = c.var.state;
    return c.json({
      scenario: state.scenario,
      scenarios,
      password,
      uploadLimit: uploadLimits(state).total,
      users: state.users.map((u) => ({ email: u.email, role: u.role })),
      userId: state.userId,
      archiveFolderId:
        state.folders.find(
          (folder) =>
            folder.id === `${state.userId}-archive` &&
            !isDeleted(state, folder),
        )?.id ?? null,
    });
  });
  app.post("/__ui/scenario", async (c) => {
    const form = await c.req.parseBody();
    const scenario = z
      .enum(Object.keys(scenarios) as [Scenario, ...Scenario[]])
      .parse(form.scenario);
    Object.assign(c.var.state, seedState(c.var.assets, scenario));
    const path =
      typeof form.path === "string" && /^\/(?![/\\])/.test(form.path)
        ? form.path
        : "/__ui";
    return c.redirect(path, 303);
  });
  mountAuth(app);
  app.get("/api/desktop-app", (c) => {
    requireUser(c.var.state);
    return c.redirect("https://github.com/itsmeares/staaash/releases", 302);
  });
  mountViews(app);
  mountFiles(app);
  mountAdmin(app, streams);
  mountUploads(app);
  mountShares(app);
  app.notFound((c) => {
    console.error(`[ui preview] Unhandled ${c.req.method} ${c.req.path}`);
    return c.json(
      {
        error: `No sample reply for ${c.req.method} ${c.req.path}.`,
        code: "UI_PREVIEW_UNHANDLED",
      },
      404,
    );
  });
  return { app, close: () => streams.forEach((stop) => stop()) };
}
