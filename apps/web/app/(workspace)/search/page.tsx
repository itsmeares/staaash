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
import { SectionLabel } from "@/components/section-label";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { RetrievalItemList } from "../retrieval-item-list";

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
      className="grid gap-4.5 max-lg:min-w-0"
      preset="search"
    >
      <PageHeader
        description="Find active files and folders by name, extension, or path segment."
        divider
        meta={
          query.length > 0 ? (
            <Badge>
              {allItems.length} match{allItems.length === 1 ? "" : "es"}
            </Badge>
          ) : null
        }
        title="Search"
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="grid gap-3.5" aria-labelledby="search-results">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-2 max-xs:flex-col">
          <h2 id="search-results" className="m-0">
            <SectionLabel>Results</SectionLabel>
          </h2>
          <p className="m-0 text-label text-muted-foreground">
            Query:{" "}
            {query.length > 0 ? (
              <strong className="font-semibold text-foreground">{query}</strong>
            ) : (
              "enter a search above"
            )}
          </p>
        </div>

        {query.length === 0 ? (
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyTitle>Search your files</EmptyTitle>
              <EmptyDescription>
                Use the top-bar search field to find active files and folders by
                name, extension, or path segment.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <RetrievalItemList
              currentPath={currentPath}
              emptyDescription="Try a different name, extension, or folder."
              emptyTitle="No results match that search"
              items={items}
              showMatchKind
            />
            <PaginationControls
              buildHref={buildHref}
              page={page}
              totalPages={totalPages}
            />
          </>
        )}
      </section>
    </WorkspacePresetPageContextMenu>
  );
}
