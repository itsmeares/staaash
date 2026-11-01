import type { Hono } from "hono";
import type { PreviewEnv } from "./state";
import { z } from "zod";
import { jsonBody } from "./request";
import { randomUUID } from "node:crypto";
import {
  PreviewError,
  rootOf,
  fileOf,
  folderOf,
  isDeleted,
  pathOf,
  publicFolder,
  previewStatus,
} from "./state";
import {
  owned,
  destination,
  nameSchema,
  changeItem,
  createFolder,
} from "./mutations";
import { assets, byteResponse, sampleBytes } from "./media";

export function mountFiles(app: Hono<PreviewEnv>) {
  app.post("/api/files/folders", async (c) => {
    const body = await jsonBody(c.req.raw);
    return c.json(
      {
        folder: publicFolder(
          createFolder(
            c.var.state,
            z
              .string()
              .parse(body.parentId ?? body.folderId ?? rootOf(c.var.state).id),
            nameSchema.parse(body.name),
          ),
        ),
      },
      201,
    );
  });
  app.get("/api/files/folders/tree", (c) =>
    c.json({
      instanceName: c.var.state.instanceName,
      folders: c.var.state.folders
        .filter(
          (f) =>
            f.ownerUserId === c.var.state.userId && !isDeleted(c.var.state, f),
        )
        .map((f) => ({
          ...publicFolder(f),
          pathLabel: pathOf(c.var.state, f.id),
          color: f.color ?? null,
        })),
    }),
  );
  app.post("/api/files/folders/:id/appearance", async (c) => {
    const body = await jsonBody(c.req.raw);
    const folder = owned(c.var.state, folderOf(c.var.state, c.req.param("id")));
    folder.color = z
      .string()
      .nullable()
      .parse(body.color ?? null);
    folder.icon = z
      .string()
      .nullable()
      .parse(body.icon ?? null);
    return c.json({ color: folder.color, icon: folder.icon });
  });
  app.post("/api/files/files/:id/derivative", (c) => {
    const file = owned(c.var.state, fileOf(c.var.state, c.req.param("id")));
    c.var.state.previewStates.set(file.id, "ready");
    return c.json({ status: "ready" });
  });
  app.post("/api/files/:kind/:id/:action", async (c) =>
    c.json(
      changeItem(
        c.var.state,
        c.req.param("kind"),
        c.req.param("id"),
        c.req.param("action"),
        await jsonBody(c.req.raw),
      ),
    ),
  );
  app.get("/api/files/move", (c) => c.json([...c.var.state.moves.values()]));
  app.post("/api/files/move", async (c) => {
    const body = await jsonBody(c.req.raw);
    const items = z
      .array(z.object({ id: z.string(), kind: z.enum(["file", "folder"]) }))
      .min(1)
      .parse(body.items);
    const target = destination(
      c.var.state,
      z.string().parse(body.destinationFolderId ?? rootOf(c.var.state).id),
    );
    const results = items.map((item) => {
      try {
        changeItem(
          c.var.state,
          item.kind === "file" ? "files" : "folders",
          item.id,
          "move",
          { destinationFolderId: target.id },
        );
        return { ...item, status: "moved" as const };
      } catch (error) {
        return {
          ...item,
          status: "failed" as const,
          code: "MOVE_FAILED",
          error: error instanceof Error ? error.message : "Sample move failed.",
        };
      }
    });
    const response = {
      movedCount: results.filter((r) => r.status === "moved").length,
      failedCount: results.filter((r) => r.status === "failed").length,
      results,
    };
    const operation = {
      operationId: randomUUID(),
      status: "succeeded" as const,
      response,
    };
    c.var.state.moves.set(operation.operationId, operation);
    return c.json(operation);
  });
  app.get("/api/files/move/:id", (c) => {
    const move = c.var.state.moves.get(c.req.param("id"));
    if (!move) throw new PreviewError(404, "Move not found.");
    return c.json(move);
  });
  app.post("/api/files/trash/clear", (c) => {
    const state = c.var.state;
    const files = state.files.filter(
      (f) => f.ownerUserId === state.userId && isDeleted(state, f),
    );
    const folders = state.folders.filter(
      (f) => f.ownerUserId === state.userId && isDeleted(state, f),
    );
    const ids = new Set([...files, ...folders].map((i) => i.id));
    state.files = state.files.filter((f) => !ids.has(f.id));
    state.folders = state.folders.filter((f) => !ids.has(f.id));
    state.shares = state.shares.filter((s) => !ids.has(s.targetId));
    for (const id of ids) state.blobs.delete(id);
    return c.json({
      deletedFileCount: files.length,
      deletedFolderCount: folders.length,
    });
  });
  app.get("/api/files/files/:id/:action", (c) => {
    const state = c.var.state;
    const file = owned(state, fileOf(state, c.req.param("id")));
    if (isDeleted(state, file))
      throw new PreviewError(404, "File is in Trash.");
    const action = c.req.param("action");
    if (action === "derivative")
      return c.json({ status: previewStatus(state, file.id) });
    if (!["content", "download", "thumbnail", "preview"].includes(action))
      throw new PreviewError(404, "Unknown sample file request.");
    return byteResponse(
      sampleBytes(state, file.id, action === "thumbnail"),
      action === "thumbnail" ? "image/jpeg" : file.mimeType,
      c.req.raw,
      action === "download" ? file.name : undefined,
    );
  });
  app.post("/api/files/archives", (c) =>
    c.json({
      archiveId: "sample",
      status: c.var.state.scenario === "error" ? "failed" : "ready",
    }),
  );
  app.get("/api/files/archives/:id", (c) =>
    c.json({
      status: c.var.state.scenario === "error" ? "failed" : "ready",
      fileCount: 1,
      sizeBytes: String(assets.get("sample.zip")!.byteLength),
      error: c.var.state.scenario === "error" ? "Sample archive failed." : null,
    }),
  );
  app.get("/api/files/archives/:id/download", (c) =>
    byteResponse(
      assets.get("sample.zip")!,
      "application/zip",
      c.req.raw,
      "Sample files.zip",
    ),
  );
}
