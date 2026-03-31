import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { libraryService } from "@/server/library/service";

export const dynamic = "force-dynamic";

type TrashPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TrashPage({ searchParams }: TrashPageProps) {
  const [resolvedSearchParams, session] = await Promise.all([
    searchParams,
    requireSignedInPageSession("/sign-in?next=/trash"),
  ]);
  const listing = await libraryService.listTrashFolders({
    actorUserId: session.user.id,
    actorRole: session.user.role,
  });
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="pill">Trash</div>
        <h1>Deleted folders</h1>
        <p className="muted">
          Phase 2 only surfaces folder restore here. File trash behavior lands
          later with the retrieval layer.
        </p>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        {listing.items.length === 0 ? (
          <div className="workspace-empty-state">
            <h2>Trash is empty</h2>
            <p className="muted">
              Deleted folder roots will show up here with their restore target.
            </p>
          </div>
        ) : (
          <div className="folder-list">
            {listing.items.map((item) => (
              <article className="folder-row" key={item.folder.id}>
                <div className="folder-row-head">
                  <div className="stack">
                    <h2>{item.folder.name}</h2>
                    <p className="folder-meta">
                      Deleted{" "}
                      {formatDateTime(
                        item.folder.deletedAt ?? item.folder.updatedAt,
                      )}
                    </p>
                  </div>
                  <span className="pill">Restore ready</span>
                </div>

                <div className="meta-list muted">
                  <div className="meta-row">
                    <span>Original path</span>
                    <strong>{item.originalPathLabel}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Restore target</span>
                    <strong>{item.restoreLocation.pathLabel}</strong>
                  </div>
                </div>

                <form
                  action={`/api/library/folders/${item.folder.id}/restore`}
                  method="post"
                >
                  <input name="redirectTo" type="hidden" value="/trash" />
                  <button className="button" type="submit">
                    Restore folder
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
