import path from "node:path";
import { createHash } from "node:crypto";
import { buildArchiveFolderSegments } from "@staaash/config/zip";
import { getPrisma } from "./client";
import { readFolderSubtreeIds } from "./folder-tree";

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
  sizeBytes: bigint;
  contentChecksum: string | null;
  storageStatus: string;
  storageKey: string;
  deletedAt: Date | null;
  storageRevision: number;
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

export class ArchiveSelectionUnavailableError extends Error {
  readonly code = "FILE_NOT_FOUND";
  readonly status = 404;
  constructor() {
    super("An archive source is missing or unavailable.");
  }
}

export const describeArchiveSelection = (
  userId: string,
  fileIds: string[],
  folderIds: string[],
  allFolders: FolderRecord[],
  filesToZip: StoredFileRecord[],
) => {
  const { folderMap, descendantsByRootId, allDescendantFolderIds } =
    buildArchiveFolderIndex(allFolders, folderIds);
  const filesById = new Map(filesToZip.map((file) => [file.id, file]));
  if (
    fileIds.some((id) => !filesById.has(id)) ||
    folderIds.some((id) => !folderMap.has(id)) ||
    filesToZip.some(
      (file) =>
        file.deletedAt ||
        file.storageStatus !== "available" ||
        file.ownerUserId !== userId,
    )
  ) {
    throw new ArchiveSelectionUnavailableError();
  }
  const fileName =
    folderIds.length === 1 && fileIds.length === 0
      ? `${folderMap.get(folderIds[0]!)!.name}.zip`
      : folderIds.length === 0 && fileIds.length === 1
        ? `${filesById.get(fileIds[0]!)!.originalName}.zip`
        : "staaash-files.zip";
  const entries = filesToZip
    .map((file) => ({
      file,
      archivePath:
        file.folderId && allDescendantFolderIds.has(file.folderId)
          ? buildFileArchivePath(file, folderMap, descendantsByRootId)
          : file.originalName,
    }))
    .sort(
      (a, b) =>
        a.archivePath.localeCompare(b.archivePath) ||
        a.file.id.localeCompare(b.file.id),
    );
  const directories: string[] = [];
  for (const rootId of folderIds) {
    const root = folderMap.get(rootId)!;
    directories.push(`${root.name}/`);
    for (const id of descendantsByRootId.get(rootId) ?? []) {
      if (id === rootId) continue;
      const folder = folderMap.get(id)!;
      directories.push(
        `${path.posix.join(root.name, ...buildArchiveFolderSegments({ folder, folderMap, rootFolderId: rootId }))}/`,
      );
    }
  }
  directories.sort();
  const contentKey =
    "v2:" +
    createHash("sha256")
      .update(
        JSON.stringify({
          userId,
          fileName,
          fileIds: [...fileIds].sort(),
          folderIds: [...folderIds].sort(),
          directories,
          entries: entries.map(({ file, archivePath }) => [
            archivePath,
            file.id,
            String(file.sizeBytes),
            file.contentChecksum ?? `revision:${file.storageRevision}`,
          ]),
        }),
      )
      .digest("hex");
  return {
    contentKey,
    fileName,
    entries,
    directories,
    filesToZip,
    allFolders: allFolders.filter((folder) =>
      allDescendantFolderIds.has(folder.id),
    ),
  };
};

export const readArchiveSelection = (
  userId: string,
  fileIds: string[],
  folderIds: string[],
) =>
  getPrisma().$transaction(
    async (tx) => {
      const subtree = folderIds.length
        ? await readFolderSubtreeIds(tx, userId, folderIds)
        : [];
      const allFolders = subtree.length
        ? await tx.folder.findMany({
            where: { id: { in: subtree.map((folder) => folder.id) } },
          })
        : [];
      const files = await tx.file.findMany({
        where: {
          ownerUserId: userId,
          deletedAt: null,
          OR: [
            { id: { in: fileIds } },
            { folderId: { in: subtree.map((folder) => folder.id) } },
          ],
        },
      });
      return describeArchiveSelection(
        userId,
        fileIds,
        folderIds,
        allFolders,
        files,
      );
    },
    { isolationLevel: "RepeatableRead" },
  );
