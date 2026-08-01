// Storage mutations deliberately mirror phase ordering across entity kinds.
// fallow-ignore-file code-duplication
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { scheduleDerivativeGenerate } from "@staaash/db/media-derivatives";
import { getPrisma, type Prisma } from "@staaash/db/client";

import { canAccessPrivateNamespace } from "@/server/access";
import { getSystemSettings } from "@/server/settings";
import {
  assertUserStorageQuotaAvailable,
  withUserQuotaWrite,
} from "@/server/user-storage";
import { FilesError, ResumableCompletionError } from "@/server/files/errors";
import {
  buildFileStorageKey,
  buildFolderStorageKey,
  buildIsolatedTrashStorageKey,
  normalizeFileName,
  normalizeFolderName,
} from "@/server/files/storage-layout";
import type {
  FileMutationResult,
  FolderMutationResult,
  FolderRestoreLocation,
  FilesActor,
  FilesBreadcrumb,
  FileSummary,
  FolderSummary,
  FilesListing,
  MoveTarget,
  StoredFile,
  TrashClearResult,
  TrashFileSummary,
  TrashFolderSummary,
  TrashListing,
} from "@/server/files/types";
import {
  ensureUserCommittedStorageDirectories,
  getStorageRoot,
  getStoragePath,
} from "@/server/storage";
import {
  finalizePendingDelete,
  commitResumableUploadWithLock as commitResumableStorageUpload,
  getDirectoryMutationLockKey,
  getEntryMutationLockKey,
  moveStorageEntriesWithLock,
  moveStorageEntryWithLock,
  quarantineDeleteWithLock,
  rollbackPendingDelete,
  replaceResumableUploadWithLock as replaceResumableStorageUpload,
  ResumableStorageCommitError,
  withStorageLocks,
} from "@/server/storage-mutations";
import {
  buildSafeRenamedFileName,
  createUploadDeadline,
  cleanupStagedUpload,
  commitStagedUpload,
  replaceCommittedUpload,
  stageUpload,
} from "@/server/uploads";
import type {
  UploadConflictStrategy,
  UploadRequestItem,
} from "@/server/uploads";

import type { FilesRepository } from "./repository";
import type { FilesTransactionClient } from "./repository";
import { assertClearTrashChildReplayIdentity } from "./clear-trash-child";
import {
  assertStorageProtocolReady,
  hashDurableStorageRequest,
  runDurableStorageMutation,
} from "@/server/durable-storage-mutation";
import type {
  StorageMetadataOperation,
  StorageMutationEntityInput,
  StorageMutationKind,
  StorageMutationStepInput,
} from "@staaash/db/storage-mutations";
import {
  buildStorageMutationChildRequestHashPayload,
  findStorageMutation,
  recordStorageMutationParentChild,
  renewStorageMutationLease,
  StorageMutationConflictError,
} from "@staaash/db/storage-mutations";
import {
  calculateCapturedTreeManifestDigest,
  calculateStorageFileChecksum,
  calculateTreeManifestDigest,
  EMPTY_TREE_MANIFEST_DIGEST,
  StorageMutationAmbiguityError,
} from "@staaash/db/storage-mutation-executor";
import {
  assertStorageEntityReadable,
  getStorageMutationStateMap,
} from "@/server/storage-read-guard";
import {
  completeResumableSessionWithFile,
  recordResumableCommitRecoveryError,
  restoreResumableSessionAfterCommitRollback,
} from "@/server/uploads/session-service";
import {
  buildFilePathLabel,
  buildFolderMap,
  buildFolderPathLabel,
} from "./path-labels";

type CreateFilesServiceOptions = {
  repo?: FilesRepository;
  now?: () => Date;
  scheduleStagingCleanupJob?: (runAt: Date) => Promise<void>;
  commitResumableStorageUpload?: typeof commitResumableStorageUpload;
  replaceResumableStorageUpload?: typeof replaceResumableStorageUpload;
};

type DurableRequest = {
  idempotencyKey?: string | null;
  storageMutationParentId?: string | null;
  storageMutationParentLeaseOwner?: string | null;
  storageMutationParentLeaseToken?: bigint | null;
  storageMutationOrderedItems?: Array<{
    kind: "file" | "folder";
    id: string;
    deletedAt: string;
    storageRevision: number;
    trashEntryId: string | null;
  }>;
  storageMutationPriorChildren?: Array<{
    ordinal: number;
    result: Record<string, unknown>;
  }>;
};

type FolderLookupInput = FilesActor &
  DurableRequest & {
    folderId: string;
  };

type FileLookupInput = FilesActor &
  DurableRequest & {
    fileId: string;
  };

type CreateFolderInput = FilesActor &
  DurableRequest & {
    parentId?: string | null;
    name: string;
  };

type RenameFolderInput = FilesActor &
  DurableRequest & {
    folderId: string;
    name: string;
  };

type MoveFolderInput = FilesActor &
  DurableRequest & {
    folderId: string;
    destinationFolderId?: string | null;
  };

type RenameFileInput = FilesActor &
  DurableRequest & {
    fileId: string;
    name: string;
  };

type MoveFileInput = FilesActor &
  DurableRequest & {
    fileId: string;
    destinationFolderId?: string | null;
  };

type UploadFilesInput = FilesActor &
  DurableRequest & {
    folderId?: string | null;
    items: UploadRequestItem[];
  };

const deterministicUuid = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

type ActiveNameConflict =
  | {
      kind: "file";
      item: StoredFile;
    }
  | {
      kind: "folder";
      item: FolderSummary;
    };

type UploadConflictItem = {
  clientKey: string;
  originalName: string;
  conflictStrategy: UploadConflictStrategy;
  existingKind: "file" | "folder";
  existingId: string;
  existingName: string;
};

type UploadFilesResult = {
  uploadedFiles: FileSummary[];
  conflicts: UploadConflictItem[];
};

type CommitResumableUploadInput = FilesActor & {
  uploadSessionId: string;
  tmpPath: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: number;
  contentChecksum: string | null;
  conflictStrategy: UploadConflictStrategy;
};

const getFolderHref = (folder: Pick<FolderSummary, "id" | "isFilesRoot">) =>
  folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`;

const toFileSummary = (
  file: Pick<
    StoredFile,
    | "id"
    | "ownerUserId"
    | "ownerStorageId"
    | "folderId"
    | "name"
    | "mimeType"
    | "sizeBytes"
    | "viewerKind"
    | "storageRevision"
    | "trashEntryId"
    | "deletedAt"
    | "createdAt"
    | "updatedAt"
  >,
): FileSummary => ({
  id: file.id,
  ownerUserId: file.ownerUserId,
  ownerStorageId: file.ownerStorageId,
  folderId: file.folderId,
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  viewerKind: file.viewerKind,
  storageRevision: file.storageRevision,
  trashEntryId: file.trashEntryId,
  deletedAt: file.deletedAt,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const assertFolderAccess = (
  actor: FilesActor,
  folder: FolderSummary | null,
) => {
  if (!folder) {
    throw new FilesError("FOLDER_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: folder.ownerUserId,
    })
  ) {
    throw new FilesError("ACCESS_DENIED");
  }

  return folder;
};

const assertFileAccess = (actor: FilesActor, file: StoredFile | null) => {
  if (!file) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new FilesError("ACCESS_DENIED");
  }

  return file;
};

const assertActiveFolder = (folder: FolderSummary) => {
  if (folder.deletedAt) {
    throw new FilesError("FOLDER_NOT_FOUND");
  }

  return folder;
};

const assertActiveFile = (file: StoredFile) => {
  if (file.deletedAt) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  return file;
};

const assertMutableFolder = (folder: FolderSummary) => {
  if (folder.isFilesRoot) {
    throw new FilesError("FOLDER_ROOT_IMMUTABLE");
  }
};

const cloneFolderMap = (folderMap: Map<string, FolderSummary>) =>
  new Map(
    Array.from(folderMap.entries()).map(([id, folder]) => [id, { ...folder }]),
  );

const buildUpdatedFolderMap = ({
  folderMap,
  updatedFolders,
}: {
  folderMap: Map<string, FolderSummary>;
  updatedFolders: FolderSummary[];
}) => {
  const next = cloneFolderMap(folderMap);

  for (const folder of updatedFolders) {
    next.set(folder.id, folder);
  }

  return next;
};

const createFolderDirectory = async (storageKey: string) => {
  await mkdir(getStoragePath(storageKey), {
    recursive: true,
  });
};

const removeFolderDirectory = async (storageKey: string) => {
  await rm(getStoragePath(storageKey), {
    recursive: true,
    force: true,
  });
};

const moveStorageEntry = async ({
  fromStorageKey,
  toStorageKey,
}: {
  fromStorageKey: string;
  toStorageKey: string;
}) => {
  if (fromStorageKey === toStorageKey) {
    return;
  }

  const fromPath = getStoragePath(fromStorageKey);
  const toPath = getStoragePath(toStorageKey);

  await moveStorageEntryWithLock({
    fromPath,
    toPath,
    lockKeys: [
      getEntryMutationLockKey(fromPath),
      getDirectoryMutationLockKey(fromPath),
      getDirectoryMutationLockKey(toPath),
    ],
  });
};

const toMetadataJson = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Record<string, string | number | boolean | null>;

const relativeStorageKeyWithin = (rootKey: string, storageKey: string) => {
  const relative = path.posix.relative(rootKey, storageKey);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error("Storage metadata is outside mutation tree.");
  }
  return relative;
};

const fingerprintFileIfDeterminable = async (storageKey: string) => {
  try {
    return await calculateStorageFileChecksum(getStorageRoot(), storageKey);
  } catch (error) {
    if (error instanceof StorageMutationAmbiguityError) return undefined;
    throw error;
  }
};

const fingerprintTreeIfDeterminable = async (storageKey: string) => {
  const absolutePath = getStoragePath(storageKey);
  try {
    const stats = await lstat(absolutePath);
    if (!stats.isDirectory()) return "invalid-tree-node";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return await calculateTreeManifestDigest(absolutePath);
  } catch (error) {
    // Preserve an existing but unsafe tree. The deliberately unmatchable
    // digest makes the durable executor classify it as recovery_required
    // before any rename/delete can occur.
    if (error instanceof StorageMutationAmbiguityError)
      return "invalid-tree-manifest";
    throw error;
  }
};

const captureFolderTreeManifest = async ({
  rootStorageKey,
  folderStorageKeys,
  files,
}: {
  rootStorageKey: string;
  folderStorageKeys: string[];
  files: StoredFile[];
}) => {
  const relativeKey = (storageKey: string) => {
    const relative = path.posix.relative(rootStorageKey, storageKey);
    if (!relative || relative === ".." || relative.startsWith("../")) {
      throw new StorageMutationAmbiguityError(
        "Folder member storage path escapes captured tree.",
      );
    }
    return relative;
  };
  const entries: Parameters<typeof calculateCapturedTreeManifestDigest>[0] =
    folderStorageKeys.map((storageKey) => ({
      kind: "directory",
      relativeKey: relativeKey(storageKey),
    }));
  const checksums = new Map<string, string>();
  for (const file of files) {
    const checksum =
      file.contentChecksum ??
      (await calculateStorageFileChecksum(getStorageRoot(), file.storageKey));
    checksums.set(file.id, checksum);
    entries.push({
      kind: "file",
      relativeKey: relativeKey(file.storageKey),
      sizeBytes: BigInt(file.sizeBytes),
      checksum,
    });
  }
  return {
    digest: calculateCapturedTreeManifestDigest(entries),
    checksums,
  };
};

const storageKeyForAbsolutePath = (absolutePath: string) => {
  const root = getStorageRoot();
  const relative = path.relative(root, path.resolve(absolutePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Staged upload is outside storage root.");
  }
  return relative.split(path.sep).join("/");
};

// Test-only dependency-injection seam.
// fallow-ignore-next-line unused-export
export const createFilesService = ({
  repo,
  now = () => new Date(),
  scheduleStagingCleanupJob,
  commitResumableStorageUpload:
    activeCommitResumableStorageUpload = commitResumableStorageUpload,
  replaceResumableStorageUpload:
    activeReplaceResumableStorageUpload = replaceResumableStorageUpload,
}: CreateFilesServiceOptions = {}) => {
  const resolveRepo = async (): Promise<FilesRepository> =>
    repo ?? (await import("./repository")).prismaFilesRepository;
  const coordinateStorageMutation = async <T>(
    options: Parameters<typeof withStorageLocks<T>>[0],
  ) => (repo ? withStorageLocks(options) : options.callback());

  const assertDirectMutationReplayIdentity = ({
    prior,
    kind,
    entityType,
    entityId,
    requestHashPayload,
    actorRole,
    actorUserId,
  }: {
    prior: {
      kind: string;
      requestHash: string | null;
      ownerUserId: string;
      entities: Array<{ entityType: string; entityId: string }>;
    };
    kind: StorageMutationKind;
    entityType: "file" | "folder";
    entityId: string;
    requestHashPayload: unknown;
  } & FilesActor) => {
    const matchingEntity = prior.entities.some(
      (entity) =>
        entity.entityType === entityType && entity.entityId === entityId,
    );
    const accessible = canAccessPrivateNamespace({
      actorRole,
      actorUserId,
      namespaceOwnerUserId: prior.ownerUserId,
    });
    if (
      prior.kind !== kind ||
      prior.requestHash !== hashDurableStorageRequest(requestHashPayload) ||
      !matchingEntity ||
      !accessible
    ) {
      throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
    }
  };

  const assertDirectMutationReplayComplete = (prior: { status: string }) => {
    if (prior.status === "recovery_required") {
      throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
    }
    if (prior.status !== "succeeded") {
      throw new StorageMutationConflictError("STORAGE_MUTATION_RECOVERING");
    }
  };

  const findDirectMutationReplay = async ({
    actorRole,
    actorUserId,
    idempotencyKey,
    kind,
    entityType,
    entityId,
    requestHashPayload,
  }: FilesActor & {
    idempotencyKey?: string | null;
    kind: StorageMutationKind;
    entityType: "file" | "folder";
    entityId: string;
    requestHashPayload: unknown;
  }) => {
    if (repo || !idempotencyKey) return null;
    const prior = await getPrisma().storageMutation.findUnique({
      where: { idempotencyKey },
      include: { entities: true },
    });
    if (!prior) return null;
    assertDirectMutationReplayIdentity({
      prior,
      kind,
      entityType,
      entityId,
      requestHashPayload,
      actorRole,
      actorUserId,
    });
    assertDirectMutationReplayComplete(prior);
    return prior;
  };

  const serializeFolderMutationResult = (
    result: FolderMutationResult,
  ): Prisma.InputJsonValue =>
    toMetadataJson({
      response: {
        folder: {
          ...result.folder,
          deletedAt: result.folder.deletedAt?.toISOString() ?? null,
          createdAt: result.folder.createdAt.toISOString(),
          updatedAt: result.folder.updatedAt.toISOString(),
          storageMutation: null,
        },
        restoredTo: result.restoredTo ?? null,
      },
    });

  const serializeFileMutationResult = (
    result: FileMutationResult,
  ): Prisma.InputJsonValue =>
    toMetadataJson({
      response: {
        file: result.file
          ? {
              ...result.file,
              deletedAt: result.file.deletedAt?.toISOString() ?? null,
              createdAt: result.file.createdAt.toISOString(),
              updatedAt: result.file.updatedAt.toISOString(),
              storageMutation: null,
            }
          : null,
        deletedFileId: result.deletedFileId ?? null,
        restoredTo: result.restoredTo ?? null,
      },
    });

  const mutationReplayResponse = (
    resultJson: Prisma.JsonValue | null,
  ): Record<string, unknown> | null =>
    resultJson && typeof resultJson === "object" && !Array.isArray(resultJson)
      ? ((resultJson.response as Record<string, unknown> | undefined) ?? null)
      : null;

  const replayRestoreLocation = (
    response: Record<string, unknown> | null,
  ): FolderRestoreLocation | undefined =>
    response?.restoredTo &&
    typeof response.restoredTo === "object" &&
    !Array.isArray(response.restoredTo)
      ? (response.restoredTo as FolderRestoreLocation)
      : undefined;

  const replayFolderSummary = (value: unknown): FolderSummary | null => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const folder = value as Record<string, unknown>;
    if (typeof folder.id !== "string") return null;
    return {
      ...(folder as unknown as FolderSummary),
      deletedAt:
        typeof folder.deletedAt === "string"
          ? new Date(folder.deletedAt)
          : null,
      createdAt: new Date(String(folder.createdAt)),
      updatedAt: new Date(String(folder.updatedAt)),
      storageMutation: null,
    };
  };

  const parseFolderMutationReplay = (
    resultJson: Prisma.JsonValue | null,
  ): FolderMutationResult | null => {
    const response = mutationReplayResponse(resultJson);
    const folder = replayFolderSummary(response?.folder);
    if (!folder) return null;
    return {
      folder,
      restoredTo: replayRestoreLocation(response),
    };
  };

  const replayFileSummary = (value: unknown): FileSummary | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const file = value as Record<string, unknown>;
    return {
      ...(file as unknown as FileSummary),
      deletedAt:
        typeof file.deletedAt === "string" ? new Date(file.deletedAt) : null,
      createdAt: new Date(String(file.createdAt)),
      updatedAt: new Date(String(file.updatedAt)),
      storageMutation: null,
    };
  };

  const parseFileMutationReplay = (
    resultJson: Prisma.JsonValue | null,
  ): FileMutationResult | null => {
    const response = mutationReplayResponse(resultJson);
    const file = replayFileSummary(response?.file);
    const deletedFileId =
      typeof response?.deletedFileId === "string"
        ? response.deletedFileId
        : undefined;
    if (!file && !deletedFileId) return null;
    return {
      file,
      deletedFileId,
      restoredTo: replayRestoreLocation(response),
    };
  };

  const persistDirectMutationReplay = async (
    idempotencyKey: string | null | undefined,
    resultJson: Prisma.InputJsonValue,
  ) => {
    if (!repo && idempotencyKey) {
      await getPrisma().storageMutation.updateMany({
        where: { idempotencyKey, status: "succeeded" },
        data: { resultJson },
      });
    }
  };

  const buildDerivativeInvalidation = async (fileId: string) => {
    if (repo) {
      return {
        operations: [] as StorageMetadataOperation[],
        steps: [] as StorageMutationStepInput[],
        entities: [] as StorageMutationEntityInput[],
      };
    }
    const derivatives = await getPrisma().mediaDerivative.findMany({
      where: { fileId, storageKey: { not: null } },
      select: {
        id: true,
        storageKey: true,
        sizeBytes: true,
        storageRevision: true,
      },
    });
    const operations: StorageMetadataOperation[] = [];
    const steps: StorageMutationStepInput[] = [];
    const entities: StorageMutationEntityInput[] = [];
    for (const derivative of derivatives) {
      if (!derivative.storageKey) continue;
      operations.push({
        action: "update",
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        data: {
          status: "stale",
          storageKey: null,
          sizeBytes: null,
        },
      });
      steps.push({
        action: "delete_file",
        targetKey: derivative.storageKey,
        expectedNodeType: "file",
        expectedSizeBytes: derivative.sizeBytes,
        expectedChecksum: await fingerprintFileIfDeterminable(
          derivative.storageKey,
        ),
      });
      entities.push({
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        postRevision: derivative.storageRevision + 1,
        beforeJson: toMetadataJson({ storageKey: derivative.storageKey }),
        afterJson: toMetadataJson({ status: "stale", storageKey: null }),
      });
    }
    return { operations, steps, entities };
  };

  type FileTrashEntryPlan = {
    id: string;
    deletedAt: Date;
    storageRootKey: string;
    treeManifestDigest?: string | null;
  };

  const buildDurableFileOperations = ({
    file,
    preRevision,
    effectiveData,
    trashEntry,
    deleteTrashEntryId,
  }: {
    file: StoredFile;
    preRevision: number;
    effectiveData: Record<string, unknown>;
    trashEntry?: FileTrashEntryPlan;
    deleteTrashEntryId?: string | null;
  }): StorageMetadataOperation[] => {
    const operations: StorageMetadataOperation[] = [];
    if (trashEntry) {
      operations.push({
        action: "create_trash_entry",
        data: {
          id: trashEntry.id,
          ownerUserId: file.ownerUserId,
          rootKind: "file",
          rootEntityId: file.id,
          deletedAt: trashEntry.deletedAt.toISOString(),
          storageRootKey: trashEntry.storageRootKey,
          treeManifestDigest: trashEntry.treeManifestDigest ?? null,
          layoutVersion: "isolated",
        },
      });
    }
    operations.push({
      action: "update",
      entityType: "file",
      entityId: file.id,
      preRevision,
      data: toMetadataJson(effectiveData),
    });
    if (deleteTrashEntryId) {
      operations.push({
        action: "delete_trash_entry",
        entityId: deleteTrashEntryId,
      });
    }
    return operations;
  };

  const buildDurableFileSteps = ({
    file,
    toStorageKey,
    expectedChecksum,
  }: {
    file: StoredFile;
    toStorageKey: string;
    expectedChecksum: string | null;
  }): StorageMutationStepInput[] =>
    file.storageKey === toStorageKey
      ? []
      : [
          {
            action: "rename",
            sourceKey: file.storageKey,
            targetKey: toStorageKey,
            expectedNodeType: "file",
            expectedSizeBytes: BigInt(file.sizeBytes),
            expectedChecksum,
          },
        ];

  const buildDurableFileEntity = ({
    file,
    preRevision,
    effectiveData,
    toStorageKey,
  }: {
    file: StoredFile;
    preRevision: number;
    effectiveData: Record<string, unknown>;
    toStorageKey: string;
  }): StorageMutationEntityInput => ({
    entityType: "file",
    entityId: file.id,
    preRevision,
    postRevision: preRevision + 1,
    beforeJson: toMetadataJson({
      storageKey: file.storageKey,
      name: file.name,
      folderId: file.folderId,
      deletedAt: file.deletedAt?.toISOString() ?? null,
      trashEntryId: file.trashEntryId ?? null,
    }),
    afterJson: toMetadataJson({
      ...effectiveData,
      storageKey: toStorageKey,
    }),
  });

  const resolveDurableFileFingerprint = async (file: StoredFile) =>
    file.contentChecksum ??
    (await fingerprintFileIfDeterminable(file.storageKey)) ??
    null;

  const includeCapturedChecksum = ({
    file,
    data,
    expectedChecksum,
  }: {
    file: StoredFile;
    data: Record<string, unknown>;
    expectedChecksum: string | null;
  }) => {
    if (file.contentChecksum || !expectedChecksum) return data;
    return { ...data, contentChecksum: expectedChecksum };
  };

  const durablyUpdateFile = async ({
    kind,
    file,
    toStorageKey,
    data,
    trashEntry,
    deleteTrashEntryId,
    idempotencyKey,
    parentId,
    requestHashPayload,
    resultJson,
    guardEntities = [],
  }: {
    kind: StorageMutationKind;
    file: StoredFile;
    toStorageKey: string;
    data: Record<string, unknown>;
    trashEntry?: FileTrashEntryPlan;
    deleteTrashEntryId?: string | null;
    idempotencyKey?: string | null;
    parentId?: string | null;
    requestHashPayload?: unknown;
    resultJson?: Prisma.InputJsonValue;
    guardEntities?: StorageMutationEntityInput[];
  }): Promise<StoredFile | null> => {
    if (repo) return null;
    const preRevision = file.storageRevision ?? 0;
    const expectedChecksum = await resolveDurableFileFingerprint(file);
    const effectiveData = includeCapturedChecksum({
      file,
      data,
      expectedChecksum,
    });
    await runDurableStorageMutation({
      kind,
      ownerUserId: file.ownerUserId,
      idempotencyKey,
      parentId,
      requestHashPayload,
      resultJson,
      metadataOperations: buildDurableFileOperations({
        file,
        preRevision,
        effectiveData,
        trashEntry,
        deleteTrashEntryId,
      }),
      steps: buildDurableFileSteps({
        file,
        toStorageKey,
        expectedChecksum,
      }),
      entities: [
        buildDurableFileEntity({
          file,
          preRevision,
          effectiveData,
          toStorageKey,
        }),
        ...guardEntities,
      ],
      details: { entityType: "file", entityId: file.id },
    });
    return (await resolveRepo()).findFileById(file.id, {
      includeMissing: true,
    });
  };

  type FolderTreeUpdate = {
    folder: FolderSummary;
    data: Record<string, unknown>;
  };
  type FolderTreeFileUpdate = {
    file: StoredFile;
    data: Record<string, unknown>;
  };
  type FolderTrashEntryPlan = {
    id: string;
    deletedAt: Date;
    storageRootKey: string;
    treeManifestDigest?: string | null;
  };

  const buildDurableFolderOperations = ({
    rootFolder,
    folderUpdates,
    fileUpdates,
    trashEntry,
    deleteTrashEntryId,
  }: {
    rootFolder: FolderSummary;
    folderUpdates: FolderTreeUpdate[];
    fileUpdates: FolderTreeFileUpdate[];
    trashEntry?: FolderTrashEntryPlan;
    deleteTrashEntryId?: string | null;
  }) => {
    const operations: StorageMetadataOperation[] = [];
    if (trashEntry) {
      operations.push({
        action: "create_trash_entry",
        data: {
          id: trashEntry.id,
          ownerUserId: rootFolder.ownerUserId,
          rootKind: "folder",
          rootEntityId: rootFolder.id,
          deletedAt: trashEntry.deletedAt.toISOString(),
          storageRootKey: trashEntry.storageRootKey,
          treeManifestDigest: trashEntry.treeManifestDigest ?? null,
          layoutVersion: "isolated",
        },
      });
    }
    for (const update of folderUpdates) {
      operations.push({
        action: "update",
        entityType: "folder",
        entityId: update.folder.id,
        preRevision: update.folder.storageRevision ?? 0,
        data: toMetadataJson(update.data),
      });
    }
    for (const update of fileUpdates) {
      operations.push({
        action: "update",
        entityType: "file",
        entityId: update.file.id,
        preRevision: update.file.storageRevision ?? 0,
        data: toMetadataJson(update.data),
      });
    }
    if (deleteTrashEntryId) {
      operations.push({
        action: "delete_trash_entry",
        entityId: deleteTrashEntryId,
      });
    }
    return operations;
  };

  const resolveDurableTreeDigest = async ({
    fromStorageKey,
    toStorageKey,
    trashEntry,
    expectedTreeManifestDigest,
    stepsOverride,
  }: {
    fromStorageKey: string;
    toStorageKey: string;
    trashEntry?: FolderTrashEntryPlan;
    expectedTreeManifestDigest?: string | null;
    stepsOverride?: StorageMutationStepInput[];
  }) => {
    const known =
      trashEntry?.treeManifestDigest ?? expectedTreeManifestDigest ?? null;
    if (known || stepsOverride || fromStorageKey === toStorageKey) return known;
    return (await fingerprintTreeIfDeterminable(fromStorageKey)) ?? null;
  };

  const buildDurableFolderSteps = ({
    fromStorageKey,
    toStorageKey,
    treeManifestDigest,
    stepsOverride,
  }: {
    fromStorageKey: string;
    toStorageKey: string;
    treeManifestDigest: string | null;
    stepsOverride?: StorageMutationStepInput[];
  }): StorageMutationStepInput[] => {
    if (stepsOverride) return stepsOverride;
    if (fromStorageKey === toStorageKey) return [];
    return [
      {
        action: "rename",
        sourceKey: fromStorageKey,
        targetKey: toStorageKey,
        expectedNodeType: "directory",
        treeManifestDigest,
      },
    ];
  };

  const durableFolderEntity = ({
    folder,
    data,
  }: FolderTreeUpdate): StorageMutationEntityInput => ({
    entityType: "folder",
    entityId: folder.id,
    preRevision: folder.storageRevision ?? 0,
    postRevision: (folder.storageRevision ?? 0) + 1,
    beforeJson: toMetadataJson({
      name: folder.name,
      parentId: folder.parentId,
      deletedAt: folder.deletedAt?.toISOString() ?? null,
      trashEntryId: folder.trashEntryId ?? null,
    }),
    afterJson: toMetadataJson(data),
  });

  const durableTreeFileEntity = ({
    file,
    data,
  }: FolderTreeFileUpdate): StorageMutationEntityInput => ({
    entityType: "file",
    entityId: file.id,
    preRevision: file.storageRevision ?? 0,
    postRevision: (file.storageRevision ?? 0) + 1,
    beforeJson: toMetadataJson({
      storageKey: file.storageKey,
      deletedAt: file.deletedAt?.toISOString() ?? null,
      trashEntryId: file.trashEntryId ?? null,
    }),
    afterJson: toMetadataJson(data),
  });

  const durablyUpdateFolderTree = async ({
    kind,
    rootFolder,
    fromStorageKey,
    toStorageKey,
    folderUpdates,
    fileUpdates,
    trashEntry,
    expectedTreeManifestDigest,
    deleteTrashEntryId,
    stepsOverride,
    idempotencyKey,
    parentId,
    requestHashPayload,
    resultJson,
    guardEntities = [],
  }: {
    kind: StorageMutationKind;
    rootFolder: FolderSummary;
    fromStorageKey: string;
    toStorageKey: string;
    folderUpdates: FolderTreeUpdate[];
    fileUpdates: FolderTreeFileUpdate[];
    trashEntry?: FolderTrashEntryPlan;
    expectedTreeManifestDigest?: string | null;
    deleteTrashEntryId?: string | null;
    stepsOverride?: StorageMutationStepInput[];
    idempotencyKey?: string | null;
    parentId?: string | null;
    requestHashPayload?: unknown;
    resultJson?: Prisma.InputJsonValue;
    guardEntities?: StorageMutationEntityInput[];
  }): Promise<FolderSummary | null> => {
    if (repo) return null;
    const treeManifestDigest = await resolveDurableTreeDigest({
      fromStorageKey,
      toStorageKey,
      trashEntry,
      expectedTreeManifestDigest,
      stepsOverride,
    });
    await runDurableStorageMutation({
      kind,
      ownerUserId: rootFolder.ownerUserId,
      idempotencyKey,
      parentId,
      requestHashPayload,
      resultJson,
      metadataOperations: buildDurableFolderOperations({
        rootFolder,
        folderUpdates,
        fileUpdates,
        trashEntry,
        deleteTrashEntryId,
      }),
      steps: buildDurableFolderSteps({
        fromStorageKey,
        toStorageKey,
        treeManifestDigest,
        stepsOverride,
      }),
      entities: [
        ...folderUpdates.map(durableFolderEntity),
        ...fileUpdates.map(durableTreeFileEntity),
        ...guardEntities,
      ],
      details: { entityType: "folder", entityId: rootFolder.id },
    });
    return (await resolveRepo()).findFolderById(rootFolder.id);
  };

  const ensureFilesRoot = async (ownerUserId: string) => {
    const activeRepo = await resolveRepo();
    if (!repo) {
      await assertStorageProtocolReady();
      const filesRoot = await activeRepo.findFilesRoot?.(ownerUserId);
      if (!filesRoot) {
        throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
      }
      return filesRoot;
    }
    const filesRoot = await activeRepo.ensureFilesRoot(ownerUserId);
    await ensureUserCommittedStorageDirectories(filesRoot.ownerStorageId);
    await createFolderDirectory(
      buildFolderStorageKey({
        folder: filesRoot,
        folderMap: new Map([[filesRoot.id, filesRoot]]),
        filesRoot,
        trashed: false,
      }),
    );

    return filesRoot;
  };

  const getOwnedFolder = async ({
    actorRole,
    actorUserId,
    folderId,
  }: FolderLookupInput) => {
    const folder = assertFolderAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFolderById(folderId),
    );
    if (!repo) await assertStorageEntityReadable("folder", folder.id);
    return folder;
  };

  const getOwnedFile = async ({
    actorRole,
    actorUserId,
    fileId,
  }: FileLookupInput) => {
    const file = assertFileAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFileById(fileId),
    );
    if (!repo) await assertStorageEntityReadable("file", file.id);
    return file;
  };

  const getActiveOwnedFolder = async (input: FolderLookupInput) =>
    assertActiveFolder(await getOwnedFolder(input));

  const getActiveOwnedFile = async (input: FileLookupInput) =>
    assertActiveFile(await getOwnedFile(input));

  const collectDescendants = async ({
    ownerUserId,
    folderId,
    includeDeleted = true,
  }: {
    ownerUserId: string;
    folderId: string;
    includeDeleted?: boolean;
  }) => {
    const activeRepo = await resolveRepo();
    const descendants: FolderSummary[] = [];
    const queue = [folderId];

    while (queue.length > 0) {
      const currentFolderId = queue.shift();

      if (!currentFolderId) {
        continue;
      }

      const children = await activeRepo.listChildFolders(
        ownerUserId,
        currentFolderId,
        {
          includeDeleted,
        },
      );

      descendants.push(...children);
      queue.push(...children.map((child) => child.id));
    }

    return descendants;
  };

  const collectFilesInFolders = async ({
    ownerUserId,
    folderIds,
    includeDeleted = true,
  }: {
    ownerUserId: string;
    folderIds: Set<string>;
    includeDeleted?: boolean;
  }) => {
    const files = await (
      await resolveRepo()
    ).listFilesByOwner(ownerUserId, {
      includeDeleted,
    });

    return files.filter(
      (file) => file.folderId && folderIds.has(file.folderId),
    );
  };

  const buildBreadcrumbs = async (
    currentFolder: FolderSummary,
    filesRoot: FolderSummary,
  ): Promise<FilesBreadcrumb[]> => {
    if (currentFolder.id === filesRoot.id) {
      return [
        {
          id: filesRoot.id,
          name: filesRoot.name,
          href: "/files",
        },
      ];
    }

    const activeRepo = await resolveRepo();
    const trail: FolderSummary[] = [currentFolder];
    const seen = new Set([currentFolder.id]);
    let parentId = currentFolder.parentId;
    let reachedRoot = false;

    while (parentId && !seen.has(parentId)) {
      const parent = await activeRepo.findFolderById(parentId);

      if (!parent) {
        break;
      }

      trail.unshift(parent);
      seen.add(parent.id);

      if (parent.id === filesRoot.id) {
        reachedRoot = true;
        break;
      }

      parentId = parent.parentId;
    }

    if (!reachedRoot) {
      trail.unshift(filesRoot);
    }

    return trail.map((folder) => ({
      id: folder.id,
      name: folder.name,
      href: getFolderHref(folder),
    }));
  };

  const buildMoveTargets = async (filesRoot: FolderSummary) => {
    const folders = await (
      await resolveRepo()
    ).listFoldersByOwner(filesRoot.ownerUserId, {
      includeDeleted: false,
    });
    const childrenByParent = new Map<string | null, FolderSummary[]>();

    for (const folder of folders) {
      const parentKey = folder.parentId;
      const siblings = childrenByParent.get(parentKey) ?? [];
      siblings.push(folder);
      childrenByParent.set(parentKey, siblings);
    }

    for (const siblings of childrenByParent.values()) {
      siblings.sort((left, right) => left.name.localeCompare(right.name));
    }

    const ordered: MoveTarget[] = [];
    const visited = new Set<string>();

    const visit = (folder: FolderSummary, pathNames: string[]) => {
      if (visited.has(folder.id)) {
        return;
      }

      visited.add(folder.id);
      ordered.push({
        id: folder.id,
        name: folder.name,
        pathLabel: pathNames.join(" / "),
        isFilesRoot: folder.isFilesRoot,
      });

      const children = childrenByParent.get(folder.id) ?? [];

      for (const child of children) {
        visit(child, [...pathNames, child.name]);
      }
    };

    visit(filesRoot, [filesRoot.name]);

    for (const folder of folders) {
      if (!visited.has(folder.id)) {
        visit(folder, [filesRoot.name, folder.name]);
      }
    }

    return {
      childrenByParent,
      moveTargets: ordered,
    };
  };

  const getRestoreLocation = async (
    folder: FolderSummary,
    filesRoot: FolderSummary,
  ): Promise<FolderRestoreLocation> => {
    const activeRepo = await resolveRepo();

    if (folder.parentId) {
      const parent = await activeRepo.findFolderById(folder.parentId);

      if (
        parent &&
        parent.ownerUserId === folder.ownerUserId &&
        parent.deletedAt === null
      ) {
        return {
          kind: "original-parent",
          folderId: parent.id,
          folderName: parent.name,
          pathLabel: parent.isFilesRoot
            ? filesRoot.name
            : buildFolderPathLabel({
                folder: parent,
                folderMap: new Map(
                  (
                    await activeRepo.listFoldersByOwner(folder.ownerUserId, {
                      includeDeleted: true,
                    })
                  ).map((candidate) => [candidate.id, candidate]),
                ),
                filesRoot,
              }),
        };
      }
    }

    return {
      kind: "files-root",
      folderId: filesRoot.id,
      folderName: filesRoot.name,
      pathLabel: filesRoot.name,
    };
  };

  const getFileRestoreLocation = async (
    file: StoredFile,
    filesRoot: FolderSummary,
  ): Promise<FolderRestoreLocation> => {
    const activeRepo = await resolveRepo();

    if (file.folderId) {
      const parent = await activeRepo.findFolderById(file.folderId);

      if (
        parent &&
        parent.ownerUserId === file.ownerUserId &&
        parent.deletedAt === null
      ) {
        return {
          kind: "original-parent",
          folderId: parent.id,
          folderName: parent.name,
          pathLabel: parent.isFilesRoot
            ? filesRoot.name
            : buildFolderPathLabel({
                folder: parent,
                folderMap: new Map(
                  (
                    await activeRepo.listFoldersByOwner(file.ownerUserId, {
                      includeDeleted: true,
                    })
                  ).map((candidate) => [candidate.id, candidate]),
                ),
                filesRoot,
              }),
        };
      }
    }

    return {
      kind: "files-root",
      folderId: filesRoot.id,
      folderName: filesRoot.name,
      pathLabel: filesRoot.name,
    };
  };

  const findActiveNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFolderId,
    excludeFileId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFolderId?: string;
    excludeFileId?: string;
  }): Promise<ActiveNameConflict | null> => {
    const activeRepo = await resolveRepo();
    const [folders, files] = await Promise.all([
      activeRepo.listChildFolders(ownerUserId, parentId, {
        includeDeleted: false,
      }),
      activeRepo.listChildFiles(ownerUserId, parentId, {
        includeDeleted: false,
      }),
    ]);

    const conflictingFolder = folders.find(
      (folder) => folder.name === name && folder.id !== excludeFolderId,
    );

    if (conflictingFolder) {
      return {
        kind: "folder",
        item: conflictingFolder,
      };
    }

    const conflictingFile = files.find(
      (file) => file.name === name && file.id !== excludeFileId,
    );

    if (conflictingFile) {
      return {
        kind: "file",
        item: conflictingFile,
      };
    }

    return null;
  };

  const assertNoFolderNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFolderId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFolderId?: string;
  }) => {
    const conflict = await findActiveNameConflict({
      ownerUserId,
      parentId,
      name,
      excludeFolderId,
    });

    if (conflict) {
      throw new FilesError("FOLDER_NAME_CONFLICT");
    }
  };

  const assertNoFileNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFileId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFileId?: string;
  }) => {
    const conflict = await findActiveNameConflict({
      ownerUserId,
      parentId,
      name,
      excludeFileId,
    });

    if (conflict) {
      throw new FilesError("FILE_NAME_CONFLICT");
    }
  };

  const scheduleStagingCleanup = async (runAt = now()) => {
    if (scheduleStagingCleanupJob) {
      await scheduleStagingCleanupJob(runAt);
      return;
    }

    const {
      ensureBackgroundJobScheduled,
      STAGING_CLEANUP_JOB_KIND,
      STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
    } = await import("@staaash/db/jobs");

    await ensureBackgroundJobScheduled({
      kind: STAGING_CLEANUP_JOB_KIND,
      runAt: new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
      payloadJson: {},
      windowEnd: new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
    });
  };

  type FolderPurgeDerivative = {
    id: string;
    storageKey: string | null;
    sizeBytes: bigint | null;
    storageRevision: number;
  };

  const buildFolderPurgeOperations = ({
    currentFolder,
    descendants,
    files,
    derivatives,
  }: {
    currentFolder: FolderSummary;
    descendants: FolderSummary[];
    files: StoredFile[];
    derivatives: FolderPurgeDerivative[];
  }): StorageMetadataOperation[] => [
    ...derivatives.map((item): StorageMetadataOperation => ({
      action: "delete",
      entityType: "derivative",
      entityId: item.id,
      preRevision: item.storageRevision,
    })),
    ...files.map((item): StorageMetadataOperation => ({
      action: "delete",
      entityType: "file",
      entityId: item.id,
      preRevision: item.storageRevision ?? 0,
    })),
    ...[...descendants].reverse().map((item): StorageMetadataOperation => ({
      action: "delete",
      entityType: "folder",
      entityId: item.id,
      preRevision: item.storageRevision ?? 0,
    })),
    {
      action: "delete",
      entityType: "folder",
      entityId: currentFolder.id,
      preRevision: currentFolder.storageRevision ?? 0,
    },
    {
      action: "delete_trash_entry",
      entityId: currentFolder.trashEntryId!,
    },
  ];

  const buildLegacyFolderPurgeSteps = async ({
    files,
    quarantineKey,
  }: {
    files: StoredFile[];
    quarantineKey: string;
  }) => {
    const steps: StorageMutationStepInput[] = [];
    for (const item of files) {
      const expectedChecksum =
        item.contentChecksum ??
        (await fingerprintFileIfDeterminable(item.storageKey));
      const targetKey = path.posix.join(quarantineKey, item.id);
      steps.push(
        {
          action: "rename",
          sourceKey: item.storageKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(item.sizeBytes),
          expectedChecksum,
        },
        {
          action: "delete_file",
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(item.sizeBytes),
          expectedChecksum,
        },
      );
    }
    return steps;
  };

  const buildIsolatedFolderPurgeSteps = ({
    storageRootKey,
    treeManifestDigest,
    quarantineKey,
  }: {
    storageRootKey: string;
    treeManifestDigest: string | null;
    quarantineKey: string;
  }): StorageMutationStepInput[] => {
    if (!treeManifestDigest) {
      throw new StorageMutationAmbiguityError(
        "Isolated trash tree lacks its captured manifest.",
      );
    }
    return [
      {
        action: "rename",
        sourceKey: storageRootKey,
        targetKey: quarantineKey,
        expectedNodeType: "directory",
        treeManifestDigest,
      },
      {
        action: "delete_tree",
        targetKey: quarantineKey,
        expectedNodeType: "directory",
        treeManifestDigest,
      },
    ];
  };

  const appendDerivativePurgeSteps = async (
    steps: StorageMutationStepInput[],
    derivatives: FolderPurgeDerivative[],
  ) => {
    for (const derivative of derivatives) {
      if (!derivative.storageKey) continue;
      steps.push({
        action: "delete_file",
        targetKey: derivative.storageKey,
        expectedNodeType: "file",
        expectedSizeBytes: derivative.sizeBytes,
        expectedChecksum: await fingerprintFileIfDeterminable(
          derivative.storageKey,
        ),
      });
    }
  };

  const buildFolderPurgeEntities = ({
    currentFolder,
    descendants,
    files,
    derivatives,
  }: {
    currentFolder: FolderSummary;
    descendants: FolderSummary[];
    files: StoredFile[];
    derivatives: FolderPurgeDerivative[];
  }): StorageMutationEntityInput[] => [
    ...derivatives.map((item) => ({
      entityType: "derivative" as const,
      entityId: item.id,
      preRevision: item.storageRevision,
      postRevision: item.storageRevision + 1,
      beforeJson: toMetadataJson({ storageKey: item.storageKey }),
      afterJson: null,
    })),
    ...files.map((item) => ({
      entityType: "file" as const,
      entityId: item.id,
      preRevision: item.storageRevision ?? 0,
      postRevision: (item.storageRevision ?? 0) + 1,
      beforeJson: toMetadataJson({ storageKey: item.storageKey }),
      afterJson: null,
    })),
    ...[currentFolder, ...descendants].map((item) => ({
      entityType: "folder" as const,
      entityId: item.id,
      preRevision: item.storageRevision ?? 0,
      postRevision: (item.storageRevision ?? 0) + 1,
      beforeJson: toMetadataJson({ deletedAt: item.deletedAt }),
      afterJson: null,
    })),
  ];

  const durableFolderPurgeRequestHash = (
    currentFolder: FolderSummary,
    parentId?: string | null,
  ) =>
    parentId
      ? buildStorageMutationChildRequestHashPayload({
          operation: "clear_trash",
          item: { id: currentFolder.id, kind: "folder" },
        })
      : { kind: "folder_purge", folderId: currentFolder.id };

  const purgeDurableFolderTree = async ({
    folder,
    activeRepo,
    idempotencyKey,
    parentId,
  }: {
    folder: FolderSummary;
    activeRepo: FilesRepository;
    idempotencyKey?: string | null;
    parentId?: string | null;
  }) => {
    await assertStorageProtocolReady();
    const currentFolder = await activeRepo.findFolderById(folder.id);
    if (!currentFolder || !currentFolder.deletedAt) {
      return { deletedFolderCount: 0, deletedFileCount: 0 };
    }
    if (!currentFolder.trashEntryId) {
      throw new Error("Legacy folder purge requires recovery cutover.");
    }
    const trashEntry = await getPrisma().trashEntry.findUnique({
      where: { id: currentFolder.trashEntryId },
      select: {
        storageRootKey: true,
        treeManifestDigest: true,
        layoutVersion: true,
      },
    });
    if (!trashEntry?.storageRootKey) {
      throw new Error("Legacy folder purge requires exact-path recovery.");
    }
    const descendants = (
      await collectDescendants({
        ownerUserId: currentFolder.ownerUserId,
        folderId: currentFolder.id,
      })
    ).filter((item) => item.trashEntryId === currentFolder.trashEntryId);
    const folderIds = new Set([
      currentFolder.id,
      ...descendants.map((item) => item.id),
    ]);
    const files = (
      await collectFilesInFolders({
        ownerUserId: currentFolder.ownerUserId,
        folderIds,
      })
    ).filter((item) => item.trashEntryId === currentFolder.trashEntryId);
    const derivatives = await getPrisma().mediaDerivative.findMany({
      where: {
        fileId: { in: files.map((item) => item.id) },
        storageKey: { not: null },
      },
      select: {
        id: true,
        storageKey: true,
        sizeBytes: true,
        storageRevision: true,
      },
    });
    const quarantineKey = path.posix.join(
      "tmp",
      "quarantine",
      randomUUID(),
      currentFolder.name,
    );
    const steps =
      trashEntry.layoutVersion === "legacy"
        ? await buildLegacyFolderPurgeSteps({ files, quarantineKey })
        : buildIsolatedFolderPurgeSteps({
            storageRootKey: trashEntry.storageRootKey,
            treeManifestDigest: trashEntry.treeManifestDigest,
            quarantineKey,
          });
    await appendDerivativePurgeSteps(steps, derivatives);
    const counts = {
      deletedFolderCount: 1 + descendants.length,
      deletedFileCount: files.length,
    };
    await runDurableStorageMutation({
      kind: "folder_purge",
      ownerUserId: currentFolder.ownerUserId,
      idempotencyKey,
      parentId,
      requestHashPayload: durableFolderPurgeRequestHash(
        currentFolder,
        parentId,
      ),
      metadataOperations: buildFolderPurgeOperations({
        currentFolder,
        descendants,
        files,
        derivatives,
      }),
      steps,
      entities: buildFolderPurgeEntities({
        currentFolder,
        descendants,
        files,
        derivatives,
      }),
      resultJson: counts,
    });
    return counts;
  };

  const deleteTrashedFolderTree = async ({
    folder,
    filesRoot,
    idempotencyKey,
    parentId,
  }: {
    folder: FolderSummary;
    filesRoot: FolderSummary;
    idempotencyKey?: string | null;
    parentId?: string | null;
  }): Promise<{ deletedFolderCount: number; deletedFileCount: number }> => {
    const activeRepo = await resolveRepo();
    if (!repo) {
      return purgeDurableFolderTree({
        folder,
        activeRepo,
        idempotencyKey,
        parentId,
      });
    }
    const allFoldersForKey = buildFolderMap(
      await activeRepo.listFoldersByOwner(folder.ownerUserId, {
        includeDeleted: true,
      }),
    );
    const trashedStorageKey = buildFolderStorageKey({
      folder,
      folderMap: allFoldersForKey,
      filesRoot,
      trashed: true,
    });
    const trashedStoragePath = getStoragePath(trashedStorageKey);
    const lockKeys = [
      getEntryMutationLockKey(trashedStoragePath),
      getDirectoryMutationLockKey(trashedStoragePath),
    ];

    return withStorageLocks({
      lockKeys,
      callback: async () => {
        // Re-fetch to verify the root is still trashed after acquiring locks.
        const currentFolder = await activeRepo.findFolderById(folder.id);

        if (!currentFolder || currentFolder.deletedAt === null) {
          // Concurrently restored — skip.
          return { deletedFolderCount: 0, deletedFileCount: 0 };
        }

        // Re-collect from live state after revalidation.
        const descendants = await collectDescendants({
          ownerUserId: currentFolder.ownerUserId,
          folderId: currentFolder.id,
        });
        const folderIds = new Set([
          currentFolder.id,
          ...descendants.map((item) => item.id),
        ]);
        const descendantFiles = await collectFilesInFolders({
          ownerUserId: currentFolder.ownerUserId,
          folderIds,
        });

        // Delete only rows that are still present/trashed.
        const trashedDescendantIds = descendants
          .filter((d) => d.deletedAt !== null)
          .map((d) => d.id);
        const deletedFileCount = await activeRepo.deleteFiles(
          descendantFiles.map((file) => file.id),
        );
        await activeRepo.deleteFolders(trashedDescendantIds);
        await activeRepo.deleteFolders([currentFolder.id]);

        // Best-effort remove the trashed directory after DB deletion.
        try {
          await removeFolderDirectory(trashedStorageKey);
        } catch {
          // Once the tree rows are gone, leftover trash storage is operational
          // residue. Best-effort cleanup avoids reintroducing deleted records.
        }

        return {
          deletedFolderCount: 1 + trashedDescendantIds.length,
          deletedFileCount,
        };
      },
    });
  };

  type ClearTrashPlannedItem = {
    kind: "file" | "folder";
    id: string;
    deletedAt: string;
    storageRevision: number;
    trashEntryId: string | null;
  };
  type ClearTrashChildResult = Record<string, unknown> & {
    deletedFolderCount?: number;
    deletedFileCount?: number;
  };
  type ClearTrashLease = {
    parentId?: string | null;
    leaseOwner?: string | null;
    leaseToken?: bigint | null;
  };

  const completeClearTrashLease = ({
    parentId,
    leaseOwner,
    leaseToken,
  }: ClearTrashLease) =>
    parentId && leaseOwner && leaseToken !== null && leaseToken !== undefined
      ? { parentId, leaseOwner, leaseToken }
      : null;

  const renewClearTrashLease = async (lease: ClearTrashLease) => {
    const complete = completeClearTrashLease(lease);
    if (!complete) return;
    await renewStorageMutationLease({
      id: complete.parentId,
      leaseOwner: complete.leaseOwner,
      leaseToken: complete.leaseToken,
    });
  };

  const clearTrashCounts = (
    result: ClearTrashChildResult,
    planned: ClearTrashPlannedItem,
  ) => ({
    deletedFolderCount: Number(result.deletedFolderCount ?? 0),
    deletedFileCount: Number(
      result.deletedFileCount ?? (planned.kind === "file" ? 1 : 0),
    ),
  });

  const skippedClearTrashItem = (planned: ClearTrashPlannedItem) => ({
    kind: planned.kind,
    id: planned.id,
    status: "skipped",
    deletedFolderCount: 0,
    deletedFileCount: 0,
  });

  const clearTrashIdentityMatches = (
    planned: ClearTrashPlannedItem,
    current: {
      deletedAt: Date | null;
      storageRevision?: number;
      trashEntryId?: string | null;
    },
  ) =>
    current.deletedAt?.toISOString() === planned.deletedAt &&
    (current.storageRevision ?? 0) === planned.storageRevision &&
    (current.trashEntryId ?? null) === planned.trashEntryId;

  const isCanonicalIsoDate = (value: string) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    );
  };

  const isValidClearTrashKind = (kind: string) =>
    kind === "file" || kind === "folder";

  const isValidStorageRevision = (revision: number) =>
    Number.isSafeInteger(revision) && revision >= 0;

  const isValidTrashEntryId = (trashEntryId: string | null) =>
    trashEntryId === null || trashEntryId.length > 0;

  const isValidClearTrashItem = (item: ClearTrashPlannedItem) =>
    item.id.length > 0 &&
    isValidClearTrashKind(item.kind) &&
    isCanonicalIsoDate(item.deletedAt) &&
    isValidStorageRevision(item.storageRevision) &&
    isValidTrashEntryId(item.trashEntryId);

  const assertClearTrashPlan = (items: ClearTrashPlannedItem[]) => {
    for (const item of items) {
      if (!isValidClearTrashItem(item)) {
        throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
      }
    }
  };

  const recordClearTrashChild = async ({
    lease,
    childId,
    ordinal,
    result,
  }: {
    lease: ClearTrashLease;
    childId: string | null;
    ordinal: number;
    result: Record<string, unknown>;
  }) => {
    const complete = completeClearTrashLease(lease);
    if (!complete) return;
    await recordStorageMutationParentChild({
      parentId: complete.parentId,
      childId,
      ordinal,
      result: toMetadataJson(result),
      leaseOwner: complete.leaseOwner,
      leaseToken: complete.leaseToken,
    });
  };

  const completedClearTrashChild = async ({
    childKey,
    planned,
    ordinal,
    lease,
    actorUserId,
  }: {
    childKey?: string;
    planned: ClearTrashPlannedItem;
    ordinal: number;
    lease: ClearTrashLease;
    actorUserId: string;
  }): Promise<ClearTrashChildResult | null> => {
    if (!childKey || !lease.parentId) return null;
    const child = await getPrisma().storageMutation.findUnique({
      where: { idempotencyKey: childKey },
      select: {
        id: true,
        parentId: true,
        kind: true,
        ownerUserId: true,
        requestHash: true,
        status: true,
        resultJson: true,
      },
    });
    if (!child) return null;
    const expectedKind =
      planned.kind === "file" ? "file_purge" : "folder_purge";
    const requestHash = hashDurableStorageRequest(
      buildStorageMutationChildRequestHashPayload({
        operation: "clear_trash",
        item: { id: planned.id, kind: planned.kind },
      }),
    );
    assertClearTrashChildReplayIdentity({
      child,
      parentId: lease.parentId,
      ownerUserId: actorUserId,
      expectedKind,
      requestHash,
    });
    if (child.status !== "succeeded") return null;
    const durableCounts =
      child.resultJson &&
      typeof child.resultJson === "object" &&
      !Array.isArray(child.resultJson)
        ? (child.resultJson as ClearTrashChildResult)
        : {};
    const counts = clearTrashCounts(durableCounts, planned);
    const result = {
      kind: planned.kind,
      id: planned.id,
      status: "purged",
      ...counts,
    };
    await recordClearTrashChild({
      lease,
      childId: child.id,
      ordinal,
      result,
    });
    return result;
  };

  const purgeClearTrashItem = async ({
    planned,
    currentFiles,
    currentFolders,
    actor,
    childKey,
    parentId,
    filesRoot,
    deleteFile,
  }: {
    planned: ClearTrashPlannedItem;
    currentFiles: Map<string, TrashListing["files"][number]>;
    currentFolders: Map<string, TrashListing["items"][number]>;
    actor: FilesActor;
    childKey?: string;
    parentId?: string | null;
    filesRoot: FolderSummary;
    deleteFile(input: FileLookupInput): Promise<FileMutationResult>;
  }): Promise<ClearTrashChildResult> => {
    if (planned.kind === "file") {
      const item = currentFiles.get(planned.id);
      if (!item || !clearTrashIdentityMatches(planned, item.file)) {
        return skippedClearTrashItem(planned);
      }
      await deleteFile({
        ...actor,
        fileId: item.file.id,
        idempotencyKey: childKey,
        storageMutationParentId: parentId,
      });
      return {
        kind: "file",
        id: item.file.id,
        status: "purged",
        deletedFileCount: 1,
        deletedFolderCount: 0,
      };
    }
    const item = currentFolders.get(planned.id);
    if (!item || !clearTrashIdentityMatches(planned, item.folder)) {
      return skippedClearTrashItem(planned);
    }
    const counts = await deleteTrashedFolderTree({
      folder: item.folder,
      filesRoot,
      idempotencyKey: childKey,
      parentId,
    });
    return {
      kind: "folder",
      id: item.folder.id,
      status: "purged",
      ...counts,
    };
  };

  const runClearTrashChildren = async ({
    orderedItems,
    priorChildren,
    idempotencyKey,
    currentFiles,
    currentFolders,
    actor,
    lease,
    filesRoot,
    deleteFile,
  }: {
    orderedItems: ClearTrashPlannedItem[];
    priorChildren: Map<number, Record<string, unknown>>;
    idempotencyKey?: string | null;
    currentFiles: Map<string, TrashListing["files"][number]>;
    currentFolders: Map<string, TrashListing["items"][number]>;
    actor: FilesActor;
    lease: ClearTrashLease;
    filesRoot: FolderSummary;
    deleteFile(input: FileLookupInput): Promise<FileMutationResult>;
  }): Promise<TrashClearResult> => {
    assertClearTrashPlan(orderedItems);
    let deletedFolderCount = 0;
    let deletedFileCount = 0;
    const addResult = (
      result: ClearTrashChildResult,
      planned: ClearTrashPlannedItem,
    ) => {
      const counts = clearTrashCounts(result, planned);
      deletedFolderCount += counts.deletedFolderCount;
      deletedFileCount += counts.deletedFileCount;
    };
    for (const [ordinal, planned] of orderedItems.entries()) {
      await renewClearTrashLease(lease);
      const prior = priorChildren.get(ordinal);
      if (prior) {
        addResult(prior, planned);
        continue;
      }
      const childKey = idempotencyKey
        ? `${idempotencyKey}:${ordinal}`
        : undefined;
      const completed = await completedClearTrashChild({
        childKey,
        planned,
        ordinal,
        lease,
        actorUserId: actor.actorUserId,
      });
      if (completed) {
        addResult(completed, planned);
        continue;
      }
      const result = await purgeClearTrashItem({
        planned,
        currentFiles,
        currentFolders,
        actor,
        childKey,
        parentId: lease.parentId,
        filesRoot,
        deleteFile,
      });
      addResult(result, planned);
      const child = childKey
        ? await getPrisma().storageMutation.findUnique({
            where: { idempotencyKey: childKey },
            select: { id: true },
          })
        : null;
      await recordClearTrashChild({
        lease,
        childId: child?.id ?? null,
        ordinal,
        result,
      });
    }
    return { deletedFolderCount, deletedFileCount };
  };

  return {
    async ensureFilesRoot(ownerUserId: string) {
      return ensureFilesRoot(ownerUserId);
    },

    async getFilesListing({
      actorRole,
      actorUserId,
      folderId,
    }: FilesActor & { folderId?: string | null }): Promise<FilesListing> {
      const filesRoot = await ensureFilesRoot(actorUserId);
      const currentFolder = folderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId,
          })
        : filesRoot;
      const activeRepo = await resolveRepo();
      const [childFolders, files] = await Promise.all([
        activeRepo.listChildFolders(
          currentFolder.ownerUserId,
          currentFolder.id,
          {
            includeDeleted: false,
          },
        ),
        activeRepo.listChildFiles(currentFolder.ownerUserId, currentFolder.id, {
          includeDeleted: false,
        }),
      ]);
      const moveData = await buildMoveTargets(filesRoot);
      const [folderMutationStates, fileMutationStates] = !repo
        ? await Promise.all([
            getStorageMutationStateMap(
              "folder",
              childFolders.map((folder) => folder.id),
            ),
            getStorageMutationStateMap(
              "file",
              files.map((file) => file.id),
            ),
          ])
        : [new Map(), new Map()];
      const descendantIdsByFolderId = new Map<string, string[]>();
      const collectVisibleDescendantIds = (folderId: string): string[] => {
        const cached = descendantIdsByFolderId.get(folderId);

        if (cached) {
          return cached;
        }

        const children = moveData.childrenByParent.get(folderId) ?? [];
        const descendants = children.flatMap((child) => [
          child.id,
          ...collectVisibleDescendantIds(child.id),
        ]);
        descendantIdsByFolderId.set(folderId, descendants);

        return descendants;
      };
      const availableMoveTargetIdsByFolderId = Object.fromEntries(
        childFolders.map((folder) => {
          const blockedTargetIds = new Set([
            currentFolder.id,
            folder.id,
            ...collectVisibleDescendantIds(folder.id),
          ]);

          return [
            folder.id,
            moveData.moveTargets
              .filter((target) => !blockedTargetIds.has(target.id))
              .map((target) => target.id),
          ];
        }),
      );

      return {
        ownerUserId: currentFolder.ownerUserId,
        currentFolder,
        breadcrumbs: await buildBreadcrumbs(currentFolder, filesRoot),
        childFolders: childFolders.map((folder) => ({
          ...folder,
          storageMutation: folderMutationStates.get(folder.id) ?? null,
        })),
        files: files.map((file) => ({
          ...toFileSummary(file),
          storageMutation: fileMutationStates.get(file.id) ?? null,
        })),
        moveTargets: moveData.moveTargets,
        availableMoveTargetIdsByFolderId,
      };
    },

    async listTrashFolders({
      actorRole,
      actorUserId,
    }: FilesActor): Promise<TrashListing> {
      const filesRoot = await ensureFilesRoot(actorUserId);
      const activeRepo = await resolveRepo();
      const [allFolders, allFiles] = await Promise.all([
        activeRepo.listFoldersByOwner(filesRoot.ownerUserId, {
          includeDeleted: true,
        }),
        activeRepo.listFilesByOwner(filesRoot.ownerUserId, {
          includeDeleted: true,
        }),
      ]);
      const folderMap = new Map(
        allFolders.map((folder) => [folder.id, folder]),
      );
      const items: TrashFolderSummary[] = [];
      const files: TrashFileSummary[] = [];

      for (const folder of allFolders) {
        if (!folder.deletedAt || folder.isFilesRoot) {
          continue;
        }

        const parent = folder.parentId ? folderMap.get(folder.parentId) : null;

        if (parent?.deletedAt && parent.trashEntryId === folder.trashEntryId) {
          continue;
        }

        assertFolderAccess(
          {
            actorRole,
            actorUserId,
          },
          folder,
        );

        items.push({
          folder,
          originalPathLabel: buildFolderPathLabel({
            folder,
            folderMap,
            filesRoot,
          }),
          restoreLocation: await getRestoreLocation(folder, filesRoot),
        });
      }

      for (const file of allFiles) {
        if (!file.deletedAt) {
          continue;
        }

        assertFileAccess(
          {
            actorRole,
            actorUserId,
          },
          file,
        );

        const fileSummary = toFileSummary(file);
        let ancestor = file.folderId ? folderMap.get(file.folderId) : null;
        let hasDeletedAncestor = false;

        while (ancestor) {
          if (
            ancestor.deletedAt &&
            ancestor.trashEntryId === file.trashEntryId
          ) {
            hasDeletedAncestor = true;
            break;
          }

          ancestor = ancestor.parentId
            ? folderMap.get(ancestor.parentId)
            : null;
        }

        if (hasDeletedAncestor) {
          continue;
        }

        files.push({
          file: fileSummary,
          originalPathLabel: buildFilePathLabel({
            file: fileSummary,
            folderMap,
            filesRoot,
          }),
          restoreLocation: await getFileRestoreLocation(file, filesRoot),
        });
      }

      items.sort((left, right) => {
        const rightTime = right.folder.deletedAt?.getTime() ?? 0;
        const leftTime = left.folder.deletedAt?.getTime() ?? 0;

        return (
          rightTime - leftTime ||
          left.folder.name.localeCompare(right.folder.name)
        );
      });

      files.sort((left, right) => {
        const rightTime = right.file.deletedAt?.getTime() ?? 0;
        const leftTime = left.file.deletedAt?.getTime() ?? 0;

        return (
          rightTime - leftTime || left.file.name.localeCompare(right.file.name)
        );
      });

      const [folderMutationStates, fileMutationStates] = !repo
        ? await Promise.all([
            getStorageMutationStateMap(
              "folder",
              items.map((item) => item.folder.id),
            ),
            getStorageMutationStateMap(
              "file",
              files.map((item) => item.file.id),
            ),
          ])
        : [new Map(), new Map()];

      return {
        filesRoot,
        items: items.map((item) => ({
          ...item,
          folder: {
            ...item.folder,
            storageMutation: folderMutationStates.get(item.folder.id) ?? null,
          },
        })),
        files: files.map((item) => ({
          ...item,
          file: {
            ...item.file,
            storageMutation: fileMutationStates.get(item.file.id) ?? null,
          },
        })),
      };
    },

    async clearTrash({
      actorRole,
      actorUserId,
      idempotencyKey,
      storageMutationParentId,
      storageMutationParentLeaseOwner,
      storageMutationParentLeaseToken,
      storageMutationOrderedItems,
      storageMutationPriorChildren,
    }: FilesActor & DurableRequest): Promise<TrashClearResult> {
      if (!repo) await assertStorageProtocolReady();
      const listing = await this.listTrashFolders({
        actorRole,
        actorUserId,
      });

      const currentFiles = new Map(
        listing.files.map((item) => [item.file.id, item]),
      );
      const currentFolders = new Map(
        listing.items.map((item) => [item.folder.id, item]),
      );
      const orderedItems = storageMutationOrderedItems ?? [
        ...listing.files.map((item) => ({
          kind: "file" as const,
          id: item.file.id,
          deletedAt: item.file.deletedAt!.toISOString(),
          storageRevision: item.file.storageRevision ?? 0,
          trashEntryId: item.file.trashEntryId ?? null,
        })),
        ...listing.items.map((item) => ({
          kind: "folder" as const,
          id: item.folder.id,
          deletedAt: item.folder.deletedAt!.toISOString(),
          storageRevision: item.folder.storageRevision ?? 0,
          trashEntryId: item.folder.trashEntryId ?? null,
        })),
      ];
      const priorChildren = new Map(
        (storageMutationPriorChildren ?? []).map((child) => [
          child.ordinal,
          child.result,
        ]),
      );

      return runClearTrashChildren({
        orderedItems,
        priorChildren,
        idempotencyKey,
        currentFiles,
        currentFolders,
        actor: { actorRole, actorUserId },
        lease: {
          parentId: storageMutationParentId,
          leaseOwner: storageMutationParentLeaseOwner,
          leaseToken: storageMutationParentLeaseToken,
        },
        filesRoot: listing.filesRoot,
        deleteFile: (input) => this.deleteFile(input),
      });
    },

    // Durable create keeps validation, intent, and replay ordering explicit.
    // fallow-ignore-next-line complexity
    async createFolder({
      actorRole,
      actorUserId,
      parentId,
      name,
      idempotencyKey,
    }: CreateFolderInput): Promise<FolderMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const normalizedName = normalizeFolderName(name);
      const requestHashPayload = {
        kind: "folder_create",
        parentId: parentId ?? null,
        name: normalizedName,
      };
      if (!repo && idempotencyKey) {
        const prior = await getPrisma().storageMutation.findUnique({
          where: { idempotencyKey },
        });
        if (prior) {
          if (
            prior.kind !== "folder_create" ||
            prior.requestHash !==
              hashDurableStorageRequest(requestHashPayload) ||
            !canAccessPrivateNamespace({
              actorRole,
              actorUserId,
              namespaceOwnerUserId: prior.ownerUserId,
            })
          ) {
            throw new StorageMutationConflictError(
              "STORAGE_IDEMPOTENCY_KEY_REUSED",
            );
          }
          if (prior.status === "recovery_required") {
            throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
          }
          if (prior.status !== "succeeded") {
            throw new StorageMutationConflictError(
              "STORAGE_MUTATION_RECOVERING",
            );
          }
          const response = parseFolderMutationReplay(prior.resultJson);
          if (!response) {
            throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
          }
          return response;
        }
      }
      const parentFolder = parentId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: parentId,
          })
        : await ensureFilesRoot(actorUserId);

      await assertNoFolderNameConflict({
        ownerUserId: parentFolder.ownerUserId,
        parentId: parentFolder.id,
        name: normalizedName,
      });
      const activeRepo = await resolveRepo();
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(parentFolder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const virtualFolder: FolderSummary = {
        id: idempotencyKey
          ? deterministicUuid(
              `folder-create:${parentFolder.ownerUserId}:${idempotencyKey}`,
            )
          : randomUUID(),
        ownerUserId: parentFolder.ownerUserId,
        ownerStorageId: parentFolder.ownerStorageId,
        parentId: parentFolder.id,
        name: normalizedName,
        isFilesRoot: false,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      const folderStorageKey = buildFolderStorageKey({
        folder: virtualFolder,
        folderMap: new Map(folderMap).set(virtualFolder.id, virtualFolder),
        filesRoot: await ensureFilesRoot(parentFolder.ownerUserId),
        trashed: false,
      });

      if (!repo) {
        await runDurableStorageMutation({
          kind: "folder_create",
          ownerUserId: parentFolder.ownerUserId,
          idempotencyKey,
          requestHashPayload,
          resultJson: serializeFolderMutationResult({
            folder: {
              ...virtualFolder,
              storageRevision: 0,
            },
          }),
          metadataOperations: [
            {
              action: "create_folder",
              data: {
                id: virtualFolder.id,
                ownerUserId: parentFolder.ownerUserId,
                parentId: parentFolder.id,
                name: normalizedName,
              },
            },
          ],
          steps: [
            {
              action: "mkdir",
              targetKey: folderStorageKey,
              expectedNodeType: "directory",
              treeManifestDigest: EMPTY_TREE_MANIFEST_DIGEST,
            },
          ],
          entities: [
            {
              entityType: "folder",
              entityId: virtualFolder.id,
              preRevision: -1,
              postRevision: 0,
              beforeJson: null,
              afterJson: toMetadataJson({
                parentId: parentFolder.id,
                name: normalizedName,
              }),
            },
          ],
        });
        const folder = await activeRepo.findFolderById(virtualFolder.id);
        if (!folder) {
          throw new Error("Durable folder create committed without metadata.");
        }
        const result = { folder };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFolderMutationResult(result),
        );
        return result;
      }

      await createFolderDirectory(folderStorageKey);

      try {
        const folder = await activeRepo.createFolder({
          ownerUserId: parentFolder.ownerUserId,
          parentId: parentFolder.id,
          name: normalizedName,
        });

        return {
          folder,
        };
      } catch (error) {
        await removeFolderDirectory(folderStorageKey);
        throw error;
      }
    },

    // Durable rename keeps validation, intent, and replay ordering explicit.
    // fallow-ignore-next-line complexity
    async renameFolder({
      actorRole,
      actorUserId,
      folderId,
      name,
      idempotencyKey,
    }: RenameFolderInput): Promise<FolderMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const normalizedName = normalizeFolderName(name);
      const requestHashPayload = {
        kind: "folder_rename",
        folderId,
        name: normalizedName,
      };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "folder_rename",
        entityType: "folder",
        entityId: folderId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFolderMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);
      const filesRoot = await ensureFilesRoot(folder.ownerUserId);

      await assertNoFolderNameConflict({
        ownerUserId: folder.ownerUserId,
        parentId: folder.parentId ?? filesRoot.id,
        name: normalizedName,
        excludeFolderId: folder.id,
      });
      const activeRepo = await resolveRepo();
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
        includeDeleted: true,
      });
      const folderIds = new Set([
        folder.id,
        ...descendants.map((item) => item.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
        includeDeleted: true,
      });
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        name: normalizedName,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<Pick<StoredFile, "id" | "storageKey">> =
        [];
      const activeFromStorageKey = buildFolderStorageKey({
        folder,
        folderMap: currentFolderMap,
        filesRoot,
        trashed: false,
      });
      const activeToStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        filesRoot,
        trashed: false,
      });
      if (!repo) {
        const activeFiles = descendantFiles.filter(
          (descendantFile) => descendantFile.deletedAt === null,
        );
        const activeFolders = descendants.filter(
          (descendant) => descendant.deletedAt === null,
        );
        const {
          digest: expectedTreeManifestDigest,
          checksums: capturedChecksums,
        } = await captureFolderTreeManifest({
          rootStorageKey: activeFromStorageKey,
          folderStorageKeys: activeFolders.map((descendant) =>
            buildFolderStorageKey({
              folder: descendant,
              folderMap: currentFolderMap,
              filesRoot,
              trashed: false,
            }),
          ),
          files: activeFiles,
        });
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_rename",
          idempotencyKey,
          requestHashPayload,
          resultJson: serializeFolderMutationResult({
            folder: {
              ...folder,
              name: normalizedName,
              storageRevision: (folder.storageRevision ?? 0) + 1,
              updatedAt: now(),
            },
          }),
          rootFolder: folder,
          fromStorageKey: activeFromStorageKey,
          toStorageKey: activeToStorageKey,
          expectedTreeManifestDigest,
          folderUpdates: [
            {
              folder,
              data: { name: normalizedName },
            },
            ...activeFolders.map((descendant) => ({
              folder: descendant,
              data: {},
            })),
          ],
          fileUpdates: activeFiles.map((descendantFile) => ({
            file: descendantFile,
            data: {
              ...(!descendantFile.contentChecksum
                ? {
                    contentChecksum: capturedChecksums.get(descendantFile.id),
                  }
                : {}),
              storageKey: buildFileStorageKey({
                file: descendantFile,
                folderMap: nextFolderMap,
                filesRoot,
                trashed: false,
              }),
            },
          })),
        });
        if (!durableFolder) throw new Error("Durable folder rename failed.");
        const result = { folder: durableFolder };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFolderMutationResult(result),
        );
        return result;
      }
      const storageMoves = [
        {
          fromPath: getStoragePath(activeFromStorageKey),
          toPath: getStoragePath(activeToStorageKey),
        },
      ];
      const topLevelTrashedFolders = descendants.filter((item) => {
        if (!item.deletedAt) {
          return false;
        }

        const parent = item.parentId
          ? currentFolderMap.get(item.parentId)
          : null;

        return !parent?.deletedAt;
      });
      const standaloneTrashedFiles = descendantFiles.filter((item) => {
        if (!item.deletedAt) {
          return false;
        }

        const parent = item.folderId
          ? currentFolderMap.get(item.folderId)
          : null;

        return !parent?.deletedAt;
      });

      for (const trashedFolder of topLevelTrashedFolders) {
        const trashFromStorageKey = buildFolderStorageKey({
          folder: trashedFolder,
          folderMap: currentFolderMap,
          filesRoot,
          trashed: true,
        });
        const trashToStorageKey = buildFolderStorageKey({
          folder: trashedFolder,
          folderMap: nextFolderMap,
          filesRoot,
          trashed: true,
        });

        storageMoves.push({
          fromPath: getStoragePath(trashFromStorageKey),
          toPath: getStoragePath(trashToStorageKey),
        });
      }

      for (const trashedFile of standaloneTrashedFiles) {
        const trashToStorageKey = buildFileStorageKey({
          file: trashedFile,
          folderMap: nextFolderMap,
          filesRoot,
          trashed: true,
        });

        storageMoves.push({
          fromPath: getStoragePath(trashedFile.storageKey),
          toPath: getStoragePath(trashToStorageKey),
        });
      }

      return moveStorageEntriesWithLock({
        entries: storageMoves,
        lockKeys: storageMoves.flatMap(({ fromPath, toPath }) => [
          getEntryMutationLockKey(fromPath),
          getDirectoryMutationLockKey(fromPath),
          getDirectoryMutationLockKey(toPath),
        ]),
        applyMetadataUpdate: async () => {
          let folderUpdated = false;

          try {
            const updatedFolder = await activeRepo.updateFolder({
              id: folder.id,
              name: normalizedName,
            });
            folderUpdated = true;

            for (const descendantFile of descendantFiles) {
              const nextStorageKey = buildFileStorageKey({
                file: descendantFile,
                folderMap: nextFolderMap,
                filesRoot,
                trashed: descendantFile.deletedAt !== null,
              });

              if (nextStorageKey === descendantFile.storageKey) {
                continue;
              }

              previousFileStates.push({
                id: descendantFile.id,
                storageKey: descendantFile.storageKey,
              });
              await activeRepo.updateFile({
                id: descendantFile.id,
                storageKey: nextStorageKey,
              });
            }

            return {
              folder: updatedFolder,
            };
          } catch (error) {
            for (const previousFileState of [...previousFileStates].reverse()) {
              try {
                await activeRepo.updateFile({
                  id: previousFileState.id,
                  storageKey: previousFileState.storageKey,
                });
              } catch {
                // Preserve the original metadata error.
              }
            }

            if (folderUpdated) {
              try {
                await activeRepo.updateFolder({
                  id: folder.id,
                  name: folder.name,
                });
              } catch {
                // Preserve the original metadata error.
              }
            }

            throw error;
          }
        },
      });
    },

    // Tree CAS and path movement are one ordered recovery protocol.
    // fallow-ignore-next-line complexity
    async moveFolder({
      actorRole,
      actorUserId,
      folderId,
      destinationFolderId,
      idempotencyKey,
      storageMutationParentId,
    }: MoveFolderInput): Promise<FolderMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = storageMutationParentId
        ? buildStorageMutationChildRequestHashPayload({
            operation: "batch_move",
            item: { id: folderId, kind: "folder" },
            destinationFolderId: destinationFolderId ?? undefined,
          })
        : {
            kind: "folder_move" as const,
            folderId,
            destinationFolderId: destinationFolderId ?? null,
          };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "folder_move",
        entityType: "folder",
        entityId: folderId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFolderMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      const destinationFolder = destinationFolderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: destinationFolderId,
          })
        : await ensureFilesRoot(actorUserId);

      if (destinationFolder.id === folder.id) {
        throw new FilesError("FOLDER_MOVE_CYCLE");
      }

      if (destinationFolder.id === folder.parentId) {
        throw new FilesError("FOLDER_MOVE_NOOP");
      }

      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
        includeDeleted: false,
      });

      if (
        descendants.some((descendant) => descendant.id === destinationFolder.id)
      ) {
        throw new FilesError("FOLDER_MOVE_CYCLE");
      }

      await assertNoFolderNameConflict({
        ownerUserId: folder.ownerUserId,
        parentId: destinationFolder.id,
        name: folder.name,
        excludeFolderId: folder.id,
      });
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(folder.ownerUserId);
      const folderIds = new Set([
        folder.id,
        ...descendants.map((item) => item.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
        includeDeleted: true,
      });
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        parentId: destinationFolder.id,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<Pick<StoredFile, "id" | "storageKey">> =
        [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap: currentFolderMap,
        filesRoot,
        trashed: false,
      });
      const toStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        filesRoot,
        trashed: false,
      });

      if (!repo) {
        const activeFiles = descendantFiles.filter(
          (descendantFile) => descendantFile.deletedAt === null,
        );
        const {
          digest: expectedTreeManifestDigest,
          checksums: capturedChecksums,
        } = await captureFolderTreeManifest({
          rootStorageKey: fromStorageKey,
          folderStorageKeys: descendants.map((descendant) =>
            buildFolderStorageKey({
              folder: descendant,
              folderMap: currentFolderMap,
              filesRoot,
              trashed: false,
            }),
          ),
          files: activeFiles,
        });
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_move",
          idempotencyKey,
          parentId: storageMutationParentId,
          requestHashPayload,
          resultJson: serializeFolderMutationResult({
            folder: {
              ...folder,
              parentId: destinationFolder.id,
              storageRevision: (folder.storageRevision ?? 0) + 1,
              updatedAt: now(),
            },
          }),
          rootFolder: folder,
          guardEntities: [
            {
              entityType: "folder",
              entityId: destinationFolder.id,
              preRevision: destinationFolder.storageRevision ?? 0,
              postRevision: destinationFolder.storageRevision ?? 0,
              beforeJson: null,
              afterJson: null,
            },
          ],
          fromStorageKey,
          toStorageKey,
          expectedTreeManifestDigest,
          folderUpdates: [
            {
              folder,
              data: { parentId: destinationFolder.id },
            },
            ...descendants.map((descendant) => ({
              folder: descendant,
              data: {},
            })),
          ],
          fileUpdates: activeFiles.map((descendantFile) => ({
            file: descendantFile,
            data: {
              ...(!descendantFile.contentChecksum
                ? {
                    contentChecksum: capturedChecksums.get(descendantFile.id),
                  }
                : {}),
              storageKey: buildFileStorageKey({
                file: descendantFile,
                folderMap: nextFolderMap,
                filesRoot,
                trashed: false,
              }),
            },
          })),
        });
        if (!durableFolder) throw new Error("Durable folder move failed.");
        const result = { folder: durableFolder };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFolderMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        const updatedFolder = await activeRepo.updateFolder({
          id: folder.id,
          parentId: destinationFolder.id,
        });

        for (const descendantFile of descendantFiles) {
          const nextStorageKey = buildFileStorageKey({
            file: descendantFile,
            folderMap: nextFolderMap,
            filesRoot,
            trashed: false,
          });

          if (nextStorageKey === descendantFile.storageKey) {
            continue;
          }

          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            storageKey: nextStorageKey,
          });
        }

        return {
          folder: updatedFolder,
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolder({
          id: folder.id,
          parentId: folder.parentId,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
    },

    // Trash membership capture and tree movement are one recovery protocol.
    // fallow-ignore-next-line complexity
    async trashFolder({
      actorRole,
      actorUserId,
      folderId,
      idempotencyKey,
    }: FolderLookupInput): Promise<FolderMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = { kind: "folder_trash", folderId };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "folder_trash",
        entityType: "folder",
        entityId: folderId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFolderMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      const deletedAt = now();
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
        includeDeleted: repo ? true : false,
      });
      const folderIds = new Set([
        folder.id,
        ...descendants.map((descendant) => descendant.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
        includeDeleted: repo ? true : false,
      });
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(folder.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const previousFileStates: Array<
        Pick<StoredFile, "id" | "storageKey" | "deletedAt">
      > = [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap,
        filesRoot,
        trashed: false,
      });
      const trashEntryId = idempotencyKey
        ? deterministicUuid(`folder-trash:${folder.id}:${idempotencyKey}`)
        : randomUUID();
      const toStorageKey = repo
        ? buildFolderStorageKey({
            folder,
            folderMap,
            filesRoot,
            trashed: true,
          })
        : buildIsolatedTrashStorageKey({
            ownerStorageId: folder.ownerStorageId,
            kind: "folder",
            name: folder.name,
            deletedAt,
            trashEntryId,
          });

      if (!repo) {
        const memberFolders = [folder, ...descendants];
        const { digest: treeManifestDigest, checksums: capturedChecksums } =
          await captureFolderTreeManifest({
            rootStorageKey: fromStorageKey,
            folderStorageKeys: descendants.map((member) =>
              buildFolderStorageKey({
                folder: member,
                folderMap,
                filesRoot,
                trashed: false,
              }),
            ),
            files: descendantFiles,
          });
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_trash",
          idempotencyKey,
          requestHashPayload,
          resultJson: serializeFolderMutationResult({
            folder: {
              ...folder,
              deletedAt,
              trashEntryId,
              storageRevision: (folder.storageRevision ?? 0) + 1,
              updatedAt: now(),
            },
          }),
          rootFolder: folder,
          fromStorageKey,
          toStorageKey,
          folderUpdates: memberFolders.map((member) => ({
            folder: member,
            data: {
              deletedAt: deletedAt.toISOString(),
              trashEntryId,
            },
          })),
          fileUpdates: descendantFiles.map((descendantFile) => ({
            file: descendantFile,
            data: {
              ...(!descendantFile.contentChecksum
                ? {
                    contentChecksum: capturedChecksums.get(descendantFile.id),
                  }
                : {}),
              deletedAt: deletedAt.toISOString(),
              trashEntryId,
              storageKey: path.posix.join(
                toStorageKey,
                relativeStorageKeyWithin(
                  fromStorageKey,
                  descendantFile.storageKey,
                ),
              ),
            },
          })),
          trashEntry: {
            id: trashEntryId,
            deletedAt,
            storageRootKey: toStorageKey,
            treeManifestDigest,
          },
        });
        if (!durableFolder) throw new Error("Durable folder trash failed.");
        const result = { folder: durableFolder };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFolderMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        await activeRepo.updateFolders({
          ids: Array.from(folderIds),
          deletedAt,
        });

        for (const descendantFile of descendantFiles) {
          const trashedStorageKey = buildFileStorageKey({
            file: descendantFile,
            folderMap,
            filesRoot,
            trashed: true,
          });
          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
            deletedAt: descendantFile.deletedAt,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            deletedAt,
            storageKey: trashedStorageKey,
          });
        }

        return {
          folder: assertFolderAccess(
            {
              actorRole,
              actorUserId,
            },
            await activeRepo.findFolderById(folder.id),
          ),
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            deletedAt: previousFileState.deletedAt,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolders({
          ids: Array.from(folderIds),
          deletedAt: null,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
    },

    // Restore membership validation and tree movement are one recovery protocol.
    // fallow-ignore-next-line complexity
    async restoreFolder({
      actorRole,
      actorUserId,
      folderId,
      idempotencyKey,
    }: FolderLookupInput): Promise<FolderMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = { kind: "folder_restore", folderId };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "folder_restore",
        entityType: "folder",
        entityId: folderId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFolderMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const folder = await getOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      if (!folder.deletedAt) {
        throw new FilesError("FOLDER_ALREADY_ACTIVE");
      }

      const filesRoot = await ensureFilesRoot(folder.ownerUserId);
      const restoreLocation = await getRestoreLocation(folder, filesRoot);
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
      });
      const memberDescendants = repo
        ? descendants
        : descendants.filter(
            (descendant) =>
              descendant.trashEntryId !== undefined &&
              descendant.trashEntryId === folder.trashEntryId,
          );
      const folderIds = new Set([
        folder.id,
        ...memberDescendants.map((descendant) => descendant.id),
      ]);
      const collectedFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
      });
      const descendantFiles = repo
        ? collectedFiles
        : collectedFiles.filter(
            (file) =>
              file.trashEntryId !== undefined &&
              file.trashEntryId === folder.trashEntryId,
          );
      const activeRepo = await resolveRepo();
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        parentId: restoreLocation.folderId,
        deletedAt: null,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<
        Pick<StoredFile, "id" | "storageKey" | "deletedAt">
      > = [];
      const isolatedTrashEntry =
        !repo && folder.trashEntryId
          ? await getPrisma().trashEntry.findUnique({
              where: { id: folder.trashEntryId },
              select: {
                storageRootKey: true,
                treeManifestDigest: true,
                layoutVersion: true,
              },
            })
          : null;
      if (
        !repo &&
        (!isolatedTrashEntry || !isolatedTrashEntry.storageRootKey)
      ) {
        throw new Error("Folder trash identity requires recovery.");
      }
      const fromStorageKey =
        isolatedTrashEntry?.storageRootKey ??
        buildFolderStorageKey({
          folder,
          folderMap: currentFolderMap,
          filesRoot,
          trashed: true,
        });
      const toStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        filesRoot,
        trashed: false,
      });

      if (!repo) {
        const memberFolders = [folder, ...memberDescendants];
        const folderUpdates = memberFolders.map((member) => ({
          folder: member,
          data: {
            ...(member.id === folder.id
              ? { parentId: restoreLocation.folderId }
              : {}),
            deletedAt: null,
            trashEntryId: null,
          },
        }));
        const fileUpdates: Array<{
          file: StoredFile;
          data: Record<string, unknown>;
        }> = descendantFiles.map((descendantFile) => ({
          file: descendantFile,
          data: {
            deletedAt: null,
            trashEntryId: null,
            storageKey: buildFileStorageKey({
              file: descendantFile,
              folderMap: nextFolderMap,
              filesRoot,
              trashed: false,
            }),
          },
        }));
        let legacySteps: StorageMutationStepInput[] | undefined;
        if (isolatedTrashEntry?.layoutVersion === "legacy") {
          const directorySteps: StorageMutationStepInput[] = memberFolders.map(
            (member) => ({
              action: "mkdir",
              targetKey: buildFolderStorageKey({
                folder: member.id === folder.id ? nextFolder : member,
                folderMap: nextFolderMap,
                filesRoot,
                trashed: false,
              }),
              expectedNodeType: "directory",
              treeManifestDigest: EMPTY_TREE_MANIFEST_DIGEST,
            }),
          );
          const fileSteps: StorageMutationStepInput[] = [];
          for (const update of fileUpdates) {
            const expectedChecksum =
              update.file.contentChecksum ??
              (await fingerprintFileIfDeterminable(update.file.storageKey));
            if (!update.file.contentChecksum && expectedChecksum) {
              update.data.contentChecksum = expectedChecksum;
            }
            fileSteps.push({
              action: "rename",
              sourceKey: update.file.storageKey,
              targetKey: String(update.data.storageKey),
              expectedNodeType: "file",
              expectedSizeBytes: BigInt(update.file.sizeBytes),
              expectedChecksum,
            });
          }
          legacySteps = [...directorySteps, ...fileSteps];
        }
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_restore",
          idempotencyKey,
          requestHashPayload,
          resultJson: serializeFolderMutationResult({
            folder: {
              ...folder,
              parentId: restoreLocation.folderId,
              deletedAt: null,
              trashEntryId: null,
              storageRevision: (folder.storageRevision ?? 0) + 1,
              updatedAt: now(),
            },
            restoredTo: restoreLocation,
          }),
          rootFolder: folder,
          fromStorageKey,
          toStorageKey,
          folderUpdates,
          fileUpdates,
          deleteTrashEntryId: folder.trashEntryId,
          expectedTreeManifestDigest:
            isolatedTrashEntry?.layoutVersion === "isolated"
              ? (isolatedTrashEntry.treeManifestDigest ??
                "missing-captured-tree-manifest")
              : null,
          stepsOverride: legacySteps,
        });
        if (!durableFolder) throw new Error("Durable folder restore failed.");
        const result = {
          folder: durableFolder,
          restoredTo: restoreLocation,
        };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFolderMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        await activeRepo.updateFolders({
          ids: memberDescendants.map((descendant) => descendant.id),
          deletedAt: null,
        });

        const restoredFolder = await activeRepo.updateFolder({
          id: folder.id,
          parentId: restoreLocation.folderId,
          deletedAt: null,
        });

        for (const descendantFile of descendantFiles) {
          const restoredStorageKey = buildFileStorageKey({
            file: {
              ownerStorageId: descendantFile.ownerStorageId,
              folderId: descendantFile.folderId,
              name: descendantFile.name,
            },
            folderMap: nextFolderMap,
            filesRoot,
            trashed: false,
          });
          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
            deletedAt: descendantFile.deletedAt,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            deletedAt: null,
            storageKey: restoredStorageKey,
          });
        }

        return {
          folder: restoredFolder,
          restoredTo: restoreLocation,
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            deletedAt: previousFileState.deletedAt,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolders({
          ids: memberDescendants.map((descendant) => descendant.id),
          deletedAt: folder.deletedAt,
        });
        await activeRepo.updateFolder({
          id: folder.id,
          parentId: folder.parentId,
          deletedAt: folder.deletedAt,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
    },

    async renameFile({
      actorRole,
      actorUserId,
      fileId,
      idempotencyKey,
      storageMutationParentId,
      name,
    }: RenameFileInput): Promise<FileMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const normalizedName = normalizeFileName(name);
      const requestHashPayload = {
        kind: "file_rename",
        fileId,
        name: normalizedName,
      };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_rename",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFileMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const parentId = file.folderId ?? filesRoot.id;

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId,
        name: normalizedName,
        excludeFileId: file.id,
      });
      const activeRepo = await resolveRepo();
      const allFolders = await activeRepo.listFoldersByOwner(file.ownerUserId, {
        includeDeleted: true,
      });
      const folderMap = buildFolderMap(allFolders);
      const nextFile = {
        ...file,
        name: normalizedName,
      };
      const nextStorageKey = buildFileStorageKey({
        file: nextFile,
        folderMap,
        filesRoot,
        trashed: false,
      });

      const durableRename = await durablyUpdateFile({
        kind: "file_rename",
        idempotencyKey,
        parentId: storageMutationParentId,
        requestHashPayload,
        resultJson: serializeFileMutationResult({
          file: toFileSummary({
            ...file,
            name: normalizedName,
            updatedAt: now(),
          }),
        }),
        file,
        toStorageKey: nextStorageKey,
        data: {
          originalName: normalizedName,
          storageKey: nextStorageKey,
        },
      });
      if (durableRename) {
        const result = { file: toFileSummary(durableRename) };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFileMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: nextStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          name: normalizedName,
          storageKey: nextStorageKey,
        });

        return {
          file: toFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: nextStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
    },

    // File CAS, path movement, and replay handling must remain visibly ordered.
    // fallow-ignore-next-line complexity
    async moveFile({
      actorRole,
      actorUserId,
      fileId,
      destinationFolderId,
      idempotencyKey,
      storageMutationParentId,
    }: MoveFileInput): Promise<FileMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = storageMutationParentId
        ? buildStorageMutationChildRequestHashPayload({
            operation: "batch_move",
            item: { id: fileId, kind: "file" },
            destinationFolderId: destinationFolderId ?? undefined,
          })
        : {
            kind: "file_move" as const,
            fileId,
            destinationFolderId: destinationFolderId ?? null,
          };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_move",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFileMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      const destinationFolder = destinationFolderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: destinationFolderId,
          })
        : await ensureFilesRoot(actorUserId);

      if (destinationFolder.id === file.folderId) {
        throw new FilesError("FILE_MOVE_NOOP");
      }

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId: destinationFolder.id,
        name: file.name,
        excludeFileId: file.id,
      });
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextStorageKey = buildFileStorageKey({
        file: {
          ...file,
          folderId: destinationFolder.id,
        },
        folderMap,
        filesRoot,
        trashed: false,
      });

      const durableMove = await durablyUpdateFile({
        kind: "file_move",
        idempotencyKey,
        parentId: storageMutationParentId,
        requestHashPayload,
        resultJson: serializeFileMutationResult({
          file: toFileSummary({
            ...file,
            folderId: destinationFolder.id,
            updatedAt: now(),
          }),
        }),
        file,
        guardEntities: [
          {
            entityType: "folder",
            entityId: destinationFolder.id,
            preRevision: destinationFolder.storageRevision ?? 0,
            postRevision: destinationFolder.storageRevision ?? 0,
            beforeJson: null,
            afterJson: null,
          },
        ],
        toStorageKey: nextStorageKey,
        data: {
          folderId: destinationFolder.id,
          storageKey: nextStorageKey,
        },
      });
      if (durableMove) {
        const result = { file: toFileSummary(durableMove) };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFileMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: nextStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          folderId: destinationFolder.id,
          storageKey: nextStorageKey,
        });

        return {
          file: toFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: nextStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
    },

    async trashFile({
      actorRole,
      actorUserId,
      fileId,
      idempotencyKey,
    }: FileLookupInput): Promise<FileMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = { kind: "file_trash", fileId };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_trash",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFileMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const deletedAt = now();
      const trashEntryId = idempotencyKey
        ? deterministicUuid(`file-trash:${file.id}:${idempotencyKey}`)
        : randomUUID();
      const trashedStorageKey = repo
        ? buildFileStorageKey({
            file,
            folderMap,
            filesRoot,
            trashed: true,
          })
        : buildIsolatedTrashStorageKey({
            ownerStorageId: file.ownerStorageId,
            kind: "file",
            name: file.name,
            deletedAt,
            trashEntryId,
          });

      const durableTrash = await durablyUpdateFile({
        kind: "file_trash",
        idempotencyKey,
        requestHashPayload,
        resultJson: serializeFileMutationResult({
          file: toFileSummary({
            ...file,
            deletedAt,
            updatedAt: now(),
          }),
        }),
        file,
        toStorageKey: trashedStorageKey,
        data: {
          deletedAt: deletedAt.toISOString(),
          storageKey: trashedStorageKey,
          trashEntryId,
        },
        trashEntry: {
          id: trashEntryId,
          deletedAt,
          storageRootKey: trashedStorageKey,
        },
      });
      if (durableTrash) {
        const result = { file: toFileSummary(durableTrash) };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFileMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: trashedStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          deletedAt,
          storageKey: trashedStorageKey,
        });

        return {
          file: toFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: trashedStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
    },

    async restoreFile({
      actorRole,
      actorUserId,
      fileId,
      idempotencyKey,
    }: FileLookupInput): Promise<FileMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = { kind: "file_restore", fileId };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_restore",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFileMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const file = await getOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      if (!file.deletedAt) {
        throw new FilesError("FILE_ALREADY_ACTIVE");
      }

      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const restoreLocation = await getFileRestoreLocation(file, filesRoot);

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId: restoreLocation.folderId,
        name: file.name,
        excludeFileId: file.id,
      });
      const activeRepo = await resolveRepo();
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const restoredStorageKey = buildFileStorageKey({
        file: {
          ...file,
          folderId: restoreLocation.folderId,
        },
        folderMap,
        filesRoot,
        trashed: false,
      });

      const durableRestore = await durablyUpdateFile({
        kind: "file_restore",
        idempotencyKey,
        requestHashPayload,
        resultJson: serializeFileMutationResult({
          file: toFileSummary({
            ...file,
            folderId: restoreLocation.folderId,
            deletedAt: null,
            updatedAt: now(),
          }),
          restoredTo: restoreLocation,
        }),
        file,
        toStorageKey: restoredStorageKey,
        data: {
          deletedAt: null,
          folderId: restoreLocation.folderId,
          storageKey: restoredStorageKey,
          trashEntryId: null,
        },
        deleteTrashEntryId: file.trashEntryId,
      });
      if (durableRestore) {
        const result = {
          file: toFileSummary(durableRestore),
          restoredTo: restoreLocation,
        };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFileMutationResult(result),
        );
        return result;
      }

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: restoredStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          deletedAt: null,
          folderId: restoreLocation.folderId,
          storageKey: restoredStorageKey,
        });

        return {
          file: toFileSummary(updated),
          restoredTo: restoreLocation,
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: restoredStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
    },

    // Quarantine, metadata deletion, and cleanup are one ordered protocol.
    // fallow-ignore-next-line complexity
    async deleteFile({
      actorRole,
      actorUserId,
      fileId,
      idempotencyKey,
      storageMutationParentId,
    }: FileLookupInput): Promise<FileMutationResult> {
      if (!repo) await assertStorageProtocolReady();
      const requestHashPayload = storageMutationParentId
        ? buildStorageMutationChildRequestHashPayload({
            operation: "clear_trash",
            item: { id: fileId, kind: "file" },
          })
        : { kind: "file_purge" as const, fileId };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_purge",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) {
        const response = parseFileMutationReplay(replay.resultJson);
        if (!response) {
          throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
        }
        return response;
      }
      const file = await getOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      if (!file.deletedAt) {
        throw new FilesError("FILE_DELETE_REQUIRES_TRASH");
      }

      const activeRepo = await resolveRepo();
      if (!repo) {
        const derivatives = await getPrisma().mediaDerivative.findMany({
          where: { fileId: file.id, storageKey: { not: null } },
          select: {
            id: true,
            storageKey: true,
            sizeBytes: true,
            storageRevision: true,
          },
        });
        const derivativeSteps: StorageMutationStepInput[] = [];
        for (const derivative of derivatives) {
          if (!derivative.storageKey) continue;
          derivativeSteps.push({
            action: "delete_file",
            targetKey: derivative.storageKey,
            expectedNodeType: "file",
            expectedSizeBytes: derivative.sizeBytes,
            expectedChecksum: await fingerprintFileIfDeterminable(
              derivative.storageKey,
            ),
          });
        }
        const expectedChecksum =
          file.contentChecksum ??
          (await fingerprintFileIfDeterminable(file.storageKey));
        const quarantineKey = path.posix.join(
          "tmp",
          "quarantine",
          randomUUID(),
          file.name,
        );
        const operations: StorageMetadataOperation[] = [
          ...derivatives.map((derivative): StorageMetadataOperation => ({
            action: "delete",
            entityType: "derivative",
            entityId: derivative.id,
            preRevision: derivative.storageRevision,
          })),
          {
            action: "delete",
            entityType: "file",
            entityId: file.id,
            preRevision: file.storageRevision ?? 0,
          },
        ];
        if (file.trashEntryId) {
          operations.push({
            action: "delete_trash_entry",
            entityId: file.trashEntryId,
          });
        }
        await runDurableStorageMutation({
          kind: "file_purge",
          ownerUserId: file.ownerUserId,
          idempotencyKey,
          parentId: storageMutationParentId,
          requestHashPayload,
          metadataOperations: operations,
          steps: [
            {
              action: "rename",
              sourceKey: file.storageKey,
              targetKey: quarantineKey,
              expectedNodeType: "file",
              expectedSizeBytes: BigInt(file.sizeBytes),
              expectedChecksum,
            },
            {
              action: "delete_file",
              targetKey: quarantineKey,
              expectedNodeType: "file",
              expectedSizeBytes: BigInt(file.sizeBytes),
              expectedChecksum,
            },
            ...derivativeSteps,
          ],
          entities: [
            ...derivatives.map((derivative) => ({
              entityType: "derivative" as const,
              entityId: derivative.id,
              preRevision: derivative.storageRevision,
              postRevision: derivative.storageRevision + 1,
              beforeJson: toMetadataJson({
                storageKey: derivative.storageKey,
              }),
              afterJson: null,
            })),
            {
              entityType: "file",
              entityId: file.id,
              preRevision: file.storageRevision ?? 0,
              postRevision: (file.storageRevision ?? 0) + 1,
              beforeJson: toMetadataJson({
                storageKey: file.storageKey,
                deletedAt: file.deletedAt.toISOString(),
              }),
              afterJson: null,
            },
          ],
          details: { quarantineKey },
          resultJson: serializeFileMutationResult({
            deletedFileId: file.id,
          }),
        });
        const result = { deletedFileId: file.id };
        await persistDirectMutationReplay(
          idempotencyKey,
          serializeFileMutationResult(result),
        );
        return result;
      }
      const filePath = getStoragePath(file.storageKey);
      const lockKeys = [
        getEntryMutationLockKey(filePath),
        getDirectoryMutationLockKey(filePath),
      ];

      await withStorageLocks({
        lockKeys,
        callback: async () => {
          const pendingDelete = await quarantineDeleteWithLock({
            fileId: file.id,
            originalStorageKey: file.storageKey,
            originalPath: filePath,
            lockKeys: [],
          });

          try {
            await activeRepo.deleteFile(file.id);
          } catch (error) {
            try {
              await rollbackPendingDelete(pendingDelete);
            } catch {
              // Preserve the original repository failure. Pending delete
              // recovery will reconcile any leftover quarantine state.
            }

            throw error;
          }

          try {
            await finalizePendingDelete(pendingDelete);
          } catch {
            // The delete is logically complete once the database row is gone.
            // Worker recovery handles any leftover quarantine files.
          }
        },
      });

      return {
        deletedFileId: file.id,
      };
    },

    // Upload staging, conflict handling, and durable promotion are one protocol.
    // fallow-ignore-next-line complexity
    async uploadFiles({
      actorRole,
      actorUserId,
      folderId,
      items,
      idempotencyKey,
    }: UploadFilesInput): Promise<UploadFilesResult> {
      if (!repo) await assertStorageProtocolReady();
      const uploadDeadline = await createUploadDeadline(now().getTime());
      const preStagedUploads = new Map<
        number,
        Awaited<ReturnType<typeof stageUpload>>
      >();
      const replayedUploads = new Map<number, FileSummary>();
      if (!repo && idempotencyKey) {
        try {
          for (const [itemOrdinal, item] of items.entries()) {
            const normalizedName = normalizeFileName(
              item.originalName || item.file.name,
            );
            const stagedFile = await stageUpload(
              { ...item, originalName: normalizedName },
              uploadDeadline,
            );
            const requestHashPayload = {
              folderId: folderId ?? null,
              name: normalizedName,
              sizeBytes: stagedFile.sizeBytes,
              checksum: stagedFile.actualChecksum,
              conflictStrategy: item.conflictStrategy,
            };
            const prior = await getPrisma().storageMutation.findUnique({
              where: { idempotencyKey: `${idempotencyKey}:${itemOrdinal}` },
            });
            if (!prior) {
              preStagedUploads.set(itemOrdinal, stagedFile);
              continue;
            }
            if (
              !["upload_create", "upload_replace"].includes(prior.kind) ||
              prior.requestHash !==
                hashDurableStorageRequest(requestHashPayload) ||
              !canAccessPrivateNamespace({
                actorRole,
                actorUserId,
                namespaceOwnerUserId: prior.ownerUserId,
              })
            ) {
              throw new StorageMutationConflictError(
                "STORAGE_IDEMPOTENCY_KEY_REUSED",
              );
            }
            if (prior.status !== "succeeded") {
              throw new StorageMutationConflictError(
                prior.status === "recovery_required"
                  ? "STORAGE_RECOVERY_REQUIRED"
                  : "STORAGE_MUTATION_RECOVERING",
              );
            }
            const response = parseFileMutationReplay(prior.resultJson);
            if (!response?.file) {
              throw new StorageMutationConflictError(
                "STORAGE_RECOVERY_REQUIRED",
              );
            }
            replayedUploads.set(itemOrdinal, response.file);
            await cleanupStagedUpload(stagedFile.tmpPath);
          }
        } catch (error) {
          await Promise.all(
            Array.from(preStagedUploads.values()).map((stagedFile) =>
              cleanupStagedUpload(stagedFile.tmpPath),
            ),
          );
          throw error;
        }
        if (replayedUploads.size === items.length) {
          return {
            uploadedFiles: items.map((_item, ordinal) =>
              replayedUploads.get(ordinal)!,
            ),
            conflicts: [],
          };
        }
      }
      let targetFolder: FolderSummary;
      try {
        targetFolder = folderId
          ? await getActiveOwnedFolder({
              actorRole,
              actorUserId,
              folderId,
            })
          : await ensureFilesRoot(actorUserId);
        if (repo) {
          await assertUserStorageQuotaAvailable(
            targetFolder.ownerUserId,
            items.reduce(
              (total, item, ordinal) =>
                replayedUploads.has(ordinal)
                  ? total
                  : total + BigInt(item.file.size),
              0n,
            ),
          );
        }
      } catch (error) {
        await Promise.all(
          Array.from(preStagedUploads.values()).map((stagedFile) =>
            cleanupStagedUpload(stagedFile.tmpPath),
          ),
        );
        throw error;
      }
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(targetFolder.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(targetFolder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const targetFolderPath = getStoragePath(
        buildFolderStorageKey({
          folder: targetFolder,
          folderMap,
          filesRoot,
          trashed: false,
        }),
      );
      const targetFolderLockKeys = [
        getEntryMutationLockKey(targetFolderPath),
        getDirectoryMutationLockKey(targetFolderPath),
      ];
      const uploadedFilesByOrdinal = new Map<number, FileSummary>(
        replayedUploads,
      );
      const conflicts: UploadConflictItem[] = [];
      let stagedAnyUpload = false;

      for (const [itemOrdinal, item] of items.entries()) {
        if (replayedUploads.has(itemOrdinal)) continue;
        const itemIdempotencyKey = idempotencyKey
          ? `${idempotencyKey}:${itemOrdinal}`
          : undefined;
        const normalizedName = normalizeFileName(
          item.originalName || item.file.name,
        );
        const stagedFile =
          preStagedUploads.get(itemOrdinal) ??
          (await stageUpload(
            {
              ...item,
              originalName: normalizedName,
            },
            uploadDeadline,
          ));
        stagedAnyUpload = true;

        try {
          await coordinateStorageMutation({
            lockKeys: targetFolderLockKeys,
            deadline: uploadDeadline,
            // Replacement callback preserves staging and quota-transfer ordering.
            // fallow-ignore-next-line complexity
            callback: async () => {
              if (!repo && itemIdempotencyKey) {
                const prior = await getPrisma().storageMutation.findUnique({
                  where: { idempotencyKey: itemIdempotencyKey },
                });
                if (prior) {
                  if (
                    !["upload_create", "upload_replace"].includes(prior.kind) ||
                    !canAccessPrivateNamespace({
                      actorRole,
                      actorUserId,
                      namespaceOwnerUserId: prior.ownerUserId,
                    })
                  ) {
                    throw new StorageMutationConflictError(
                      "STORAGE_IDEMPOTENCY_KEY_REUSED",
                    );
                  }
                  if (prior.status !== "succeeded") {
                    throw new StorageMutationConflictError(
                      prior.status === "recovery_required"
                        ? "STORAGE_RECOVERY_REQUIRED"
                        : "STORAGE_MUTATION_RECOVERING",
                    );
                  }
                  const replayPayload = {
                    folderId: folderId ?? null,
                    name: normalizedName,
                    sizeBytes: stagedFile.sizeBytes,
                    checksum: stagedFile.actualChecksum,
                    conflictStrategy: item.conflictStrategy,
                  };
                  if (
                    prior.requestHash !==
                    hashDurableStorageRequest(replayPayload)
                  ) {
                    throw new StorageMutationConflictError(
                      "STORAGE_IDEMPOTENCY_KEY_REUSED",
                    );
                  }
                  const response = parseFileMutationReplay(prior.resultJson);
                  if (!response?.file) {
                    throw new StorageMutationConflictError(
                      "STORAGE_RECOVERY_REQUIRED",
                    );
                  }
                  uploadedFilesByOrdinal.set(itemOrdinal, response.file);
                  await cleanupStagedUpload(stagedFile.tmpPath);
                  return;
                }
              }
              const activeConflict = await findActiveNameConflict({
                ownerUserId: targetFolder.ownerUserId,
                parentId: targetFolder.id,
                name: normalizedName,
              });

              let finalName = normalizedName;

              if (activeConflict) {
                if (
                  item.conflictStrategy === "replace" &&
                  activeConflict.kind === "file"
                ) {
                  if (!repo) {
                    const existing = activeConflict.item;
                    const stagedStorageKey = storageKeyForAbsolutePath(
                      stagedFile.tmpPath,
                    );
                    const operationId = itemIdempotencyKey
                      ? deterministicUuid(
                          `upload-replace:${targetFolder.ownerUserId}:${itemIdempotencyKey}`,
                        )
                      : randomUUID();
                    const incomingKey = path.posix.join(
                      "tmp",
                      "incoming",
                      operationId,
                      existing.name,
                    );
                    const backupKey = path.posix.join(
                      "tmp",
                      "backup",
                      operationId,
                      existing.name,
                    );
                    const oldChecksum =
                      existing.contentChecksum ??
                      (await fingerprintFileIfDeterminable(
                        existing.storageKey,
                      ));
                    const derivativeInvalidation =
                      await buildDerivativeInvalidation(existing.id);
                    await runDurableStorageMutation({
                      kind: "upload_replace",
                      ownerUserId: targetFolder.ownerUserId,
                      idempotencyKey: itemIdempotencyKey,
                      requestHashPayload: {
                        folderId: folderId ?? null,
                        name: normalizedName,
                        sizeBytes: stagedFile.sizeBytes,
                        checksum: stagedFile.actualChecksum,
                        conflictStrategy: item.conflictStrategy,
                      },
                      metadataOperations: [
                        {
                          action: "assert_owner_quota",
                          ownerUserId: targetFolder.ownerUserId,
                          additionalBytes: String(
                            stagedFile.sizeBytes - existing.sizeBytes,
                          ),
                        },
                        {
                          action: "update",
                          entityType: "file",
                          entityId: existing.id,
                          preRevision: existing.storageRevision ?? 0,
                          data: {
                            mimeType: stagedFile.mimeType,
                            sizeBytes: String(stagedFile.sizeBytes),
                            contentChecksum: stagedFile.actualChecksum,
                            deletedAt: null,
                            folderId: targetFolder.id,
                          },
                        },
                        ...derivativeInvalidation.operations,
                      ],
                      steps: [
                        {
                          action: "rename",
                          sourceKey: stagedStorageKey,
                          targetKey: incomingKey,
                          expectedNodeType: "file",
                          expectedSizeBytes: BigInt(stagedFile.sizeBytes),
                          expectedChecksum: stagedFile.actualChecksum,
                        },
                        {
                          action: "rename",
                          sourceKey: existing.storageKey,
                          targetKey: backupKey,
                          expectedNodeType: "file",
                          expectedSizeBytes: BigInt(existing.sizeBytes),
                          expectedChecksum: oldChecksum,
                        },
                        {
                          action: "rename",
                          sourceKey: incomingKey,
                          targetKey: existing.storageKey,
                          expectedNodeType: "file",
                          expectedSizeBytes: BigInt(stagedFile.sizeBytes),
                          expectedChecksum: stagedFile.actualChecksum,
                        },
                        {
                          action: "delete_file",
                          targetKey: backupKey,
                          expectedNodeType: "file",
                          expectedSizeBytes: BigInt(existing.sizeBytes),
                          expectedChecksum: oldChecksum,
                        },
                        ...derivativeInvalidation.steps,
                      ],
                      entities: [
                        {
                          entityType: "file",
                          entityId: existing.id,
                          preRevision: existing.storageRevision ?? 0,
                          postRevision: (existing.storageRevision ?? 0) + 1,
                          beforeJson: toMetadataJson({
                            storageKey: existing.storageKey,
                            sizeBytes: existing.sizeBytes,
                            contentChecksum: oldChecksum,
                          }),
                          afterJson: toMetadataJson({
                            storageKey: existing.storageKey,
                            sizeBytes: stagedFile.sizeBytes,
                            contentChecksum: stagedFile.actualChecksum,
                          }),
                        },
                        ...derivativeInvalidation.entities,
                      ],
                      details: { stagedStorageKey, incomingKey, backupKey },
                      resultJson: serializeFileMutationResult({
                        file: toFileSummary({
                          ...existing,
                          mimeType: stagedFile.mimeType,
                          sizeBytes: stagedFile.sizeBytes,
                          updatedAt: now(),
                        }),
                      }),
                    });
                    await cleanupStagedUpload(stagedFile.tmpPath);
                    const updated = await activeRepo.findFileById(existing.id);
                    if (!updated) {
                      throw new Error(
                        "Durable replacement committed without metadata.",
                      );
                    }
                    const result = { file: toFileSummary(updated) };
                    await persistDirectMutationReplay(
                      itemIdempotencyKey,
                      serializeFileMutationResult(result),
                    );
                    uploadedFilesByOrdinal.set(itemOrdinal, result.file);
                    return;
                  }
                  const updated = await replaceCommittedUpload({
                    stagedFile,
                    targetPath: getStoragePath(activeConflict.item.storageKey),
                    deadline: uploadDeadline,
                    applyMetadataUpdate: () =>
                      withUserQuotaWrite({
                        ownerUserId: targetFolder.ownerUserId,
                        additionalBytes: BigInt(
                          Math.max(
                            0,
                            stagedFile.sizeBytes -
                              activeConflict.item.sizeBytes,
                          ),
                        ),
                        callback: (tx) =>
                          activeRepo.updateFile(
                            {
                              id: activeConflict.item.id,
                              name: activeConflict.item.name,
                              mimeType: stagedFile.mimeType,
                              sizeBytes: stagedFile.sizeBytes,
                              contentChecksum: stagedFile.actualChecksum,
                              deletedAt: null,
                              folderId: targetFolder.id,
                            },
                            tx as unknown as FilesTransactionClient,
                          ),
                      }),
                  });

                  uploadedFilesByOrdinal.set(
                    itemOrdinal,
                    toFileSummary(updated),
                  );
                  return;
                }

                if (item.conflictStrategy === "safeRename") {
                  const siblings = await Promise.all([
                    activeRepo.listChildFolders(
                      targetFolder.ownerUserId,
                      targetFolder.id,
                      {
                        includeDeleted: false,
                      },
                    ),
                    activeRepo.listChildFiles(
                      targetFolder.ownerUserId,
                      targetFolder.id,
                      {
                        includeDeleted: false,
                      },
                    ),
                  ]);
                  finalName = buildSafeRenamedFileName(normalizedName, [
                    ...siblings[0].map((folder) => folder.name),
                    ...siblings[1].map((file) => file.name),
                  ]);
                } else {
                  conflicts.push({
                    clientKey: item.clientKey,
                    originalName: normalizedName,
                    conflictStrategy: item.conflictStrategy,
                    existingKind: activeConflict.kind,
                    existingId: activeConflict.item.id,
                    existingName: activeConflict.item.name,
                  });
                  await cleanupStagedUpload(stagedFile.tmpPath);
                  return;
                }
              }

              const storageKey = buildFileStorageKey({
                file: {
                  ownerStorageId: targetFolder.ownerStorageId,
                  folderId: targetFolder.id,
                  name: finalName,
                },
                folderMap,
                filesRoot,
                trashed: false,
              });
              const fileId = itemIdempotencyKey
                ? deterministicUuid(
                    `upload-create:${targetFolder.ownerUserId}:${itemIdempotencyKey}`,
                  )
                : randomUUID();
              const targetPath = getStoragePath(storageKey);

              if (!repo) {
                const stagedStorageKey = storageKeyForAbsolutePath(
                  stagedFile.tmpPath,
                );
                await runDurableStorageMutation({
                  kind: "upload_create",
                  ownerUserId: targetFolder.ownerUserId,
                  idempotencyKey: itemIdempotencyKey,
                  requestHashPayload: {
                    folderId: folderId ?? null,
                    name: normalizedName,
                    sizeBytes: stagedFile.sizeBytes,
                    checksum: stagedFile.actualChecksum,
                    conflictStrategy: item.conflictStrategy,
                  },
                  metadataOperations: [
                    {
                      action: "assert_owner_quota",
                      ownerUserId: targetFolder.ownerUserId,
                      additionalBytes: String(stagedFile.sizeBytes),
                    },
                    {
                      action: "create_file",
                      data: {
                        id: fileId,
                        ownerUserId: targetFolder.ownerUserId,
                        folderId: targetFolder.id,
                        originalName: finalName,
                        storageKey,
                        mimeType: stagedFile.mimeType,
                        sizeBytes: String(stagedFile.sizeBytes),
                        contentChecksum: stagedFile.actualChecksum,
                      },
                    },
                  ],
                  steps: [
                    {
                      action: "rename",
                      sourceKey: stagedStorageKey,
                      targetKey: storageKey,
                      expectedNodeType: "file",
                      expectedSizeBytes: BigInt(stagedFile.sizeBytes),
                      expectedChecksum: stagedFile.actualChecksum,
                    },
                  ],
                  entities: [
                    {
                      entityType: "file",
                      entityId: fileId,
                      preRevision: -1,
                      postRevision: 0,
                      beforeJson: null,
                      afterJson: toMetadataJson({
                        storageKey,
                        originalName: finalName,
                        sizeBytes: stagedFile.sizeBytes,
                        contentChecksum: stagedFile.actualChecksum,
                      }),
                    },
                  ],
                  details: { stagedStorageKey },
                  resultJson: serializeFileMutationResult({
                    file: {
                      id: fileId,
                      ownerUserId: targetFolder.ownerUserId,
                      ownerStorageId: targetFolder.ownerStorageId,
                      folderId: targetFolder.id,
                      name: finalName,
                      mimeType: stagedFile.mimeType,
                      sizeBytes: stagedFile.sizeBytes,
                      viewerKind: null,
                      deletedAt: null,
                      createdAt: now(),
                      updatedAt: now(),
                    },
                  }),
                });
                await cleanupStagedUpload(stagedFile.tmpPath);
                const createdFile = await activeRepo.findFileById(fileId);
                if (!createdFile) {
                  throw new Error(
                    "Durable upload committed without file metadata.",
                  );
                }
                const result = { file: toFileSummary(createdFile) };
                await persistDirectMutationReplay(
                  itemIdempotencyKey,
                  serializeFileMutationResult(result),
                );
                uploadedFilesByOrdinal.set(itemOrdinal, result.file);
                return;
              }

              try {
                await commitStagedUpload(stagedFile, targetPath, {
                  deadline: uploadDeadline,
                });
              } catch (error) {
                await cleanupStagedUpload(stagedFile.tmpPath);
                throw error;
              }

              try {
                const createdFile = await withUserQuotaWrite({
                  ownerUserId: targetFolder.ownerUserId,
                  additionalBytes: BigInt(stagedFile.sizeBytes),
                  callback: (tx) =>
                    activeRepo.createFile(
                      {
                        id: fileId,
                        ownerUserId: targetFolder.ownerUserId,
                        folderId: targetFolder.id,
                        name: finalName,
                        storageKey,
                        mimeType: stagedFile.mimeType,
                        sizeBytes: stagedFile.sizeBytes,
                        contentChecksum: stagedFile.actualChecksum,
                      },
                      tx as unknown as FilesTransactionClient,
                    ),
                });

                uploadedFilesByOrdinal.set(
                  itemOrdinal,
                  toFileSummary(createdFile),
                );
              } catch (error) {
                await rm(targetPath, {
                  force: true,
                });
                throw error;
              }
            },
          });
        } catch (error) {
          if (repo) {
            await cleanupStagedUpload(stagedFile.tmpPath);
          }

          throw error;
        }
      }

      if (stagedAnyUpload) {
        await scheduleStagingCleanup();
      }

      const uploadedFiles = items.flatMap((_item, ordinal) => {
        const uploaded = uploadedFilesByOrdinal.get(ordinal);
        return uploaded ? [uploaded] : [];
      });
      if (uploadedFiles.length > 0) {
        void (async () => {
          try {
            const settings = await getSystemSettings();
            if (
              !settings.mediaPreviewEnabled ||
              !settings.mediaPreviewGenerateOnUpload
            ) {
              return;
            }
            const threshold = settings.mediaPreviewThresholdBytes;
            await Promise.all(
              uploadedFiles
                .filter(
                  (f) =>
                    f.viewerKind === "video" &&
                    BigInt(f.sizeBytes) >= threshold,
                )
                .map((f) =>
                  scheduleDerivativeGenerate({
                    fileId: f.id,
                    reason: "upload",
                    now: now(),
                  }),
                ),
            );
          } catch (err) {
            console.error(
              "[files] Failed to schedule preview generation.",
              err,
            );
          }
        })();
      }

      return {
        uploadedFiles,
        conflicts,
      };
    },

    // Resumable commit keeps session, quota, and byte promotion ordering explicit.
    // fallow-ignore-next-line complexity
    async commitResumableUpload({
      actorRole,
      actorUserId,
      uploadSessionId,
      tmpPath,
      folderId,
      originalName,
      mimeType,
      totalSizeBytes,
      contentChecksum,
      conflictStrategy,
    }: CommitResumableUploadInput): Promise<FileSummary> {
      if (!repo) await assertStorageProtocolReady();
      const durableMutationId = `resumable-${uploadSessionId}`;
      if (!repo) {
        const prior = await findStorageMutation(durableMutationId);
        if (
          prior &&
          (prior.ownerUserId !== actorUserId ||
            !["upload_create", "upload_replace"].includes(prior.kind))
        ) {
          throw new FilesError("ACCESS_DENIED");
        }
        if (prior) {
          const linkedSession = await getPrisma().uploadSession.findUnique({
            where: { id: uploadSessionId },
            select: { ownerUserId: true, storageMutationId: true },
          });
          if (
            !linkedSession ||
            linkedSession.ownerUserId !== actorUserId ||
            linkedSession.storageMutationId !== prior.id
          ) {
            throw new FilesError("ACCESS_DENIED");
          }
        }
        if (prior?.status === "succeeded") {
          const committedFileId = (
            prior.resultJson as { committedFileId?: unknown } | null
          )?.committedFileId;
          if (typeof committedFileId !== "string") {
            throw new Error(
              "Completed resumable mutation lost retained result.",
            );
          }
          const committed = await (
            await resolveRepo()
          ).findFileById(committedFileId);
          if (!committed) {
            throw new Error("Completed resumable file metadata is missing.");
          }
          return toFileSummary(committed);
        }
        if (prior) {
          throw new StorageMutationConflictError(
            prior.status === "recovery_required"
              ? "STORAGE_RECOVERY_REQUIRED"
              : [
                    "prepared",
                    "running",
                    "retrying",
                    "metadata_committed",
                    "finalizing",
                  ].includes(prior.status)
                ? "STORAGE_MUTATION_RECOVERING"
                : "STORAGE_MUTATION_IN_PROGRESS",
          );
        }
      }
      const targetFolder = folderId
        ? await getActiveOwnedFolder({ actorRole, actorUserId, folderId })
        : await ensureFilesRoot(actorUserId);
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(targetFolder.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(targetFolder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const normalizedName = normalizeFileName(originalName);
      const durableStagedStorageKey = !repo
        ? storageKeyForAbsolutePath(tmpPath)
        : null;
      const durableContentChecksum =
        !repo && !contentChecksum
          ? await calculateStorageFileChecksum(
              getStorageRoot(),
              durableStagedStorageKey!,
            )
          : contentChecksum;
      const targetFolderPath = getStoragePath(
        buildFolderStorageKey({
          folder: targetFolder,
          folderMap,
          filesRoot,
          trashed: false,
        }),
      );
      const targetFolderLockKeys = [
        getEntryMutationLockKey(targetFolderPath),
        getDirectoryMutationLockKey(targetFolderPath),
      ];

      return coordinateStorageMutation({
        lockKeys: targetFolderLockKeys,
        // Commit callback preserves session and metadata transaction ordering.
        // fallow-ignore-next-line complexity
        callback: async () => {
          const activeConflict = await findActiveNameConflict({
            ownerUserId: targetFolder.ownerUserId,
            parentId: targetFolder.id,
            name: normalizedName,
          });

          let finalName = normalizedName;

          if (activeConflict) {
            if (
              conflictStrategy === "replace" &&
              activeConflict.kind === "file"
            ) {
              if (!repo) {
                const existing = activeConflict.item;
                const stagedStorageKey = durableStagedStorageKey!;
                const operationId = durableMutationId;
                const incomingKey = path.posix.join(
                  "tmp",
                  "incoming",
                  operationId,
                  existing.name,
                );
                const backupKey = path.posix.join(
                  "tmp",
                  "backup",
                  operationId,
                  existing.name,
                );
                const oldChecksum =
                  existing.contentChecksum ??
                  (await fingerprintFileIfDeterminable(existing.storageKey));
                const derivativeInvalidation =
                  await buildDerivativeInvalidation(existing.id);
                await runDurableStorageMutation({
                  kind: "upload_replace",
                  mutationId: durableMutationId,
                  ownerUserId: targetFolder.ownerUserId,
                  idempotencyKey: `resumable:${uploadSessionId}:complete`,
                  uploadSessionId,
                  metadataOperations: [
                    {
                      action: "update",
                      entityType: "file",
                      entityId: existing.id,
                      preRevision: existing.storageRevision ?? 0,
                      data: {
                        mimeType,
                        sizeBytes: String(totalSizeBytes),
                        contentChecksum: durableContentChecksum,
                        deletedAt: null,
                        folderId: targetFolder.id,
                      },
                    },
                    {
                      action: "complete_upload_session",
                      entityId: uploadSessionId,
                      ownerUserId: targetFolder.ownerUserId,
                      committedFileId: existing.id,
                      completedAt: now().toISOString(),
                      storageMutationId: durableMutationId,
                    },
                    ...derivativeInvalidation.operations,
                  ],
                  steps: [
                    {
                      action: "rename",
                      sourceKey: stagedStorageKey,
                      targetKey: incomingKey,
                      expectedNodeType: "file",
                      expectedSizeBytes: BigInt(totalSizeBytes),
                      expectedChecksum: durableContentChecksum,
                    },
                    {
                      action: "rename",
                      sourceKey: existing.storageKey,
                      targetKey: backupKey,
                      expectedNodeType: "file",
                      expectedSizeBytes: BigInt(existing.sizeBytes),
                      expectedChecksum: oldChecksum,
                    },
                    ...derivativeInvalidation.steps,
                    {
                      action: "rename",
                      sourceKey: incomingKey,
                      targetKey: existing.storageKey,
                      expectedNodeType: "file",
                      expectedSizeBytes: BigInt(totalSizeBytes),
                      expectedChecksum: durableContentChecksum,
                    },
                    {
                      action: "delete_file",
                      targetKey: backupKey,
                      expectedNodeType: "file",
                      expectedSizeBytes: BigInt(existing.sizeBytes),
                      expectedChecksum: oldChecksum,
                    },
                  ],
                  entities: [
                    {
                      entityType: "file",
                      entityId: existing.id,
                      preRevision: existing.storageRevision ?? 0,
                      postRevision: (existing.storageRevision ?? 0) + 1,
                      beforeJson: toMetadataJson({
                        sizeBytes: existing.sizeBytes,
                        contentChecksum: oldChecksum,
                      }),
                      afterJson: toMetadataJson({
                        sizeBytes: totalSizeBytes,
                        contentChecksum: durableContentChecksum,
                      }),
                    },
                    {
                      entityType: "upload_session",
                      entityId: uploadSessionId,
                      preRevision: 0,
                      postRevision: 1,
                      beforeJson: toMetadataJson({ status: "committing" }),
                      afterJson: toMetadataJson({ status: "completed" }),
                    },
                    ...derivativeInvalidation.entities,
                  ],
                  details: { stagedStorageKey, incomingKey, backupKey },
                  requestHashPayload: {
                    uploadSessionId,
                    ownerUserId: targetFolder.ownerUserId,
                    existingFileId: existing.id,
                    folderId: targetFolder.id,
                    mimeType,
                    totalSizeBytes,
                    contentChecksum: durableContentChecksum,
                    conflictStrategy,
                  },
                  resultJson: { committedFileId: existing.id },
                });
                const updated = await activeRepo.findFileById(existing.id);
                if (!updated) {
                  throw new Error(
                    "Durable resumable replacement lost metadata.",
                  );
                }
                return toFileSummary(updated);
              }
              try {
                const updated = await activeReplaceResumableStorageUpload({
                  stagedPath: tmpPath,
                  uploadId: randomUUID(),
                  targetPath: getStoragePath(activeConflict.item.storageKey),
                  lockKeys: [
                    getEntryMutationLockKey(tmpPath),
                    getDirectoryMutationLockKey(tmpPath),
                    getEntryMutationLockKey(
                      getStoragePath(activeConflict.item.storageKey),
                    ),
                    getDirectoryMutationLockKey(
                      getStoragePath(activeConflict.item.storageKey),
                    ),
                  ],
                  applyMetadataUpdate: () =>
                    completeResumableSessionWithFile({
                      id: uploadSessionId,
                      ownerUserId: targetFolder.ownerUserId,
                      committedFileId: activeConflict.item.id,
                      callback: (tx) =>
                        activeRepo.updateFile(
                          {
                            id: activeConflict.item.id,
                            name: activeConflict.item.name,
                            mimeType,
                            sizeBytes: totalSizeBytes,
                            contentChecksum,
                            deletedAt: null,
                            folderId: targetFolder.id,
                          },
                          tx as unknown as FilesTransactionClient,
                        ),
                    }),
                });
                return toFileSummary(updated);
              } catch (error) {
                return recoverResumableCompletionFailure({
                  error,
                  uploadSessionId,
                  ownerUserId: targetFolder.ownerUserId,
                });
              }
            }

            if (conflictStrategy === "safeRename") {
              const siblings = await Promise.all([
                activeRepo.listChildFolders(
                  targetFolder.ownerUserId,
                  targetFolder.id,
                  { includeDeleted: false },
                ),
                activeRepo.listChildFiles(
                  targetFolder.ownerUserId,
                  targetFolder.id,
                  { includeDeleted: false },
                ),
              ]);
              finalName = buildSafeRenamedFileName(normalizedName, [
                ...siblings[0].map((f) => f.name),
                ...siblings[1].map((f) => f.name),
              ]);
            } else {
              throw new FilesError("FILE_NAME_CONFLICT");
            }
          }

          const storageKey = buildFileStorageKey({
            file: {
              ownerStorageId: targetFolder.ownerStorageId,
              folderId: targetFolder.id,
              name: finalName,
            },
            folderMap,
            filesRoot,
            trashed: false,
          });
          const fileId = repo ? randomUUID() : `file-${uploadSessionId}`;
          const targetPath = getStoragePath(storageKey);

          if (!repo) {
            const stagedStorageKey = durableStagedStorageKey!;
            await runDurableStorageMutation({
              kind: "upload_create",
              mutationId: durableMutationId,
              ownerUserId: targetFolder.ownerUserId,
              idempotencyKey: `resumable:${uploadSessionId}:complete`,
              uploadSessionId,
              metadataOperations: [
                {
                  action: "create_file",
                  data: {
                    id: fileId,
                    ownerUserId: targetFolder.ownerUserId,
                    folderId: targetFolder.id,
                    originalName: finalName,
                    storageKey,
                    mimeType,
                    sizeBytes: String(totalSizeBytes),
                    contentChecksum: durableContentChecksum,
                  },
                },
                {
                  action: "complete_upload_session",
                  entityId: uploadSessionId,
                  ownerUserId: targetFolder.ownerUserId,
                  committedFileId: fileId,
                  completedAt: now().toISOString(),
                  storageMutationId: durableMutationId,
                },
              ],
              steps: [
                {
                  action: "rename",
                  sourceKey: stagedStorageKey,
                  targetKey: storageKey,
                  expectedNodeType: "file",
                  expectedSizeBytes: BigInt(totalSizeBytes),
                  expectedChecksum: durableContentChecksum,
                },
              ],
              entities: [
                {
                  entityType: "file",
                  entityId: fileId,
                  preRevision: -1,
                  postRevision: 0,
                  beforeJson: null,
                  afterJson: toMetadataJson({
                    storageKey,
                    sizeBytes: totalSizeBytes,
                    contentChecksum: durableContentChecksum,
                  }),
                },
                {
                  entityType: "upload_session",
                  entityId: uploadSessionId,
                  preRevision: 0,
                  postRevision: 1,
                  beforeJson: toMetadataJson({ status: "committing" }),
                  afterJson: toMetadataJson({ status: "completed" }),
                },
              ],
              details: { stagedStorageKey },
              requestHashPayload: {
                uploadSessionId,
                ownerUserId: targetFolder.ownerUserId,
                folderId: targetFolder.id,
                finalName,
                mimeType,
                totalSizeBytes,
                contentChecksum: durableContentChecksum,
                conflictStrategy,
              },
              resultJson: { committedFileId: fileId },
            });
            const createdFile = await activeRepo.findFileById(fileId);
            if (!createdFile) {
              throw new Error(
                "Durable resumable upload committed without metadata.",
              );
            }
            return toFileSummary(createdFile);
          }

          let createdFile: StoredFile;
          try {
            createdFile = await activeCommitResumableStorageUpload({
              stagedPath: tmpPath,
              targetPath,
              lockKeys: [
                getEntryMutationLockKey(tmpPath),
                getDirectoryMutationLockKey(tmpPath),
                getEntryMutationLockKey(targetPath),
                getDirectoryMutationLockKey(targetPath),
              ],
              applyMetadataUpdate: () =>
                completeResumableSessionWithFile({
                  id: uploadSessionId,
                  ownerUserId: targetFolder.ownerUserId,
                  committedFileId: fileId,
                  callback: (tx) =>
                    activeRepo.createFile(
                      {
                        id: fileId,
                        ownerUserId: targetFolder.ownerUserId,
                        folderId: targetFolder.id,
                        name: finalName,
                        storageKey,
                        mimeType,
                        sizeBytes: totalSizeBytes,
                        contentChecksum,
                      },
                      tx as unknown as FilesTransactionClient,
                    ),
                }),
            });
          } catch (error) {
            return recoverResumableCompletionFailure({
              error,
              uploadSessionId,
              ownerUserId: targetFolder.ownerUserId,
            });
          }

          const summary = toFileSummary(createdFile);

          if (summary.viewerKind === "video") {
            void (async () => {
              try {
                const settings = await getSystemSettings();
                if (
                  settings.mediaPreviewEnabled &&
                  settings.mediaPreviewGenerateOnUpload &&
                  BigInt(totalSizeBytes) >= settings.mediaPreviewThresholdBytes
                ) {
                  await scheduleDerivativeGenerate({
                    fileId: createdFile.id,
                    reason: "upload",
                    now: now(),
                  });
                }
              } catch {
                // best-effort
              }
            })();
          }

          return summary;
        },
      });
    },
  };
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error.";

const resumableRecoveryDiagnostic = (error: unknown) => {
  if (!(error instanceof ResumableStorageCommitError)) {
    return new Error(`Commit outcome unknown: ${errorText(error)}`);
  }
  const rollback = error.rollbackError
    ? ` Rollback error: ${errorText(error.rollbackError)}`
    : "";
  return new Error(
    `Commit ${error.outcome}: ${errorText(error.originalError)}${rollback}`,
  );
};

const recoverResumableCompletionFailure = async ({
  error,
  uploadSessionId,
  ownerUserId,
}: {
  error: unknown;
  uploadSessionId: string;
  ownerUserId: string;
}): Promise<never> => {
  const diagnostic = resumableRecoveryDiagnostic(error);
  if (
    !(error instanceof ResumableStorageCommitError) ||
    error.outcome === "ambiguous"
  ) {
    await recordResumableCommitRecoveryError({
      id: uploadSessionId,
      ownerUserId,
      error: diagnostic,
    }).catch((recordError) => {
      console.error(
        "[uploads] Failed to record ambiguous resumable commit.",
        recordError,
      );
    });
    throw new ResumableCompletionError("RESUMABLE_COMMIT_AMBIGUOUS", {
      cause: error,
    });
  }

  try {
    await restoreResumableSessionAfterCommitRollback({
      id: uploadSessionId,
      ownerUserId,
      error: diagnostic,
    });
  } catch (restoreError) {
    const combinedDiagnostic = new Error(
      `${diagnostic.message} Session restore error: ${errorText(restoreError)}`,
    );
    await recordResumableCommitRecoveryError({
      id: uploadSessionId,
      ownerUserId,
      error: combinedDiagnostic,
    }).catch((recordError) => {
      console.error(
        "[uploads] Failed to record resumable session restore ambiguity.",
        recordError,
      );
    });
    throw new ResumableCompletionError("RESUMABLE_COMMIT_AMBIGUOUS", {
      cause: restoreError,
    });
  }

  throw new ResumableCompletionError("RESUMABLE_COMMIT_RETRYABLE", {
    cause: error,
  });
};

export const filesService = createFilesService();
