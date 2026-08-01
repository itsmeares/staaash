// File and folder retention intentionally share journaled purge phase ordering.
// fallow-ignore-file code-duplication
import { z } from "zod";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { getWorkerStoragePaths } from "../storage-maintenance.js";
import { assertStorageFilesystemSupported } from "@staaash/db/storage-mutation-executor";
import {
  claimStorageMutation,
  prepareStorageMutationParent,
} from "@staaash/db/storage-mutations";
import { hashWorkerStorageRequest } from "../durable-storage-mutation.js";
import { recoverStorageMutationParent } from "./storage-mutation-parent-recovery.js";
import type { TrashItemIdentity } from "./trash-retention-eligibility.js";

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

type RetentionItem = TrashItemIdentity & {
  id: string;
  kind: "file" | "folder";
};

const addRetentionItem = (
  itemsByOwner: Map<string, RetentionItem[]>,
  ownerUserId: string,
  item: RetentionItem,
) => {
  const items = itemsByOwner.get(ownerUserId);
  if (items) {
    items.push(item);
    return;
  }
  itemsByOwner.set(ownerUserId, [item]);
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
      deletedAt: file.deletedAt!.toISOString(),
      storageRevision: file.storageRevision,
      trashEntryId: file.trashEntryId,
    });
  }
  for (const folder of expiredFolderRoots) {
    addRetentionItem(itemsByOwner, folder.ownerUserId, {
      id: folder.id,
      kind: "folder",
      deletedAt: folder.deletedAt!.toISOString(),
      storageRevision: folder.storageRevision,
      trashEntryId: folder.trashEntryId,
    });
  }
  for (const items of itemsByOwner.values()) {
    items.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
    );
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
  const requestHash = hashWorkerStorageRequest({
    kind: "trash_retention",
    jobId: job.id,
    ownerUserId,
    cutoff: cutoff.toISOString(),
  });
  const prepared = await prepareStorageMutationParent({
    kind: "trash_retention",
    ownerUserId,
    idempotencyKey: `trash-retention:${job.id}:${ownerUserId}`,
    requestHash,
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

export const handleTrashRetention = async (
  job: BackgroundJobRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const { TRASH_RETENTION_DAYS } = trashEnvSchema.parse(env);
  const storagePaths = getWorkerStoragePaths(env);
  const cutoff = new Date(
    job.createdAt.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const prisma = getPrisma() as unknown as PrismaClient;
  const { expiredFiles, parentFolderById } = await loadExpiredFiles(
    prisma,
    cutoff,
  );
  await runDurableTrashRetention({
    job,
    cutoff,
    storagePaths,
    prisma,
    expiredFiles,
    parentFolderById,
  });
};
