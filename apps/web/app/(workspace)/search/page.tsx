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
      className="workspace-page search-page"
      preset="search"
    >
      <header className="search-header">
        <div className="search-header-copy">
          <h1>Search</h1>
          <p className="muted search-description">
            Find active files and folders by name, extension, or path segment.
          </p>
        </div>
        {query.length > 0 ? (
          <span className="section-count">
            {allItems.length} match{allItems.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </header>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="search-results" aria-labelledby="search-results">
        <div className="search-results-head">
          <h2 id="search-results">Results</h2>
          <p className="muted search-query">
            Query:{" "}
            {query.length > 0 ? (
              <strong>{query}</strong>
            ) : (
              "enter a search above"
            )}
          </p>
        </div>

        {query.length === 0 ? (
          <div className="workspace-empty-state search-empty-state">
            <h2>Search your files</h2>
            <p className="muted">
              Use the top-bar search field to find active files and folders by
              name, extension, or path segment.
            </p>
          </div>
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
