import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";
import type { RetrievalItem } from "@/server/retrieval/types";

import {
  PAGE_SIZE,
  PaginationControls,
  parsePage,
} from "@/app/pagination-controls";
import { RetrievalItemList } from "../retrieval-item-list";

export const dynamic = "force-dynamic";

type RecentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getDateLabel(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 30) return "This month";
  return "Older";
}

function groupByDate(
  items: RetrievalItem[],
  now: Date,
): { label: string; items: RetrievalItem[] }[] {
  const order = ["Today", "Yesterday", "This week", "This month", "Older"];
  const map = new Map<string, RetrievalItem[]>();
  for (const item of items) {
    const label = getDateLabel(new Date(item.updatedAt), now);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(item);
  }
  return order.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}

export default async function RecentPage({ searchParams }: RecentPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/recent"),
  ]);
  const allItems = await retrievalService.listRecent({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const totalPages = Math.ceil(allItems.length / PAGE_SIZE);
  const items = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const groups = groupByDate(items, new Date());

  const buildHref = (p: number) => (p === 1 ? "/recent" : `/recent?page=${p}`);

  return (
    <div className="workspace-page">
      <div className="stack">
        <div className="split">
          <h1>Recent</h1>
          {allItems.length > 0 && (
            <span className="section-count">{allItems.length}</span>
          )}
        </div>

        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

        {groups.length === 0 ? (
          <RetrievalItemList
            currentPath="/recent"
            emptyDescription="Open folders, download files, or make changes to build your recents list."
            emptyTitle="Nothing recent yet"
            items={[]}
          />
        ) : (
          <div className="recent-groups">
            {groups.map((group) => (
              <div className="recent-group" key={group.label}>
                <p className="recent-group-label">{group.label}</p>
                <RetrievalItemList
                  currentPath="/recent"
                  emptyDescription=""
                  emptyTitle=""
                  items={group.items}
                />
              </div>
            ))}
          </div>
        )}

        <PaginationControls
          buildHref={buildHref}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
