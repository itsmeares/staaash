import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FilesFolderPage({
  params,
  searchParams,
}: FilesFolderPageProps) {
  const [{ folderId }, resolvedSearchParams, h] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const baseUrl = getShareBaseUrl(h);
  const session = await requireSignedInPageSession(
    `/?next=${encodeURIComponent(`/files/f/${folderId}`)}`,
  );

  try {
    let listing: FilesListing;
    try {
      listing = await filesService.getFilesListing({
        actorUserId: session.user.id,
        actorRole: session.user.role,
        folderId,
      });
    } catch (error) {
      if (error instanceof StorageEntityUnavailableError) {
        redirect(
          `/files/storage-unavailable?folderId=${encodeURIComponent(folderId)}`,
        );
      }
      throw error;
    }

    if (listing.currentFolder.isFilesRoot) {
      redirect("/files");
    }

    await recordFolderAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: listing.currentFolder.id,
      source: "files-folder-page",
    });
    const props = await loadFilesViewProps({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      listing,
      baseUrl,
      showFolderPreviews: session.user.preferences?.showFolderPreviews ?? true,
    });

    return (
      <FilesView
        {...props}
        currentPath={`/files/f/${folderId}`}
        searchParams={resolvedSearchParams}
      />
    );
  } catch (error) {
    if (isFilesError(error)) {
      redirect(`/files?error=${encodeURIComponent(error.message)}`);
    }

    throw error;
  }
}
