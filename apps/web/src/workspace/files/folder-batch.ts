type BatchProps = {
  listing: {
    total: number;
    childFolders: Array<{ id: string }>;
    files: Array<{ id: string }>;
    folderPreviews: Record<string, string[]>;
  };
  shareLookup: {
    sharesByFolderId: Record<string, unknown>;
    sharesByFileId: Record<string, unknown>;
  };
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

// Runs on the server and in the browser, which see dates differently.
type Folder<P extends BatchProps> = P["listing"]["childFolders"][number];
type File<P extends BatchProps> = P["listing"]["files"][number];
type Share<P extends BatchProps> = P["shareLookup"]["sharesByFileId"][string];

/** One row per child folder and file, as the list and grid show them. */
export function folderBatchItems<P extends BatchProps>(props: P) {
  const favoriteFolders = new Set(props.favoriteFolderIds);
  const favoriteFiles = new Set(props.favoriteFileIds);
  const shareOf = (lookup: Record<string, unknown>, id: string) =>
    (lookup[id] ?? null) as Share<P> | null;
  return {
    total: props.listing.total,
    items: [
      ...props.listing.childFolders.map((data) => ({
        id: data.id,
        kind: "folder" as const,
        data: data as Folder<P>,
        favorite: favoriteFolders.has(data.id),
        share: shareOf(props.shareLookup.sharesByFolderId, data.id),
        previews: props.listing.folderPreviews[data.id] ?? [],
      })),
      ...props.listing.files.map((data) => ({
        id: data.id,
        kind: "file" as const,
        data: data as File<P>,
        favorite: favoriteFiles.has(data.id),
        share: shareOf(props.shareLookup.sharesByFileId, data.id),
        previews: [] as string[],
      })),
    ],
  };
}
