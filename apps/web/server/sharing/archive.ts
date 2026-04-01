import { Readable } from "node:stream";
import path from "node:path";

import yazl from "yazl";

import { getStoragePath } from "@/server/storage";
import type {
  LibraryFileSummary,
  LibraryFolderSummary,
  StoredLibraryFile,
} from "@/server/library/types";

const buildFolderSegments = ({
  folder,
  folderMap,
  rootFolderId,
}: {
  folder: LibraryFolderSummary;
  folderMap: Map<string, LibraryFolderSummary>;
  rootFolderId: string;
}) => {
  const names: string[] = [];
  let current: LibraryFolderSummary | undefined = folder;

  while (current && current.id !== rootFolderId) {
    names.unshift(current.name);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  return names;
};

const buildFileArchivePath = ({
  file,
  folderMap,
  rootFolder,
}: {
  file: LibraryFileSummary;
  folderMap: Map<string, LibraryFolderSummary>;
  rootFolder: LibraryFolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : rootFolder;
  const segments = parent
    ? buildFolderSegments({
        folder: parent,
        folderMap,
        rootFolderId: rootFolder.id,
      })
    : [];

  return path.posix.join(rootFolder.name, ...segments, file.name);
};

export const createSharedFolderArchive = ({
  rootFolder,
  folders,
  files,
}: {
  rootFolder: LibraryFolderSummary;
  folders: LibraryFolderSummary[];
  files: StoredLibraryFile[];
}) => {
  const zipFile = new yazl.ZipFile();
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));

  zipFile.addEmptyDirectory(`${rootFolder.name}/`);

  for (const folder of folders) {
    if (folder.id === rootFolder.id) {
      continue;
    }

    const folderPath = path.posix.join(
      rootFolder.name,
      ...buildFolderSegments({
        folder,
        folderMap,
        rootFolderId: rootFolder.id,
      }),
    );

    zipFile.addEmptyDirectory(`${folderPath}/`);
  }

  for (const file of files) {
    zipFile.addFile(
      getStoragePath(file.storageKey),
      buildFileArchivePath({
        file,
        folderMap,
        rootFolder,
      }),
    );
  }

  zipFile.end();

  return {
    fileName: `${rootFolder.name}.zip`,
    stream: Readable.toWeb(
      zipFile.outputStream as unknown as Readable,
    ) as ReadableStream,
  };
};
