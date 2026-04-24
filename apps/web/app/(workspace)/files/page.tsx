import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import { retrievalService } from "@/server/retrieval/service";
import { sharingService } from "@/server/sharing/service";

import { FilesExplorer } from "./files-explorer";

export const dynamic = "force-dynamic";

type FilesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/files"),
  ]);
  const listing = await filesService.getFilesListing({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const [shareLookup, favorites] = await Promise.all([
    sharingService.getFilesShareLookup({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      currentFolderId: listing.currentFolder.id,
      childFolderIds: listing.childFolders.map((folder) => folder.id),
      fileIds: listing.files.map((file) => file.id),
    }),
    retrievalService.listFavorites({
      actorUserId: session.user.id,
      actorRole: session.user.role,
    }),
  ]);

  return (
    <FilesExplorer
      currentPath="/files"
      favoriteFileIds={favorites
        .filter((item) => item.kind === "file")
        .map((item) => item.id)}
      favoriteFolderIds={favorites
        .filter((item) => item.kind === "folder")
        .map((item) => item.id)}
      listing={listing}
      searchParams={resolvedSearchParams}
      shareLookup={shareLookup}
    />
  );
}
