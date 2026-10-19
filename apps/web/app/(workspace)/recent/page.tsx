import { requireSignedInPageSession } from "@/server/auth/guards";
import { getActivityPage } from "@/server/retrieval/activity-page";
import { getRetrievalPage } from "@/server/retrieval/page";

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
  const grouped =
    show !== "added" && session.user.preferences.defaultView !== "grid";
  const page = grouped
    ? await getActivityPage(session.user.id)
    : await getRetrievalPage(
        session.user.id,
        show === "added" ? "added" : "recent",
      );
  const items = grouped
    ? (page.items as Awaited<ReturnType<typeof getActivityPage>>["items"])
    : (page.items as Awaited<ReturnType<typeof getRetrievalPage>>["items"]).map(
        show === "added" ? toRecentClientItem : toActivityClientItem,
      );
  return (
    <RecentView
      items={items}
      total={page.total}
      show={show === "added" ? "added" : "activity"}
    />
  );
}
