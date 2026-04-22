import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { libraryService } from "@/server/library/service";
import type {
  TrashFileSummary,
  TrashFolderSummary,
} from "@/server/library/types";

import {
  PAGE_SIZE,
  PaginationControls,
  buildPageHref,
  parsePage,
} from "@/app/pagination-controls";
import { redirect } from "next/navigation";
import { EmptyTrashAction, TrashFileActions } from "./trash-file-actions";

export const dynamic = "force-dynamic";

type TrashPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CombinedTrashItem =
  | { type: "folder"; deletedAt: Date; data: TrashFolderSummary }
  | { type: "file"; deletedAt: Date; data: TrashFileSummary };

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
  const page = parsePage(getSingleSearchParam(resolvedSearchParams, "page"));

  const totalCount = listing.items.length + listing.files.length;
  const isEmpty = totalCount === 0;

  const combined: CombinedTrashItem[] = [
    ...listing.items.map(
      (item): CombinedTrashItem => ({
        type: "folder",
        deletedAt: item.folder.deletedAt ?? item.folder.updatedAt,
        data: item,
      }),
    ),
    ...listing.files.map(
      (item): CombinedTrashItem => ({
        type: "file",
        deletedAt: item.file.deletedAt ?? item.file.updatedAt,
        data: item,
      }),
    ),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const buildHref = buildPageHref("/trash");

  if (totalPages > 0 && page > totalPages) redirect(buildHref(1));

  const pageItems = combined.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const folders = pageItems.flatMap((i) =>
    i.type === "folder" ? [i.data as TrashFolderSummary] : [],
  );
  const files = pageItems.flatMap((i) =>
    i.type === "file" ? [i.data as TrashFileSummary] : [],
  );

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
          <EmptyTrashAction disabled={isEmpty} />
        </div>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        {isEmpty ? (
          <div className="workspace-empty-state">
            <h2>Trash is empty</h2>
            <p className="muted">
              Deleted files and folder roots show up here with their restore
              target.
            </p>
          </div>
        ) : (
          <>
            {folders.length > 0 ? (
              <div className="stack">
                <div className="split">
                  <h2>Folders</h2>
                  <span className="pill">
                    {listing.items.length} folder
                    {listing.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="folder-list">
                  {folders.map((item) => (
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
                        action={`/api/files/folders/${item.folder.id}/restore`}
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

            {files.length > 0 ? (
              <div className="stack">
                <div className="split">
                  <h2>Files</h2>
                  <span className="pill">
                    {listing.files.length} file
                    {listing.files.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="folder-list">
                  {files.map((item) => (
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

            <PaginationControls
              buildHref={buildHref}
              page={page}
              totalPages={totalPages}
            />
          </>
        )}
      </section>
    </div>
  );
}
