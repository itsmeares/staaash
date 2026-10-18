import type { loadFilesViewProps } from "./load-files-view";

export function folderBatchItems(
  props: Awaited<ReturnType<typeof loadFilesViewProps>>,
) {
  const favoriteFolders = new Set(props.favoriteFolderIds);
  const favoriteFiles = new Set(props.favoriteFileIds);
  return {
    total: props.listing.total,
    items: [
      ...props.listing.childFolders.map((data) => ({
        id: data.id,
        kind: "folder" as const,
        data,
        favorite: favoriteFolders.has(data.id),
        share: props.shareLookup.sharesByFolderId[data.id] ?? null,
        previews: props.listing.folderPreviews[data.id] ?? [],
      })),
      ...props.listing.files.map((data) => ({
        id: data.id,
        kind: "file" as const,
        data,
        favorite: favoriteFiles.has(data.id),
        share: props.shareLookup.sharesByFileId[data.id] ?? null,
        previews: [] as string[],
      })),
    ],
  };
}
