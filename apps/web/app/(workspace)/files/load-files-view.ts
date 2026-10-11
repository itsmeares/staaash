import type { FilesListing } from "@/server/files/types";
import { retrievalService } from "@/server/retrieval/service";
import { sharingService } from "@/server/sharing/service";

/** Share links and favorites for a Files listing, as `FilesView` props. */
export async function loadFilesViewProps({
  actorUserId,
  actorRole,
  listing,
  baseUrl,
}: {
  actorUserId: string;
  actorRole: Parameters<typeof retrievalService.listFavorites>[0]["actorRole"];
  listing: FilesListing;
  baseUrl: string;
}) {
  const [shareLookup, favorites] = await Promise.all([
    sharingService.getFilesShareLookup({
      actorUserId,
      actorRole,
      currentFolderId: listing.currentFolder.id,
      childFolderIds: listing.childFolders.map((folder) => folder.id),
      fileIds: listing.files.map((file) => file.id),
      baseUrl,
    }),
    retrievalService.listFavorites({ actorUserId, actorRole }),
  ]);
  const idsOf = (kind: "file" | "folder") =>
    favorites.filter((item) => item.kind === kind).map((item) => item.id);
  return {
    listing,
    shareLookup,
    favoriteFileIds: idsOf("file"),
    favoriteFolderIds: idsOf("folder"),
  };
}
