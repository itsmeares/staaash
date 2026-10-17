import { Readable } from "node:stream";
import path from "node:path";

import {
  buildArchiveFolderSegments,
  createZipArchiveStream,
} from "@staaash/config/zip";

import { getStoragePath } from "@/server/storage";
import type {
  FileSummary,
  FolderSummary,
  StoredFile,
} from "@/server/files/types";
import {
  assertStorageEntityReadable,
  getStorageMutationStateMap,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

const buildFileArchivePath = ({
  file,
  folderMap,
  rootFolder,
}: {
  file: FileSummary;
  folderMap: Map<string, FolderSummary>;
  rootFolder: FolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : rootFolder;
  const segments = parent
    ? buildArchiveFolderSegments({
        folder: parent,
        folderMap,
        rootFolderId: rootFolder.id,
      })
    : [];

  return path.posix.join(rootFolder.name, ...segments, file.name);
};

export const createSharedFolderArchive = async ({
  rootFolder,
  folders,
  files,
}: {
  rootFolder: FolderSummary;
  folders: FolderSummary[];
  files: StoredFile[];
}) => {
  await assertStorageEntityReadable("folder", rootFolder.id);
  const [folderStates, fileStates] = await Promise.all([
    getStorageMutationStateMap(
      "folder",
      folders.map(({ id }) => id),
    ),
    getStorageMutationStateMap(
      "file",
      files.map(({ id }) => id),
    ),
  ]);
  const blocked = [...folderStates.values(), ...fileStates.values()][0];
  if (blocked) throw new StorageEntityUnavailableError(blocked);
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));

  const directories = [`${rootFolder.name}/`];

  for (const folder of folders) {
    if (folder.id === rootFolder.id) {
      continue;
    }

    const folderPath = path.posix.join(
      rootFolder.name,
      ...buildArchiveFolderSegments({
        folder,
        folderMap,
        rootFolderId: rootFolder.id,
      }),
    );

    directories.push(`${folderPath}/`);
  }

  const output = await createZipArchiveStream(
    files.map((file) => ({
      filePath: getStoragePath(file.storageKey),
      archivePath: buildFileArchivePath({ file, folderMap, rootFolder }),
    })),
    directories,
  );

  return {
    fileName: `${rootFolder.name}.zip`,
    stream: Readable.toWeb(output) as ReadableStream,
  };
};
