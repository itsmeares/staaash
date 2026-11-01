import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  createState,
  type PreviewEnv,
  type State,
  type Scenario,
  scenarios,
  PreviewError,
  password,
  memoryLimit,
  isDeleted,
} from "./state";
import { assets } from "./media";
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
function expireSessions(
  sessions: Map<string, { state: State; lastSeen: number }>,
) {
  for (const [id, session] of sessions)
    if (Date.now() - session.lastSeen > 2 * 60 * 60 * 1000) sessions.delete(id);
}
export function createPreviewApp() {
  const sessions = new Map<string, { state: State; lastSeen: number }>();
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
    expireSessions(sessions);
    let id = getCookie(c, "staaash_ui_session");
    if (!id || !sessions.has(id)) {
      if (sessions.size >= 16) sessions.delete(sessions.keys().next().value!);
      id = randomUUID();
      const state = createState();
      for (const file of state.files)
        file.sizeBytes = assets.get(file.asset)?.byteLength ?? 0;
      sessions.set(id, { state, lastSeen: Date.now() });
      setCookie(c, "staaash_ui_session", id, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
      });
    }
    const session = sessions.get(id)!;
    session.lastSeen = Date.now();
    c.set("state", session.state);
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: memoryLimit + 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: "Sample uploads are limited to 16 MiB.",
            code: "UI_PREVIEW_LIMIT",
          },
          413,
        ),
    }),
  );
  app.get("/__ui/state", (c) => {
    const state = c.var.state;
    return c.json({
      scenario: state.scenario,
      scenarios,
      password,
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
    const state = createState(scenario);
    for (const file of state.files)
      file.sizeBytes = assets.get(file.asset)?.byteLength ?? 0;
    Object.assign(c.var.state, state);
    const path =
      typeof form.path === "string" && /^\/(?![/\\])/.test(form.path)
        ? form.path
        : "/__ui";
    return c.redirect(path, 303);
  });
  mountAuth(app);
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
  return {
    app,
    close: () => {
      for (const stop of streams) stop();
      sessions.clear();
    },
  };
}
