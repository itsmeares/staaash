import path from "node:path";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import yazl from "yazl";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  findZipArchiveById,
  updateZipArchiveProcessing,
  updateZipArchiveReady,
  updateZipArchiveFailed,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";

type FolderRecord = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isFilesRoot: boolean;
  deletedAt: Date | null;
};

type StoredFileRecord = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  storageKey: string;
  deletedAt: Date | null;
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

const buildFolderSegments = ({
  folder,
  folderMap,
  rootFolderId,
}: {
  folder: FolderRecord;
  folderMap: Map<string, FolderRecord>;
  rootFolderId: string;
}): string[] => {
  const names: string[] = [];
  let current: FolderRecord | undefined = folder;
  while (current && current.id !== rootFolderId) {
    names.unshift(current.name);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }
  return names;
};

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

export const handleZipArchiveGenerate = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  const payload = job.payloadJson as ZipArchiveGeneratePayload;
  const { archiveId } = payload;

  const archive = await findZipArchiveById(archiveId);
  if (!archive || archive.status === ZIP_ARCHIVE_STATUS_READY) {
    return;
  }

  const idsJson = archive.idsJson as { fileIds: string[]; folderIds: string[] };
  const { fileIds, folderIds } = idsJson;
  const userId = archive.userId;

  await updateZipArchiveProcessing(archiveId);

  const tmpDir = path.resolve(storagePaths.tmpRoot, "archives");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.resolve(tmpDir, `${archiveId}.zip.tmp`);

  try {
    const prisma = getPrisma() as unknown as PrismaClient;

    const allFolders = await prisma.folder.findMany({
      where: { ownerUserId: userId, deletedAt: null } as object,
    });

    const allFiles = await prisma.file.findMany({
      where: { ownerUserId: userId, deletedAt: null } as object,
    });

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

    // Collect files: directly requested + inside expanded folders
    const requestedFileSet = new Set(fileIds);
    const filesToZip = allFiles.filter(
      (f) =>
        requestedFileSet.has(f.id) ||
        (f.folderId !== null && allDescendantFolderIds.has(f.folderId)),
    );

    // Determine zip filename
    let fileName: string;
    if (folderIds.length === 1 && fileIds.length === 0) {
      fileName = `${folderMap.get(folderIds[0])?.name ?? "archive"}.zip`;
    } else if (folderIds.length === 0 && fileIds.length === 1) {
      fileName = `${allFiles.find((f) => f.id === fileIds[0])?.originalName ?? "file"}.zip`;
    } else {
      fileName = "staaash-files.zip";
    }

    // Build zip
    const zipFile = new yazl.ZipFile();

    // Add folder directories for each requested root + all descendants
    for (const rootFolderId of folderIds) {
      const rootFolder = folderMap.get(rootFolderId);
      if (!rootFolder) continue;
      zipFile.addEmptyDirectory(`${rootFolder.name}/`);

      for (const descendantId of allDescendantFolderIds) {
        if (descendantId === rootFolderId) continue;
        const descendant = folderMap.get(descendantId);
        if (!descendant) continue;

        // Only include descendants of this root
        const segments = buildFolderSegments({
          folder: descendant,
          folderMap,
          rootFolderId,
        });
        if (segments.length === 0) continue;

        const folderPath = path.posix.join(rootFolder.name, ...segments);
        zipFile.addEmptyDirectory(`${folderPath}/`);
      }
    }

    // Add files
    for (const file of filesToZip) {
      const filePath = path.resolve(storagePaths.filesRoot, file.storageKey);

      let archivePath: string;

      if (file.folderId && allDescendantFolderIds.has(file.folderId)) {
        // File is inside a requested folder subtree — find which root it belongs to
        const parentFolder = folderMap.get(file.folderId);
        if (!parentFolder) {
          archivePath = file.originalName;
        } else {
          let rootFolderId: string | null = null;
          for (const [reqFolderId, descendants] of descendantsByRootId) {
            if (descendants.has(file.folderId)) {
              rootFolderId = reqFolderId;
              break;
            }
          }

          if (rootFolderId) {
            const rootFolder = folderMap.get(rootFolderId);
            if (rootFolder) {
              const segments = buildFolderSegments({
                folder: parentFolder,
                folderMap,
                rootFolderId,
              });
              archivePath = path.posix.join(
                rootFolder.name,
                ...segments,
                file.originalName,
              );
            } else {
              archivePath = file.originalName;
            }
          } else {
            archivePath = file.originalName;
          }
        }
      } else {
        archivePath = file.originalName;
      }

      zipFile.addFile(filePath, archivePath);
    }

    zipFile.end();

    // Write zip stream to temp file
    await pipeline(
      zipFile.outputStream as unknown as Readable,
      createWriteStream(tmpPath),
    );

    // Move to final location
    const storageKey = `archives/${archiveId}.zip`;
    const finalPath = path.resolve(storagePaths.filesRoot, storageKey);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tmpPath, finalPath);

    const { size } = await stat(finalPath);

    await updateZipArchiveReady(
      archiveId,
      storageKey,
      fileName,
      BigInt(size),
      filesToZip.length,
    );
  } catch (error) {
    await rm(tmpPath, { force: true });
    const message =
      error instanceof Error ? error.message : "Unknown zip error.";
    await updateZipArchiveFailed(archiveId, message);
    throw error;
  }
};
