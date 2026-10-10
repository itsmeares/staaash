import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { toRecentClientItem } from "../recent/recent-helpers";
import { SearchResults } from "./search-results";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <WorkspacePresetPageContextMenu
      className="grid content-start gap-4 max-lg:min-w-0"
      preset="search"
    >
      <PageHeader
        description={
          query.length > 0
            ? `${allItems.length} result${allItems.length === 1 ? "" : "s"}`
            : undefined
        }
        title={query.length > 0 ? `Results for "${query}"` : "Search"}
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      {query.length === 0 || items.length === 0 ? (
        <Empty className="min-h-64">
          <EmptyHeader>
            <EmptyTitle>
              {query.length === 0 ? "Search your files" : "Nothing matches"}
            </EmptyTitle>
            <EmptyDescription>
              {query.length === 0
                ? "Type a name, an extension or a folder in the search box. Press / to jump there."
                : "Try part of the name, an extension like pdf, or a folder name."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <SearchResults
            currentPath={currentPath}
            items={items.map(toRecentClientItem)}
            query={query}
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
