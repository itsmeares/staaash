import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { retrievalService } from "@/server/retrieval/service";

import { RetrievalItemList } from "../retrieval-item-list";

export const dynamic = "force-dynamic";

type RecentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RecentPage({ searchParams }: RecentPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/recent"),
  ]);
  const items = await retrievalService.listRecent({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="pill">Recent</div>
        <h1>Latest private interactions</h1>
        <p className="muted">
          Recents are a deduped revisit list for active private files and
          folders, not an audit log.
        </p>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Recent items</h2>
            <p className="muted">
              Folder navigation and authenticated file downloads refresh entries
              here along with create, move, rename, trash, and restore actions.
            </p>
          </div>
          <span className="pill">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <RetrievalItemList
          currentPath="/recent"
          emptyDescription="Recent items will appear here after you open folders, download files, or change private library items."
          emptyTitle="Nothing recent yet"
          items={items}
        />
      </section>
    </div>
  );
}
