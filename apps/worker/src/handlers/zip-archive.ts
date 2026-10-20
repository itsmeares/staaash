import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import { z } from "zod";
import {
  buildArchiveFolderSegments,
  createZipArchiveStream,
} from "@staaash/config/zip";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { waitForStorageAdmission } from "@staaash/db/storage-transactions";
import {
  findZipArchiveById,
  updateZipArchiveProcessing,
  updateZipArchiveFailed,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";
import { listBlockingStorageMutationsForEntities } from "@staaash/db/storage-mutations";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import type { JobContext } from "../job-context.js";
import { TerminalJobError } from "../job-context.js";
import {
  assertWorkerMutationMayStart,
  buildArtifactPublishSteps,
  runWorkerStorageMutation,
  StorageMutationOwnedError,
} from "../durable-storage-mutation.js";

type FolderRecord = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isFilesRoot: boolean;
  deletedAt: Date | null;
  storageRevision: number;
};

type StoredFileRecord = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  storageKey: string;
  deletedAt: Date | null;
  storageRevision: number;
};

type PrismaClient = {
  folder: {
    findMany(args: object): Promise<FolderRecord[]>;
  };
  file: {
    findMany(args: object): Promise<StoredFileRecord[]>;
    findUnique(args: object): Promise<{ originalName: string } | null>;
  };
};

type ZipArchiveGeneratePayload = {
  archiveId: string;
};

const zipArchiveIdsSchema = z.object({
  fileIds: z.array(z.string()),
  folderIds: z.array(z.string()),
});

const collectDescendantFolderIds = (
  rootId: string,
  childrenByParentId: Map<string, FolderRecord[]>,
): Set<string> => {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.add(id);
    for (const child of childrenByParentId.get(id) ?? []) {
      if (!result.has(child.id)) {
        queue.push(child.id);
      }
    }
  }
  return result;
};

const buildArchiveFolderIndex = (
  allFolders: FolderRecord[],
  folderIds: string[],
) => {
  const folderMap = new Map(allFolders.map((f) => [f.id, f]));

  const childrenByParentId = new Map<string, FolderRecord[]>();
  for (const folder of allFolders) {
    if (folder.parentId) {
      const list = childrenByParentId.get(folder.parentId) ?? [];
      list.push(folder);
      childrenByParentId.set(folder.parentId, list);
    }
  }

  // Expand each requested folder to all descendants (per-root sets for path building)
  const allDescendantFolderIds = new Set<string>();
  const descendantsByRootId = new Map<string, Set<string>>();
  for (const folderId of folderIds) {
    const descendants = collectDescendantFolderIds(
      folderId,
      childrenByParentId,
    );
    descendantsByRootId.set(folderId, descendants);
    for (const id of descendants) {
      allDescendantFolderIds.add(id);
    }
  }

  return { folderMap, descendantsByRootId, allDescendantFolderIds };
};

const buildFileArchivePath = (
  file: StoredFileRecord,
  folderMap: Map<string, FolderRecord>,
  descendantsByRootId: Map<string, Set<string>>,
): string => {
  const parentFolder = file.folderId ? folderMap.get(file.folderId) : undefined;
  if (!parentFolder) return file.originalName;

  // Overlapping selections keep the first requested root as the file's path.
  for (const [rootFolderId, descendants] of descendantsByRootId) {
    if (!descendants.has(parentFolder.id)) continue;
    const rootFolder = folderMap.get(rootFolderId);
    if (!rootFolder) return file.originalName;
    return path.posix.join(
      rootFolder.name,
      ...buildArchiveFolderSegments({
        folder: parentFolder,
        folderMap,
        rootFolderId,
      }),
      file.originalName,
    );
  }
  return file.originalName;
};

export const handleZipArchiveGenerate = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  context?: JobContext,
): Promise<void> => {
  const payload = job.payloadJson as ZipArchiveGeneratePayload;
  const { archiveId } = payload;

  const archive = await findZipArchiveById(archiveId);
  if (!archive || archive.status === ZIP_ARCHIVE_STATUS_READY) {
    return;
  }

  const parsedIds = zipArchiveIdsSchema.safeParse(archive.idsJson);
  if (!parsedIds.success) {
    throw new TerminalJobError("Invalid zip archive selection.", "payload");
  }

  const idsJson = parsedIds.data;
  const { fileIds, folderIds } = idsJson;
  const userId = archive.userId;
  const publishMutationId = `archive-publish-${archiveId}-${job.id}`;
  if ((await assertWorkerMutationMayStart(publishMutationId)) === "succeeded") {
    return;
  }

  await updateZipArchiveProcessing(archiveId);

  const tmpDir = path.resolve(storagePaths.tmpRoot, "archives");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.resolve(tmpDir, `${archiveId}.zip.tmp`);

  try {
    const prisma = getPrisma() as unknown as PrismaClient;
    await context?.updateProgress({ stage: "loading_selection", archiveId });

    const {
      allFolders,
      folderMap,
      descendantsByRootId,
      allDescendantFolderIds,
      filesToZip,
    } = await waitForStorageAdmission(
      async () => {
        const allFolders = folderIds.length
          ? await prisma.folder.findMany({
              where: { ownerUserId: userId, deletedAt: null } as object,
            })
          : [];

        const { folderMap, descendantsByRootId, allDescendantFolderIds } =
          buildArchiveFolderIndex(allFolders, folderIds);

        // Collect files: directly requested + inside expanded folders
        const filesToZip = await prisma.file.findMany({
          where: {
            ownerUserId: userId,
            deletedAt: null,
            OR: [
              { id: { in: fileIds } },
              { folderId: { in: [...allDescendantFolderIds] } },
            ],
          },
        });

        const blockedFiles = await listBlockingStorageMutationsForEntities({
          entityType: "file",
          entityIds: filesToZip.map((file) => file.id),
        });
        if (blockedFiles.length > 0) {
          throw new StorageMutationOwnedError(
            blockedFiles[0]!.mutation.id,
            new Error("An archive source has an unfinished storage mutation."),
          );
        }
        return {
          allFolders,
          folderMap,
          descendantsByRootId,
          allDescendantFolderIds,
          filesToZip,
        };
      },
      {
        signal: context?.signal,
        retryable: (error) => error instanceof StorageMutationOwnedError,
      },
    );

    // Determine zip filename
    let fileName: string;
    if (folderIds.length === 1 && fileIds.length === 0) {
      fileName = `${folderMap.get(folderIds[0])?.name ?? "archive"}.zip`;
    } else if (folderIds.length === 0 && fileIds.length === 1) {
      fileName = `${filesToZip.find((f) => f.id === fileIds[0])?.originalName ?? "file"}.zip`;
    } else {
      fileName = "staaash-files.zip";
    }

    await context?.updateProgress({
      stage: "writing_archive",
      archiveId,
      fileCount: filesToZip.length,
    });

    const entries = filesToZip.map((file) => ({
      filePath: safeResolveStoragePath(storagePaths.filesRoot, file.storageKey),
      archivePath:
        file.folderId && allDescendantFolderIds.has(file.folderId)
          ? buildFileArchivePath(file, folderMap, descendantsByRootId)
          : file.originalName,
    }));
    const directories: string[] = [];

    // Add folder directories for each requested root + all descendants
    for (const rootFolderId of folderIds) {
      const rootFolder = folderMap.get(rootFolderId);
      if (!rootFolder) continue;
      directories.push(`${rootFolder.name}/`);

      for (const descendantId of descendantsByRootId.get(rootFolderId) ?? []) {
        if (descendantId === rootFolderId) continue;
        const descendant = folderMap.get(descendantId);
        if (!descendant) continue;

        // Only include descendants of this root
        const segments = buildArchiveFolderSegments({
          folder: descendant,
          folderMap,
          rootFolderId,
        });
        if (segments.length === 0) continue;

        const folderPath = path.posix.join(rootFolder.name, ...segments);
        directories.push(`${folderPath}/`);
      }
    }

    const output = await createZipArchiveStream(entries, directories);

    // Write zip stream to temp file
    await pipeline(output, createWriteStream(tmpPath));

    // Move to final location
    const storageKey = `archives/${archiveId}.zip`;
    safeResolveStoragePath(storagePaths.filesRoot, storageKey);
    const { size } = await stat(tmpPath);
    const tmpKey = path
      .relative(storagePaths.filesRoot, tmpPath)
      .split(path.sep)
      .join("/");
    const checksum = await calculateStorageFileChecksum(
      storagePaths.filesRoot,
      tmpKey,
    );
    let oldChecksum: string | null = null;
    try {
      oldChecksum = await calculateStorageFileChecksum(
        storagePaths.filesRoot,
        storageKey,
      );
    } catch {
      oldChecksum = null;
    }
    const readyData = {
      status: "ready",
      storageKey,
      fileName,
      sizeBytes: String(size),
      fileCount: filesToZip.length,
      error: null,
    };
    await runWorkerStorageMutation({
      mutationId: publishMutationId,
      kind: "archive_publish",
      ownerUserId: userId,
      idempotencyKey: `archive-publish:${job.id}`,
      storagePaths,
      signal: context?.signal,
      metadataOperations: [
        {
          action: "update",
          entityType: "archive",
          entityId: archiveId,
          preRevision: archive.storageRevision,
          data: readyData,
        },
      ],
      steps: buildArtifactPublishSteps({
        mutationId: publishMutationId,
        tmpKey,
        storageKey,
        sizeBytes: BigInt(size),
        checksum,
        oldChecksum,
      }),
      entities: [
        ...filesToZip.map((file) => ({
          entityType: "file" as const,
          entityId: file.id,
          preRevision: file.storageRevision,
          postRevision: file.storageRevision,
          beforeJson: null,
          afterJson: null,
        })),
        ...allFolders
          .filter((folder) => allDescendantFolderIds.has(folder.id))
          .map((folder) => ({
            entityType: "folder" as const,
            entityId: folder.id,
            preRevision: folder.storageRevision,
            postRevision: folder.storageRevision,
            beforeJson: null,
            afterJson: null,
          })),
        {
          entityType: "archive",
          entityId: archiveId,
          preRevision: archive.storageRevision,
          postRevision: archive.storageRevision + 1,
          beforeJson: { status: archive.status },
          afterJson: readyData,
        },
      ],
    });
    await context?.updateProgress({ stage: "ready", archiveId });
  } catch (error) {
    if (error instanceof StorageMutationOwnedError) {
      throw error;
    }
    await rm(tmpPath, { force: true });
    const message =
      error instanceof Error ? error.message : "Unknown zip error.";
    await updateZipArchiveFailed(archiveId, message);
    throw error;
  }
};
