import { requireSignedInPageSession } from "@/server/auth/guards";
import { getRetrievalPage } from "@/server/retrieval/page";

import { toFavoriteClientItem } from "./favorites-helpers";
import { FavoritesView } from "./favorites-view";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await requireSignedInPageSession("/?next=/favorites");
  const page = await getRetrievalPage(session.user.id, "favorites");
  return (
    <FavoritesView
      items={page.items.map(toFavoriteClientItem)}
      total={page.total}
    />
  );
}
