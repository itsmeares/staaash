import { z } from "@hono/zod-openapi";

import type { AuthSession, AuthUser } from "@/server/auth/types";

export const OkSchema = z.object({ ok: z.literal(true) });

export const PreferencesSchema = z
  .object({
    theme: z.string(),
    timeZone: z.string(),
    showUpdateNotifications: z.boolean(),
    showFolderPreviews: z.boolean(),
    showPinsInSidebar: z.boolean(),
    startPage: z.string(),
    defaultView: z.string(),
    clockFormat: z.string(),
    onboardingCompletedAt: z.date().nullable(),
  })
  .openapi("Preferences");

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    storageId: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    isOwner: z.boolean(),
    isAdmin: z.boolean(),
    role: z.enum(["owner", "admin", "member"]),
    passwordChangeRequiredAt: z.date().nullable(),
    temporaryPasswordIssuedAt: z.date().nullable(),
    temporaryPasswordIssuedByUserId: z.string().nullable(),
    /** Bytes as a decimal string, or null for no limit. */
    storageLimitBytes: z.string().nullable(),
    preferences: PreferencesSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("User");

export const SessionSchema = z
  .object({
    id: z.string(),
    expiresAt: z.date(),
    userAgent: z.string().nullable(),
    ipAddress: z.string().nullable(),
    lastSeenAt: z.date().nullable(),
    deviceName: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    user: UserSchema,
  })
  .openapi("Session");

export const toUserView = (user: AuthUser) => ({
  ...user,
  storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
});

// deviceSessionId only links an app window to its device inside the server.
export const toSessionView = (session: AuthSession) => {
  const { deviceSessionId: _deviceSessionId, ...view } = session;
  return { ...view, user: toUserView(session.user) };
};

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const StorageMutationStateSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
});

const FolderSchema = z
  .object({
    id: z.string(),
    ownerUserId: z.string(),
    ownerStorageId: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    isFilesRoot: z.boolean(),
    color: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    deletedAt: z.date().nullable(),
    storageRevision: z.number().int().optional(),
    trashEntryId: z.string().nullable().optional(),
    storageMutation: StorageMutationStateSchema.nullable().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("Folder");

export const FileSchema = z
  .object({
    id: z.string(),
    ownerUserId: z.string(),
    ownerStorageId: z.string(),
    folderId: z.string().nullable(),
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    viewerKind: z.enum(["image", "video", "audio", "pdf", "text"]).nullable(),
    storageRevision: z.number().int().optional(),
    trashEntryId: z.string().nullable().optional(),
    storageMutation: StorageMutationStateSchema.nullable().optional(),
    clientModifiedAt: z.date().nullable().optional().openapi({
      description: "The modified time on the uploader's computer, when sent.",
    }),
    deletedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("File");

const RestoreLocationSchema = z.object({
  kind: z.enum(["original-parent", "files-root"]),
  folderId: z.string(),
  folderName: z.string(),
  pathLabel: z.string(),
});

export const FileMutationSchema = z
  .object({
    file: FileSchema.optional(),
    deletedFileId: z.string().optional(),
    restoredTo: RestoreLocationSchema.optional(),
  })
  .openapi("FileMutation");

export const FolderMutationSchema = z
  .object({
    folder: FolderSchema,
    restoredTo: RestoreLocationSchema.optional(),
  })
  .openapi("FolderMutation");

const BatchMoveItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["file", "folder"]),
});

export const BatchMoveOperationSchema = z
  .object({
    operationId: z.string(),
    status: z.enum(["queued", "running", "succeeded", "recovery_required"]),
    response: z
      .object({
        movedCount: z.number().int(),
        failedCount: z.number().int(),
        results: z.array(
          z.union([
            BatchMoveItemSchema.extend({ status: z.literal("moved") }),
            BatchMoveItemSchema.extend({
              status: z.literal("failed"),
              code: z.string(),
              error: z.string(),
              retryable: z.boolean().optional(),
            }),
          ]),
        ),
      })
      .optional(),
    error: z.string().optional(),
    items: z.array(BatchMoveItemSchema).optional(),
    destinationFolderId: z.string().optional(),
    source: z.enum(["direct", "paste"]).optional(),
  })
  .openapi("BatchMoveOperation");

export const FavoriteBody = z.object({
  /** Defaults to true. Ignored when quickAccessPinned is sent. */
  isFavorite: z.boolean().optional(),
  quickAccessPinned: z.boolean().optional(),
});
