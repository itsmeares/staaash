import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { toFavoriteClientItem } from "./favorites-helpers";
import { FavoritesView } from "./favorites-view";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await requireSignedInPageSession("/?next=/favorites");
  const allItems = await retrievalService.listFavorites({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });

  return <FavoritesView items={allItems.map(toFavoriteClientItem)} />;
}
