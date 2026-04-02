import { redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isLibraryError } from "@/server/library/errors";
import { libraryService } from "@/server/library/service";
import { recordFolderAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { retrievalService } from "@/server/retrieval/service";
import { sharingService } from "@/server/sharing/service";

import { LibraryExplorer } from "../../library-explorer";

export const dynamic = "force-dynamic";

type LibraryFolderPageProps = {
  params: Promise<{
    folderId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LibraryFolderPage({
  params,
  searchParams,
}: LibraryFolderPageProps) {
  const [{ folderId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const session = await requireSignedInPageSession(
    `/sign-in?next=${encodeURIComponent(`/library/f/${folderId}`)}`,
  );

  try {
    const listing = await libraryService.getLibraryListing({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
    });

    if (listing.currentFolder.isLibraryRoot) {
      redirect("/library");
    }

    await recordFolderAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: listing.currentFolder.id,
      source: "library-folder-page",
    });
    const [shareLookup, favorites] = await Promise.all([
      sharingService.getLibraryShareLookup({
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
      <LibraryExplorer
        currentPath={`/library/f/${folderId}`}
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
  } catch (error) {
    if (isLibraryError(error)) {
      redirect(`/library?error=${encodeURIComponent(error.message)}`);
    }

    throw error;
  }
}
