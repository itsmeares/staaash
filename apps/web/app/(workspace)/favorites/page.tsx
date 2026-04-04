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
      <section className="panel stack">
        <div className="pill">Favorites</div>
        <h1>Bookmarked files and folders</h1>
        <p className="muted">
          Favorites are private bookmarks only. They do not change library or
          search ordering.
        </p>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Saved items</h2>
            <p className="muted">
              Files download with authentication, and folders jump back into the
              private tree.
            </p>
          </div>
          <span className="pill">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <RetrievalItemList
          currentPath="/favorites"
          emptyDescription="Add favorites from the library, search, or recent views to pin quick access here."
          emptyTitle="No favorites yet"
          items={items}
        />
      </section>
    </div>
  );
}
