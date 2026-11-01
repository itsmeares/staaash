import { jsonBody } from "./request";
import {
  isPublicShareFileNativeViewSafe,
  applyPublicShareContentPolicy,
} from "../../server/media/public-share-content-policy";
import { unavailableHtml } from "../../server/sharing/unavailable-page";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { PreviewEnv } from "./state";
import {
  type State,
  type Share,
  PreviewError,
  fileOf,
  folderOf,
  isDeleted,
  publicFile,
  publicFolder,
  requireUser,
  sizeOf,
  timestamp,
  assertFolderReadable,
  within,
} from "./state";
import { assets, byteResponse, sampleBytes } from "./media";
import { owned } from "./mutations";
import { shareStatus, shareView } from "./views";

function shareFailure(error: unknown) {
  if (!(error instanceof PreviewError) || error.status === 503) throw error;
  return {
    kind: "error" as const,
    error: { code: error.code, message: error.message },
  };
}
function shared(state: State, token: string, unlock = true) {
  const share = state.shares.find((s) => s.token === token);
  if (!share)
    throw new PreviewError(404, "Sample share not found.", "SHARE_INVALID");
  const status = shareStatus(state, share);
  const messages = {
    revoked: "This sample link was revoked.",
    expired: "This sample link expired.",
    "target-unavailable": "This sample item is unavailable.",
  };
  if (status !== "active")
    throw new PreviewError(404, messages[status], "SHARE_INVALID");
  assertFolderReadable(state, share.targetId);
  if (unlock && share.password && !state.unlocked.has(token))
    throw new PreviewError(
      403,
      "Enter the sample link's password.",
      "SHARE_PASSWORD_REQUIRED",
    );
  return share;
}
function nestedFile(state: State, share: Share, id: string) {
  const file = fileOf(state, id);
  if (
    isDeleted(state, file) ||
    (share.targetType === "file"
      ? file.id !== share.targetId
      : !within(state, file.folderId, share.targetId))
  )
    throw new PreviewError(404, "File is outside this sample share.");
  return file;
}
const shareSettings = (share: Share) => ({
  downloadDisabled: share.downloadDisabled,
  expiresAt: share.expiresAt,
});
function folderShareView(state: State, share: Share, folderId: string) {
  if (!within(state, folderId, share.targetId))
    throw new PreviewError(404, "Folder is outside this sample share.");
  const currentFolder = folderOf(state, folderId);
  if (isDeleted(state, currentFolder))
    throw new PreviewError(404, "Sample folder is in Trash.");
  const breadcrumbs = [];
  let parent = currentFolder.parentId;
  while (parent && within(state, parent, share.targetId)) {
    const folder = folderOf(state, parent);
    breadcrumbs.unshift({
      id: folder.id,
      name: folder.name,
      href:
        folder.id === share.targetId
          ? `/s/${share.token}`
          : `/s/${share.token}/f/${folder.id}`,
    });
    parent = folder.parentId;
  }
  return {
    kind: "share",
    resolution: {
      kind: "folder",
      share: shareSettings(share),
      listing: {
        rootFolderId: share.targetId,
        currentFolder: { id: currentFolder.id, name: currentFolder.name },
        breadcrumbs,
        childFolders: state.folders
          .filter((f) => f.parentId === folderId && !isDeleted(state, f))
          .map(publicFolder),
        files: state.files
          .filter((f) => f.folderId === folderId && !isDeleted(state, f))
          .map(publicFile),
      },
    },
    nativeInline: false,
    folderSizeBytes: sizeOf(state, folderId),
  };
}
export function mountShares(app: Hono<PreviewEnv>) {
  app.post("/api/shares", async (c) => {
    const state = c.var.state;
    const body = z
      .object({
        mode: z.enum(["create", "reissue"]).default("create"),
        shareId: z.string().optional(),
        targetType: z.enum(["file", "folder"]).default("file"),
        fileId: z.string().optional(),
        folderId: z.string().optional(),
        expiresAt: z.iso.datetime().default("2036-10-29T12:00:00.000Z"),
        downloadDisabled: z.boolean().default(false),
        password: z.string().min(4).nullable().default(null),
      })
      .parse(await jsonBody(c.req.raw));
    if (body.mode === "reissue") {
      const share = state.shares.find(
        (s) => s.id === body.shareId && s.ownerId === state.userId,
      );
      if (!share) throw new PreviewError(404, "Share not found.");
      const issuedAt = Date.now();
      if (Date.parse(share.expiresAt) <= issuedAt) {
        share.expiresAt = new Date(
          issuedAt + state.settings.shareMaxAgeDays * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
      share.token = randomUUID();
      share.revokedAt = null;
      return c.json({
        share: shareView(state, share, new URL(c.req.url).origin),
      });
    }
    const targetId = body.fileId ?? body.folderId;
    if (!targetId)
      throw new PreviewError(400, "Choose a sample item to share.");
    const item =
      body.targetType === "folder"
        ? folderOf(state, targetId)
        : fileOf(state, targetId);
    owned(state, item);
    const share: Share = {
      id: randomUUID(),
      token: randomUUID(),
      ownerId: requireUser(state).id,
      targetType: body.targetType,
      targetId,
      password: body.password,
      downloadDisabled: body.downloadDisabled,
      expiresAt: body.expiresAt,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.shares.push(share);
    return c.json(
      { share: shareView(state, share, new URL(c.req.url).origin) },
      201,
    );
  });
  app.post("/api/shares/:id/:action", async (c) => {
    const state = c.var.state;
    const share = state.shares.find(
      (s) => s.id === c.req.param("id") && s.ownerId === state.userId,
    );
    if (!share) throw new PreviewError(404, "Share not found.");
    const action = c.req.param("action");
    if (action === "revoke") share.revokedAt = timestamp;
    else if (action === "delete") {
      state.shares = state.shares.filter((s) => s !== share);
      return c.json({ ok: true });
    } else {
      const body = await jsonBody(c.req.raw);
      if (action === "update") {
        const values = z
          .object({
            expiresAt: z.iso.datetime(),
            downloadDisabled: z.boolean(),
          })
          .parse(body);
        Object.assign(share, values);
      } else if (action === "password") {
        const change = z
          .union([
            z.object({ password: z.string().trim().min(4).max(256) }),
            z.object({ clear: z.literal(true) }),
          ])
          .parse(body);
        share.password = "clear" in change ? null : change.password;
        state.unlocked.delete(share.token);
      } else throw new PreviewError(404, "Unknown share action.");
    }
    return c.json({
      share: shareView(state, share, new URL(c.req.url).origin),
    });
  });
  app.get("/s/:token/view", (c) => {
    const state = c.var.state;
    try {
      const share = shared(state, c.req.param("token"), false);
      if (share.password && !state.unlocked.has(share.token))
        return c.json({
          kind: "share",
          resolution: { kind: "locked" },
          nativeInline: false,
          folderSizeBytes: 0,
        });
      if (share.targetType === "file")
        return c.json({
          kind: "share",
          resolution: {
            kind: "file",
            share: shareSettings(share),
            file: publicFile(fileOf(state, share.targetId)),
          },
          nativeInline: isPublicShareFileNativeViewSafe(
            fileOf(state, share.targetId),
          ),
          folderSizeBytes: 0,
        });
      return c.json(
        folderShareView(
          state,
          share,
          c.req.query("folderId") ?? share.targetId,
        ),
      );
    } catch (error) {
      return c.json(shareFailure(error));
    }
  });
  app.post("/s/:token/unlock", async (c) => {
    const state = c.var.state;
    const share = shared(state, c.req.param("token"), false);
    const body = z
      .object({ password: z.string() })
      .parse(await jsonBody(c.req.raw));
    if (body.password !== share.password)
      throw new PreviewError(403, "Incorrect sample password.");
    state.unlocked.add(share.token);
    return c.json({ ok: true });
  });
  app.get("/s/:token/view/files/:id", (c) => {
    const state = c.var.state;
    try {
      const share = shared(state, c.req.param("token"), false);
      if (share.password && !state.unlocked.has(share.token))
        return c.json({ kind: "locked" });
      const file = nestedFile(state, share, c.req.param("id"));
      if (!file.viewerKind) return c.json({ kind: "not-found" });
      return c.json({
        kind: "file",
        backHref:
          file.folderId === share.targetId
            ? `/s/${share.token}`
            : `/s/${share.token}/f/${file.folderId}`,
        contentHref: `/s/${share.token}/files/${file.id}/content`,
        downloadHref: `/s/${share.token}/files/${file.id}/download`,
        file: publicFile(file),
        nativeInline: isPublicShareFileNativeViewSafe(file),
        share: shareSettings(share),
      });
    } catch (error) {
      return c.json(shareFailure(error));
    }
  });
  app.get("/s/:token/storage-unavailable", (c) => {
    try {
      shared(c.var.state, c.req.param("token"));
    } catch (error) {
      if (!(error instanceof PreviewError) || error.status !== 503) throw error;
      return c.html(unavailableHtml, 503, { "Retry-After": "10" });
    }
    return c.redirect(`/s/${c.req.param("token")}`, 307);
  });
  app.get("/s/:token/archive", (c) => {
    const share = shared(c.var.state, c.req.param("token"));
    if (share.targetType !== "folder")
      throw new PreviewError(404, "This sample share is not a folder.");
    if (share.downloadDisabled)
      throw new PreviewError(
        403,
        "Downloads are disabled for this sample link.",
      );
    return byteResponse(
      assets.get("sample.zip")!,
      "application/zip",
      c.req.raw,
      "Sample files.zip",
    );
  });
  for (const path of [
    "/s/:token/:action{content|download|preview|thumbnail|poster}",
    "/s/:token/files/:id/:action{content|download|preview|thumbnail|poster}",
  ])
    app.get(path, (c) => {
      const state = c.var.state;
      const share = shared(state, c.req.param("token")!);
      const action = c.req.param("action");
      if (share.downloadDisabled && action === "download")
        throw new PreviewError(
          403,
          "Downloads are disabled for this sample link.",
        );
      const file = nestedFile(
        state,
        share,
        c.req.param("id") ?? share.targetId,
      );
      const response = byteResponse(
        sampleBytes(state, file.id, ["thumbnail", "poster"].includes(action!)),
        ["thumbnail", "poster"].includes(action!)
          ? "image/jpeg"
          : file.mimeType,
        c.req.raw,
        action === "download" ? file.name : undefined,
      );
      return action === "download"
        ? response
        : applyPublicShareContentPolicy(response, file.name);
    });
}
