import { redirect } from "next/navigation";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isLibraryError } from "@/server/library/errors";
import { libraryService } from "@/server/library/service";

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

    return (
      <LibraryExplorer
        currentPath={`/library/f/${folderId}`}
        listing={listing}
        searchParams={resolvedSearchParams}
      />
    );
  } catch (error) {
    if (isLibraryError(error)) {
      redirect(`/library?error=${encodeURIComponent(error.message)}`);
    }

    throw error;
  }
}
