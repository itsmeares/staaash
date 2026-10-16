import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";
import type { AuthUser } from "@/server/auth/types";
import type { FilesListing } from "@/server/files/types";
import { recordFolderAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { getShareBaseUrl } from "@/server/request";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

import { FilesView } from "../../files-view";
import { loadFilesViewProps } from "../../load-files-view";

export const dynamic = "force-dynamic";

type FilesFolderPageProps = {
  params: Promise<{
    folderId: string;
  }>;
};

/**
 * The folder's listing, or the page that fits why it can't be shown:
 * storage busy, missing, or someone else's (which reads as missing).
 */
const loadFolderListing = async (
  user: { id: string; role: AuthUser["role"] },
  folderId: string,
): Promise<FilesListing> => {
  try {
    return await filesService.getFilesListing({
      actorUserId: user.id,
      actorRole: user.role,
      folderId,
    });
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      redirect(
        `/files/storage-unavailable?folderId=${encodeURIComponent(folderId)}`,
      );
    }
    if (!isFilesError(error)) throw error;
    if (error.code === "FOLDER_NOT_FOUND" || error.code === "ACCESS_DENIED") {
      notFound();
    }
    redirect(`/files?error=${encodeURIComponent(error.message)}`);
  }
};

export default async function FilesFolderPage({
  params,
}: FilesFolderPageProps) {
  const [{ folderId }, h] = await Promise.all([params, headers()]);
  const baseUrl = getShareBaseUrl(h);
  const session = await requireSignedInPageSession(
    `/?next=${encodeURIComponent(`/files/f/${folderId}`)}`,
  );

  const listing = await loadFolderListing(session.user, folderId);
  if (listing.currentFolder.isFilesRoot) redirect("/files");

  await recordFolderAccessBestEffort({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    folderId: listing.currentFolder.id,
    action: "opened",
  });
  const props = await loadFilesViewProps({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    listing,
    baseUrl,
    showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
  });

  return <FilesView {...props} currentPath={`/files/f/${folderId}`} />;
}
