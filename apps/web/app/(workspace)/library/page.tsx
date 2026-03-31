import { requireSignedInPageSession } from "@/server/auth/guards";
import { libraryService } from "@/server/library/service";

import { LibraryExplorer } from "./library-explorer";

export const dynamic = "force-dynamic";

type LibraryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/library"),
  ]);
  const listing = await libraryService.getLibraryListing({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });

  return (
    <LibraryExplorer
      currentPath="/library"
      listing={listing}
      searchParams={resolvedSearchParams}
    />
  );
}
