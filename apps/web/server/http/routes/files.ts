import { createRoute, z } from "@hono/zod-openapi";
import { getPrisma } from "@staaash/db/client";
import { bodyLimit } from "hono/body-limit";
import { scheduleDerivativeGenerate } from "@staaash/db/media-derivatives";
import {
  findStorageMutation,
  listRecentBatchMoveMutations,
} from "@staaash/db/storage-mutations";
import {
  findZipArchiveById,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import {
  DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE,
  DIRECT_UPLOAD_MAX_REQUEST_BYTES,
} from "@/lib/upload-limits";
import { canAccessPrivateNamespace } from "@/server/access";
import { authService } from "@/server/auth/service";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";
import { requestArchive } from "@/server/files/archive-request";
import { getReadableArchiveStatus } from "@/server/files/archive-status";
import {
  batchMoveRequestSchema,
  startBatchMove,
} from "@/server/files/batch-move-request";
import { clearTrash } from "@/server/files/clear-trash";
import { getPrivatePreviewStatus } from "@/server/files/derivative-status";
import { downloadPrivateFile } from "@/server/files/download";
import { FilesError } from "@/server/files/errors";
import { toBatchMoveOperationResponse } from "@/server/files/move-operation";
import { filesService } from "@/server/files/service";
import type { FilesActor } from "@/server/files/types";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import {
  actorOf,
  errorResponses,
  httpError,
  requireUser,
  router,
  storageMutation,
} from "@/server/http/core";
import {
  BatchMoveOperationSchema,
  FavoriteBody,
  FileMutationSchema,
  FileSchema,
  FolderMutationSchema,
  json,
  jsonBody,
} from "@/server/http/schemas";
import {
  createInlineContentResponse,
  createThumbnailResponse,
} from "@/server/media/derivative-content-response";
import { respondWithPrivateFile } from "@/server/media/private-file-route";
import {
  recordFileAccessBestEffort,
  recordFolderAccessBestEffort,
} from "@/server/retrieval/recent-tracking";
import { retrievalService } from "@/server/retrieval/service";
import { getSystemSettings } from "@/server/settings";
import { getStoragePath } from "@/server/storage";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";
import { readStorageIdempotencyKey } from "@/server/storage-idempotency";
import { pairUploadRequestItems, parseUploadManifest } from "@/server/uploads";

const user = [requireUser];
const mutation = [requireUser, storageMutation()];

const FileParams = z.object({ fileId: z.string() });
const FolderParams = z.object({ folderId: z.string() });
const NameBody = z.object({ name: z.string() });
const MoveBody = z.object({
  /** Null moves the item to the top of Files. */
  destinationFolderId: z.string().nullable(),
});

const RevisionQuery = z.object({
  ifRevision: z.coerce.number().int().min(0).optional().openapi({
    description:
      "Apply only if the item is still at this storageRevision. Otherwise 409 REVISION_MISMATCH with the current item in `details`.",
  }),
});

const FavoriteSchema = z
  .object({
    kind: z.enum(["file", "folder"]),
    id: z.string(),
    isFavorite: z.boolean(),
    quickAccessPinnedAt: z.date().nullable().optional(),
  })
  .openapi("Favorite");

const fileRoute = <const Action extends string>(
  action: Action,
  summary: string,
) =>
  createRoute({
    method: "post",
    path: `/api/files/files/{fileId}/${action}`,
    tags: ["Files"],
    summary,
    middleware: mutation,
    request: { params: FileParams },
    responses: { 200: json(FileMutationSchema, "Done."), ...errorResponses },
  });

const fileBodyRoute = <const Action extends string, Body extends z.ZodType>(
  action: Action,
  summary: string,
  body: Body,
) =>
  createRoute({
    method: "post",
    path: `/api/files/files/{fileId}/${action}`,
    tags: ["Files"],
    summary,
    middleware: mutation,
    request: { params: FileParams, query: RevisionQuery, body: jsonBody(body) },
    responses: { 200: json(FileMutationSchema, "Done."), ...errorResponses },
  });

const folderRoute = <const Action extends string>(
  action: Action,
  summary: string,
) =>
  createRoute({
    method: "post",
    path: `/api/files/folders/{folderId}/${action}`,
    tags: ["Folders"],
    summary,
    middleware: mutation,
    request: { params: FolderParams },
    responses: { 200: json(FolderMutationSchema, "Done."), ...errorResponses },
  });

const folderBodyRoute = <const Action extends string, Body extends z.ZodType>(
  action: Action,
  summary: string,
  body: Body,
) =>
  createRoute({
    method: "post",
    path: `/api/files/folders/{folderId}/${action}`,
    tags: ["Folders"],
    summary,
    middleware: mutation,
    request: {
      params: FolderParams,
      query: RevisionQuery,
      body: jsonBody(body),
    },
    responses: { 200: json(FolderMutationSchema, "Done."), ...errorResponses },
  });

const renameFile = fileBodyRoute("rename", "Rename a file.", NameBody);
const moveFile = fileBodyRoute(
  "move",
  "Move a file to another folder.",
  MoveBody,
);
const trashFile = createRoute({
  method: "post",
  path: "/api/files/files/{fileId}/trash",
  tags: ["Files"],
  summary: "Move a file to the trash.",
  middleware: mutation,
  request: { params: FileParams, query: RevisionQuery },
  responses: { 200: json(FileMutationSchema, "Done."), ...errorResponses },
});
const restoreFile = fileRoute("restore", "Restore a file from the trash.");
const deleteFile = fileRoute(
  "delete",
  "Delete a trashed file for good. The bytes are removed.",
);

const renameFolder = folderBodyRoute("rename", "Rename a folder.", NameBody);
const moveFolder = folderBodyRoute(
  "move",
  "Move a folder and everything in it.",
  MoveBody,
);
const trashFolder = createRoute({
  method: "post",
  path: "/api/files/folders/{folderId}/trash",
  tags: ["Folders"],
  summary: "Move a folder and everything in it to the trash.",
  middleware: mutation,
  request: { params: FolderParams, query: RevisionQuery },
  responses: { 200: json(FolderMutationSchema, "Done."), ...errorResponses },
});
const restoreFolder = folderRoute(
  "restore",
  "Restore a folder from the trash.",
);

const favoriteFile = createRoute({
  method: "post",
  path: "/api/files/files/{fileId}/favorite",
  tags: ["Files"],
  summary: "Favorite or unfavorite a file, or pin it to quick access.",
  middleware: user,
  request: { params: FileParams, body: jsonBody(FavoriteBody) },
  responses: { 200: json(FavoriteSchema, "Saved."), ...errorResponses },
});

const favoriteFolder = createRoute({
  method: "post",
  path: "/api/files/folders/{folderId}/favorite",
  tags: ["Folders"],
  summary: "Favorite or unfavorite a folder, or pin it to quick access.",
  middleware: user,
  request: { params: FolderParams, body: jsonBody(FavoriteBody) },
  responses: { 200: json(FavoriteSchema, "Saved."), ...errorResponses },
});

const openedFile = createRoute({
  method: "post",
  path: "/api/files/files/{fileId}/opened",
  tags: ["Files"],
  summary: "Note that the file was opened, for Recent.",
  middleware: user,
  request: { params: FileParams },
  responses: { 204: { description: "Noted." }, ...errorResponses },
});

const createFolder = createRoute({
  method: "post",
  path: "/api/files/folders",
  tags: ["Folders"],
  summary: "Create a folder.",
  middleware: mutation,
  request: {
    body: jsonBody(
      z.object({
        /** Null creates it at the top of Files. */
        parentId: z.string().nullable().optional(),
        name: z.string(),
      }),
    ),
  },
  responses: { 201: json(FolderMutationSchema, "Created."), ...errorResponses },
});

const ensureFolders = createRoute({
  method: "post",
  path: "/api/files/folders/ensure",
  tags: ["Folders"],
  summary:
    "Create every missing folder on the given relative paths, for folder uploads.",
  middleware: mutation,
  request: {
    body: jsonBody(
      z.object({
        folderId: z.string().trim().min(1),
        paths: z.array(z.string().min(1).max(4096)).min(1).max(10_000),
      }),
    ),
  },
  responses: {
    201: json(
      z.object({
        folders: z.array(z.object({ path: z.string(), folderId: z.string() })),
      }),
      "Every path exists.",
    ),
    ...errorResponses,
  },
});

const SWATCHES = [
  "stone",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

const folderAppearance = createRoute({
  method: "post",
  path: "/api/files/folders/{folderId}/appearance",
  tags: ["Folders"],
  summary: "Set a folder's color and icon. Null goes back to the default.",
  middleware: user,
  request: {
    params: FolderParams,
    body: jsonBody(
      z.object({
        color: z
          .union([
            z.enum(SWATCHES),
            z.string().regex(/^#[0-9a-f]{6}$/i),
            z.null(),
          ])
          .optional(),
        icon: z
          .string()
          .regex(/^[A-Za-z]{1,32}$/)
          .nullable()
          .optional(),
      }),
    ),
  },
  responses: {
    200: json(
      z.object({ color: z.string().nullable(), icon: z.string().nullable() }),
      "Saved.",
    ),
    ...errorResponses,
  },
});

const folderTree = createRoute({
  method: "get",
  path: "/api/files/folders/tree",
  tags: ["Folders"],
  summary: "All of your folders, for picking a destination.",
  middleware: user,
  responses: {
    200: json(
      z.object({
        instanceName: z.string(),
        folders: z.array(
          z.object({
            id: z.string(),
            parentId: z.string().nullable(),
            name: z.string(),
            pathLabel: z.string(),
            isFilesRoot: z.boolean(),
            color: z.string().nullable(),
          }),
        ),
      }),
      "Your folders.",
    ),
    ...errorResponses,
  },
});

const batchMove = createRoute({
  method: "post",
  path: "/api/files/move",
  tags: ["Files"],
  summary:
    "Move many files and folders at once. Runs in the background; poll the operation.",
  middleware: user,
  request: { body: jsonBody(batchMoveRequestSchema) },
  responses: {
    200: json(BatchMoveOperationSchema, "Already finished."),
    202: json(BatchMoveOperationSchema, "Queued or running."),
    ...errorResponses,
  },
});

const batchMoves = createRoute({
  method: "get",
  path: "/api/files/move",
  tags: ["Files"],
  summary: "Your recent batch moves that are unfinished or had failures.",
  middleware: user,
  responses: {
    200: json(z.array(BatchMoveOperationSchema), "Operations."),
    ...errorResponses,
  },
});

const batchMoveStatus = createRoute({
  method: "get",
  path: "/api/files/move/{mutationId}",
  tags: ["Files"],
  summary: "One batch move.",
  middleware: user,
  request: { params: z.object({ mutationId: z.string() }) },
  responses: {
    200: json(BatchMoveOperationSchema, "The move."),
    ...errorResponses,
  },
});

const emptyTrash = createRoute({
  method: "post",
  path: "/api/files/trash/clear",
  tags: ["Files"],
  summary: "Delete everything in your trash for good.",
  middleware: user,
  responses: {
    200: json(
      z.object({
        deletedFolderCount: z.number().int(),
        deletedFileCount: z.number().int(),
      }),
      "Emptied.",
    ),
    ...errorResponses,
  },
});

const ArchiveStatus = z.string().openapi({
  description: "queued, processing, ready, or failed.",
});

const createArchive = createRoute({
  method: "post",
  path: "/api/files/archives",
  tags: ["Archives"],
  summary: "Start building a zip of files and folders.",
  middleware: user,
  request: {
    body: jsonBody(z.object({ ids: z.array(z.string()).min(1).max(500) })),
  },
  responses: {
    200: json(
      z.object({ archiveId: z.string(), status: ArchiveStatus }),
      "Queued, or already built.",
    ),
    ...errorResponses,
  },
});

const archiveStatus = createRoute({
  method: "get",
  path: "/api/files/archives/{archiveId}",
  tags: ["Archives"],
  summary: "Whether a zip is ready.",
  middleware: user,
  request: { params: z.object({ archiveId: z.string() }) },
  responses: {
    200: json(
      z.object({
        status: ArchiveStatus,
        fileCount: z.number().int().nullable(),
        sizeBytes: z.string().nullable(),
        error: z.string().nullable(),
      }),
      "The archive.",
    ),
    ...errorResponses,
  },
});

const archiveDownload = createRoute({
  method: "get",
  path: "/api/files/archives/{archiveId}/download",
  tags: ["Archives"],
  summary: "Download a ready zip. Supports Range.",
  middleware: user,
  request: { params: z.object({ archiveId: z.string() }) },
  responses: { 200: { description: "The zip bytes." }, ...errorResponses },
});

const fileBytes = (path: string, summary: string) =>
  createRoute({
    method: "get",
    path: `/api/files/files/{fileId}/${path}`,
    tags: ["Files"],
    summary,
    middleware: user,
    request: { params: FileParams },
    responses: { 200: { description: "The bytes." }, ...errorResponses },
  });

const download = fileBytes(
  "download",
  "Download a file as an attachment. Supports Range.",
);
const content = fileBytes(
  "content",
  "The file inline, or its browser-friendly preview. Supports Range.",
);
const thumbnail = fileBytes("thumbnail", "A small image of the file.");
const preview = createRoute({
  method: "get",
  path: "/api/files/files/{fileId}/preview",
  tags: ["Files"],
  summary: "Redirects to the inline content when the browser can show it.",
  middleware: user,
  request: { params: FileParams },
  responses: { 307: { description: "Go to the content." }, ...errorResponses },
});

const PreviewStatus = z.object({
  status: z.string(),
  generatedAt: z.date().nullable(),
});

const derivativeStatus = createRoute({
  method: "get",
  path: "/api/files/files/{fileId}/derivative",
  tags: ["Files"],
  summary: "Whether the video's browser-friendly preview is ready.",
  middleware: user,
  request: { params: FileParams },
  responses: { 200: json(PreviewStatus, "Status."), ...errorResponses },
});

const queueDerivative = createRoute({
  method: "post",
  path: "/api/files/files/{fileId}/derivative",
  tags: ["Files"],
  summary: "Build the video's browser-friendly preview again.",
  middleware: user,
  request: { params: FileParams },
  responses: { 200: json(PreviewStatus, "Queued."), ...errorResponses },
});

const directUpload = createRoute({
  method: "post",
  path: "/api/files/files",
  tags: ["Uploads"],
  summary:
    "Upload small files in one multipart request: `folderId`, a JSON `manifest`, and `files`. Large files use upload sessions.",
  middleware: [
    requireUser,
    // Counts the bytes that arrive, so a chunked body without a length
    // cannot get past the limit either.
    bodyLimit({
      maxSize: DIRECT_UPLOAD_MAX_REQUEST_BYTES,
      onError: () => {
        throw httpError(
          413,
          "UPLOAD_REQUEST_TOO_LARGE",
          DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE,
        );
      },
    }),
    storageMutation((key) => `${key}:0`),
  ],
  responses: {
    201: json(
      z.object({
        uploadedFiles: z.array(FileSchema),
        conflicts: z.array(z.unknown()),
      }),
      "Uploaded.",
    ),
    413: { description: "Too large for a single request." },
    ...errorResponses,
  },
});

/** Hides storage and queue errors behind one safe message. */
const safePreview = async <T>(message: string, work: () => Promise<T>) => {
  try {
    return await work();
  } catch (error) {
    if (typeof (error as { status?: unknown })?.status === "number") {
      throw error;
    }
    throw httpError(503, "PREVIEW_UNAVAILABLE", message);
  }
};

/** Only visible files this user may read can be served or derived. */
const findOwnFile = async (actor: FilesActor, fileId: string) => {
  const file = await getPrisma().file.findFirst({
    where: { id: fileId, deletedAt: null },
    select: { ownerUserId: true, mimeType: true },
  });
  if (
    !file ||
    !canAccessPrivateNamespace({
      ...actor,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new FilesError("FILE_NOT_FOUND");
  }
  return file;
};

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : null;

const FOLDER_ACCESS_BATCH_SIZE = 8;

const trackEnsuredFolderAccess = async (
  actor: FilesActor,
  folders: Array<{ folderId: string }>,
) => {
  for (
    let index = 0;
    index < folders.length;
    index += FOLDER_ACCESS_BATCH_SIZE
  ) {
    await Promise.all(
      folders
        .slice(index, index + FOLDER_ACCESS_BATCH_SIZE)
        .map(({ folderId }) =>
          recordFolderAccessBestEffort({
            ...actor,
            folderId,
            action: "uploaded",
          }),
        ),
    );
  }
};

const setFavorite = <Kind extends "file" | "folder">(
  kind: Kind,
  actor: FilesActor,
  id: string,
  { isFavorite, quickAccessPinned }: z.infer<typeof FavoriteBody>,
) => {
  if (kind === "file") {
    return quickAccessPinned === undefined
      ? retrievalService.setFileFavorite({
          ...actor,
          fileId: id,
          isFavorite: isFavorite ?? true,
        })
      : retrievalService.setFileFavoriteQuickAccess({
          ...actor,
          fileId: id,
          quickAccessPinned,
        });
  }
  return quickAccessPinned === undefined
    ? retrievalService.setFolderFavorite({
        ...actor,
        folderId: id,
        isFavorite: isFavorite ?? true,
      })
    : retrievalService.setFolderFavoriteQuickAccess({
        ...actor,
        folderId: id,
        quickAccessPinned,
      });
};

export const filesRoutes = router()
  .openapi(renameFile, async (c) => {
    const actor = actorOf(c.var.session);
    const { fileId } = c.req.valid("param");
    const result = await filesService.renameFile({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      fileId,
      name: c.req.valid("json").name,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFileAccessBestEffort({ ...actor, fileId, action: "renamed" });
    return c.json(result, 200);
  })
  .openapi(moveFile, async (c) => {
    const actor = actorOf(c.var.session);
    const { fileId } = c.req.valid("param");
    const result = await filesService.moveFile({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      fileId,
      destinationFolderId: c.req.valid("json").destinationFolderId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFileAccessBestEffort({ ...actor, fileId, action: "moved" });
    return c.json(result, 200);
  })
  .openapi(trashFile, async (c) => {
    const actor = actorOf(c.var.session);
    const { fileId } = c.req.valid("param");
    const result = await filesService.trashFile({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      fileId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFileAccessBestEffort({ ...actor, fileId, action: "trashed" });
    return c.json(result, 200);
  })
  .openapi(restoreFile, async (c) => {
    const actor = actorOf(c.var.session);
    const { fileId } = c.req.valid("param");
    const result = await filesService.restoreFile({
      ...actor,
      fileId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFileAccessBestEffort({ ...actor, fileId, action: "restored" });
    return c.json(result, 200);
  })
  .openapi(deleteFile, async (c) =>
    c.json(
      await filesService.deleteFile({
        ...actorOf(c.var.session),
        fileId: c.req.valid("param").fileId,
        idempotencyKey: c.var.idempotencyKey,
      }),
      200,
    ),
  )
  .openapi(renameFolder, async (c) => {
    const actor = actorOf(c.var.session);
    const { folderId } = c.req.valid("param");
    const result = await filesService.renameFolder({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      folderId,
      name: c.req.valid("json").name,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      ...actor,
      folderId,
      action: "renamed",
    });
    return c.json(result, 200);
  })
  .openapi(moveFolder, async (c) => {
    const actor = actorOf(c.var.session);
    const { folderId } = c.req.valid("param");
    const result = await filesService.moveFolder({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      folderId,
      destinationFolderId: c.req.valid("json").destinationFolderId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFolderAccessBestEffort({ ...actor, folderId, action: "moved" });
    return c.json(result, 200);
  })
  .openapi(trashFolder, async (c) => {
    const actor = actorOf(c.var.session);
    const { folderId } = c.req.valid("param");
    const result = await filesService.trashFolder({
      ...actor,
      ifRevision: c.req.valid("query").ifRevision,
      folderId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      ...actor,
      folderId,
      action: "trashed",
    });
    return c.json(result, 200);
  })
  .openapi(restoreFolder, async (c) => {
    const actor = actorOf(c.var.session);
    const { folderId } = c.req.valid("param");
    const result = await filesService.restoreFolder({
      ...actor,
      folderId,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      ...actor,
      folderId,
      action: "restored",
    });
    return c.json(result, 200);
  })
  .openapi(favoriteFile, async (c) =>
    c.json(
      await setFavorite(
        "file",
        actorOf(c.var.session),
        c.req.valid("param").fileId,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(favoriteFolder, async (c) =>
    c.json(
      await setFavorite(
        "folder",
        actorOf(c.var.session),
        c.req.valid("param").folderId,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(openedFile, async (c) => {
    await recordFileAccessBestEffort({
      ...actorOf(c.var.session),
      fileId: c.req.valid("param").fileId,
      action: "opened",
    });
    return c.body(null, 204);
  })
  .openapi(createFolder, async (c) => {
    const actor = actorOf(c.var.session);
    const body = c.req.valid("json");
    const result = await filesService.createFolder({
      ...actor,
      parentId: body.parentId || null,
      name: body.name,
      idempotencyKey: c.var.idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      ...actor,
      folderId: result.folder.id,
      action: "created",
    });
    return c.json(result, 201);
  })
  .openapi(ensureFolders, async (c) => {
    const actor = actorOf(c.var.session);
    const { folderId, paths } = c.req.valid("json");
    const result = await filesService.ensureFolderPaths({
      ...actor,
      parentId: folderId,
      paths,
      idempotencyKey: c.var.idempotencyKey,
    });
    await trackEnsuredFolderAccess(actor, result.folders);
    return c.json(result, 201);
  })
  .openapi(folderAppearance, async (c) => {
    const folder = await filesService.setFolderAppearance({
      ...actorOf(c.var.session),
      folderId: c.req.valid("param").folderId,
      ...c.req.valid("json"),
    });
    return c.json(
      { color: folder.color ?? null, icon: folder.icon ?? null },
      200,
    );
  })
  .openapi(folderTree, async (c) => {
    const [folders, setup] = await Promise.all([
      filesService.listFolderTree(actorOf(c.var.session)),
      authService.getSetupState(),
    ]);
    c.header("cache-control", "no-store");
    return c.json(
      { instanceName: setup.instanceName?.trim() || "Staaash", folders },
      200,
    );
  })
  .openapi(batchMove, async (c) => {
    const { mutationId, operation } = await startBatchMove({
      ownerUserId: c.var.session.user.id,
      idempotencyKey: readStorageIdempotencyKey(c.req.raw),
      request: c.req.valid("json"),
    });
    c.header("X-Storage-Mutation-Id", mutationId);
    return operation.status === "queued" || operation.status === "running"
      ? c.json(operation, 202)
      : c.json(operation, 200);
  })
  .openapi(batchMoves, async (c) => {
    const mutations = await listRecentBatchMoveMutations({
      ownerUserId: c.var.session.user.id,
    });
    c.header("cache-control", "no-store");
    return c.json(
      mutations
        .map(toBatchMoveOperationResponse)
        .filter(
          (operation) =>
            operation.status !== "succeeded" ||
            (operation.response?.failedCount ?? 0) > 0,
        ),
      200,
    );
  })
  .openapi(batchMoveStatus, async (c) => {
    const { session } = c.var;
    const mutation = await findStorageMutation(c.req.valid("param").mutationId);
    if (
      !mutation ||
      mutation.kind !== "batch_move" ||
      mutation.parentId !== null ||
      !canAccessPrivateNamespace({
        ...actorOf(session),
        namespaceOwnerUserId: mutation.ownerUserId,
      })
    ) {
      throw httpError(404, "MOVE_NOT_FOUND", "Move operation not found.");
    }
    c.header("cache-control", "no-store");
    c.header("X-Storage-Mutation-Id", mutation.id);
    return c.json(toBatchMoveOperationResponse(mutation), 200);
  })
  .openapi(emptyTrash, async (c) => {
    const { mutationId, result } = await clearTrash(
      actorOf(c.var.session),
      readStorageIdempotencyKey(c.req.raw),
    );
    c.header("X-Storage-Mutation-Id", mutationId);
    return c.json(result, 200);
  })
  .openapi(createArchive, async (c) =>
    c.json(
      await requestArchive(actorOf(c.var.session), c.req.valid("json").ids),
      200,
    ),
  )
  .openapi(archiveStatus, async (c) => {
    const archive = await findZipArchiveById(c.req.valid("param").archiveId);
    if (!archive) throw new FilesError("FILE_NOT_FOUND");
    if (
      !canAccessPrivateNamespace({
        ...actorOf(c.var.session),
        namespaceOwnerUserId: archive.userId,
      })
    ) {
      throw new FilesError("ACCESS_DENIED");
    }
    return c.json(
      {
        status: await getReadableArchiveStatus(archive),
        fileCount: archive.fileCount,
        sizeBytes: archive.sizeBytes?.toString() ?? null,
        error: archive.error,
      },
      200,
    );
  })
  // Request wiring; each branch is one response.
  // fallow-ignore-next-line complexity
  .openapi(archiveDownload, async (c) => {
    const archive = await findZipArchiveById(c.req.valid("param").archiveId);
    if (
      !archive ||
      archive.status !== ZIP_ARCHIVE_STATUS_READY ||
      !archive.storageKey
    ) {
      throw new FilesError("FILE_NOT_FOUND");
    }
    if (
      !canAccessPrivateNamespace({
        ...actorOf(c.var.session),
        namespaceOwnerUserId: archive.userId,
      })
    ) {
      throw new FilesError("ACCESS_DENIED");
    }
    await assertStorageEntityReadable("archive", archive.id);
    const response = await createRangeResponseFromPath(
      c.req.raw,
      getStoragePath(archive.storageKey),
      Number(archive.sizeBytes ?? 0),
      "application/zip",
      archive.fileName ?? "staaash-files.zip",
    );
    if (!response) throw new FilesError("FILE_NOT_FOUND");
    return response;
  })
  .openapi(download, (c) =>
    downloadPrivateFile({
      request: c.req.raw,
      session: c.var.session,
      fileId: c.req.valid("param").fileId,
    }),
  )
  .openapi(content, (c) =>
    respondWithPrivateFile({
      session: c.var.session,
      fileId: c.req.valid("param").fileId,
      unavailable: "Content unavailable.",
      respond: (file) =>
        createInlineContentResponse({ request: c.req.raw, file }),
    }),
  )
  .openapi(thumbnail, (c) =>
    respondWithPrivateFile({
      session: c.var.session,
      fileId: c.req.valid("param").fileId,
      unavailable: "Thumbnail unavailable.",
      respond: (file) => createThumbnailResponse({ request: c.req.raw, file }),
    }),
  )
  .openapi(preview, async (c) => {
    const { fileId } = c.req.valid("param");
    const file = await getAccessiblePrivateFile({
      ...actorOf(c.var.session),
      fileId,
    });
    if (!file.viewerKind) {
      throw httpError(
        404,
        "PREVIEW_UNSUPPORTED",
        "Preview not supported for this file type.",
      );
    }
    return c.redirect(`/api/files/files/${fileId}/content`, 307);
  })
  .openapi(derivativeStatus, async (c) => {
    const { fileId } = c.req.valid("param");
    const status = await safePreview(
      "Preview status unavailable.",
      async () => {
        await findOwnFile(actorOf(c.var.session), fileId);
        return getPrivatePreviewStatus(fileId);
      },
    );
    return c.json(status, 200);
  })
  .openapi(queueDerivative, async (c) => {
    const { fileId } = c.req.valid("param");
    const queue = <T>(work: () => Promise<T>) =>
      safePreview("Failed to queue preview.", work);
    const file = await queue(() => findOwnFile(actorOf(c.var.session), fileId));
    if (!file.mimeType.startsWith("video/")) {
      throw httpError(
        400,
        "PREVIEW_UNSUPPORTED",
        "Preview generation is only supported for video files.",
      );
    }
    if (!(await getSystemSettings()).mediaPreviewEnabled) {
      throw httpError(409, "PREVIEWS_DISABLED", "Media previews are disabled.");
    }
    const { job } = await queue(() =>
      scheduleDerivativeGenerate({ fileId, reason: "manual-regenerate" }),
    );
    return c.json(
      {
        status: job.status === "running" ? "processing" : "queued",
        generatedAt: null,
      },
      200,
    );
  })
  .openapi(directUpload, async (c) => {
    const actor = actorOf(c.var.session);
    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch {
      throw httpError(
        400,
        "INVALID_MULTIPART_BODY",
        "The upload request was incomplete or invalid.",
      );
    }
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const result = await filesService.uploadFiles({
      ...actor,
      folderId: text(formData.get("folderId")),
      items: pairUploadRequestItems(
        parseUploadManifest(text(formData.get("manifest"))),
        files,
      ),
      signal: c.req.raw.signal,
      idempotencyKey: c.var.idempotencyKey,
    });
    await Promise.all(
      result.uploadedFiles.map((file) =>
        recordFileAccessBestEffort({
          ...actor,
          fileId: file.id,
          action: "uploaded",
        }),
      ),
    );
    if (result.conflicts.length > 0) {
      return c.json(
        {
          error:
            "One or more files conflicted with existing names in this folder.",
          code: "FILE_NAME_CONFLICT",
          ...result,
        },
        409,
      );
    }
    return c.json(result, 201);
  });
