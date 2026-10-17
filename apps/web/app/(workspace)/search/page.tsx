import { getSingleSearchParam } from "@/app/auth-ui";
import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import {
  PAGE_SIZE,
  PaginationControls,
  parsePage,
} from "@/app/pagination-controls";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { toRecentClientItem } from "../recent/recent-helpers";
import { SearchResults } from "./search-results";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Empty, short, filtered and full queries each render differently.
// fallow-ignore-next-line complexity
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/?next=/search"),
  ]);
  const query = getSingleSearchParam(resolvedSearchParams, "q")?.trim() ?? "";
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));
  const allItems =
    query.length > 0
      ? await retrievalService.search({
          actorUserId: session.user.id,
          actorRole: session.user.role,
          query,
        })
      : [];
  const totalPages = Math.ceil(allItems.length / PAGE_SIZE);

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (query.length > 0) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const items = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const currentPath =
    query.length > 0 ? `/search?q=${encodeURIComponent(query)}` : "/search";

  // The query stays in the top box, so the title stays quiet.
  const title = <span className="text-muted-foreground">Search</span>;

  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="search"
    >
      {query.length === 0 || items.length === 0 ? (
        <>
          <PageHeader title={title} />
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyTitle>
                {query.length === 0
                  ? "Search your files"
                  : `Nothing matches "${query}"`}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        </>
      ) : (
        <>
          <SearchResults
            currentPath={currentPath}
            items={items.map(toRecentClientItem)}
            query={query}
            title={title}
          />
          <PaginationControls
            buildHref={buildHref}
            page={page}
            totalPages={totalPages}
          />
        </>
      )}
    </WorkspacePresetPageContextMenu>
  );
}
