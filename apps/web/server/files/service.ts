import { hasTrashAncestor, isTrashFolderRoot } from "./trash-roots";
import { getListWindow, type ListQuery } from "@/server/list-window";
// Storage mutations deliberately mirror phase ordering across entity kinds.
// fallow-ignore-file code-duplication
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertStorageAdmissionActive,
  StorageAdmissionBusyError,
  StorageAdmissionCancelledError,
} from "@staaash/db/storage-transactions";

import {
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_THUMB,
  canHaveThumbnail,
  isDerivativeKindEnabled,
  scheduleDerivativeGenerate,
} from "@staaash/db/media-derivatives";
import { getPrisma, Prisma } from "@staaash/db/client";

import { canAccessPrivateNamespace } from "@/server/access";
import { listFolderPreviewFileIds } from "@/server/files/folder-previews";
import { shouldGenerateMediaPreview } from "@/server/media/preview-generation-policy";
import { getSystemSettings } from "@/server/settings";
import {
  assertUserStorageQuotaAvailable,
  withUserQuotaWrite,
} from "@/server/user-storage";
import {
  assertRevision,
  conflictDetails,
  FilesError,
  ResumableCompletionError,
  RevisionConflictError,
} from "@/server/files/errors";
import {
  assertStorageKeysFit,
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
  StorageMutationRejectedError,
  storageMutationRejectionFromResult,
} from "@staaash/db/storage-mutations";
import {
  assertStorageFilesystemSupported,
  captureTreeManifest,
  type CapturedTreeEntry,
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
  /** A background request is accepted only after its journal is prepared. */
  onStorageMutationPrepared?: (mutationId: string) => void;
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
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    folderId: string;
  };

type FileLookupInput = FilesActor &
  DurableRequest & {
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    fileId: string;
  };

type CreateFolderInput = FilesActor &
  DurableRequest & {
    parentId?: string | null;
    name: string;
  };

type RenameFolderInput = FilesActor &
  DurableRequest & {
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    folderId: string;
    name: string;
  };

type MoveFolderInput = FilesActor &
  DurableRequest & {
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    folderId: string;
    destinationFolderId?: string | null;
  };

type RenameFileInput = FilesActor &
  DurableRequest & {
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    fileId: string;
    name: string;
  };

type MoveFileInput = FilesActor &
  DurableRequest & {
    /** Refuse if the item is no longer at this revision. */
    ifRevision?: number;
    fileId: string;
    destinationFolderId?: string | null;
  };

type UploadFilesInput = FilesActor &
  DurableRequest & {
    signal?: AbortSignal;
    folderId?: string | null;
    items: UploadRequestItem[];
  };

type EnsureFolderPathsInput = FilesActor &
  DurableRequest & {
    parentId: string;
    paths: string[];
  };

type EnsureFolderPathsResult = {
  folders: Array<{
    path: string;
    folderId: string;
  }>;
};

const MAX_FOLDER_UPLOAD_PATHS = 10_000;
const MAX_FOLDER_UPLOAD_PATH_DEPTH = 100;
const MAX_FOLDER_UPLOAD_PATH_LENGTH = 4_096;

const deterministicUuid = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const hasInvalidFolderUploadPathShape = (rawPath: string) =>
  rawPath.length === 0 ||
  rawPath.length > MAX_FOLDER_UPLOAD_PATH_LENGTH ||
  rawPath.startsWith("/") ||
  rawPath.endsWith("/") ||
  rawPath.includes("\\");

const hasUnsafeFolderUploadSegments = (segments: string[]) =>
  segments.length > MAX_FOLDER_UPLOAD_PATH_DEPTH ||
  segments.some((segment) => segment === "." || segment === "..");

const parseFolderUploadPath = (rawPath: string) => {
  if (hasInvalidFolderUploadPathShape(rawPath)) {
    throw new FilesError("FOLDER_NAME_INVALID");
  }

  const rawSegments = rawPath.split("/");
  if (hasUnsafeFolderUploadSegments(rawSegments)) {
    throw new FilesError("FOLDER_NAME_INVALID");
  }

  const segments = rawSegments.map(normalizeFolderName);
  return {
    path: rawPath,
    canonicalPath: segments.join("/"),
    segments,
  };
};

type ParsedFolderUploadPath = ReturnType<typeof parseFolderUploadPath>;

/**
 * Paths are planned from a snapshot of the folder tree. A rename, move or
 * trash of the folder or one above it changes its revision, so the journal
 * refuses a mutation that would put something at the folder's old path.
 * As an entity the folder also reads as busy until the mutation ends.
 */
const folderGuardEntity = (folder: FolderSummary) => ({
  entityType: "folder" as const,
  entityId: folder.id,
  preRevision: folder.storageRevision ?? 0,
  postRevision: folder.storageRevision ?? 0,
  beforeJson: null,
  afterJson: null,
});

/** The same check without marking the folder as changing, for hot paths. */
const folderGuard = (folder: FolderSummary) => ({
  folderId: folder.id,
  revision: folder.storageRevision ?? 0,
});

const restoreGuard = (
  location: FolderRestoreLocation,
  folderMap: Map<string, FolderSummary>,
) => {
  const into = folderMap.get(location.folderId);
  // Trashed or purged after the restore picked it: a trashed folder's
  // revision is already the new one, and a purged one has no guard at all.
  if (into?.deletedAt || (!into && location.kind === "original-parent")) {
    throw new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS");
  }
  return into ? [folderGuardEntity(into)] : [];
};

const folderUploadEntryKey = (folderId: string, name: string) =>
  `${folderId}\u0000${name}`;

const isFolderNameConflict = (error: unknown): error is FilesError =>
  error instanceof FilesError && error.code === "FOLDER_NAME_CONFLICT";

const recoverFolderUploadConflict = async ({
  error,
  activeRepo,
  ownerUserId,
  parentId,
  name,
}: {
  error: FilesError;
  activeRepo: FilesRepository;
  ownerUserId: string;
  parentId: string;
  name: string;
}) => {
  const [existingFolders, existingFiles] = await Promise.all([
    activeRepo.listChildFolders(ownerUserId, parentId, {
      includeDeleted: false,
      names: [name],
    }),
    activeRepo.listChildFiles(ownerUserId, parentId, {
      includeDeleted: false,
      includeMissing: true,
      names: [name],
    }),
  ]);
  const folder = existingFolders.find((candidate) => candidate.name === name);
  if (!folder || existingFiles.some((file) => file.name === name)) {
    throw error;
  }
  return folder;
};

const ensureFolderUploadChild = async ({
  actorRole,
  actorUserId,
  ownerUserId,
  parentFolder,
  parsed,
  segment,
  segmentIndex,
  idempotencyKey,
  activeRepo,
  folderByParentAndName,
  fileKeys,
  loadChildren,
  createFolder,
}: {
  actorRole: FilesActor["actorRole"];
  actorUserId: string;
  ownerUserId: string;
  parentFolder: FolderSummary;
  parsed: ParsedFolderUploadPath;
  segment: string;
  segmentIndex: number;
  idempotencyKey?: string | null;
  activeRepo: FilesRepository;
  folderByParentAndName: Map<string, FolderSummary>;
  fileKeys: Set<string>;
  loadChildren: (parentId: string, parentPath: string) => Promise<void>;
  createFolder: (input: CreateFolderInput) => Promise<FolderMutationResult>;
}) => {
  await loadChildren(
    parentFolder.id,
    parsed.segments.slice(0, segmentIndex).join("/"),
  );
  const key = folderUploadEntryKey(parentFolder.id, segment);
  const cachedFolder = folderByParentAndName.get(key);
  if (cachedFolder) return cachedFolder;
  if (fileKeys.has(key)) throw new FilesError("FOLDER_NAME_CONFLICT");

  const childIdempotencyKey = idempotencyKey
    ? deterministicUuid(
        `folder-upload:${idempotencyKey}:${parsed.segments
          .slice(0, segmentIndex + 1)
          .join("/")}`,
      )
    : undefined;

  let folder: FolderSummary;
  try {
    folder = (
      await createFolder({
        actorRole,
        actorUserId,
        parentId: parentFolder.id,
        name: segment,
        idempotencyKey: childIdempotencyKey,
      })
    ).folder;
  } catch (error) {
    if (!isFolderNameConflict(error)) throw error;
    folder = await recoverFolderUploadConflict({
      error,
      activeRepo,
      ownerUserId,
      parentId: parentFolder.id,
      name: segment,
    });
  }

  folderByParentAndName.set(key, folder);
  return folder;
};

const ensureFolderUploadPath = async ({
  actorRole,
  actorUserId,
  ownerUserId,
  targetFolder,
  parsed,
  idempotencyKey,
  activeRepo,
  folderByParentAndName,
  fileKeys,
  loadChildren,
  createFolder,
}: {
  actorRole: FilesActor["actorRole"];
  actorUserId: string;
  ownerUserId: string;
  targetFolder: FolderSummary;
  parsed: ParsedFolderUploadPath;
  idempotencyKey?: string | null;
  activeRepo: FilesRepository;
  folderByParentAndName: Map<string, FolderSummary>;
  fileKeys: Set<string>;
  loadChildren: (parentId: string, parentPath: string) => Promise<void>;
  createFolder: (input: CreateFolderInput) => Promise<FolderMutationResult>;
}) => {
  let parentFolder = targetFolder;
  for (const [segmentIndex, segment] of parsed.segments.entries()) {
    parentFolder = await ensureFolderUploadChild({
      actorRole,
      actorUserId,
      ownerUserId,
      parentFolder,
      parsed,
      segment,
      segmentIndex,
      idempotencyKey,
      activeRepo,
      folderByParentAndName,
      fileKeys,
      loadChildren,
      createFolder,
    });
  }
  return parentFolder;
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
  clientModifiedAt?: Date | null;
  /** With replace: the revision of the existing file the client changed. */
  ifRevision?: number;
  /** With replace: the id of that file, so a newer file of the same name is kept. */
  ifFileId?: string;
};

/**
 * What a direct upload's idempotency key commits to, so a reused key with
 * another request is refused instead of replayed.
 */
const uploadRequestHash = (
  folderId: string | null | undefined,
  name: string,
  stagedFile: { sizeBytes: number; actualChecksum: string },
  item: UploadRequestItem,
) => ({
  folderId: folderId ?? null,
  name,
  sizeBytes: stagedFile.sizeBytes,
  checksum: stagedFile.actualChecksum,
  conflictStrategy: item.conflictStrategy,
  // Only when set, so requests without them hash as before.
  ...(item.ifRevision !== undefined && { ifRevision: item.ifRevision }),
  ...(item.ifFileId !== undefined && { ifFileId: item.ifFileId }),
});

/** At most this many new files commit as one upload_create mutation. */
const UPLOAD_CREATE_GROUP_LIMIT = 100;
const FOLDER_CREATE_GROUP_LIMIT = 100;

/**
 * A new file's id follows from its retry key. A group of new files commits
 * as one mutation under its first file's key, so a retry of any other file
 * in the group finds that mutation by this id.
 */
const uploadCreateFileId = (ownerUserId: string, idempotencyKey: string) =>
  deterministicUuid(`upload-create:${ownerUserId}:${idempotencyKey}`);

// A group splits where two names might be one file on a disk that ignores
// case, the rule safe renames follow too.
const uploadGroupNameKey = (name: string) => name.toLowerCase();

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
    | "clientModifiedAt"
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
  clientModifiedAt: file.clientModifiedAt ?? null,
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
    throw new FilesError("FOLDER_NOT_FOUND");
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
    throw new FilesError("FILE_NOT_FOUND");
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
  const checksums = new Map<string, string>();
  const digest = await captureTreeManifest(
    getStoragePath(rootStorageKey),
    async () => {
      const entries: CapturedTreeEntry[] = folderStorageKeys.map(
        (storageKey) => ({
          kind: "directory",
          relativeKey: relativeKey(storageKey),
        }),
      );
      for (const file of files) {
        const checksum =
          file.contentChecksum ??
          (await calculateStorageFileChecksum(
            getStorageRoot(),
            file.storageKey,
          ));
        checksums.set(file.id, checksum);
        entries.push({
          kind: "file",
          relativeKey: relativeKey(file.storageKey),
          sizeBytes: BigInt(file.sizeBytes),
          checksum,
        });
      }
      return entries;
    },
  );
  return { digest, checksums };
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

  // Naming the request's own mutation and its kind tells the client this
  // change was accepted and is still finishing, not refused before it started.
  const assertDirectMutationReplayComplete = (prior: {
    id: string;
    kind: string;
    status: string;
  }) => {
    if (prior.status === "recovery_required") {
      throw new StorageMutationConflictError(
        "STORAGE_RECOVERY_REQUIRED",
        prior.id,
        prior.kind,
      );
    }
    if (prior.status !== "succeeded") {
      throw new StorageMutationConflictError(
        "STORAGE_MUTATION_RECOVERING",
        prior.id,
        prior.kind,
      );
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
    onPrepared,
  }: FilesActor & {
    idempotencyKey?: string | null;
    kind: StorageMutationKind;
    entityType: "file" | "folder";
    entityId: string;
    requestHashPayload: unknown;
    onPrepared?: (mutationId: string) => void;
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
    if (prior.status !== "preparing") onPrepared?.(prior.id);
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

  const serializeFileSummary = (file: FileSummary) => ({
    ...file,
    deletedAt: file.deletedAt?.toISOString() ?? null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    storageMutation: null,
  });

  const serializeFileMutationResult = (
    result: FileMutationResult,
  ): Prisma.InputJsonValue =>
    toMetadataJson({
      response: {
        file: result.file ? serializeFileSummary(result.file) : null,
        deletedFileId: result.deletedFileId ?? null,
        restoredTo: result.restoredTo ?? null,
      },
    });

  type UploadGroupEntry = {
    idempotencyKey: string | null;
    requestHash: string;
    file: FileSummary;
  };

  // Each file of a group keeps its own key and request hash, so a retry of
  // one file is checked against what that file asked for.
  const serializeUploadGroupResult = (
    entries: UploadGroupEntry[],
  ): Prisma.InputJsonValue =>
    toMetadataJson({
      response: {
        uploads: entries.map((entry) => ({
          ...entry,
          file: serializeFileSummary(entry.file),
        })),
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

  const uploadGroupReplayEntry = (
    resultJson: Prisma.JsonValue | null,
    idempotencyKey: string,
  ) => {
    const uploads = mutationReplayResponse(resultJson)?.uploads;
    if (!Array.isArray(uploads)) return undefined;
    const entry = uploads.find(
      (value): value is Record<string, unknown> =>
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.idempotencyKey === idempotencyKey,
    );
    return entry && typeof entry.requestHash === "string"
      ? { requestHash: entry.requestHash, file: replayFileSummary(entry.file) }
      : undefined;
  };

  /**
   * Finds earlier attempts of these uploads: a replacement or a single
   * upload by its key, a file of a group by the file id its key names.
   */
  const findUploadReplays = async (
    ownerUserId: string,
    idempotencyKeys: string[],
  ) => {
    const priorSelect = {
      kind: true,
      status: true,
      ownerUserId: true,
      idempotencyKey: true,
      requestHash: true,
      resultJson: true,
    } as const;
    const [byKey, byFile] = await Promise.all([
      getPrisma().storageMutation.findMany({
        where: { idempotencyKey: { in: idempotencyKeys } },
        select: priorSelect,
      }),
      getPrisma().storageMutationEntity.findMany({
        where: {
          entityType: "file",
          entityId: {
            in: idempotencyKeys.map((key) =>
              uploadCreateFileId(ownerUserId, key),
            ),
          },
          mutation: { kind: "upload_create", ownerUserId },
        },
        select: { entityId: true, mutation: { select: priorSelect } },
      }),
    ]);
    return (idempotencyKey: string) =>
      byKey.find((prior) => prior.idempotencyKey === idempotencyKey) ??
      byFile.find(
        (entity) =>
          entity.entityId === uploadCreateFileId(ownerUserId, idempotencyKey),
      )?.mutation;
  };

  // What an earlier attempt answered for this file: its entry in a group's
  // reply, or the whole reply of a mutation started under this file's key.
  const priorUploadReply = (
    prior: {
      idempotencyKey: string | null;
      requestHash: string | null;
      resultJson: Prisma.JsonValue | null;
    },
    idempotencyKey: string,
  ) =>
    uploadGroupReplayEntry(prior.resultJson, idempotencyKey) ??
    (prior.idempotencyKey === idempotencyKey
      ? {
          requestHash: prior.requestHash,
          file: parseFileMutationReplay(prior.resultJson)?.file,
        }
      : null);

  const replayUpload = (
    prior: {
      kind: string;
      status: string;
      ownerUserId: string;
      idempotencyKey: string | null;
      requestHash: string | null;
      resultJson: Prisma.JsonValue | null;
    },
    idempotencyKey: string,
    requestHash: string,
    actor: FilesActor,
  ): FileSummary => {
    if (
      !["upload_create", "upload_replace"].includes(prior.kind) ||
      !canAccessPrivateNamespace({
        ...actor,
        namespaceOwnerUserId: prior.ownerUserId,
      })
    ) {
      throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
    }
    const reply = priorUploadReply(prior, idempotencyKey);
    if (reply && reply.requestHash !== requestHash) {
      throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
    }
    if (prior.status !== "succeeded") {
      throw new StorageMutationConflictError(
        prior.status === "recovery_required"
          ? "STORAGE_RECOVERY_REQUIRED"
          : "STORAGE_MUTATION_RECOVERING",
      );
    }
    // A pruned reply can no longer say which file this was.
    if (!reply?.file) {
      throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
    }
    return reply.file;
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

  // A retry of a finished change answers with the item as it is now. Worker
  // recovery finishes the journal without the web reply, so a stored reply
  // can be missing or show the item from before the change.
  const replayFileMutation = async (
    replay: { resultJson: Prisma.JsonValue | null },
    fileId: string,
  ): Promise<FileMutationResult> => {
    const current = await (
      await resolveRepo()
    ).findFileById(fileId, { includeMissing: true });
    if (!current) return { deletedFileId: fileId };
    return {
      file: toFileSummary(current),
      restoredTo: parseFileMutationReplay(replay.resultJson)?.restoredTo,
    };
  };

  const replayFolderMutation = async (
    replay: { resultJson: Prisma.JsonValue | null },
    folderId: string,
  ): Promise<FolderMutationResult> => {
    const folder = await (await resolveRepo()).findFolderById(folderId);
    if (!folder) {
      throw new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
    }
    return {
      folder,
      restoredTo: parseFolderMutationReplay(replay.resultJson)?.restoredTo,
    };
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

  // One branch per kind of journal operation a folder change may need.
  // fallow-ignore-next-line complexity
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
    const folderUpdate = (update: FolderTreeUpdate) =>
      operations.push({
        action: "update",
        entityType: "folder",
        entityId: update.folder.id,
        preRevision: update.folder.storageRevision ?? 0,
        data: toMetadataJson(update.data),
      });
    const rootUpdate = folderUpdates.find(
      (update) => update.folder.id === rootFolder.id,
    );
    for (const update of folderUpdates) {
      if (update !== rootUpdate) folderUpdate(update);
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
    // Everything above sits inside the root folder, whose own change comes
    // last; a large tree commits it in chunks before that.
    const bulkOperationsEnd = operations.length;
    if (rootUpdate) folderUpdate(rootUpdate);
    if (deleteTrashEntryId) {
      operations.push({
        action: "delete_trash_entry",
        entityId: deleteTrashEntryId,
      });
    }
    return {
      operations,
      bulkOperationsEnd: rootUpdate ? bulkOperationsEnd : undefined,
    };
  };

  // Each fallback is one short branch; splitting them hides the order.
  // fallow-ignore-next-line complexity
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
    onPrepared,
  }: {
    kind: StorageMutationKind;
    onPrepared?: (mutationId: string) => void;
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
    const { operations, bulkOperationsEnd } = buildDurableFolderOperations({
      rootFolder,
      folderUpdates,
      fileUpdates,
      trashEntry,
      deleteTrashEntryId,
    });
    await runDurableStorageMutation({
      kind,
      onPrepared,
      ownerUserId: rootFolder.ownerUserId,
      idempotencyKey,
      parentId,
      requestHashPayload,
      resultJson,
      metadataOperations: operations,
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
      details: {
        entityType: "folder",
        entityId: rootFolder.id,
        bulkOperationsEnd,
      },
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
    includeMissing,
  }: FileLookupInput & { includeMissing?: boolean }) => {
    const file = assertFileAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFileById(fileId, { includeMissing }),
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
    const folders = await activeRepo.listFolderSubtree(ownerUserId, folderId, {
      includeDeleted,
    });
    const childrenByParent = new Map<string | null, FolderSummary[]>();
    for (const folder of folders) {
      const children = childrenByParent.get(folder.parentId) ?? [];
      children.push(folder);
      childrenByParent.set(folder.parentId, children);
    }

    // Legacy restores create directories in this order.
    const descendants: FolderSummary[] = [];
    const parentIds = [folderId];
    const visited = new Set([folderId]);
    for (const parentId of parentIds) {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        descendants.push(child);
        parentIds.push(child.id);
      }
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
    return (await resolveRepo()).listFilesInFolders(
      ownerUserId,
      [...folderIds],
      { includeDeleted },
    );
  };

  const readFolderMap = async (
    ownerUserId: string,
    folderIds: Array<string | null>,
    descendants: FolderSummary[] = [],
  ) =>
    buildFolderMap([
      ...(await (
        await resolveRepo()
      ).listFolderAncestors(
        ownerUserId,
        folderIds.filter((id) => id !== null),
      )),
      ...descendants,
    ]);

  const createMissingFolderPaths = async ({
    targetFolder,
    requestedPaths,
    folderByParentAndName,
    fileKeys,
    loadChildren,
  }: {
    targetFolder: FolderSummary;
    requestedPaths: ParsedFolderUploadPath[];
    folderByParentAndName: Map<string, FolderSummary>;
    fileKeys: Set<string>;
    loadChildren: (parentId: string, parentPath: string) => Promise<void>;
  }): Promise<EnsureFolderPathsResult> => {
    // One journal entry per folder costs a full prepare, commit and
    // finalize each. Missing folders are planned first, parents before
    // children, and created a group at a time.
    const filesRoot = await ensureFilesRoot(targetFolder.ownerUserId);
    const folderMap = await readFolderMap(targetFolder.ownerUserId, [
      targetFolder.id,
    ]);
    const byCanonicalPath = new Map<string, FolderSummary>();
    const missing = new Set<string>();
    const pending: Array<{ folder: FolderSummary; storageKey: string }> = [];
    const plannedSiblings = new Set<string>();
    const ignoresCase = async () =>
      (await assertStorageFilesystemSupported(getStorageRoot())).ignoresCase;
    const resolveSegment = async (
      parentFolder: FolderSummary,
      parentPath: string,
      canonicalPath: string,
      name: string,
    ) => {
      const known = byCanonicalPath.get(canonicalPath);
      if (known) return known;
      let folder: FolderSummary | undefined;
      // A folder planned in this request has no children yet.
      if (!missing.has(parentFolder.id)) {
        await loadChildren(parentFolder.id, parentPath);
        const key = folderUploadEntryKey(parentFolder.id, name);
        folder = folderByParentAndName.get(key);
        if (!folder && fileKeys.has(key)) {
          throw new FilesError("FOLDER_NAME_CONFLICT");
        }
        // The lookups above match the exact name. This also refuses a name
        // that differs only in case on a disk that ignores case.
        if (!folder) {
          await assertNoFolderNameConflict({
            ownerUserId: targetFolder.ownerUserId,
            parentId: parentFolder.id,
            name,
          });
        }
      }
      if (!folder) {
        const sibling = folderUploadEntryKey(
          parentFolder.id,
          name.toLowerCase(),
        );
        if (plannedSiblings.has(sibling) && (await ignoresCase())) {
          throw new FilesError("FOLDER_NAME_CONFLICT");
        }
        plannedSiblings.add(sibling);
        folder = {
          // A repeat finds what exists by name, so the id carries no meaning.
          // An id derived from the request would collide with a folder that
          // was renamed or moved since.
          id: randomUUID(),
          ownerUserId: targetFolder.ownerUserId,
          ownerStorageId: targetFolder.ownerStorageId,
          parentId: parentFolder.id,
          name,
          isFilesRoot: false,
          deletedAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        missing.add(folder.id);
        folderMap.set(folder.id, folder);
        pending.push({
          folder,
          storageKey: buildFolderStorageKey({
            folder,
            folderMap,
            filesRoot,
            trashed: false,
          }),
        });
      } else {
        folderMap.set(folder.id, folder);
      }
      byCanonicalPath.set(canonicalPath, folder);
      return folder;
    };

    const resolved: EnsureFolderPathsResult["folders"] = [];
    for (const parsed of requestedPaths) {
      let folder = targetFolder;
      for (const [index, name] of parsed.segments.entries()) {
        folder = await resolveSegment(
          folder,
          parsed.segments.slice(0, index).join("/"),
          parsed.segments.slice(0, index + 1).join("/"),
          name,
        );
      }
      resolved.push({ path: parsed.path, folderId: folder.id });
    }

    for (
      let start = 0;
      start < pending.length;
      start += FOLDER_CREATE_GROUP_LIMIT
    ) {
      const group = pending.slice(start, start + FOLDER_CREATE_GROUP_LIMIT);
      const created = new Set(group.map(({ folder }) => folder.id));
      // The paths were planned from a snapshot. A parent renamed or moved
      // since has a new revision, and the journal then refuses the group
      // instead of creating folders at the parent's old path.
      const parents = new Map(
        group
          .map(({ folder }) => folderMap.get(folder.parentId!)!)
          .filter((parent) => !created.has(parent.id))
          .map((parent) => [parent.id, parent]),
      );
      await runDurableStorageMutation({
        kind: "folder_create",
        ownerUserId: targetFolder.ownerUserId,
        metadataOperations: group.map(
          ({ folder }) =>
            ({
              action: "create_folder",
              data: {
                id: folder.id,
                ownerUserId: folder.ownerUserId,
                parentId: folder.parentId!,
                name: folder.name,
              },
            }) as const,
        ),
        steps: group.map(({ storageKey }) => ({
          action: "mkdir" as const,
          targetKey: storageKey,
          expectedNodeType: "directory" as const,
          treeManifestDigest: EMPTY_TREE_MANIFEST_DIGEST,
        })),
        entities: [
          ...group.map(({ folder }) => ({
            entityType: "folder" as const,
            entityId: folder.id,
            preRevision: -1,
            postRevision: 0,
            beforeJson: null,
            afterJson: toMetadataJson({
              parentId: folder.parentId,
              name: folder.name,
            }),
          })),
          ...[...parents.values()].map((parent) => ({
            entityType: "folder" as const,
            entityId: parent.id,
            // A folder planned in an earlier group was created at revision 0.
            preRevision: missing.has(parent.id)
              ? 0
              : (parent.storageRevision ?? 0),
            postRevision: missing.has(parent.id)
              ? 0
              : (parent.storageRevision ?? 0),
            beforeJson: null,
            afterJson: null,
          })),
        ],
      });
    }
    return { folders: resolved };
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

    const folderMap = await readFolderMap(currentFolder.ownerUserId, [
      currentFolder.id,
    ]);
    const trail: FolderSummary[] = [currentFolder];
    const seen = new Set([currentFolder.id]);
    let parentId = currentFolder.parentId;
    let reachedRoot = false;

    while (parentId && !seen.has(parentId)) {
      const parent = folderMap.get(parentId);

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
        parentId: folder.parentId,
        name: folder.name,
        pathLabel: pathNames.join(" / "),
        isFilesRoot: folder.isFilesRoot,
        color: folder.color ?? null,
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

    return ordered;
  };

  const restoreParent = async (
    parentId: string | null,
    known?: Map<string, FolderSummary>,
  ) => {
    if (!parentId) return null;
    if (known) return known.get(parentId) ?? null;
    return (await resolveRepo()).findFolderById(parentId);
  };

  const getRestoreLocation = async (
    item: Pick<FolderSummary, "parentId" | "ownerUserId">,
    filesRoot: FolderSummary,
    knownFolders?: Map<string, FolderSummary>,
  ): Promise<FolderRestoreLocation> => {
    const parent = await restoreParent(item.parentId, knownFolders);
    if (
      !parent ||
      parent.ownerUserId !== item.ownerUserId ||
      parent.deletedAt
    ) {
      return {
        kind: "files-root",
        folderId: filesRoot.id,
        folderName: filesRoot.name,
        pathLabel: filesRoot.name,
      };
    }
    const folderMap =
      knownFolders ??
      new Map(
        (
          await (
            await resolveRepo()
          ).listFolderAncestors(item.ownerUserId, [parent.id])
        ).map((folder) => [folder.id, folder]),
      );
    return {
      kind: "original-parent",
      folderId: parent.id,
      folderName: parent.name,
      pathLabel: buildFolderPathLabel({ folder: parent, folderMap, filesRoot }),
    };
  };

  const readTrashRecords = async (
    actorUserId: string,
    query?: ListQuery,
    selected?: Awaited<ReturnType<typeof getListWindow>>,
  ) => {
    const activeRepo = await resolveRepo();
    const window =
      selected ??
      (repo
        ? null
        : await getListWindow({
            userId: actorUserId,
            scope: "trash",
            query,
            all: !query,
          }));
    const ids = window?.items.map((item) => item.id);
    const files = ids
      ? await activeRepo.listFilesByIds(actorUserId, ids, {
          includeDeleted: true,
          includeMissing: true,
        })
      : await activeRepo.listFilesByOwner(actorUserId, {
          includeDeleted: true,
        });
    const folders = ids
      ? await activeRepo.listFolderAncestors(actorUserId, [
          ...ids,
          ...files.flatMap((file) => (file.folderId ? [file.folderId] : [])),
        ])
      : await activeRepo.listFoldersByOwner(actorUserId, {
          includeDeleted: true,
        });
    return { window, files, folders };
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
    const activeRepo = await resolveRepo();
    const conflict = await activeRepo.findActiveNameConflict({
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
    const activeRepo = await resolveRepo();
    const conflict = await activeRepo.findActiveNameConflict({
      ownerUserId,
      parentId,
      name,
      excludeFileId,
    });

    if (conflict) {
      throw new FilesError("FILE_NAME_CONFLICT");
    }
  };

  // Best-effort: a queue failure must not fail an upload that is already saved.
  const scheduleUploadDerivatives = (files: FileSummary[]) =>
    void (async () => {
      const settings = await getSystemSettings();
      const thumbnails = isDerivativeKindEnabled(
        settings,
        DERIVATIVE_KIND_THUMBNAIL,
      );
      const videoCopies = shouldGenerateMediaPreview(settings, "upload");
      await Promise.all(
        files.flatMap((file) => [
          ...(thumbnails && canHaveThumbnail(file.mimeType, file.name)
            ? [
                scheduleDerivativeGenerate({
                  fileId: file.id,
                  kind: DERIVATIVE_KIND_THUMBNAIL,
                  profile: DERIVATIVE_PROFILE_THUMB,
                  reason: "upload",
                  now: now(),
                }),
              ]
            : []),
          ...(videoCopies &&
          file.viewerKind === "video" &&
          BigInt(file.sizeBytes) >= settings.mediaPreviewThresholdBytes
            ? [
                scheduleDerivativeGenerate({
                  fileId: file.id,
                  reason: "upload",
                  now: now(),
                }),
              ]
            : []),
        ]),
      );
    })().catch((error) => {
      console.error("[files] Failed to schedule preview generation.", error);
    });

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
    const operations = buildFolderPurgeOperations({
      currentFolder,
      descendants,
      files,
      derivatives,
    });
    await runDurableStorageMutation({
      kind: "folder_purge",
      ownerUserId: currentFolder.ownerUserId,
      idempotencyKey,
      parentId,
      requestHashPayload: durableFolderPurgeRequestHash(
        currentFolder,
        parentId,
      ),
      metadataOperations: operations,
      // The root folder and its trash entry go last.
      details: { bulkOperationsEnd: operations.length - 2 },
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
    const allFoldersForKey = await readFolderMap(folder.ownerUserId, [
      folder.id,
    ]);
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

  // Replay checks for one clear-trash child, one per stored outcome.
  // fallow-ignore-next-line complexity
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

  // Walks the children in order and records each outcome durably.
  // fallow-ignore-next-line complexity
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
    /**
     * Color and icon are metadata only: nothing on disk changes, so they are
     * written directly rather than through the storage journal.
     */
    async setFolderAppearance({
      actorRole,
      actorUserId,
      folderId,
      color,
      icon,
    }: FolderLookupInput & { color?: string | null; icon?: string | null }) {
      const folder = assertActiveFolder(
        await getOwnedFolder({ actorRole, actorUserId, folderId }),
      );
      return (await resolveRepo()).updateFolder({
        id: folder.id,
        ...(color === undefined ? {} : { color }),
        ...(icon === undefined ? {} : { icon }),
      });
    },

    async ensureFilesRoot(ownerUserId: string) {
      return ensureFilesRoot(ownerUserId);
    },

    async getFilesListing({
      actorRole,
      actorUserId,
      folderId,
      query = {},
      selected,
    }: FilesActor & {
      folderId?: string | null;
      query?: ListQuery;
      selected?: Awaited<ReturnType<typeof getListWindow>>;
    }): Promise<FilesListing> {
      const filesRoot = await ensureFilesRoot(actorUserId);
      const currentFolder = folderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId,
          })
        : filesRoot;
      const activeRepo = await resolveRepo();
      const window =
        selected ??
        (repo
          ? null
          : await getListWindow({
              userId: actorUserId,
              scope: "folder",
              folderId: currentFolder.id,
              query: { sort: "name", direction: "asc", ...query },
            }));
      const ids = window?.items.map((item) => item.id);
      const order = new Map(ids?.map((id, index) => [id, index]));
      const [childFolders, files, counts] = await Promise.all([
        activeRepo.listChildFolders(
          currentFolder.ownerUserId,
          currentFolder.id,
          {
            includeDeleted: false,
            ids,
          },
        ),
        activeRepo.listChildFiles(currentFolder.ownerUserId, currentFolder.id, {
          includeDeleted: false,
          ids,
        }),
        activeRepo.countChildren(currentFolder.ownerUserId, currentFolder.id),
      ]);
      const folderPreviews = !repo
        ? await listFolderPreviewFileIds(
            childFolders.map((folder) => folder.id),
          )
        : {};
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
      return {
        counts,
        total: window ? window.total : childFolders.length + files.length,
        ownerUserId: currentFolder.ownerUserId,
        currentFolder,
        folderPreviews,
        breadcrumbs: await buildBreadcrumbs(currentFolder, filesRoot),
        childFolders: childFolders
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .map((folder) => ({
            ...folder,
            storageMutation: folderMutationStates.get(folder.id) ?? null,
          })),
        files: files
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .map((file) => ({
            ...toFileSummary(file),
            storageMutation: fileMutationStates.get(file.id) ?? null,
          })),
      };
    },

    /** Every folder in the person's own drive, for the move picker. */
    async listFolderTree({ actorUserId }: FilesActor): Promise<MoveTarget[]> {
      return buildMoveTargets(await ensureFilesRoot(actorUserId));
    },

    async listTrashFolders({
      actorRole,
      actorUserId,
      query,
      selected,
    }: FilesActor & {
      query?: ListQuery;
      selected?: Awaited<ReturnType<typeof getListWindow>>;
    }): Promise<TrashListing> {
      const filesRoot = await ensureFilesRoot(actorUserId);
      const {
        window,
        folders: allFolders,
        files: allFiles,
      } = await readTrashRecords(actorUserId, query, selected);
      const folderMap = new Map(
        allFolders.map((folder) => [folder.id, folder]),
      );
      const listed = window
        ? new Set(window.items.map((item) => item.id))
        : null;
      const folders = allFolders.filter(
        (folder) =>
          isTrashFolderRoot(folder, folderMap) &&
          (!listed || listed.has(folder.id)),
      );
      const retainedFiles = allFiles.filter(
        (file) => file.deletedAt && !hasTrashAncestor(file, folderMap),
      );
      const items: TrashFolderSummary[] = await Promise.all(
        folders.map(async (folder) => {
          assertFolderAccess({ actorRole, actorUserId }, folder);
          return {
            folder,
            originalPathLabel: buildFolderPathLabel({
              folder,
              folderMap,
              filesRoot,
            }),
            restoreLocation: await getRestoreLocation(
              folder,
              filesRoot,
              folderMap,
            ),
          };
        }),
      );
      const files: TrashFileSummary[] = await Promise.all(
        retainedFiles.map(async (file) => {
          assertFileAccess({ actorRole, actorUserId }, file);
          return {
            file: toFileSummary(file),
            originalPathLabel: buildFilePathLabel({
              file,
              folderMap,
              filesRoot,
            }),
            restoreLocation: await getRestoreLocation(
              { parentId: file.folderId, ownerUserId: file.ownerUserId },
              filesRoot,
              folderMap,
            ),
          };
        }),
      );
      items.sort(
        (a, b) =>
          (b.folder.deletedAt?.getTime() ?? 0) -
          (a.folder.deletedAt?.getTime() ?? 0),
      );
      files.sort(
        (a, b) =>
          (b.file.deletedAt?.getTime() ?? 0) -
          (a.file.deletedAt?.getTime() ?? 0),
      );
      const [folderStates, fileStates] = repo
        ? [new Map(), new Map()]
        : await Promise.all([
            getStorageMutationStateMap(
              "folder",
              items.map((item) => item.folder.id),
            ),
            getStorageMutationStateMap(
              "file",
              files.map((item) => item.file.id),
            ),
          ]);
      return {
        total: window?.total ?? items.length + files.length,
        order: window?.items.map((item) => item.id),
        filesRoot,
        items: items.map((item) => ({
          ...item,
          folder: {
            ...item.folder,
            storageMutation: folderStates.get(item.folder.id) ?? null,
          },
        })),
        files: files.map((item) => ({
          ...item,
          file: {
            ...item.file,
            storageMutation: fileStates.get(item.file.id) ?? null,
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
      const folderMap = await readFolderMap(parentFolder.ownerUserId, [
        parentFolder.id,
      ]);
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
          folderGuards: [folderGuard(parentFolder)],
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
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new FilesError("FOLDER_NAME_CONFLICT");
        }
        await removeFolderDirectory(folderStorageKey);
        throw error;
      }
    },

    async ensureFolderPaths({
      actorRole,
      actorUserId,
      parentId,
      paths,
      idempotencyKey,
    }: EnsureFolderPathsInput): Promise<EnsureFolderPathsResult> {
      if (paths.length > MAX_FOLDER_UPLOAD_PATHS) {
        throw new FilesError("FOLDER_NAME_INVALID");
      }

      const requestedPaths = paths.map(parseFolderUploadPath);

      const targetFolder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId: parentId,
      });
      const activeRepo = await resolveRepo();
      const namesByParentPath = new Map<string, Set<string>>();
      for (const parsed of requestedPaths) {
        for (const [index, segment] of parsed.segments.entries()) {
          const parentPath = parsed.segments.slice(0, index).join("/");
          const names = namesByParentPath.get(parentPath) ?? new Set<string>();
          names.add(segment);
          namesByParentPath.set(parentPath, names);
        }
      }
      const folderByParentAndName = new Map<string, FolderSummary>();
      const fileKeys = new Set<string>();
      const loadedParents = new Set<string>();
      const loadChildren = async (parentId: string, parentPath: string) => {
        if (loadedParents.has(parentId)) return;
        const names = [...namesByParentPath.get(parentPath)!];
        const [folders, files] = await Promise.all([
          activeRepo.listChildFolders(targetFolder.ownerUserId, parentId, {
            names,
          }),
          activeRepo.listChildFiles(targetFolder.ownerUserId, parentId, {
            names,
            includeMissing: true,
          }),
        ]);
        for (const folder of folders) {
          folderByParentAndName.set(
            folderUploadEntryKey(parentId, folder.name),
            folder,
          );
        }
        for (const file of files) {
          fileKeys.add(folderUploadEntryKey(parentId, file.name));
        }
        loadedParents.add(parentId);
      };

      if (!repo) {
        return createMissingFolderPaths({
          targetFolder,
          requestedPaths,
          folderByParentAndName,
          fileKeys,
          loadChildren,
        });
      }

      const resolvedFolders: EnsureFolderPathsResult["folders"] = [];
      const resolvedByCanonicalPath = new Map<string, FolderSummary>();
      for (const parsed of requestedPaths) {
        let folder = resolvedByCanonicalPath.get(parsed.canonicalPath);
        if (!folder) {
          folder = await ensureFolderUploadPath({
            actorRole,
            actorUserId,
            ownerUserId: targetFolder.ownerUserId,
            targetFolder,
            parsed,
            idempotencyKey,
            activeRepo,
            folderByParentAndName,
            fileKeys,
            loadChildren,
            createFolder: (input) => this.createFolder(input),
          });
          resolvedByCanonicalPath.set(parsed.canonicalPath, folder);
        }

        resolvedFolders.push({
          path: parsed.path,
          folderId: folder.id,
        });
      }

      return { folders: resolvedFolders };
    },

    // Durable rename keeps validation, intent, and replay ordering explicit.
    // fallow-ignore-next-line complexity
    async renameFolder({
      actorRole,
      actorUserId,
      ifRevision,
      folderId,
      name,
      idempotencyKey,
      onStorageMutationPrepared,
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
        onPrepared: onStorageMutationPrepared,
      });
      if (replay) return replayFolderMutation(replay, folderId);
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertRevision(folder, ifRevision);
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
      const currentFolderMap = await readFolderMap(
        folder.ownerUserId,
        [folder.id],
        descendants,
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
        assertStorageKeysFit(
          activeFolders.map((descendant) =>
            buildFolderStorageKey({
              folder: descendant,
              folderMap: nextFolderMap,
              filesRoot,
              trashed: false,
            }),
          ),
        );
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_rename",
          onPrepared: onStorageMutationPrepared,
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
        // Builds the metadata for one folder change in one transaction.
        // fallow-ignore-next-line complexity
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
      ifRevision,
      folderId,
      destinationFolderId,
      idempotencyKey,
      storageMutationParentId,
      onStorageMutationPrepared,
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
        onPrepared: onStorageMutationPrepared,
      });
      if (replay) return replayFolderMutation(replay, folderId);
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertRevision(folder, ifRevision);
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
      const currentFolderMap = await readFolderMap(
        folder.ownerUserId,
        [folder.id, destinationFolder.id],
        descendants,
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
        assertStorageKeysFit(
          descendants
            .filter((descendant) => descendant.deletedAt === null)
            .map((descendant) =>
              buildFolderStorageKey({
                folder: descendant,
                folderMap: nextFolderMap,
                filesRoot,
                trashed: false,
              }),
            ),
        );
        const durableFolder = await durablyUpdateFolderTree({
          kind: "folder_move",
          onPrepared: onStorageMutationPrepared,
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
          guardEntities: [folderGuardEntity(destinationFolder)],
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
      ifRevision,
      folderId,
      idempotencyKey,
      onStorageMutationPrepared,
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
        onPrepared: onStorageMutationPrepared,
      });
      if (replay) return replayFolderMutation(replay, folderId);
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertRevision(folder, ifRevision);
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
      const folderMap = await readFolderMap(
        folder.ownerUserId,
        [folder.id],
        descendants,
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
          onPrepared: onStorageMutationPrepared,
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
      onStorageMutationPrepared,
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
        onPrepared: onStorageMutationPrepared,
      });
      if (replay) return replayFolderMutation(replay, folderId);
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
      const currentFolderMap = await readFolderMap(
        folder.ownerUserId,
        [folder.id, restoreLocation.folderId],
        descendants,
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
        assertStorageKeysFit(
          memberDescendants.map((member) =>
            buildFolderStorageKey({
              folder: member,
              folderMap: nextFolderMap,
              filesRoot,
              trashed: false,
            }),
          ),
        );
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
          onPrepared: onStorageMutationPrepared,
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
          guardEntities: restoreGuard(restoreLocation, currentFolderMap),
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
      ifRevision,
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
      if (replay) return replayFileMutation(replay, fileId);
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      assertRevision(file, ifRevision);
      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const parentId = file.folderId ?? filesRoot.id;

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId,
        name: normalizedName,
        excludeFileId: file.id,
      });
      const activeRepo = await resolveRepo();
      const folderMap = await readFolderMap(file.ownerUserId, [parentId]);
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
      ifRevision,
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
      if (replay) return replayFileMutation(replay, fileId);
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      assertRevision(file, ifRevision);

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
      const folderMap = await readFolderMap(file.ownerUserId, [
        destinationFolder.id,
      ]);
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
        guardEntities: [folderGuardEntity(destinationFolder)],
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

    // Replay, journal, and legacy paths of one trash action.
    // fallow-ignore-next-line complexity
    async trashFile({
      actorRole,
      actorUserId,
      ifRevision,
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
      if (replay) return replayFileMutation(replay, fileId);
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      assertRevision(file, ifRevision);
      const activeRepo = await resolveRepo();
      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const folderMap = await readFolderMap(file.ownerUserId, [file.folderId]);
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

    /**
     * Resolves a sync conflict for the device's version. The original keeps
     * its id and takes the conflict copy's bytes; its old bytes go to the
     * trash as the copy's row, under the original name. One journal entry.
     */
    // Builds one journal entry for both files; each branch is a guard.
    // fallow-ignore-next-line complexity
    async keepMine({
      actorRole,
      actorUserId,
      fileId,
      conflictCopyId,
      ifRevision,
      idempotencyKey,
    }: FileLookupInput & {
      conflictCopyId: string;
      ifRevision: number;
    }): Promise<FileMutationResult> {
      if (repo) throw new Error("Keep mine needs the storage journal.");
      await assertStorageProtocolReady();
      const requestHashPayload = {
        kind: "file_keep_mine",
        fileId,
        conflictCopyId,
        ifRevision,
      };
      const replay = await findDirectMutationReplay({
        actorRole,
        actorUserId,
        idempotencyKey,
        kind: "file_keep_mine",
        entityType: "file",
        entityId: fileId,
        requestHashPayload,
      });
      if (replay) return replayFileMutation(replay, fileId);
      const [original, copy] = await Promise.all([
        getActiveOwnedFile({ actorRole, actorUserId, fileId }),
        getActiveOwnedFile({ actorRole, actorUserId, fileId: conflictCopyId }),
      ]);
      assertRevision(original, ifRevision);
      if (
        copy.id === original.id ||
        copy.ownerUserId !== original.ownerUserId
      ) {
        throw new FilesError("FILE_NOT_FOUND");
      }
      const deletedAt = now();
      const trashEntryId = idempotencyKey
        ? deterministicUuid(`file-keep-mine:${copy.id}:${idempotencyKey}`)
        : randomUUID();
      const trashKey = buildIsolatedTrashStorageKey({
        ownerStorageId: original.ownerStorageId,
        kind: "file",
        name: original.name,
        deletedAt,
        trashEntryId,
      });
      const [
        originalChecksum,
        copyChecksum,
        originalDerivatives,
        copyDerivatives,
      ] = await Promise.all([
        resolveDurableFileFingerprint(original),
        resolveDurableFileFingerprint(copy),
        buildDerivativeInvalidation(original.id),
        buildDerivativeInvalidation(copy.id),
      ]);
      const originalData = {
        mimeType: copy.mimeType,
        sizeBytes: String(copy.sizeBytes),
        contentChecksum: copyChecksum,
        clientModifiedAt: copy.clientModifiedAt?.toISOString() ?? null,
      };
      const copyData = {
        originalName: original.name,
        folderId: original.folderId,
        mimeType: original.mimeType,
        sizeBytes: String(original.sizeBytes),
        contentChecksum: originalChecksum,
        clientModifiedAt: original.clientModifiedAt?.toISOString() ?? null,
        storageKey: trashKey,
        deletedAt: deletedAt.toISOString(),
        trashEntryId,
      };
      const entity = (file: StoredFile, after: Record<string, unknown>) => ({
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision ?? 0,
        postRevision: (file.storageRevision ?? 0) + 1,
        beforeJson: toMetadataJson({
          storageKey: file.storageKey,
          sizeBytes: file.sizeBytes,
          contentChecksum: file.contentChecksum,
        }),
        afterJson: toMetadataJson(after),
      });
      await runDurableStorageMutation({
        kind: "file_keep_mine",
        ownerUserId: original.ownerUserId,
        idempotencyKey,
        requestHashPayload,
        metadataOperations: [
          {
            action: "create_trash_entry",
            data: {
              id: trashEntryId,
              ownerUserId: original.ownerUserId,
              rootKind: "file",
              rootEntityId: copy.id,
              deletedAt: deletedAt.toISOString(),
              storageRootKey: trashKey,
              treeManifestDigest: null,
              layoutVersion: "isolated",
            },
          },
          {
            action: "update",
            entityType: "file",
            entityId: copy.id,
            preRevision: copy.storageRevision ?? 0,
            data: toMetadataJson(copyData),
          },
          {
            action: "update",
            entityType: "file",
            entityId: original.id,
            preRevision: original.storageRevision ?? 0,
            data: toMetadataJson(originalData),
          },
          ...originalDerivatives.operations,
          ...copyDerivatives.operations,
        ],
        // The old bytes leave before the new ones take their place.
        steps: [
          ...originalDerivatives.steps,
          ...copyDerivatives.steps,
          {
            action: "rename",
            sourceKey: original.storageKey,
            targetKey: trashKey,
            expectedNodeType: "file",
            expectedSizeBytes: BigInt(original.sizeBytes),
            expectedChecksum: originalChecksum,
          },
          {
            action: "rename",
            sourceKey: copy.storageKey,
            targetKey: original.storageKey,
            expectedNodeType: "file",
            expectedSizeBytes: BigInt(copy.sizeBytes),
            expectedChecksum: copyChecksum,
          },
        ],
        entities: [
          entity(original, {
            ...originalData,
            storageKey: original.storageKey,
          }),
          entity(copy, copyData),
          ...originalDerivatives.entities,
          ...copyDerivatives.entities,
        ],
        details: { entityType: "file", entityId: original.id },
      });
      const updated = await (await resolveRepo()).findFileById(original.id);
      if (!updated) throw new Error("Keep mine lost the original file.");
      const result = { file: toFileSummary(updated) };
      await persistDirectMutationReplay(
        idempotencyKey,
        serializeFileMutationResult(result),
      );
      return result;
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
      if (replay) return replayFileMutation(replay, fileId);
      // Trash lists files whose data is missing, so say why restore refuses.
      const file = await getOwnedFile({
        actorRole,
        actorUserId,
        fileId,
        includeMissing: true,
      });

      if (!file.deletedAt) {
        throw new FilesError("FILE_ALREADY_ACTIVE");
      }
      if (file.storageStatus === "missing") {
        throw new FilesError("FILE_CONTENT_MISSING");
      }

      const filesRoot = await ensureFilesRoot(file.ownerUserId);
      const restoreLocation = await getRestoreLocation(
        { parentId: file.folderId, ownerUserId: file.ownerUserId },
        filesRoot,
      );

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId: restoreLocation.folderId,
        name: file.name,
        excludeFileId: file.id,
      });
      const activeRepo = await resolveRepo();
      const folderMap = await readFolderMap(file.ownerUserId, [
        restoreLocation.folderId,
      ]);
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
        guardEntities: restoreGuard(restoreLocation, folderMap),
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
      if (replay) return replayFileMutation(replay, fileId);
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
      signal,
    }: UploadFilesInput): Promise<UploadFilesResult> {
      assertStorageAdmissionActive(signal);
      if (!repo) await assertStorageProtocolReady();
      const uploadDeadline = await createUploadDeadline(now().getTime());
      const preStagedUploads = new Map<
        number,
        Awaited<ReturnType<typeof stageUpload>>
      >();
      const replayedUploads = new Map<number, FileSummary>();
      const normalizedNames = items.map((item) =>
        normalizeFileName(item.originalName || item.file.name),
      );
      const itemIdempotencyKeys = items.map(
        (item, ordinal) =>
          item.idempotencyKey ??
          (idempotencyKey ? `${idempotencyKey}:${ordinal}` : undefined),
      );
      const replayKeys = itemIdempotencyKeys.filter(
        (key): key is string => key !== undefined,
      );
      if (!repo && replayKeys.length > 0) {
        try {
          for (const [itemOrdinal, item] of items.entries()) {
            preStagedUploads.set(
              itemOrdinal,
              await stageUpload(
                { ...item, originalName: normalizedNames[itemOrdinal]! },
                uploadDeadline,
              ),
            );
          }
          const findPrior = await findUploadReplays(actorUserId, replayKeys);
          for (const [itemOrdinal, item] of items.entries()) {
            const key = itemIdempotencyKeys[itemOrdinal];
            const prior = key ? findPrior(key) : undefined;
            if (!key || !prior) continue;
            const stagedFile = preStagedUploads.get(itemOrdinal)!;
            replayedUploads.set(
              itemOrdinal,
              replayUpload(
                prior,
                key,
                hashDurableStorageRequest(
                  uploadRequestHash(
                    folderId,
                    normalizedNames[itemOrdinal]!,
                    stagedFile,
                    item,
                  ),
                ),
                { actorRole, actorUserId },
              ),
            );
            preStagedUploads.delete(itemOrdinal);
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
      const folderMap = await readFolderMap(targetFolder.ownerUserId, [
        targetFolder.id,
      ]);
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

      const pendingCreates: Array<{
        ordinal: number;
        idempotencyKey: string | null;
        requestHash: string;
        stagedFile: Awaited<ReturnType<typeof stageUpload>>;
        name: string;
        storageKey: string;
        fileId: string;
      }> = [];
      // A rejected durable upload owns nothing: it failed validation or
      // was rolled back to staging and aborted.
      const ownsNothing = (error: unknown) =>
        repo ||
        error instanceof FilesError ||
        error instanceof RevisionConflictError ||
        error instanceof StorageMutationRejectedError ||
        error instanceof StorageAdmissionBusyError ||
        error instanceof StorageAdmissionCancelledError;
      // New files commit together: one journal mutation, one quota check,
      // and one metadata transaction for the whole group.
      const flushPendingCreates = async () => {
        const group = pendingCreates.splice(0);
        if (group.length === 0) return;
        const ownerUserId = targetFolder.ownerUserId;
        const groupEntries = (files: FileSummary[]) =>
          group.map((entry, index) => ({
            idempotencyKey: entry.idempotencyKey,
            requestHash: entry.requestHash,
            file: files[index]!,
          }));
        try {
          await runDurableStorageMutation({
            signal,
            kind: "upload_create",
            ownerUserId,
            idempotencyKey: group[0]!.idempotencyKey,
            reservedBytes: BigInt(
              group.reduce(
                (total, entry) => total + entry.stagedFile.sizeBytes,
                0,
              ),
            ),
            requestHashPayload: {
              uploads: group.map(({ idempotencyKey, requestHash }) => ({
                idempotencyKey,
                requestHash,
              })),
            },
            metadataOperations: [
              {
                action: "assert_owner_quota",
                ownerUserId,
                additionalBytes: String(
                  group.reduce(
                    (total, entry) => total + entry.stagedFile.sizeBytes,
                    0,
                  ),
                ),
              },
              ...group.map(
                ({ stagedFile, name, storageKey, fileId }) =>
                  ({
                    action: "create_file",
                    data: {
                      id: fileId,
                      ownerUserId,
                      folderId: targetFolder.id,
                      originalName: name,
                      storageKey,
                      mimeType: stagedFile.mimeType,
                      sizeBytes: String(stagedFile.sizeBytes),
                      contentChecksum: stagedFile.actualChecksum,
                      clientModifiedAt:
                        stagedFile.clientModifiedAt?.toISOString() ?? null,
                    },
                  }) as const,
              ),
            ],
            steps: group.map(({ stagedFile, storageKey }) => ({
              action: "rename" as const,
              sourceKey: storageKeyForAbsolutePath(stagedFile.tmpPath),
              targetKey: storageKey,
              expectedNodeType: "file" as const,
              expectedSizeBytes: BigInt(stagedFile.sizeBytes),
              expectedChecksum: stagedFile.actualChecksum,
            })),
            entities: group.map(({ stagedFile, name, storageKey, fileId }) => ({
              entityType: "file" as const,
              entityId: fileId,
              preRevision: -1,
              postRevision: 0,
              beforeJson: null,
              afterJson: toMetadataJson({
                storageKey,
                originalName: name,
                sizeBytes: stagedFile.sizeBytes,
                contentChecksum: stagedFile.actualChecksum,
              }),
            })),
            folderGuards: [folderGuard(targetFolder)],
            resultJson: serializeUploadGroupResult(
              groupEntries(
                group.map(({ stagedFile, name, fileId }) => ({
                  id: fileId,
                  ownerUserId,
                  ownerStorageId: targetFolder.ownerStorageId,
                  folderId: targetFolder.id,
                  name,
                  mimeType: stagedFile.mimeType,
                  sizeBytes: stagedFile.sizeBytes,
                  viewerKind: null,
                  deletedAt: null,
                  createdAt: now(),
                  updatedAt: now(),
                })),
              ),
            ),
          });
        } catch (error) {
          if (ownsNothing(error)) {
            await Promise.all(
              group.map((entry) =>
                cleanupStagedUpload(entry.stagedFile.tmpPath),
              ),
            );
          }
          throw error;
        }
        await Promise.all(
          group.map((entry) => cleanupStagedUpload(entry.stagedFile.tmpPath)),
        );
        const createdFiles = new Map(
          (
            await activeRepo.listFilesByIds(
              ownerUserId,
              group.map((entry) => entry.fileId),
            )
          ).map((file) => [file.id, toFileSummary(file)]),
        );
        const files = group.map((entry) => {
          const file = createdFiles.get(entry.fileId);
          if (!file) {
            throw new Error("Durable upload committed without file metadata.");
          }
          return file;
        });
        await persistDirectMutationReplay(
          group[0]!.idempotencyKey,
          serializeUploadGroupResult(groupEntries(files)),
        );
        for (const [index, entry] of group.entries()) {
          uploadedFilesByOrdinal.set(entry.ordinal, files[index]!);
        }
      };

      for (const [itemOrdinal, item] of items.entries()) {
        if (replayedUploads.has(itemOrdinal)) continue;
        const itemIdempotencyKey = itemIdempotencyKeys[itemOrdinal];
        const normalizedName = normalizedNames[itemOrdinal]!;
        const stagedFile =
          preStagedUploads.get(itemOrdinal) ??
          (await stageUpload(
            {
              ...item,
              originalName: normalizedName,
            },
            uploadDeadline,
          ));
        preStagedUploads.delete(itemOrdinal);
        stagedAnyUpload = true;

        try {
          assertStorageAdmissionActive(signal);
          if (
            pendingCreates.length >= UPLOAD_CREATE_GROUP_LIMIT ||
            pendingCreates.some(
              (entry) =>
                uploadGroupNameKey(entry.name) ===
                uploadGroupNameKey(normalizedName),
            )
          ) {
            await flushPendingCreates();
          }
          await coordinateStorageMutation({
            lockKeys: targetFolderLockKeys,
            deadline: uploadDeadline,
            // Replacement callback preserves staging and quota-transfer ordering.
            // fallow-ignore-next-line complexity
            callback: async () => {
              const activeConflict = await activeRepo.findActiveNameConflict({
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
                  assertRevision(
                    activeConflict.item,
                    item.ifRevision,
                    item.ifFileId,
                  );
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
                      signal,
                      kind: "upload_replace",
                      ownerUserId: targetFolder.ownerUserId,
                      idempotencyKey: itemIdempotencyKey,
                      reservedBytes: BigInt(
                        Math.max(0, stagedFile.sizeBytes - existing.sizeBytes),
                      ),
                      requestHashPayload: uploadRequestHash(
                        folderId,
                        normalizedName,
                        stagedFile,
                        item,
                      ),
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
                            clientModifiedAt:
                              stagedFile.clientModifiedAt?.toISOString() ??
                              null,
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
                    ...pendingCreates.map((entry) => entry.name),
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
                ? uploadCreateFileId(
                    targetFolder.ownerUserId,
                    itemIdempotencyKey,
                  )
                : randomUUID();
              const targetPath = getStoragePath(storageKey);

              if (!repo) {
                pendingCreates.push({
                  ordinal: itemOrdinal,
                  idempotencyKey: itemIdempotencyKey ?? null,
                  requestHash: hashDurableStorageRequest(
                    uploadRequestHash(
                      folderId,
                      normalizedName,
                      stagedFile,
                      item,
                    ),
                  ),
                  stagedFile,
                  name: finalName,
                  storageKey,
                  fileId,
                });
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
          if (ownsNothing(error)) {
            await cleanupStagedUpload(stagedFile.tmpPath);
          }

          // Files still waiting for their group were never handed over.
          await Promise.all(
            [
              ...preStagedUploads.values(),
              ...pendingCreates.map((entry) => entry.stagedFile),
            ].map((staged) => cleanupStagedUpload(staged.tmpPath)),
          );
          // Unknown ownership stays on disk for the retention/recovery worker.
          await scheduleStagingCleanup().catch(() => undefined);
          throw error;
        }
      }
      try {
        await flushPendingCreates();
      } catch (error) {
        await scheduleStagingCleanup().catch(() => undefined);
        throw error;
      }

      if (stagedAnyUpload) {
        // The worker also schedules retention; housekeeping must not fail a saved upload.
        void scheduleStagingCleanup().catch((error) => {
          console.warn("[files] Failed to schedule staging cleanup.", error);
        });
      }

      const uploadedFiles = items.flatMap((_item, ordinal) => {
        const uploaded = uploadedFilesByOrdinal.get(ordinal);
        return uploaded ? [uploaded] : [];
      });
      if (uploadedFiles.length > 0) {
        scheduleUploadDerivatives(uploadedFiles);
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
      clientModifiedAt = null,
      ifRevision,
      ifFileId,
    }: CommitResumableUploadInput): Promise<FileSummary> {
      if (!repo) await assertStorageProtocolReady();
      const normalizedName = normalizeFileName(originalName);
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
        if (prior?.status === "aborted") {
          throw storageMutationRejectionFromResult(prior.resultJson);
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
      const folderMap = await readFolderMap(targetFolder.ownerUserId, [
        targetFolder.id,
      ]);
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
          const activeConflict = await activeRepo.findActiveNameConflict({
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
              assertRevision(activeConflict.item, ifRevision, ifFileId);
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
                        clientModifiedAt:
                          clientModifiedAt?.toISOString() ?? null,
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
              throw new FilesError(
                "FILE_NAME_CONFLICT",
                undefined,
                conflictDetails(activeConflict.item),
              );
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
                    clientModifiedAt: clientModifiedAt?.toISOString() ?? null,
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
              folderGuards: [folderGuard(targetFolder)],
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
          scheduleUploadDerivatives([summary]);
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
