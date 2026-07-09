import type { FileSummary, FolderSummary } from "./types";

export const buildFolderMap = (folders: FolderSummary[]) =>
  new Map(folders.map((folder) => [folder.id, folder]));

export const buildFolderPathLabel = ({
  folder,
  folderMap,
  filesRoot,
}: {
  folder: FolderSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
}) => {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: FolderSummary | undefined = folder;
  let reachedRoot = false;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);

    if (current.id === filesRoot.id) {
      reachedRoot = true;
      break;
    }

    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  if (!reachedRoot) {
    names.unshift(filesRoot.name);
  }

  return names.join(" / ");
};

export const buildFilePathLabel = ({
  file,
  folderMap,
  filesRoot,
}: {
  file: FileSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : filesRoot;
  const folderPath = parent
    ? buildFolderPathLabel({
        folder: parent,
        folderMap,
        filesRoot,
      })
    : filesRoot.name;

  return `${folderPath} / ${file.name}`;
};
