import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { WorkspacePresetPageContextMenu } from "@/src/dashboard-context-menu";
import { PAGE_SIZE, PaginationControls } from "@/src/pagination-controls";
import { searchQuery } from "@/src/queries";
import { SearchResults } from "@/src/workspace/search/search-results";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";
import { Empty, EmptyHeader, EmptyTitle } from "@staaash/ui/components/empty";

const buildHref = (query: string) => (page: number) => {
  const params = new URLSearchParams();
  if (query.length > 0) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
};

function SearchPage() {
  const { q, page } = Route.useSearch();
  const query = q.trim();
  const { data } = useSuspenseQuery(searchQuery(query, page, PAGE_SIZE));
  const totalPages = Math.ceil(data.total / PAGE_SIZE);
  // The query stays in the top box, so the title stays quiet.
  const title = <span className="text-muted-foreground">Search</span>;

  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="search"
    >
      {query.length === 0 || data.items.length === 0 ? (
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
            currentPath={
              query.length > 0
                ? `/search?q=${encodeURIComponent(query)}`
                : "/search"
            }
            items={data.items}
            query={query}
            title={title}
          />
          <PaginationControls
            buildHref={buildHref(query)}
            page={page}
            totalPages={totalPages}
          />
        </>
      )}
    </WorkspacePresetPageContextMenu>
  );
}

export const Route = createFileRoute("/_workspace/search")({
  validateSearch: z.object({
    q: z.string().catch("").default(""),
    page: z.coerce.number().int().min(1).catch(1).default(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps: { q, page } }) => {
    const query = q.trim();
    const data = await context.queryClient.ensureQueryData(
      searchQuery(query, page, PAGE_SIZE),
    );
    const totalPages = Math.ceil(data.total / PAGE_SIZE);
    if (totalPages > 0 && page > totalPages) {
      throw redirect({ href: buildHref(query)(1) });
    }
  },
  pendingComponent: WorkspaceLoading,
  component: SearchPage,
});
