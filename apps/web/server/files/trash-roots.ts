import type { FileSummary, FolderSummary } from "./types";

export function isTrashFolderRoot(
  folder: FolderSummary,
  folders: Map<string, FolderSummary>,
) {
  if (!folder.deletedAt || folder.isFilesRoot) return false;
  const parent = folders.get(folder.parentId ?? "");
  return !(parent?.deletedAt && parent.trashEntryId === folder.trashEntryId);
}

export function hasTrashAncestor(
  file: FileSummary,
  folders: Map<string, FolderSummary>,
) {
  let ancestor = folders.get(file.folderId ?? "");
  const seen = new Set<string>();
  while (ancestor) {
    if (seen.has(ancestor.id)) break;
    seen.add(ancestor.id);
    if (ancestor.deletedAt && ancestor.trashEntryId === file.trashEntryId)
      return true;
    ancestor = folders.get(ancestor.parentId ?? "");
  }
  return false;
}
