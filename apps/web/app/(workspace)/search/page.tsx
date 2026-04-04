import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { RetrievalItemList } from "../retrieval-item-list";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/search"),
  ]);
  const query = getSingleSearchParam(resolvedSearchParams, "q")?.trim() ?? "";
  const items =
    query.length > 0
      ? await retrievalService.search({
          actorUserId: session.user.id,
          actorRole: session.user.role,
          query,
        })
      : [];
  const currentPath =
    query.length > 0 ? `/search?q=${encodeURIComponent(query)}` : "/search";
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="pill">Search</div>
        <h1>Private library search</h1>
        <p className="muted">
          Search scans active private files and folders with one mixed ranking
          across names, extensions, and logical path tokens.
        </p>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Results</h2>
            <p className="muted">
              Query:{" "}
              {query.length > 0 ? (
                <strong>{query}</strong>
              ) : (
                "enter a search above"
              )}
            </p>
          </div>
          {query.length > 0 ? (
            <span className="pill">
              {items.length} match{items.length === 1 ? "" : "es"}
            </span>
          ) : null}
        </div>

        {query.length === 0 ? (
          <div className="workspace-empty-state">
            <h2>Search the private library</h2>
            <p className="muted">
              Use the top-bar search field to find active files and folders by
              name, extension, or path segment.
            </p>
          </div>
        ) : (
          <RetrievalItemList
            currentPath={currentPath}
            emptyDescription="No private files or folders matched that query."
            emptyTitle="No results"
            items={items}
            showMatchKind
          />
        )}
      </section>
    </div>
  );
}
