import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { z } from "zod";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { getPreviewAssetDirectoryKey } from "@staaash/db/preview-contract";
import { resolveWorkspacePath } from "@staaash/config";

const trashEnvSchema = z.object({
  FILES_ROOT: z.string().trim().min(1),
  TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

type FileRecord = {
  id: string;
  ownerUserId: string;
  storageKey: string;
  deletedAt: Date | null;
};

type FolderRecord = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  deletedAt: Date | null;
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
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;
};

const resolveStoragePath = (filesRoot: string, storageKey: string) =>
  path.resolve(filesRoot, storageKey);

const removePreviewAssetsForFiles = async (
  fileIds: Array<{ id: string; ownerUserId: string }>,
  filesRoot: string,
) => {
  await Promise.all(
    fileIds.map(({ id, ownerUserId }) => {
      const dirKey = getPreviewAssetDirectoryKey(ownerUserId, id);
      const dirPath = resolveStoragePath(filesRoot, dirKey);
      return rm(dirPath, { recursive: true, force: true });
    }),
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
export const handleTrashRetention = async (
  _job: BackgroundJobRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const { FILES_ROOT, TRASH_RETENTION_DAYS } = trashEnvSchema.parse(env);
  const filesRoot = resolveWorkspacePath(FILES_ROOT, process.cwd());
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const prisma = getPrisma() as unknown as PrismaClient;

  // --- Step 1: Expire standalone trashed files ---
  const expiredFiles = (await prisma.file.findMany({
    where: {
      deletedAt: { lte: cutoff },
    },
    select: { id: true, ownerUserId: true, storageKey: true, deletedAt: true },
  } as object)) as FileRecord[];

  for (const file of expiredFiles) {
    // Revalidate: skip if already restored
    const current = (await prisma.file.findUnique({
      where: { id: file.id },
      select: {
        id: true,
        deletedAt: true,
        storageKey: true,
        ownerUserId: true,
      },
    } as object)) as FileRecord | null;

    if (!current || current.deletedAt === null) {
      continue;
    }

    const filePath = resolveStoragePath(filesRoot, current.storageKey);
    await rm(filePath, { force: true });
    await removePreviewAssetsForFiles([current], filesRoot);
    await prisma.file.deleteMany({
      where: { id: current.id },
    } as object);
  }

  // --- Step 2: Expire trashed folder trees ---
  const expiredFolderRoots = (await prisma.folder.findMany({
    where: {
      deletedAt: { lte: cutoff },
      parentId: null, // Only top-level trashed roots
    },
    select: { id: true, ownerUserId: true, parentId: true, deletedAt: true },
  } as object)) as FolderRecord[];

  for (const folderRoot of expiredFolderRoots) {
    // Revalidate inside a transaction to check it's still trashed
    await prisma.$transaction(async (tx) => {
      const currentRoot = (await tx.folder.findUnique({
        where: { id: folderRoot.id },
        select: { id: true, ownerUserId: true, deletedAt: true },
      } as object)) as FolderRecord | null;

      if (!currentRoot || currentRoot.deletedAt === null) {
        // Concurrently restored — skip
        return;
      }

      const ownerUserId = currentRoot.ownerUserId;

      // Collect all descendant folder IDs
      const descendantIds = await collectDescendantFolderIds(
        tx,
        ownerUserId,
        currentRoot.id,
      );
      const allFolderIds = [currentRoot.id, ...descendantIds];

      // Find all files inside this tree
      const filesInTree = (await tx.file.findMany({
        where: {
          folderId: { in: allFolderIds },
        },
        select: {
          id: true,
          ownerUserId: true,
          storageKey: true,
          deletedAt: true,
        },
      } as object)) as FileRecord[];

      // Delete file blobs
      for (const f of filesInTree) {
        const filePath = resolveStoragePath(filesRoot, f.storageKey);
        await rm(filePath, { force: true });
      }

      // Remove preview assets for all files
      await removePreviewAssetsForFiles(filesInTree, filesRoot);

      // Delete files from DB
      if (filesInTree.length > 0) {
        await tx.file.deleteMany({
          where: { id: { in: filesInTree.map((f) => f.id) } },
        } as object);
      }

      // Delete folder records
      await tx.folder.deleteMany({
        where: { id: { in: allFolderIds } },
      } as object);
    });
  }
};
