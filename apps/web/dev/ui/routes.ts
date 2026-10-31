import type { Hono } from "hono";
import type { PreviewEnv } from "./state";
import { z } from "zod";
import { jsonBody } from "./request";
import {
  timestamp,
  rootOf,
  fileOf,
  folderOf,
  recentItem,
  pathOf,
  isDeleted,
  PreviewError,
} from "./state";
import { owned } from "./mutations";
import { updateView } from "./admin";
import {
  filesView,
  folderBatch,
  homeView,
  ownedItems,
  settingsView,
  shareStatus,
  shareView,
  shellView,
  viewerWindow,
  windowItems,
} from "./views";

export function mountViews(app: Hono<PreviewEnv>) {
  app.get("/api/views/shell", (c) =>
    c.json(shellView(c.var.state, updateView(c.var.state))),
  );
  app.get("/api/views/home", (c) =>
    c.json(homeView(c.var.state, new URL(c.req.url).origin)),
  );
  app.get("/api/views/settings", (c) => c.json(settingsView(c.var.state)));
  app.get("/api/views/files", (c) =>
    c.json(filesView(c.var.state, new URL(c.req.url).origin)),
  );
  app.get("/api/views/files/:id", (c) =>
    c.json(
      filesView(c.var.state, new URL(c.req.url).origin, c.req.param("id")),
    ),
  );
  app.post("/api/views/files/:id/:action", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      folderBatch(
        c.var.state,
        new URL(c.req.url).origin,
        c.req.param("id"),
        body.query,
        c.req.param("action") === "selection",
      ),
    );
  });
  app.get("/api/views/files/:id/viewer", (c) =>
    c.json(
      viewerWindow(
        c.var.state,
        c.req.param("id"),
        Number(c.req.query("offset")) || 0,
      ),
    ),
  );
  app.get("/api/views/viewer/:id", (c) => {
    const file = owned(c.var.state, fileOf(c.var.state, c.req.param("id")));
    if (!file.viewerKind || isDeleted(c.var.state, file))
      throw new PreviewError(404, "File not found.");
    const folderId = file.folderId ?? rootOf(c.var.state).id;
    return c.json({
      backHref:
        folderId === rootOf(c.var.state).id ? "/files" : `/files/f/${folderId}`,
      fileId: file.id,
      folderId,
      ...viewerWindow(c.var.state, folderId),
    });
  });
  app.get("/api/views/storage-unavailable/:id", (c) =>
    c.json(
      c.var.state.recovering
        ? { available: false, recoveryRequired: true }
        : {
            available: true,
            isFilesRoot: folderOf(c.var.state, c.req.param("id")).isFilesRoot,
          },
    ),
  );
  app.post("/api/views/recent/activity/resolve", async (c) => {
    const body = await jsonBody(c.req.raw);
    const ids = z.array(z.string()).parse(body.ids);
    return c.json(
      ownedItems(c.var.state, true)
        .filter((item) => ids.includes(item.id))
        .map((item) => recentItem(c.var.state, item)),
    );
  });
  for (const route of ["favorites", "recent/:show", "trash", "shares/:mode"]) {
    app.post(`/api/views/${route}/:selection?`, async (c) => {
      const state = c.var.state;
      const body = await jsonBody(c.req.raw);
      const all = c.req.param("selection") === "selection";
      if (route.startsWith("shares")) {
        const shares = state.shares
          .filter(
            (s) =>
              s.ownerId === state.userId &&
              (shareStatus(state, s) === "active") ===
                (c.req.param("mode") === "live"),
          )
          .map((s) => shareView(state, s, new URL(c.req.url).origin));
        const page = windowItems(
          shares.map((s) => ({
            ...s,
            kind: s.targetType,
            name: s.target.name,
            locationLabel: s.target.pathLabel,
            mimeType:
              s.target.targetType === "file" ? s.target.mimeType : undefined,
          })),
          body.query,
          all,
        );
        return c.json(page);
      }
      let items = ownedItems(
        state,
        route === "trash" || route.startsWith("recent"),
      );
      if (route === "favorites") items = items.filter((i) => i.favorite);
      if (route === "trash") items = items.filter((i) => i.deletedAt);
      const rows = items.map((item) => ({
        ...recentItem(state, item),
        favoritedAt: timestamp,
        quickAccessPinnedAt: item.pinned ? timestamp : null,
        deletedAt: item.deletedAt,
        restoreTargetLabel: pathOf(
          state,
          "folderId" in item ? item.folderId : item.parentId,
        ),
      }));
      return c.json({
        ...windowItems(rows, body.query, all),
        ...(route === "trash" ? { retentionDays: 30 } : {}),
      });
    });
  }
  app.get("/api/views/search", (c) => {
    const q = c.req.query("q") ?? "";
    const limit = Math.min(200, Number(c.req.query("pageSize")) || 50);
    const offset = Math.max(0, (Number(c.req.query("page")) || 1) - 1) * limit;
    return c.json(
      windowItems(
        ownedItems(c.var.state).map((i) => recentItem(c.var.state, i)),
        { find: q, offset, limit },
      ),
    );
  });
  app.get("/api/search", (c) => {
    const q = (c.req.query("q") ?? "").toLowerCase();
    const matching = ownedItems(c.var.state).filter((i) =>
      i.name.toLowerCase().includes(q),
    );
    return c.json({
      total: matching.length,
      results: matching.slice(0, 8).map((item) => {
        const i = recentItem(c.var.state, item);
        return {
          id: i.id,
          kind: i.kind,
          name: i.name,
          href: i.href,
          mimeType: i.mimeType ?? null,
          location: i.locationLabel,
        };
      }),
    });
  });
}
