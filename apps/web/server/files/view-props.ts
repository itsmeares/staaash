import { getFolderSizeBytes } from "@/server/files/folder-size";
import type { FilesListing } from "@/server/files/types";
import { getPrisma } from "@staaash/db/client";
import type { FilesActor } from "@/server/files/types";
import { sharingService } from "@/server/sharing/service";

/** Share links and favorites for a Files listing, as `FilesView` props. */
export async function loadFilesViewProps({
  actorUserId,
  actorRole,
  listing,
  baseUrl,
  showFolderPreviews,
}: {
  actorUserId: string;
  actorRole: FilesActor["actorRole"];
  listing: FilesListing;
  baseUrl: string;
  showFolderPreviews: boolean;
}) {
  const [shareLookup, favorites, folderSizeBytes] = await Promise.all([
    sharingService.getFilesShareLookup({
      actorUserId,
      actorRole,
      currentFolderId: listing.currentFolder.id,
      childFolderIds: listing.childFolders.map((folder) => folder.id),
      fileIds: listing.files.map((file) => file.id),
      baseUrl,
    }),
    Promise.all([
      getPrisma().favoriteFile.findMany({
        where: {
          userId: actorUserId,
          fileId: { in: listing.files.map((file) => file.id) },
        },
        select: { fileId: true },
      }),
      getPrisma().favoriteFolder.findMany({
        where: {
          userId: actorUserId,
          folderId: { in: listing.childFolders.map((folder) => folder.id) },
        },
        select: { folderId: true },
      }),
    ]),
    getFolderSizeBytes(listing.currentFolder.id),
  ]);

  return {
    listing,
    shareLookup,
    showFolderPreviews,
    favoriteFileIds: favorites[0].map((item) => item.fileId),
    favoriteFolderIds: favorites[1].map((item) => item.folderId),
    folderSizeBytes,
  };
}
