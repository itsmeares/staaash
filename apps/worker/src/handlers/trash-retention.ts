// File and folder retention intentionally share journaled purge phase ordering.
// fallow-ignore-file code-duplication
import path from "node:path";
import { z } from "zod";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { resolveWorkspacePath } from "@staaash/config";
import { getWorkerStoragePaths } from "../storage-maintenance.js";
import {
  assertStorageFilesystemSupported,
  calculateStorageFileChecksum,
  StorageMutationAmbiguityError,
} from "@staaash/db/storage-mutation-executor";
import {
  claimStorageMutation,
  prepareStorageMutationParent,
  type StorageMetadataOperation,
  type StorageMutationStepInput,
} from "@staaash/db/storage-mutations";
import {
  hashWorkerStorageRequest,
  runWorkerStorageMutation,
} from "../durable-storage-mutation.js";
import { recoverStorageMutationParent } from "./storage-mutation-parent-recovery.js";

const trashEnvSchema = z.object({
  UPLOAD_LOCATION: z.string().trim().min(1),
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

type FileRecord = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  storageKey: string;
  deletedAt: Date | null;
  storageRevision: number;
  trashEntryId: string | null;
  sizeBytes: bigint;
  contentChecksum: string | null;
};

type FolderRecord = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  deletedAt: Date | null;
  storageRevision: number;
  trashEntryId: string | null;
};

type PrismaClient = {
  file: {
    findMany(args: object): Promise<FileRecord[]>;
    deleteMany(args: object): Promise<{ count: number }>;
    findUnique(args: object): Promise<FileRecord | null>;
  };
  folder: {
    findMany(args: object): Promise<FolderRecord[]>;
    deleteMany(args: object): Promise<{ count: number }>;
    findUnique(args: object): Promise<FolderRecord | null>;
  };
  trashEntry: {
    findUnique(args: object): Promise<{
      id: string;
      storageRootKey: string | null;
      treeManifestDigest: string | null;
      layoutVersion: string;
    } | null>;
  };
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;
};

const isRetentionRootFolder = (
  folder: FolderRecord,
  parentFolderById: Map<string, FolderRecord>,
) => {
  if (folder.parentId === null) {
    return true;
  }

  const parent = parentFolderById.get(folder.parentId);

  return (
    !parent ||
    parent.deletedAt === null ||
    parent.trashEntryId !== folder.trashEntryId
  );
};

/**
 * Collects all descendant folder IDs for a given root folder (BFS).
 */
const collectDescendantFolderIds = async (
  client: PrismaClient,
  ownerUserId: string,
  rootFolderId: string,
): Promise<string[]> => {
  const all: string[] = [];
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await client.folder.findMany({
      where: { ownerUserId, parentId },
      select: { id: true },
    } as object);

    for (const child of children as { id: string }[]) {
      all.push(child.id);
      queue.push(child.id);
    }
  }

  return all;
};

const loadExpiredFiles = async (prisma: PrismaClient, cutoff: Date) => {
  const expiredFiles = (await prisma.file.findMany({
    where: { deletedAt: { lte: cutoff } },
    select: {
      id: true,
      ownerUserId: true,
      folderId: true,
      storageKey: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
      sizeBytes: true,
      contentChecksum: true,
    },
  } as object)) as FileRecord[];
  const folderIds = [
    ...new Set(expiredFiles.flatMap((file) => file.folderId ?? [])),
  ];
  const parentFolders = (await prisma.folder.findMany({
    where: { id: { in: folderIds } },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord[];
  return {
    expiredFiles,
    parentFolderById: new Map(
      parentFolders.map((folder) => [folder.id, folder]),
    ),
  };
};

const isNestedInSameTrashEntry = (
  file: FileRecord,
  parentFolderById: Map<string, FolderRecord>,
) => {
  if (!file.folderId) return false;
  const parent = parentFolderById.get(file.folderId);
  return Boolean(
    parent?.deletedAt && parent.trashEntryId === file.trashEntryId,
  );
};

const loadExpiredFolderRoots = async (prisma: PrismaClient, cutoff: Date) => {
  const expiredFolders = (await prisma.folder.findMany({
    where: { deletedAt: { lte: cutoff } },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord[];
  const parentIds = [
    ...new Set(expiredFolders.flatMap((folder) => folder.parentId ?? [])),
  ];
  const parents = (await prisma.folder.findMany({
    where: { id: { in: parentIds } },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord[];
  const parentById = new Map(parents.map((folder) => [folder.id, folder]));
  return expiredFolders.filter((folder) =>
    isRetentionRootFolder(folder, parentById),
  );
};

type RetentionItem = { id: string; kind: "file" | "folder" };

const addRetentionItem = (
  itemsByOwner: Map<string, RetentionItem[]>,
  ownerUserId: string,
  item: RetentionItem,
) => {
  itemsByOwner.set(ownerUserId, [
    ...(itemsByOwner.get(ownerUserId) ?? []),
    item,
  ]);
};

const buildRetentionItemsByOwner = ({
  expiredFiles,
  parentFolderById,
  expiredFolderRoots,
}: {
  expiredFiles: FileRecord[];
  parentFolderById: Map<string, FolderRecord>;
  expiredFolderRoots: FolderRecord[];
}) => {
  const itemsByOwner = new Map<string, RetentionItem[]>();
  for (const file of expiredFiles) {
    if (isNestedInSameTrashEntry(file, parentFolderById)) continue;
    addRetentionItem(itemsByOwner, file.ownerUserId, {
      id: file.id,
      kind: "file",
    });
  }
  for (const folder of expiredFolderRoots) {
    addRetentionItem(itemsByOwner, folder.ownerUserId, {
      id: folder.id,
      kind: "folder",
    });
  }
  return itemsByOwner;
};

const runRetentionParent = async ({
  job,
  ownerUserId,
  orderedItems,
  cutoff,
  storagePaths,
}: {
  job: BackgroundJobRecord;
  ownerUserId: string;
  orderedItems: RetentionItem[];
  cutoff: Date;
  storagePaths: ReturnType<typeof getWorkerStoragePaths>;
}) => {
  await assertStorageFilesystemSupported(storagePaths.filesRoot);
  const intent = {
    version: 1,
    metadataOperations: [],
    cutoff: cutoff.toISOString(),
    orderedItems,
  };
  const prepared = await prepareStorageMutationParent({
    kind: "trash_retention",
    ownerUserId,
    idempotencyKey: `trash-retention:${job.id}:${ownerUserId}`,
    requestHash: hashWorkerStorageRequest(intent),
    intentJson: intent,
  });
  if (prepared.mutation.status === "succeeded") return;
  const leaseOwner = `trash-retention:${process.pid}:${job.id}`;
  const claimed = await claimStorageMutation({
    id: prepared.mutation.id,
    leaseOwner,
  });
  if (!claimed) {
    throw new Error("Trash-retention parent is already recovering.");
  }
  await recoverStorageMutationParent({
    parent: claimed,
    leaseOwner,
    storagePaths,
  });
};

const runDurableTrashRetention = async ({
  job,
  cutoff,
  storagePaths,
  prisma,
  expiredFiles,
  parentFolderById,
}: {
  job: BackgroundJobRecord;
  cutoff: Date;
  storagePaths: ReturnType<typeof getWorkerStoragePaths>;
  prisma: PrismaClient;
  expiredFiles: FileRecord[];
  parentFolderById: Map<string, FolderRecord>;
}) => {
  const expiredFolderRoots = await loadExpiredFolderRoots(prisma, cutoff);
  const itemsByOwner = buildRetentionItemsByOwner({
    expiredFiles,
    parentFolderById,
    expiredFolderRoots,
  });
  for (const [ownerUserId, orderedItems] of itemsByOwner) {
    await runRetentionParent({
      job,
      ownerUserId,
      orderedItems,
      cutoff,
      storagePaths,
    });
  }
};

const currentExpiredFile = async (prisma: PrismaClient, id: string) =>
  (await prisma.file.findUnique({
    where: { id },
    select: {
      id: true,
      folderId: true,
      deletedAt: true,
      storageKey: true,
      ownerUserId: true,
      storageRevision: true,
      trashEntryId: true,
      sizeBytes: true,
      contentChecksum: true,
    },
  } as object)) as FileRecord | null;

const purgeExpiredFile = async ({
  prisma,
  file,
  filesRoot,
  storagePaths,
}: {
  prisma: PrismaClient;
  file: FileRecord;
  filesRoot: string;
  storagePaths: ReturnType<typeof getWorkerStoragePaths>;
}) => {
  const current = await currentExpiredFile(prisma, file.id);
  if (!current?.deletedAt) return;
  const checksum =
    current.contentChecksum ??
    (await calculateStorageFileChecksum(filesRoot, current.storageKey));
  const quarantineKey = path.posix.join(
    "tmp",
    "quarantine",
    `retention-file-${current.id}`,
    path.posix.basename(current.storageKey),
  );
  const operations: StorageMetadataOperation[] = [
    {
      action: "delete",
      entityType: "file",
      entityId: current.id,
      preRevision: current.storageRevision,
    },
  ];
  if (current.trashEntryId) {
    operations.push({
      action: "delete_trash_entry",
      entityId: current.trashEntryId,
    });
  }
  await runWorkerStorageMutation({
    mutationId: `retention-file-${current.id}-${current.storageRevision}`,
    kind: "trash_retention",
    ownerUserId: current.ownerUserId,
    idempotencyKey: `trash-retention:file:${current.id}:${current.trashEntryId ?? "legacy"}:${current.storageRevision}`,
    storagePaths,
    metadataOperations: operations,
    steps: [
      {
        action: "rename",
        sourceKey: current.storageKey,
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: current.sizeBytes,
        expectedChecksum: checksum,
      },
      {
        action: "delete_file",
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: current.sizeBytes,
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "file",
        entityId: current.id,
        preRevision: current.storageRevision,
        postRevision: current.storageRevision + 1,
        beforeJson: { storageKey: current.storageKey },
        afterJson: null,
      },
    ],
  });
};

const folderDepth = (folder: FolderRecord, byId: Map<string, FolderRecord>) => {
  let depth = 0;
  let cursor: FolderRecord | undefined = folder;
  while (cursor?.parentId && byId.has(cursor.parentId)) {
    depth += 1;
    cursor = byId.get(cursor.parentId);
  }
  return depth;
};

const buildFolderPurgeOperations = ({
  currentRoot,
  filesInTree,
  foldersInTree,
}: {
  currentRoot: FolderRecord & { trashEntryId: string };
  filesInTree: FileRecord[];
  foldersInTree: FolderRecord[];
}) => {
  const folderById = new Map(
    foldersInTree.map((folder) => [folder.id, folder]),
  );
  return [
    ...filesInTree.map((file): StorageMetadataOperation => ({
      action: "delete",
      entityType: "file",
      entityId: file.id,
      preRevision: file.storageRevision,
    })),
    ...[...foldersInTree]
      .sort(
        (left, right) =>
          folderDepth(right, folderById) - folderDepth(left, folderById),
      )
      .map((folder): StorageMetadataOperation => ({
        action: "delete",
        entityType: "folder",
        entityId: folder.id,
        preRevision: folder.storageRevision,
      })),
    {
      action: "delete_trash_entry" as const,
      entityId: currentRoot.trashEntryId,
    },
  ];
};

type TrashEntryRecord = Awaited<
  ReturnType<PrismaClient["trashEntry"]["findUnique"]>
>;

const buildLegacyFolderPurgeSteps = async ({
  currentRoot,
  filesInTree,
  filesRoot,
}: {
  currentRoot: FolderRecord;
  filesInTree: FileRecord[];
  filesRoot: string;
}) => {
  const steps: StorageMutationStepInput[] = [];
  for (const file of filesInTree) {
    const checksum =
      file.contentChecksum ??
      (await calculateStorageFileChecksum(filesRoot, file.storageKey));
    const quarantineKey = path.posix.join(
      "tmp",
      "quarantine",
      `retention-folder-${currentRoot.id}`,
      file.id,
    );
    steps.push(
      {
        action: "rename",
        sourceKey: file.storageKey,
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
      {
        action: "delete_file",
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: file.sizeBytes,
        expectedChecksum: checksum,
      },
    );
  }
  return steps;
};

const buildFolderPurgeSteps = async ({
  trashEntry,
  currentRoot,
  filesInTree,
  filesRoot,
}: {
  trashEntry: NonNullable<TrashEntryRecord>;
  currentRoot: FolderRecord;
  filesInTree: FileRecord[];
  filesRoot: string;
}): Promise<StorageMutationStepInput[]> => {
  if (trashEntry.layoutVersion !== "isolated" || !trashEntry.storageRootKey) {
    return buildLegacyFolderPurgeSteps({
      currentRoot,
      filesInTree,
      filesRoot,
    });
  }
  const digest = trashEntry.treeManifestDigest;
  if (!digest) {
    throw new StorageMutationAmbiguityError(
      "Isolated trash tree lacks its captured manifest.",
    );
  }
  const quarantineKey = path.posix.join(
    "tmp",
    "quarantine",
    `retention-folder-${currentRoot.id}`,
  );
  return [
    {
      action: "rename",
      sourceKey: trashEntry.storageRootKey,
      targetKey: quarantineKey,
      expectedNodeType: "directory",
      treeManifestDigest: digest,
    },
    {
      action: "delete_tree",
      targetKey: quarantineKey,
      expectedNodeType: "directory",
      treeManifestDigest: digest,
    },
  ];
};

const loadFolderTree = async (
  prisma: PrismaClient,
  currentRoot: FolderRecord & { trashEntryId: string },
) => {
  const descendantIds = await collectDescendantFolderIds(
    prisma,
    currentRoot.ownerUserId,
    currentRoot.id,
  );
  const candidateFolders = (await prisma.folder.findMany({
    where: { id: { in: [currentRoot.id, ...descendantIds] } },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord[];
  const foldersInTree = candidateFolders.filter(
    (folder) => folder.trashEntryId === currentRoot.trashEntryId,
  );
  const filesInTree = (await prisma.file.findMany({
    where: {
      folderId: { in: foldersInTree.map((folder) => folder.id) },
      trashEntryId: currentRoot.trashEntryId,
    },
    select: {
      id: true,
      ownerUserId: true,
      folderId: true,
      storageKey: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
      sizeBytes: true,
      contentChecksum: true,
    },
  } as object)) as FileRecord[];
  return { foldersInTree, filesInTree };
};

const currentExpiredFolder = async (prisma: PrismaClient, id: string) =>
  (await prisma.folder.findUnique({
    where: { id },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord | null;

const purgeExpiredFolder = async ({
  prisma,
  folderRoot,
  filesRoot,
  storagePaths,
}: {
  prisma: PrismaClient;
  folderRoot: FolderRecord;
  filesRoot: string;
  storagePaths: ReturnType<typeof getWorkerStoragePaths>;
}) => {
  const current = await currentExpiredFolder(prisma, folderRoot.id);
  if (!current?.deletedAt || !current.trashEntryId) return;
  const currentRoot = {
    ...current,
    trashEntryId: current.trashEntryId,
  };
  const { foldersInTree, filesInTree } = await loadFolderTree(
    prisma,
    currentRoot,
  );
  const trashEntry = await prisma.trashEntry.findUnique({
    where: { id: currentRoot.trashEntryId },
  } as object);
  if (!trashEntry) return;
  await runWorkerStorageMutation({
    mutationId: `retention-folder-${currentRoot.id}-${currentRoot.storageRevision}`,
    kind: "trash_retention",
    ownerUserId: currentRoot.ownerUserId,
    idempotencyKey: `trash-retention:folder:${currentRoot.id}:${currentRoot.trashEntryId}:${currentRoot.storageRevision}`,
    storagePaths,
    metadataOperations: buildFolderPurgeOperations({
      currentRoot,
      filesInTree,
      foldersInTree,
    }),
    steps: await buildFolderPurgeSteps({
      trashEntry,
      currentRoot,
      filesInTree,
      filesRoot,
    }),
    entities: [
      ...filesInTree.map((file) => ({
        entityType: "file" as const,
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision + 1,
        beforeJson: { storageKey: file.storageKey },
        afterJson: null,
      })),
      ...foldersInTree.map((folder) => ({
        entityType: "folder" as const,
        entityId: folder.id,
        preRevision: folder.storageRevision,
        postRevision: folder.storageRevision + 1,
        beforeJson: { deletedAt: folder.deletedAt?.toISOString() ?? null },
        afterJson: null,
      })),
    ],
  });
};

/**
 * Handles the `trash.retention` periodic job.
 *
 * Finds trashed files and folders older than TRASH_RETENTION_DAYS, then:
 * 1. Deletes standalone trashed files (not inside a trashed folder tree).
 * 2. For each expired trashed root folder: acquires a conceptual lock by
 *    re-validating inside a transaction, collects descendants, deletes files
 *    then folders, and removes preview assets + blob files.
 *
 * Items restored between the initial snapshot and the locked delete phase
 * are automatically skipped because their deletedAt becomes null.
 */
// Retention keeps the per-entry recovery phases visible in one ordered flow.
// fallow-ignore-next-line complexity
export const handleTrashRetention = async (
  _job: BackgroundJobRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const { UPLOAD_LOCATION, TRASH_RETENTION_DAYS } = trashEnvSchema.parse(env);
  const filesRoot = resolveWorkspacePath(UPLOAD_LOCATION, process.cwd());
  const storagePaths = getWorkerStoragePaths(env);
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const prisma = getPrisma() as unknown as PrismaClient;

  // --- Step 1: Expire standalone trashed files ---
  const expiredFiles = (await prisma.file.findMany({
    where: {
      deletedAt: { lte: cutoff },
    },
    select: {
      id: true,
      ownerUserId: true,
      folderId: true,
      storageKey: true,
      deletedAt: true,
      storageRevision: true,
      trashEntryId: true,
      sizeBytes: true,
      contentChecksum: true,
    },
  } as object)) as FileRecord[];
  const expiredFileFolderIds = Array.from(
    new Set(
      expiredFiles.flatMap((file) => (file.folderId ? [file.folderId] : [])),
    ),
  );
  const expiredFileParentFolders = (await prisma.folder.findMany({
    where: {
      id: { in: expiredFileFolderIds },
    },
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      deletedAt: true,
      trashEntryId: true,
    },
  } as object)) as FolderRecord[];
  const expiredFileParentFolderById = new Map(
    expiredFileParentFolders.map((folder) => [folder.id, folder]),
  );

  if (
    "storageMutation" in (getPrisma() as unknown as Record<string, unknown>)
  ) {
    const durableExpiredFolders = (await prisma.folder.findMany({
      where: { deletedAt: { lte: cutoff } },
      select: {
        id: true,
        ownerUserId: true,
        parentId: true,
        deletedAt: true,
      },
    } as object)) as FolderRecord[];
    const parentIds = Array.from(
      new Set(
        durableExpiredFolders.flatMap((folder) =>
          folder.parentId ? [folder.parentId] : [],
        ),
      ),
    );
    const durableParents = (await prisma.folder.findMany({
      where: { id: { in: parentIds } },
      select: {
        id: true,
        ownerUserId: true,
        parentId: true,
        deletedAt: true,
      },
    } as object)) as FolderRecord[];
    const durableParentById = new Map(
      durableParents.map((folder) => [folder.id, folder]),
    );
    const itemsByOwner = new Map<
      string,
      Array<{ id: string; kind: "file" | "folder" }>
    >();
    for (const file of expiredFiles) {
      const parent = file.folderId
        ? expiredFileParentFolderById.get(file.folderId)
        : null;
      if (parent?.deletedAt && parent.trashEntryId === file.trashEntryId) {
        continue;
      }
      itemsByOwner.set(file.ownerUserId, [
        ...(itemsByOwner.get(file.ownerUserId) ?? []),
        { id: file.id, kind: "file" },
      ]);
    }
    for (const folder of durableExpiredFolders.filter((candidate) =>
      isRetentionRootFolder(candidate, durableParentById),
    )) {
      itemsByOwner.set(folder.ownerUserId, [
        ...(itemsByOwner.get(folder.ownerUserId) ?? []),
        { id: folder.id, kind: "folder" },
      ]);
    }
    for (const [ownerUserId, orderedItems] of itemsByOwner) {
      await assertStorageFilesystemSupported(storagePaths.filesRoot);
      const intent = {
        version: 1,
        metadataOperations: [],
        cutoff: cutoff.toISOString(),
        orderedItems,
      };
      const prepared = await prepareStorageMutationParent({
        kind: "trash_retention",
        ownerUserId,
        idempotencyKey: `trash-retention:${_job.id}:${ownerUserId}`,
        requestHash: hashWorkerStorageRequest(intent),
        intentJson: intent,
      });
      if (prepared.mutation.status === "succeeded") continue;
      const leaseOwner = `trash-retention:${process.pid}:${_job.id}`;
      const claimed = await claimStorageMutation({
        id: prepared.mutation.id,
        leaseOwner,
      });
      if (!claimed) {
        throw new Error("Trash-retention parent is already recovering.");
      }
      await recoverStorageMutationParent({
        parent: claimed,
        leaseOwner,
        storagePaths,
      });
    }
    return;
  }

  for (const file of expiredFiles) {
    if (file.folderId) {
      const parentFolder = expiredFileParentFolderById.get(file.folderId);

      if (
        parentFolder?.deletedAt &&
        parentFolder.trashEntryId === file.trashEntryId
      ) {
        continue;
      }
    }

    // Revalidate: skip if already restored
    const current = (await prisma.file.findUnique({
      where: { id: file.id },
      select: {
        id: true,
        folderId: true,
        deletedAt: true,
        storageKey: true,
        ownerUserId: true,
        storageRevision: true,
        trashEntryId: true,
        sizeBytes: true,
        contentChecksum: true,
      },
    } as object)) as FileRecord | null;

    if (!current || current.deletedAt === null) {
      continue;
    }

    const checksum =
      current.contentChecksum ??
      (await calculateStorageFileChecksum(filesRoot, current.storageKey));
    const quarantineKey = path.posix.join(
      "tmp",
      "quarantine",
      `retention-file-${current.id}`,
      path.posix.basename(current.storageKey),
    );
    const operations: StorageMetadataOperation[] = [
      {
        action: "delete",
        entityType: "file",
        entityId: current.id,
        preRevision: current.storageRevision,
      },
    ];
    if (current.trashEntryId) {
      operations.push({
        action: "delete_trash_entry",
        entityId: current.trashEntryId,
      });
    }
    await runWorkerStorageMutation({
      mutationId: `retention-file-${current.id}-${current.storageRevision}`,
      kind: "trash_retention",
      ownerUserId: current.ownerUserId,
      idempotencyKey: `trash-retention:file:${current.id}:${current.trashEntryId ?? "legacy"}:${current.storageRevision}`,
      storagePaths,
      metadataOperations: operations,
      steps: [
        {
          action: "rename",
          sourceKey: current.storageKey,
          targetKey: quarantineKey,
          expectedNodeType: "file",
          expectedSizeBytes: current.sizeBytes,
          expectedChecksum: checksum,
        },
        {
          action: "delete_file",
          targetKey: quarantineKey,
          expectedNodeType: "file",
          expectedSizeBytes: current.sizeBytes,
          expectedChecksum: checksum,
        },
      ],
      entities: [
        {
          entityType: "file",
          entityId: current.id,
          preRevision: current.storageRevision,
          postRevision: current.storageRevision + 1,
          beforeJson: { storageKey: current.storageKey },
          afterJson: null,
        },
      ],
    });
  }

  // --- Step 2: Expire trashed folder trees ---
  const expiredFolders = (await prisma.folder.findMany({
    where: {
      deletedAt: { lte: cutoff },
    },
    select: { id: true, ownerUserId: true, parentId: true, deletedAt: true },
  } as object)) as FolderRecord[];
  const expiredFolderParentIds = Array.from(
    new Set(
      expiredFolders.flatMap((folder) =>
        folder.parentId ? [folder.parentId] : [],
      ),
    ),
  );
  const parentFolders = (await prisma.folder.findMany({
    where: {
      id: { in: expiredFolderParentIds },
    },
    select: { id: true, ownerUserId: true, parentId: true, deletedAt: true },
  } as object)) as FolderRecord[];
  const parentFolderById = new Map(
    parentFolders.map((folder) => [folder.id, folder]),
  );
  const expiredFolderRoots = expiredFolders.filter((folder) =>
    isRetentionRootFolder(folder, parentFolderById),
  );

  for (const folderRoot of expiredFolderRoots) {
    const currentRoot = (await prisma.folder.findUnique({
      where: { id: folderRoot.id },
      select: {
        id: true,
        ownerUserId: true,
        parentId: true,
        deletedAt: true,
        storageRevision: true,
        trashEntryId: true,
      },
    } as object)) as FolderRecord | null;
    if (!currentRoot?.deletedAt || !currentRoot.trashEntryId) {
      continue;
    }
    const descendantIds = await collectDescendantFolderIds(
      prisma,
      currentRoot.ownerUserId,
      currentRoot.id,
    );
    const candidateFolders = (await prisma.folder.findMany({
      where: { id: { in: [currentRoot.id, ...descendantIds] } },
      select: {
        id: true,
        ownerUserId: true,
        parentId: true,
        deletedAt: true,
        storageRevision: true,
        trashEntryId: true,
      },
    } as object)) as FolderRecord[];
    const foldersInTree = candidateFolders.filter(
      (folder) => folder.trashEntryId === currentRoot.trashEntryId,
    );
    const memberIds = foldersInTree.map((folder) => folder.id);
    const filesInTree = (await prisma.file.findMany({
      where: {
        folderId: { in: memberIds },
        trashEntryId: currentRoot.trashEntryId,
      },
      select: {
        id: true,
        ownerUserId: true,
        folderId: true,
        storageKey: true,
        deletedAt: true,
        storageRevision: true,
        trashEntryId: true,
        sizeBytes: true,
        contentChecksum: true,
      },
    } as object)) as FileRecord[];
    const trashEntry = await prisma.trashEntry.findUnique({
      where: { id: currentRoot.trashEntryId },
    } as object);
    if (!trashEntry) continue;

    const operations: StorageMetadataOperation[] = [
      ...filesInTree.map((file): StorageMetadataOperation => ({
        action: "delete",
        entityType: "file",
        entityId: file.id,
        preRevision: file.storageRevision,
      })),
      ...[...foldersInTree]
        .sort((left, right) => {
          const depth = (folder: FolderRecord) => {
            let value = 0;
            let cursor: FolderRecord | undefined = folder;
            const byId = new Map(foldersInTree.map((item) => [item.id, item]));
            while (cursor?.parentId && byId.has(cursor.parentId)) {
              value += 1;
              cursor = byId.get(cursor.parentId);
            }
            return value;
          };
          return depth(right) - depth(left);
        })
        .map((folder): StorageMetadataOperation => ({
          action: "delete",
          entityType: "folder",
          entityId: folder.id,
          preRevision: folder.storageRevision,
        })),
      {
        action: "delete_trash_entry",
        entityId: currentRoot.trashEntryId,
      },
    ];
    const steps: Array<{
      action: "rename" | "delete_file" | "delete_tree";
      sourceKey?: string;
      targetKey?: string;
      expectedNodeType: "file" | "directory";
      expectedSizeBytes?: bigint;
      expectedChecksum?: string;
      treeManifestDigest?: string;
    }> = [];
    if (trashEntry.layoutVersion === "isolated" && trashEntry.storageRootKey) {
      const digest = trashEntry.treeManifestDigest;
      if (!digest) {
        throw new StorageMutationAmbiguityError(
          "Isolated trash tree lacks its captured manifest.",
        );
      }
      const quarantineKey = path.posix.join(
        "tmp",
        "quarantine",
        `retention-folder-${currentRoot.id}`,
      );
      steps.push(
        {
          action: "rename",
          sourceKey: trashEntry.storageRootKey,
          targetKey: quarantineKey,
          expectedNodeType: "directory",
          treeManifestDigest: digest,
        },
        {
          action: "delete_tree",
          targetKey: quarantineKey,
          expectedNodeType: "directory",
          treeManifestDigest: digest,
        },
      );
    } else {
      for (const file of filesInTree) {
        const checksum =
          file.contentChecksum ??
          (await calculateStorageFileChecksum(filesRoot, file.storageKey));
        const quarantineKey = path.posix.join(
          "tmp",
          "quarantine",
          `retention-folder-${currentRoot.id}`,
          file.id,
        );
        steps.push(
          {
            action: "rename",
            sourceKey: file.storageKey,
            targetKey: quarantineKey,
            expectedNodeType: "file",
            expectedSizeBytes: file.sizeBytes,
            expectedChecksum: checksum,
          },
          {
            action: "delete_file",
            targetKey: quarantineKey,
            expectedNodeType: "file",
            expectedSizeBytes: file.sizeBytes,
            expectedChecksum: checksum,
          },
        );
      }
    }
    await runWorkerStorageMutation({
      mutationId: `retention-folder-${currentRoot.id}-${currentRoot.storageRevision}`,
      kind: "trash_retention",
      ownerUserId: currentRoot.ownerUserId,
      idempotencyKey: `trash-retention:folder:${currentRoot.id}:${currentRoot.trashEntryId}:${currentRoot.storageRevision}`,
      storagePaths,
      metadataOperations: operations,
      steps,
      entities: [
        ...filesInTree.map((file) => ({
          entityType: "file" as const,
          entityId: file.id,
          preRevision: file.storageRevision,
          postRevision: file.storageRevision + 1,
          beforeJson: { storageKey: file.storageKey },
          afterJson: null,
        })),
        ...foldersInTree.map((folder) => ({
          entityType: "folder" as const,
          entityId: folder.id,
          preRevision: folder.storageRevision,
          postRevision: folder.storageRevision + 1,
          beforeJson: { deletedAt: folder.deletedAt?.toISOString() ?? null },
          afterJson: null,
        })),
      ],
    });
  }
};
