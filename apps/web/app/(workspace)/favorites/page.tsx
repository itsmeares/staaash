import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

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
  const items = await retrievalService.listFavorites({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <div className="workspace-page">
      <div className="stack">
        <div className="split">
          <h1>Favorites</h1>
          {items.length > 0 && (
            <span className="section-count">{items.length}</span>
          )}
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        <RetrievalItemList
          currentPath="/favorites"
          emptyDescription="Add favorites from the library, search, or recent views to pin quick access here."
          emptyTitle="No favorites yet"
          items={items}
        />
      </div>
    </div>
  );
}
