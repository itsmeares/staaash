import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { toActivityClientItem, toRecentClientItem } from "./recent-helpers";
import { RecentView } from "./recent-view";

export const dynamic = "force-dynamic";

/** Activity (what you did) by default; `?show=added` lists everything added. */
export default async function RecentPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const [{ show }, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/recent"),
  ]);
  const actor = { actorUserId: session.user.id, actorRole: session.user.role };
  if (show === "added") {
    const items = await retrievalService.listRecentlyAdded(actor);
    return <RecentView items={items.map(toRecentClientItem)} show="added" />;
  }
  const items = await retrievalService.listRecent(actor);
  return <RecentView items={items.map(toActivityClientItem)} show="activity" />;
}
