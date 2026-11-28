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
import { sampleText } from "./fixtures";
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
  app.get("/api/views/home", (c) => c.json(homeView(c.var.state, c.var.site)));
  app.get("/api/views/recovered-notice", (c) =>
    c.json(
      c.var.state.recoveredNotice
        ? {
            ids: ["member-recovered-change"],
            items: [
              {
                id: "member-recovered",
                kind: "folder" as const,
                name: "Photos (recovered, 2026-11-25 14-09)",
                folderId: null,
              },
            ],
          }
        : null,
    ),
  );
  app.post("/api/views/recovered-notice/seen", (c) => {
    c.var.state.recoveredNotice = false;
    return c.json({ ok: true as const });
  });
  app.get("/api/views/settings", (c) => c.json(settingsView(c.var.state)));
  app.get("/api/views/files", (c) =>
    c.json(filesView(c.var.state, c.var.site)),
  );
  app.get("/api/views/files/:id", (c) =>
    c.json(filesView(c.var.state, c.var.site, c.req.param("id"))),
  );
  app.post("/api/views/files/:id/:action", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      folderBatch(
        c.var.state,
        c.var.site,
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
    // Like the server: a file mid-mutation is not in its viewer window, so it does not open.
    if (
      !file.viewerKind ||
      file.storageMutation ||
      isDeleted(c.var.state, file)
    )
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
        ? {
            available: false,
            recoveryRequired: true,
            mutationId: "sample-move",
          }
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
          .map((s) => shareView(state, s, c.var.site));
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
  // Name matches first, then files whose sample text has every word.
  const searchItems = (state: PreviewEnv["Variables"]["state"], q: string) => {
    const name = q.replaceAll('"', "").trim().toLowerCase();
    const items = ownedItems(state).flatMap(
      (item): { item: typeof item; snippet: string | null }[] => {
        if (item.name.toLowerCase().includes(name)) {
          return [{ item, snippet: null }];
        }
        const snippet = "asset" in item ? textSnippet(item.asset, q) : null;
        return snippet ? [{ item, snippet }] : [];
      },
    );
    return [
      ...items.filter((match) => !match.snippet),
      ...items.filter((match) => match.snippet),
    ].map(({ item, snippet }) => ({
      ...recentItem(state, item),
      ...(snippet ? { snippet } : {}),
    }));
  };
  app.get("/api/views/search", (c) => {
    const limit = Math.min(200, Number(c.req.query("pageSize")) || 50);
    const offset = Math.max(0, (Number(c.req.query("page")) || 1) - 1) * limit;
    const items = searchItems(c.var.state, c.req.query("q") ?? "");
    return c.json({
      total: items.length,
      items: items.slice(offset, offset + limit),
    });
  });
  app.get("/api/search", (c) => {
    const matching = searchItems(c.var.state, c.req.query("q") ?? "");
    return c.json({
      total: matching.length,
      results: matching.slice(0, 8).map((i) => ({
        id: i.id,
        kind: i.kind,
        name: i.name,
        href: i.href,
        mimeType: i.mimeType ?? null,
        location: i.locationLabel,
        match: i.snippet ? "text" : "name",
        ...(i.snippet ? { snippet: i.snippet } : {}),
      })),
    });
  });
}

const fold = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Words around the first hit when every searched word starts a word of the sample text. */
const textSnippet = (asset: string, q: string) => {
  const text = sampleText[asset];
  const words = fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
  if (!text || words.length === 0) return null;
  const hits = words.map((word) =>
    fold(text).search(new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "u")),
  );
  if (hits.some((at) => at < 0)) return null;
  const at = Math.min(...hits);
  // Whole words around the hit, as PostgreSQL's ts_headline gives them.
  const before = text.slice(0, at).split(/\s+/).slice(-12);
  const after = text.slice(at).split(/\s+/).slice(0, 12);
  return [...before, ...after].join(" ").replace(/\s+/g, " ").trim();
};
