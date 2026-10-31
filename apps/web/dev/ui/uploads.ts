import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { PreviewEnv } from "./state";
import {
  type State,
  memoryLimit,
  PreviewError,
  publicFile,
  rootOf,
} from "./state";
import { addFile, createFolder, destination, nameSchema } from "./mutations";

const usedMemory = (state: State) =>
  [...state.blobs.values()].reduce((sum, b) => sum + b.byteLength, 0) +
  [...state.uploads.values()].reduce((sum, u) => sum + u.total, 0);
const sessionView = (
  upload: State["uploads"] extends Map<string, infer U> ? U : never,
) => ({
  id: upload.id,
  receivedBytes: upload.received,
  protocolVersion: 2,
  chunkSizeBytes: 1024 * 1024,
  completedChunks: [...upload.chunks].map(([start, data]) => ({
    chunkIndex: start / (1024 * 1024),
    startByte: start,
    endByte: start + data.byteLength,
    sizeBytes: data.byteLength,
  })),
  expiresAt: "2036-10-29T12:00:00.000Z",
});
const uploadOf = (state: State, id: string) => {
  const upload = state.uploads.get(id);
  if (!upload) throw new PreviewError(404, "Sample upload not found.");
  return upload;
};
function chunkStart(range: string, total: number, size: number) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!match || Number(match[3]) !== total)
    throw new PreviewError(400, "Invalid sample chunk range.");
  const start = Number(match[1]),
    end = Number(match[2]);
  if (
    start % (1024 * 1024) !== 0 ||
    end - start + 1 !== size ||
    end >= total ||
    size > 1024 * 1024
  )
    throw new PreviewError(400, "Invalid sample chunk size.");
  return start;
}
export function mountUploads(app: Hono<PreviewEnv>) {
  app.post("/api/files/folders/ensure", async (c) => {
    const body = z
      .object({ folderId: z.string(), paths: z.array(z.string()).max(100) })
      .parse(await c.req.json());
    const state = c.var.state;
    destination(state, body.folderId);
    const folders = body.paths.map((path) => {
      let parentId = body.folderId;
      for (const part of path.split("/")) {
        nameSchema.parse(part);
        const existing = state.folders.find(
          (f) => f.parentId === parentId && f.name === part && !f.deletedAt,
        );
        parentId = existing?.id ?? createFolder(state, parentId, part).id;
      }
      return { path, folderId: parentId };
    });
    return c.json({ folders }, 201);
  });
  app.post("/api/files/files", async (c) => {
    const form = await c.req.formData();
    const folderId = z
      .string()
      .parse(form.get("folderId") ?? rootOf(c.var.state).id);
    const files = form
      .getAll("files")
      .filter((file): file is File => typeof file !== "string");
    if (!files.length) throw new PreviewError(400, "Choose a file to upload.");
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (usedMemory(c.var.state) + total > memoryLimit)
      throw new PreviewError(
        413,
        "Sample uploads are limited to 16 MiB. Reset the sample drive to clear them.",
      );
    const uploadedFiles = [];
    for (const file of files)
      uploadedFiles.push(
        publicFile(
          addFile(
            c.var.state,
            folderId,
            file.name,
            file.type || "application/octet-stream",
            new Uint8Array(await file.arrayBuffer()),
          ),
        ),
      );
    return c.json({ uploadedFiles, failedFiles: [] }, 201);
  });
  app.post("/api/uploads/sessions", async (c) => {
    const body = z
      .object({
        originalName: nameSchema,
        mimeType: z.string(),
        totalSizeBytes: z.number().int().min(0).max(memoryLimit),
        folderId: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const folder = destination(
      c.var.state,
      body.folderId ?? rootOf(c.var.state).id,
    );
    if (usedMemory(c.var.state) + body.totalSizeBytes > memoryLimit)
      throw new PreviewError(413, "Sample uploads are limited to 16 MiB.");
    const upload = {
      id: randomUUID(),
      name: body.originalName,
      mimeType: body.mimeType,
      folderId: folder.id,
      total: body.totalSizeBytes,
      chunks: new Map<number, Uint8Array<ArrayBuffer>>(),
      received: 0,
    };
    c.var.state.uploads.set(upload.id, upload);
    return c.json(sessionView(upload), 201);
  });
  app.get("/api/uploads/sessions/:id", (c) => {
    const upload = uploadOf(c.var.state, c.req.param("id"));
    return c.json({
      ...sessionView(upload),
      totalSizeBytes: upload.total,
      status: "receiving",
    });
  });
  app.patch("/api/uploads/sessions/:id", async (c) => {
    const upload = uploadOf(c.var.state, c.req.param("id"));
    const data = new Uint8Array(await c.req.arrayBuffer());
    const start = chunkStart(
      c.req.header("content-range") ?? "",
      upload.total,
      data.byteLength,
    );
    upload.chunks.set(start, data);
    upload.received = [...upload.chunks.values()].reduce(
      (sum, b) => sum + b.byteLength,
      0,
    );
    return c.json({
      receivedBytes: upload.received,
      chunkIndex: start / (1024 * 1024),
    });
  });
  app.delete("/api/uploads/sessions/:id", (c) => {
    c.var.state.uploads.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/api/uploads/sessions/:id/complete", (c) => {
    const upload = uploadOf(c.var.state, c.req.param("id"));
    if (upload.received !== upload.total)
      throw new PreviewError(409, "Finish sending the sample upload first.");
    const bytes = new Uint8Array(upload.total);
    for (const [start, data] of upload.chunks) bytes.set(data, start);
    c.var.state.uploads.delete(upload.id);
    return c.json(
      publicFile(
        addFile(
          c.var.state,
          upload.folderId,
          upload.name,
          upload.mimeType,
          bytes,
        ),
      ),
      201,
    );
  });
}
