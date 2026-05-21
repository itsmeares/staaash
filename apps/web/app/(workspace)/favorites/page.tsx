import { getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { toFavoriteClientItem } from "./favorites-helpers";
import { FavoritesView } from "./favorites-view";

export const dynamic = "force-dynamic";

type FavoritesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FavoritesPage({
  searchParams,
}: FavoritesPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/favorites"),
  ]);
  const allItems = await retrievalService.listFavorites({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <FavoritesView
      error={error}
      items={allItems.map(toFavoriteClientItem)}
      success={success}
    />
  );
}
