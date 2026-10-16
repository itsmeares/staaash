import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { toRecentClientItem } from "./recent-helpers";
import { RecentView } from "./recent-view";

export const dynamic = "force-dynamic";

export default async function RecentPage() {
  const session = await requireSignedInPageSession("/?next=/recent");
  const allItems = await retrievalService.listRecentlyAdded({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });

  return <RecentView items={allItems.map(toRecentClientItem)} />;
}
