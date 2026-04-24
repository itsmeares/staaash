import { redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";
import { recordFolderAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { retrievalService } from "@/server/retrieval/service";
import { sharingService } from "@/server/sharing/service";

import { FilesExplorer } from "../../files-explorer";

export const dynamic = "force-dynamic";

type FilesFolderPageProps = {
  params: Promise<{
    folderId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FilesFolderPage({
  params,
  searchParams,
}: FilesFolderPageProps) {
  const [{ folderId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const session = await requireSignedInPageSession(
    `/sign-in?next=${encodeURIComponent(`/files/f/${folderId}`)}`,
  );

  try {
    const listing = await filesService.getFilesListing({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
    });

    if (listing.currentFolder.isFilesRoot) {
      redirect("/files");
    }

    await recordFolderAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: listing.currentFolder.id,
      source: "files-folder-page",
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
        currentPath={`/files/f/${folderId}`}
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
    if (isFilesError(error)) {
      redirect(`/files?error=${encodeURIComponent(error.message)}`);
    }

    throw error;
  }
}
