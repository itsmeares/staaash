import { createRoute, z } from "@hono/zod-openapi";

import { assertStorageProtocolReady } from "@/server/durable-storage-mutation";
import { normalizeFileName } from "@/server/files/storage-layout";
import {
  errorResponses,
  httpError,
  requireUser,
  router,
} from "@/server/http/core";
import { json, jsonBody } from "@/server/http/schemas";
import { assertUploadSizeAllowed } from "@/server/uploads";
import {
  requireStorageProtocol,
  writeUploadChunk,
} from "@/server/uploads/chunk-upload";
import { completeResumableUpload } from "@/server/uploads/complete";
import {
  cancelAndCleanupResumableSession,
  createResumableSession,
  findActiveResumableSession,
} from "@/server/uploads/session-service";

const Checksum = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i)
  .openapi({ description: "SHA-256 of the whole file, hex." });

const SessionParams = z.object({ id: z.string() });

const UploadSessionSchema = z
  .object({
    id: z.string(),
    receivedBytes: z.number().int(),
    protocolVersion: z.number().int(),
    chunkSizeBytes: z.number().int().nullable(),
    completedChunks: z.array(
      z.object({
        chunkIndex: z.number().int(),
        startByte: z.number().int(),
        endByte: z.number().int(),
        sizeBytes: z.number().int(),
      }),
    ),
    expiresAt: z.date(),
  })
  .openapi("UploadSession");

const createSession = createRoute({
  method: "post",
  path: "/api/uploads/sessions",
  tags: ["Uploads"],
  summary:
    "Start a resumable upload. Send chunks with PATCH, then complete it.",
  middleware: [requireUser],
  request: {
    body: jsonBody(
      z.object({
        folderId: z.string().nullable().default(null),
        originalName: z.string().trim().min(1),
        mimeType: z.string().trim().min(1),
        totalSizeBytes: z.number().int().positive(),
        conflictStrategy: z
          .enum(["fail", "safeRename", "replace"])
          .default("safeRename"),
        expectedChecksum: Checksum.nullable().default(null),
        clientModifiedAt: z.coerce.date().nullable().default(null).openapi({
          description:
            "The file's modified time on the uploader's computer, kept with the file.",
        }),
      }),
    ),
  },
  responses: {
    201: json(UploadSessionSchema, "Started."),
    413: { description: "Larger than the upload limit." },
    ...errorResponses,
  },
});

const readSession = createRoute({
  method: "get",
  path: "/api/uploads/sessions/{id}",
  tags: ["Uploads"],
  summary: "Where a resumable upload stands, to resume after a restart.",
  middleware: [requireUser],
  request: { params: SessionParams },
  responses: {
    200: json(
      UploadSessionSchema.extend({
        totalSizeBytes: z.number().int(),
        status: z.string(),
      }),
      "The session.",
    ),
    ...errorResponses,
  },
});

const writeChunk = createRoute({
  method: "patch",
  path: "/api/uploads/sessions/{id}",
  tags: ["Uploads"],
  summary:
    "Send one chunk as the raw body with `Content-Range: bytes start-end/total`, aligned to chunkSizeBytes. Chunks may go in parallel.",
  middleware: [requireUser],
  request: { params: SessionParams },
  responses: {
    200: { description: "Stored. Answers `{ receivedBytes, chunkIndex }`." },
    ...errorResponses,
  },
});

const cancelSession = createRoute({
  method: "delete",
  path: "/api/uploads/sessions/{id}",
  tags: ["Uploads"],
  summary: "Cancel a resumable upload and delete its staged bytes.",
  middleware: [requireUser],
  request: { params: SessionParams },
  responses: { 204: { description: "Cancelled." }, ...errorResponses },
});

const completeSession = createRoute({
  method: "post",
  path: "/api/uploads/sessions/{id}/complete",
  tags: ["Uploads"],
  summary:
    "Verify the checksum and add the file. With conflictStrategy `replace`, the existing file keeps its id.",
  middleware: [requireUser],
  request: {
    params: SessionParams,
    body: {
      description: "Required for chunked (protocol 2) sessions.",
      content: {
        "application/json": {
          schema: z.object({
            expectedChecksum: Checksum.optional(),
            ifRevision: z.number().int().min(0).optional().openapi({
              description:
                "With `replace`: apply only if the existing file is still at this storageRevision. Otherwise 409 REVISION_MISMATCH with the current file in `details`.",
            }),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Added. Answers the file." },
    ...errorResponses,
  },
});

const notFound = () =>
  httpError(404, "UPLOAD_SESSION_NOT_FOUND", "Upload session not found.");

export const uploadRoutes = router()
  .openapi(createSession, async (c) => {
    await assertStorageProtocolReady();
    const body = c.req.valid("json");
    normalizeFileName(body.originalName);
    await assertUploadSizeAllowed(body.totalSizeBytes);
    const session = await createResumableSession({
      ownerUserId: c.var.session.user.id,
      ...body,
    });
    return c.json(
      {
        id: session.id,
        receivedBytes: session.receivedBytes,
        protocolVersion: session.protocolVersion,
        chunkSizeBytes: session.chunkSizeBytes,
        completedChunks: session.completedChunks,
        expiresAt: session.expiresAt,
      },
      201,
    );
  })
  .openapi(readSession, async (c) => {
    const session = await findActiveResumableSession(
      c.req.valid("param").id,
      c.var.session.user.id,
    );
    if (!session) throw notFound();
    return c.json(
      {
        id: session.id,
        receivedBytes: session.receivedBytes,
        totalSizeBytes: session.totalSizeBytes,
        protocolVersion: session.protocolVersion,
        chunkSizeBytes: session.chunkSizeBytes,
        completedChunks: session.completedChunks,
        expiresAt: session.expiresAt,
        status: session.status,
      },
      200,
    );
  })
  .openapi(writeChunk, async (c) => {
    const ownerUserId = c.var.session.user.id;
    const [protocolResponse, uploadSession] = await Promise.all([
      requireStorageProtocol(),
      findActiveResumableSession(c.req.valid("param").id, ownerUserId, false),
    ]);
    if (protocolResponse) return protocolResponse;
    if (!uploadSession) throw notFound();
    return writeUploadChunk({ request: c.req.raw, uploadSession, ownerUserId });
  })
  .openapi(cancelSession, async (c) => {
    const { id } = c.req.valid("param");
    const ownerUserId = c.var.session.user.id;
    await assertStorageProtocolReady();
    const uploadSession = await findActiveResumableSession(
      id,
      ownerUserId,
      false,
    );
    if (!uploadSession) throw notFound();
    await cancelAndCleanupResumableSession({
      id,
      ownerUserId,
      tmpPath: uploadSession.tmpPath,
    });
    return c.body(null, 204);
  })
  .openapi(completeSession, async (c) => {
    await assertStorageProtocolReady();
    return completeResumableUpload({
      body: c.req.header("content-type")?.includes("application/json")
        ? c.req.valid("json")
        : null,
      session: c.var.session,
      id: c.req.valid("param").id,
    });
  });
