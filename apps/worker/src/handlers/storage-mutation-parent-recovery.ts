// Parent mutation families intentionally share resumable child orchestration.
// fallow-ignore-file code-duplication
import path from "node:path";
import { lstat } from "node:fs/promises";

import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  buildStorageMutationChildRequestHashPayload,
  completeStorageMutationParent,
  recordStorageMutationParentChild,
  renewStorageMutationLease,
  type ClaimedStorageMutation,
  type StorageMetadataOperation,
  type StorageMutationEntityInput,
  type StorageMutationStepInput,
} from "@staaash/db/storage-mutations";
import {
  calculateStorageFileChecksum,
  calculateTreeManifestDigest,
  resolveMutationStoragePath,
  StorageMutationAmbiguityError,
} from "@staaash/db/storage-mutation-executor";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import {
  hashWorkerStorageRequest,
  runWorkerStorageMutation,
} from "../durable-storage-mutation.js";
import {
  assertTrashItemEligible,
  parseClearTrashIntent,
  parseTrashRetentionIntent,
  TrashItemIdentityChangedError,
  type TrashItemIdentity,
} from "./trash-retention-eligibility.js";
import { buildTrashPurgeChildRequestHashPayload } from "./trash-purge-child-request.js";

type ParentChild = {
  ordinal: number;
  childId: string | null;
  result: Record<string, unknown>;
};

type TrashPurgeItem = {
  id: string;
  kind: "file" | "folder";
  identity: TrashItemIdentity & { cutoff?: Date };
};

const assertRetentionEligibility = (
  parent: ClaimedStorageMutation,
  item: TrashPurgeItem,
  current: {
    ownerUserId: string;
    deletedAt: Date | null;
    storageRevision: number;
    trashEntryId: string | null;
  },
) => {
  assertTrashItemEligible({
    ownerUserId: parent.ownerUserId,
    expected: item.identity,
    current,
    cutoff: item.identity.cutoff,
  });
};

const checksumIfPresent = async (filesRoot: string, storageKey: string) => {
  const target = resolveMutationStoragePath(filesRoot, storageKey);
  try {
    const stats = await lstat(target);
    if (!stats.isFile()) {
      return undefined;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return await calculateStorageFileChecksum(filesRoot, storageKey);
  } catch (error) {
    if (error instanceof StorageMutationAmbiguityError) return undefined;
    throw error;
  }
};

const treeDigestIfDeterminable = async (absolutePath: string) => {
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
    if (error instanceof StorageMutationAmbiguityError)
      return "invalid-tree-manifest";
    throw error;
  }
};

export class ParentChildRecoveryRequiredError extends Error {
  readonly childMutationId: string;

  constructor(childMutationId: string) {
    super(
      `Child storage mutation ${childMutationId} requires operator recovery.`,
    );
    this.name = "ParentChildRecoveryRequiredError";
    this.childMutationId = childMutationId;
  }
}

const readChildren = (value: Prisma.JsonValue | null): ParentChild[] =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Array.isArray((value as { children?: unknown }).children)
    ? ((value as { children: ParentChild[] }).children ?? [])
    : [];

const renewParent = (parent: ClaimedStorageMutation, leaseOwner: string) =>
  renewStorageMutationLease({
    id: parent.id,
    leaseOwner,
    leaseToken: parent.leaseToken,
  });

const recordChild = async ({
  parent,
  leaseOwner,
  ordinal,
  childId,
  result,
}: {
  parent: ClaimedStorageMutation;
  leaseOwner: string;
  ordinal: number;
  childId: string | null;
  result: Record<string, unknown>;
}) =>
  recordStorageMutationParentChild({
    parentId: parent.id,
    leaseOwner,
    leaseToken: parent.leaseToken,
    ordinal,
    childId,
    result: result as Prisma.InputJsonValue,
  });

const buildFolderKeyResolver = async (ownerUserId: string) => {
  const prisma = getPrisma();
  const [owner, folders] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
      select: { storageId: true },
    }),
    prisma.folder.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        parentId: true,
        name: true,
        isFilesRoot: true,
        deletedAt: true,
        storageRevision: true,
      },
    }),
  ]);
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const resolve = (folderId: string) => {
    const names: string[] = [];
    let current = folderMap.get(folderId);
    const seen = new Set<string>();
    while (current && !current.isFilesRoot) {
      if (seen.has(current.id)) throw new Error("FOLDER_MOVE_CYCLE");
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? folderMap.get(current.parentId) : undefined;
    }
    if (!current?.isFilesRoot) throw new Error("FOLDER_PARENT_MISSING");
    return path.posix.join("files", owner.storageId, ...names);
  };
  return { folders, folderMap, resolve };
};

const resolveExistingBatchChild = async ({
  parent,
  childKey,
  expectedKind,
  requestHashPayload,
  item,
}: {
  parent: ClaimedStorageMutation;
  childKey: string;
  expectedKind: "file_move" | "folder_move";
  requestHashPayload: unknown;
  item: { id: string; kind: "file" | "folder" };
}) => {
  const existing = await getPrisma().storageMutation.findUnique({
    where: { idempotencyKey: childKey },
  });
  if (!existing) return null;
  const identityMatches = [
    existing.parentId === parent.id,
    existing.kind === expectedKind,
    existing.ownerUserId === parent.ownerUserId,
    existing.requestHash === hashWorkerStorageRequest(requestHashPayload),
  ].every(Boolean);
  if (!identityMatches) {
    throw new Error("Batch child idempotency identity mismatch.");
  }
  if (existing.status === "succeeded") {
    return { childId: existing.id, result: { ...item, status: "moved" } };
  }
  if (existing.status === "recovery_required") {
    throw new ParentChildRecoveryRequiredError(existing.id);
  }
  throw new Error("Child storage mutation is still recovering.");
};

const requireBatchDestination = async (
  destinationFolderId: string,
  ownerUserId: string,
) => {
  const destination = await getPrisma().folder.findUnique({
    where: { id: destinationFolderId },
    select: { id: true, ownerUserId: true, deletedAt: true },
  });
  if (
    [
      !destination,
      destination?.ownerUserId !== ownerUserId,
      destination?.deletedAt,
    ].some(Boolean)
  ) {
    throw new Error("DESTINATION_FOLDER_NOT_FOUND");
  }
  return destination!;
};

const requireActiveBatchFile = <
  T extends {
    ownerUserId: string;
    deletedAt: Date | null;
  },
>(
  file: T | null,
  ownerUserId: string,
): T => {
  if (
    [!file, file?.ownerUserId !== ownerUserId, file?.deletedAt].some(Boolean)
  ) {
    throw new Error("FILE_NOT_FOUND");
  }
  return file!;
};

const resolveBatchFileChecksum = async (
  filesRoot: string,
  file: { contentChecksum: string | null; storageKey: string },
) =>
  file.contentChecksum ?? (await checksumIfPresent(filesRoot, file.storageKey));

const buildBatchFileMovePlan = async ({
  parent,
  itemId,
  destination,
  destinationKey,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  itemId: string;
  destination: { id: string };
  destinationKey: string;
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const file = requireActiveBatchFile(
    await prisma.file.findUnique({ where: { id: itemId } }),
    parent.ownerUserId,
  );
  if (file.folderId === destination.id) throw new Error("FILE_MOVE_NOOP");
  const [fileConflict, folderConflict] = await Promise.all([
    prisma.file.findFirst({
      where: {
        ownerUserId: parent.ownerUserId,
        folderId: destination.id,
        originalName: file.originalName,
        deletedAt: null,
        id: { not: file.id },
      },
      select: { id: true },
    }),
    prisma.folder.findFirst({
      where: {
        ownerUserId: parent.ownerUserId,
        parentId: destination.id,
        name: file.originalName,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);
  if ([fileConflict, folderConflict].some(Boolean)) {
    throw new Error("FILE_NAME_CONFLICT");
  }
  const targetKey = path.posix.join(destinationKey, file.originalName);
  const checksum = await resolveBatchFileChecksum(storagePaths.filesRoot, file);
  return {
    operations: [
      {
        action: "update" as const,
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        data: {
          folderId: destination.id,
          storageKey: targetKey,
          contentChecksum: checksum ?? null,
        },
      },
    ],
    steps: [
      {
        action: "rename" as const,
        sourceKey: file.storageKey,
        targetKey,
        expectedNodeType: "file" as const,
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision + 1,
        beforeJson: {
          folderId: file.folderId,
          storageKey: file.storageKey,
        },
        afterJson: { folderId: destination.id, storageKey: targetKey },
      },
    ],
  };
};

const collectBatchFolderDescendants = (
  folderId: string,
  destinationId: string,
  folders: Awaited<ReturnType<typeof buildFolderKeyResolver>>["folders"],
) => {
  const descendantIds = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const candidate of folders) {
      if (candidate.parentId !== parentId || candidate.deletedAt) continue;
      if (candidate.id === destinationId) throw new Error("FOLDER_MOVE_CYCLE");
      if (descendantIds.has(candidate.id)) continue;
      descendantIds.add(candidate.id);
      queue.push(candidate.id);
    }
  }
  return descendantIds;
};

const createBatchTargetStorageKey = (
  sourceKey: string,
  targetKey: string,
  storageKey: string,
) => {
  const relative = path.posix.relative(sourceKey, storageKey);
  if (
    [
      !relative,
      relative === "..",
      relative.startsWith("../"),
      path.posix.isAbsolute(relative),
    ].some(Boolean)
  ) {
    throw new Error("Folder file escaped its journaled source root.");
  }
  return path.posix.join(targetKey, relative);
};

const buildBatchFolderMovePlan = async ({
  parent,
  itemId,
  destination,
  destinationKey,
  layout,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  itemId: string;
  destination: { id: string };
  destinationKey: string;
  layout: Awaited<ReturnType<typeof buildFolderKeyResolver>>;
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const folder = layout.folderMap.get(itemId);
  if (
    [
      !folder,
      folder?.isFilesRoot,
      folder?.deletedAt,
      folder?.id === destination.id,
    ].some(Boolean)
  ) {
    throw new Error("FOLDER_NOT_FOUND");
  }
  if (folder!.parentId === destination.id) throw new Error("FOLDER_MOVE_NOOP");
  const descendantIds = collectBatchFolderDescendants(
    folder!.id,
    destination.id,
    layout.folders,
  );
  const [folderConflict, fileConflict] = await Promise.all([
    prisma.folder.findFirst({
      where: {
        ownerUserId: parent.ownerUserId,
        parentId: destination.id,
        name: folder!.name,
        deletedAt: null,
        id: { not: folder!.id },
      },
      select: { id: true },
    }),
    prisma.file.findFirst({
      where: {
        ownerUserId: parent.ownerUserId,
        folderId: destination.id,
        originalName: folder!.name,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);
  if ([folderConflict, fileConflict].some(Boolean)) {
    throw new Error("FOLDER_NAME_CONFLICT");
  }
  const sourceKey = layout.resolve(folder!.id);
  const targetKey = path.posix.join(destinationKey, folder!.name);
  const files = await prisma.file.findMany({
    where: {
      ownerUserId: parent.ownerUserId,
      folderId: { in: [folder!.id, ...descendantIds] },
      deletedAt: null,
    },
  });
  const targetStorageKey = (storageKey: string) =>
    createBatchTargetStorageKey(sourceKey, targetKey, storageKey);
  const digest = await treeDigestIfDeterminable(
    resolveMutationStoragePath(storagePaths.filesRoot, sourceKey),
  );
  return {
    operations: [
      {
        action: "update" as const,
        entityType: "folder" as const,
        entityId: folder!.id,
        preRevision: folder!.storageRevision,
        data: { parentId: destination.id },
      },
      ...files.map((file): StorageMetadataOperation => ({
        action: "update",
        entityType: "file",
        entityId: file.id,
        preRevision: file.storageRevision,
        data: { storageKey: targetStorageKey(file.storageKey) },
      })),
    ],
    steps: [
      {
        action: "rename" as const,
        sourceKey,
        targetKey,
        expectedNodeType: "directory" as const,
        treeManifestDigest: digest,
      },
    ],
    entities: [
      {
        entityType: "folder" as const,
        entityId: folder!.id,
        preRevision: folder!.storageRevision,
        postRevision: folder!.storageRevision + 1,
        beforeJson: { parentId: folder!.parentId },
        afterJson: { parentId: destination.id },
      },
      ...files.map((file) => ({
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision + 1,
        beforeJson: { storageKey: file.storageKey },
        afterJson: { storageKey: targetStorageKey(file.storageKey) },
      })),
    ],
  };
};

const runBatchMoveChild = async ({
  parent,
  leaseOwner,
  ordinal,
  item,
  destinationFolderId,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  leaseOwner: string;
  ordinal: number;
  item: { id: string; kind: "file" | "folder" };
  destinationFolderId: string;
  storagePaths: WorkerStoragePaths;
}) => {
  const childKey = `${parent.idempotencyKey}:${ordinal}`;
  const expectedKind = item.kind === "file" ? "file_move" : "folder_move";
  const requestHashPayload = buildStorageMutationChildRequestHashPayload({
    operation: "batch_move",
    item,
    destinationFolderId,
  });
  const replay = await resolveExistingBatchChild({
    parent,
    childKey,
    expectedKind,
    requestHashPayload,
    item,
  });
  if (replay) return replay;
  const destination = await requireBatchDestination(
    destinationFolderId,
    parent.ownerUserId,
  );
  const layout = await buildFolderKeyResolver(parent.ownerUserId);
  const destinationKey = layout.resolve(destination.id);
  const plan =
    item.kind === "file"
      ? await buildBatchFileMovePlan({
          parent,
          itemId: item.id,
          destination,
          destinationKey,
          storagePaths,
        })
      : await buildBatchFolderMovePlan({
          parent,
          itemId: item.id,
          destination,
          destinationKey,
          layout,
          storagePaths,
        });

  const child = await runWorkerStorageMutation({
    mutationId: `${parent.id}-${ordinal}`,
    parentId: parent.id,
    kind: expectedKind,
    ownerUserId: parent.ownerUserId,
    idempotencyKey: childKey,
    metadataOperations: plan.operations,
    steps: plan.steps,
    entities: plan.entities,
    storagePaths,
    requestHashPayload,
  });
  await renewParent(parent, leaseOwner);
  return {
    childId: child.id,
    result: { ...item, status: "moved" },
  };
};

const clearTrashResult = (
  item: { id: string; kind: "file" | "folder" },
  deletedFolderCount: number,
  deletedFileCount: number,
) => ({
  id: item.id,
  kind: item.kind,
  status: "purged",
  deletedFolderCount,
  deletedFileCount,
});

const skippedTrashResult = (item: { id: string; kind: "file" | "folder" }) => ({
  id: item.id,
  kind: item.kind,
  status: "skipped",
  deletedFolderCount: 0,
  deletedFileCount: 0,
});

const clearTrashReplayResult = (
  item: { id: string; kind: "file" | "folder" },
  resultJson: Prisma.JsonValue | null,
) => {
  const counts = resultJson as {
    deletedFolderCount?: number;
    deletedFileCount?: number;
  } | null;
  return clearTrashResult(
    item,
    counts?.deletedFolderCount ?? 0,
    counts?.deletedFileCount ?? (item.kind === "file" ? 1 : 0),
  );
};

const resolveExistingClearTrashChild = async ({
  parent,
  childKey,
  expectedKind,
  requestHashPayload,
  item,
}: {
  parent: ClaimedStorageMutation;
  childKey: string;
  expectedKind: "file_purge" | "folder_purge";
  requestHashPayload: unknown;
  item: TrashPurgeItem;
}) => {
  const existing = await getPrisma().storageMutation.findUnique({
    where: { idempotencyKey: childKey },
  });
  if (!existing) return null;
  const identityMatches = [
    existing.parentId === parent.id,
    existing.kind === expectedKind,
    existing.ownerUserId === parent.ownerUserId,
    existing.requestHash === hashWorkerStorageRequest(requestHashPayload),
  ].every(Boolean);
  if (!identityMatches) {
    throw new Error("Clear-trash child idempotency identity mismatch.");
  }
  if (existing.status === "recovery_required") {
    throw new ParentChildRecoveryRequiredError(existing.id);
  }
  if (existing.status !== "succeeded") {
    throw new Error("Child purge is still recovering.");
  }
  return {
    childId: existing.id,
    result: clearTrashReplayResult(item, existing.resultJson),
  };
};

const resolvePriorFilePurge = async (item: {
  id: string;
  kind: "file" | "folder";
}) => {
  const prior = await getPrisma().storageMutationEntity.findFirst({
    where: {
      entityType: "file",
      entityId: item.id,
      mutation: { kind: "file_purge", status: "succeeded" },
    },
    select: { mutationId: true },
  });
  if (!prior) throw new Error("Missing clear-trash file is ambiguous.");
  return {
    childId: prior.mutationId,
    result: clearTrashResult(item, 0, 1),
  };
};

const resolvePriorFolderPurge = async (item: {
  id: string;
  kind: "file" | "folder";
}) => {
  const prior = await getPrisma().storageMutationEntity.findFirst({
    where: {
      entityType: "folder",
      entityId: item.id,
      mutation: { kind: "folder_purge", status: "succeeded" },
    },
    select: {
      mutationId: true,
      mutation: { select: { resultJson: true } },
    },
  });
  if (!prior) throw new Error("Missing clear-trash folder is ambiguous.");
  const counts = prior.mutation.resultJson as {
    deletedFolderCount?: number;
    deletedFileCount?: number;
  } | null;
  if (
    typeof counts?.deletedFolderCount !== "number" ||
    typeof counts.deletedFileCount !== "number"
  ) {
    throw new Error("Missing clear-trash folder counts are ambiguous.");
  }
  return {
    childId: prior.mutationId,
    result: clearTrashResult(
      item,
      counts.deletedFolderCount,
      counts.deletedFileCount,
    ),
  };
};

const buildClearTrashFilePlan = async ({
  parent,
  ordinal,
  item,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  ordinal: number;
  item: TrashPurgeItem;
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const file = await prisma.file.findUnique({ where: { id: item.id } });
  if (!file) return { replay: await resolvePriorFilePurge(item) };
  assertRetentionEligibility(parent, item, file);
  if (file.ownerUserId !== parent.ownerUserId || !file.deletedAt) {
    throw new Error("Clear-trash file is no longer deleted.");
  }
  const checksum = await resolveBatchFileChecksum(storagePaths.filesRoot, file);
  const quarantineKey = path.posix.join(
    "tmp",
    "quarantine",
    parent.id,
    String(ordinal),
    file.id,
  );
  const derivatives = await prisma.mediaDerivative.findMany({
    where: { fileId: file.id, storageKey: { not: null } },
  });
  const derivativeChecksums = new Map(
    await Promise.all(
      derivatives.flatMap((derivative) =>
        derivative.storageKey
          ? [
              checksumIfPresent(
                storagePaths.filesRoot,
                derivative.storageKey,
              ).then((value) => [derivative.id, value] as const),
            ]
          : [],
      ),
    ),
  );
  return {
    replay: null,
    operations: [
      ...derivatives.map((derivative): StorageMetadataOperation => ({
        action: "delete",
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
      })),
      {
        action: "delete" as const,
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
      },
      ...(file.trashEntryId
        ? [
            {
              action: "delete_trash_entry" as const,
              entityId: file.trashEntryId,
            },
          ]
        : []),
    ],
    steps: [
      {
        action: "rename" as const,
        sourceKey: file.storageKey,
        targetKey: quarantineKey,
        expectedNodeType: "file" as const,
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
      {
        action: "delete_file" as const,
        targetKey: quarantineKey,
        expectedNodeType: "file" as const,
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
      ...derivatives.flatMap((derivative): StorageMutationStepInput[] =>
        derivative.storageKey
          ? [
              {
                action: "delete_file",
                targetKey: derivative.storageKey,
                expectedNodeType: "file",
                expectedSizeBytes: derivative.sizeBytes,
                expectedChecksum: derivativeChecksums.get(derivative.id),
              },
            ]
          : [],
      ),
    ],
    entities: [
      ...derivatives.map((derivative) => ({
        entityType: "derivative" as const,
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        postRevision: derivative.storageRevision + 1,
        beforeJson: { storageKey: derivative.storageKey },
        afterJson: null,
      })),
      {
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision + 1,
        beforeJson: { storageKey: file.storageKey },
        afterJson: null,
      },
    ],
    deletedFolderCount: 0,
    deletedFileCount: 1,
  };
};

const trashFolderDepthResolver = (
  folders: Array<{ id: string; parentId: string | null }>,
) => {
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  return (folderId: string) => {
    let value = 0;
    let current = folderMap.get(folderId);
    const seen = new Set<string>();
    while (current?.parentId && folderMap.has(current.parentId)) {
      if (seen.has(current.id)) throw new Error("Legacy trash folder cycle.");
      seen.add(current.id);
      value += 1;
      current = folderMap.get(current.parentId);
    }
    return value;
  };
};

const buildTrashFolderOperations = ({
  rootTrashEntryId,
  folders,
  files,
  derivatives,
}: {
  rootTrashEntryId: string;
  folders: Array<{
    id: string;
    parentId: string | null;
    storageRevision: number;
  }>;
  files: Array<{ id: string; storageRevision: number }>;
  derivatives: Array<{ id: string; storageRevision: number }>;
}): StorageMetadataOperation[] => {
  const depth = trashFolderDepthResolver(folders);
  return [
    ...derivatives.map((derivative) => ({
      action: "delete" as const,
      entityType: "derivative" as const,
      entityId: derivative.id,
      preRevision: derivative.storageRevision,
    })),
    ...files.map((file) => ({
      action: "delete" as const,
      entityType: "file" as const,
      entityId: file.id,
      preRevision: file.storageRevision,
    })),
    ...[...folders]
      .sort((left, right) => depth(right.id) - depth(left.id))
      .map((folder) => ({
        action: "delete" as const,
        entityType: "folder" as const,
        entityId: folder.id,
        preRevision: folder.storageRevision,
      })),
    { action: "delete_trash_entry", entityId: rootTrashEntryId },
  ];
};

const buildLegacyTrashTreeSteps = async ({
  parent,
  ordinal,
  files,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  ordinal: number;
  files: Array<{
    id: string;
    storageKey: string;
    sizeBytes: bigint;
    contentChecksum: string | null;
  }>;
  storagePaths: WorkerStoragePaths;
}) => {
  const steps: StorageMutationStepInput[] = [];
  const quarantineRoot = path.posix.join(
    "tmp",
    "quarantine",
    parent.id,
    String(ordinal),
  );
  for (const file of files) {
    const checksum = await resolveBatchFileChecksum(
      storagePaths.filesRoot,
      file,
    );
    const targetKey = path.posix.join(quarantineRoot, file.id);
    steps.push(
      {
        action: "rename",
        sourceKey: file.storageKey,
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
      {
        action: "delete_file",
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
    );
  }
  return steps;
};

const buildIsolatedTrashTreeSteps = ({
  parent,
  ordinal,
  trashEntry,
}: {
  parent: ClaimedStorageMutation;
  ordinal: number;
  trashEntry: {
    storageRootKey: string;
    treeManifestDigest: string | null;
  };
}) => {
  if (!trashEntry.treeManifestDigest) {
    throw new StorageMutationAmbiguityError(
      "Isolated trash tree lacks its captured manifest.",
    );
  }
  const quarantineRoot = path.posix.join(
    "tmp",
    "quarantine",
    parent.id,
    String(ordinal),
  );
  return [
    {
      action: "rename" as const,
      sourceKey: trashEntry.storageRootKey,
      targetKey: quarantineRoot,
      expectedNodeType: "directory" as const,
      treeManifestDigest: trashEntry.treeManifestDigest,
    },
    {
      action: "delete_tree" as const,
      targetKey: quarantineRoot,
      expectedNodeType: "directory" as const,
      treeManifestDigest: trashEntry.treeManifestDigest,
    },
  ];
};

const appendDerivativePurgeSteps = async ({
  steps,
  derivatives,
  storagePaths,
}: {
  steps: StorageMutationStepInput[];
  derivatives: Array<{
    storageKey: string | null;
    sizeBytes: bigint | null;
  }>;
  storagePaths: WorkerStoragePaths;
}) => {
  for (const derivative of derivatives) {
    if (!derivative.storageKey) continue;
    steps.push({
      action: "delete_file",
      targetKey: derivative.storageKey,
      expectedNodeType: "file",
      expectedSizeBytes: derivative.sizeBytes,
      expectedChecksum: await checksumIfPresent(
        storagePaths.filesRoot,
        derivative.storageKey,
      ),
    });
  }
};

const buildClearTrashFolderPlan = async ({
  parent,
  ordinal,
  item,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  ordinal: number;
  item: TrashPurgeItem;
  storagePaths: WorkerStoragePaths;
}) => {
  const prisma = getPrisma();
  const root = await prisma.folder.findUnique({
    where: { id: item.id },
    include: { trashEntry: true },
  });
  if (!root) return { replay: await resolvePriorFolderPurge(item) };
  assertRetentionEligibility(parent, item, root);
  const validIdentity = [
    root.ownerUserId === parent.ownerUserId,
    Boolean(root.deletedAt),
    Boolean(root.trashEntryId),
    Boolean(root.trashEntry?.storageRootKey),
  ].every(Boolean);
  if (!validIdentity) throw new Error("Clear-trash folder identity changed.");
  const [folders, files] = await Promise.all([
    prisma.folder.findMany({ where: { trashEntryId: root.trashEntryId } }),
    prisma.file.findMany({ where: { trashEntryId: root.trashEntryId } }),
  ]);
  const derivatives = await prisma.mediaDerivative.findMany({
    where: {
      fileId: { in: files.map((file) => file.id) },
      storageKey: { not: null },
    },
  });
  const steps =
    root.trashEntry!.layoutVersion === "isolated"
      ? buildIsolatedTrashTreeSteps({
          parent,
          ordinal,
          trashEntry: {
            storageRootKey: root.trashEntry!.storageRootKey!,
            treeManifestDigest: root.trashEntry!.treeManifestDigest,
          },
        })
      : await buildLegacyTrashTreeSteps({
          parent,
          ordinal,
          files,
          storagePaths,
        });
  await appendDerivativePurgeSteps({ steps, derivatives, storagePaths });
  return {
    replay: null,
    operations: buildTrashFolderOperations({
      rootTrashEntryId: root.trashEntryId!,
      folders,
      files,
      derivatives,
    }),
    steps,
    entities: [
      ...derivatives.map((derivative) => ({
        entityType: "derivative" as const,
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        postRevision: derivative.storageRevision + 1,
        beforeJson: { storageKey: derivative.storageKey },
        afterJson: null,
      })),
      ...files.map((file) => ({
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision + 1,
        beforeJson: { storageKey: file.storageKey },
        afterJson: null,
      })),
      ...folders.map((folder) => ({
        entityType: "folder" as const,
        entityId: folder.id,
        preRevision: folder.storageRevision,
        postRevision: folder.storageRevision + 1,
        beforeJson: { deletedAt: folder.deletedAt?.toISOString() ?? null },
        afterJson: null,
      })),
    ],
    deletedFolderCount: folders.length,
    deletedFileCount: files.length,
  };
};

const runClearTrashChild = async ({
  parent,
  leaseOwner,
  ordinal,
  item,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  leaseOwner: string;
  ordinal: number;
  item: TrashPurgeItem;
  storagePaths: WorkerStoragePaths;
}) => {
  const childKey = `${parent.idempotencyKey}:${ordinal}`;
  const expectedKind = item.kind === "file" ? "file_purge" : "folder_purge";
  const requestHashPayload = buildTrashPurgeChildRequestHashPayload(item);
  const replay = await resolveExistingClearTrashChild({
    parent,
    childKey,
    expectedKind,
    requestHashPayload,
    item,
  });
  if (replay) return replay;
  const plan =
    item.kind === "file"
      ? await buildClearTrashFilePlan({
          parent,
          ordinal,
          item,
          storagePaths,
        })
      : await buildClearTrashFolderPlan({
          parent,
          ordinal,
          item,
          storagePaths,
        });
  if (plan.replay) return plan.replay;

  const result = clearTrashResult(
    item,
    plan.deletedFolderCount,
    plan.deletedFileCount,
  );
  const child = await runWorkerStorageMutation({
    mutationId: `${parent.id}-${ordinal}`,
    parentId: parent.id,
    kind: expectedKind,
    ownerUserId: parent.ownerUserId,
    idempotencyKey: childKey,
    metadataOperations: plan.operations,
    steps: plan.steps,
    entities: plan.entities,
    storagePaths,
    resultJson: result as Prisma.InputJsonValue,
    requestHashPayload,
  });
  await renewParent(parent, leaseOwner);
  return { childId: child.id, result };
};

// Parent recovery is an explicit state machine; splitting it obscures phase order.
// fallow-ignore-next-line complexity
const recoverStorageMutationParentInternal = async ({
  parent,
  leaseOwner,
  storagePaths,
}: {
  parent: ClaimedStorageMutation;
  leaseOwner: string;
  storagePaths: WorkerStoragePaths;
}) => {
  const intent = parent.intentJson as {
    cutoff?: unknown;
    destinationFolderId?: unknown;
    items?: unknown;
    orderedItems?: unknown;
  };
  const existing = new Map(
    readChildren(parent.resultJson).map((child) => [child.ordinal, child]),
  );
  if (
    parent.kind === "batch_move" &&
    typeof intent.destinationFolderId === "string" &&
    Array.isArray(intent.items)
  ) {
    const results: Array<Record<string, unknown>> = [];
    for (const [ordinal, raw] of intent.items.entries()) {
      const item = raw as { id?: unknown; kind?: unknown };
      if (
        typeof item.id !== "string" ||
        (item.kind !== "file" && item.kind !== "folder")
      ) {
        throw new Error("Invalid durable batch move intent.");
      }
      const prior = existing.get(ordinal);
      if (prior) {
        results.push(prior.result);
        continue;
      }
      await renewParent(parent, leaseOwner);
      try {
        const child = await runBatchMoveChild({
          parent,
          leaseOwner,
          ordinal,
          item: { id: item.id, kind: item.kind },
          destinationFolderId: intent.destinationFolderId,
          storagePaths,
        });
        await recordChild({
          parent,
          leaseOwner,
          ordinal,
          ...child,
        });
        results.push(child.result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected server error.";
        if (
          ![
            "DESTINATION_FOLDER_NOT_FOUND",
            "FILE_NOT_FOUND",
            "FILE_MOVE_NOOP",
            "FILE_NAME_CONFLICT",
            "FOLDER_NOT_FOUND",
            "FOLDER_MOVE_NOOP",
            "FOLDER_MOVE_CYCLE",
            "FOLDER_NAME_CONFLICT",
          ].includes(message)
        ) {
          throw error;
        }
        const result = {
          id: item.id,
          kind: item.kind,
          status: "failed",
          code: message,
          error: message,
        };
        await recordChild({
          parent,
          leaseOwner,
          ordinal,
          childId: null,
          result,
        });
        results.push(result);
      }
    }
    const movedCount = results.filter((item) => item.status === "moved").length;
    await completeStorageMutationParent({
      parentId: parent.id,
      leaseOwner,
      leaseToken: parent.leaseToken,
      resultJson: {
        movedCount,
        failedCount: results.length - movedCount,
        results,
      } as Prisma.InputJsonValue,
    });
    return true;
  }

  if (
    (parent.kind === "clear_trash" || parent.kind === "trash_retention") &&
    Array.isArray(intent.orderedItems)
  ) {
    const orderedItems: TrashPurgeItem[] =
      parent.kind === "trash_retention"
        ? parseTrashRetentionIntent(intent.cutoff, intent.orderedItems)
        : parseClearTrashIntent(intent.orderedItems);
    let deletedFolderCount = 0;
    let deletedFileCount = 0;
    for (const [ordinal, item] of orderedItems.entries()) {
      const prior = existing.get(ordinal);
      let child: Pick<ParentChild, "childId" | "result">;
      if (prior) {
        child = { childId: prior.childId, result: prior.result };
      } else {
        try {
          child = await runClearTrashChild({
            parent,
            leaseOwner,
            ordinal,
            item,
            storagePaths,
          });
        } catch (error) {
          if (!(error instanceof TrashItemIdentityChangedError)) throw error;
          child = { childId: null, result: skippedTrashResult(item) };
        }
        await recordChild({
          parent,
          leaseOwner,
          ordinal,
          ...child,
        });
      }
      deletedFolderCount += Number(child.result.deletedFolderCount ?? 0);
      deletedFileCount += Number(child.result.deletedFileCount ?? 0);
    }
    await completeStorageMutationParent({
      parentId: parent.id,
      leaseOwner,
      leaseToken: parent.leaseToken,
      resultJson: { deletedFolderCount, deletedFileCount },
    });
    return true;
  }

  throw new Error("Unsupported storage mutation parent intent.");
};

export const recoverStorageMutationParent = async (input: {
  parent: ClaimedStorageMutation;
  leaseOwner: string;
  storagePaths: WorkerStoragePaths;
}) => {
  let renewalFailure: unknown;
  const timer = setInterval(() => {
    void renewParent(input.parent, input.leaseOwner).catch((error) => {
      renewalFailure = error;
    });
  }, 10_000);
  timer.unref();
  try {
    const result = await recoverStorageMutationParentInternal(input);
    if (renewalFailure) throw renewalFailure;
    return result;
  } finally {
    clearInterval(timer);
  }
};
