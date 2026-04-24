import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import {
  PAGE_SIZE,
  PaginationControls,
  buildPageHref,
  parsePage,
} from "@/app/pagination-controls";
import { redirect } from "next/navigation";
import { RetrievalItemList } from "../retrieval-item-list";

export const dynamic = "force-dynamic";

type FavoritesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FavoritesPage({
  searchParams,
}: FavoritesPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/favorites"),
  ]);
  const allItems = await retrievalService.listFavorites({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allItems.length / PAGE_SIZE);
  const buildHref = buildPageHref("/favorites");

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const items = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="workspace-page">
      <div className="stack">
        <div className="split">
          <h1>Favorites</h1>
          {allItems.length > 0 && (
            <span className="section-count">{allItems.length}</span>
          )}
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        <RetrievalItemList
          currentPath="/favorites"
          emptyDescription="Add favorites from files, search, or recent views to pin quick access here."
          emptyTitle="No favorites yet"
          items={items}
        />

        <PaginationControls
          buildHref={buildHref}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
