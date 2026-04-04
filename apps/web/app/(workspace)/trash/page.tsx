import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { libraryService } from "@/server/library/service";

import { EmptyTrashAction, TrashFileActions } from "./trash-file-actions";

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
        <div className="split">
          <div className="stack">
            <div className="pill">Trash</div>
            <h1>Deleted items</h1>
            <p className="muted">
              Trash is the only place permanent file deletion is allowed. Folder
              restore can bring its descendant files back with it.
            </p>
          </div>
          <EmptyTrashAction
            disabled={listing.items.length === 0 && listing.files.length === 0}
          />
        </div>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        {listing.items.length === 0 && listing.files.length === 0 ? (
          <div className="workspace-empty-state">
            <h2>Trash is empty</h2>
            <p className="muted">
              Deleted files and folder roots show up here with their restore
              target.
            </p>
          </div>
        ) : (
          <>
            {listing.items.length > 0 ? (
              <div className="stack">
                <div className="split">
                  <h2>Folders</h2>
                  <span className="pill">
                    {listing.items.length} folder
                    {listing.items.length === 1 ? "" : "s"}
                  </span>
                </div>

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
              </div>
            ) : null}

            {listing.files.length > 0 ? (
              <div className="stack">
                <div className="split">
                  <h2>Files</h2>
                  <span className="pill">
                    {listing.files.length} file
                    {listing.files.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="folder-list">
                  {listing.files.map((item) => (
                    <article className="folder-row" key={item.file.id}>
                      <div className="folder-row-head">
                        <div className="stack">
                          <h2>{item.file.name}</h2>
                          <p className="folder-meta">
                            Deleted{" "}
                            {formatDateTime(
                              item.file.deletedAt ?? item.file.updatedAt,
                            )}
                          </p>
                        </div>
                        <span className="pill">File</span>
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

                      <TrashFileActions
                        fileId={item.file.id}
                        fileName={item.file.name}
                      />
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
