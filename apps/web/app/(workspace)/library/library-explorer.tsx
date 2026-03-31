import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import type { LibraryListing } from "@/server/library/types";

const getFolderHref = (folder: { id: string; isLibraryRoot: boolean }) =>
  folder.isLibraryRoot ? "/library" : `/library/f/${folder.id}`;

type LibraryExplorerProps = {
  listing: LibraryListing;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function LibraryExplorer({
  listing,
  currentPath,
  searchParams,
}: LibraryExplorerProps) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");

  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="pill">Private library</div>
        <div className="split">
          <div className="stack">
            <h1>{listing.currentFolder.name}</h1>
            <p className="muted">
              Folder routes stay stable by ID, while names and logical paths
              remain metadata-only.
            </p>
          </div>
          <form
            action="/api/library/folders"
            className="workspace-inline-form"
            method="post"
          >
            <input
              name="parentId"
              type="hidden"
              value={listing.currentFolder.id}
            />
            <input name="redirectTo" type="hidden" value={currentPath} />
            <div className="field">
              <label htmlFor="create-folder-name">New folder</label>
              <div className="workspace-inline-fields">
                <input
                  id="create-folder-name"
                  name="name"
                  placeholder="Folder name"
                  required
                />
                <button className="button" type="submit">
                  Create
                </button>
              </div>
            </div>
          </form>
        </div>
        <div className="workspace-breadcrumbs" aria-label="Breadcrumb">
          {listing.breadcrumbs.map((crumb) => (
            <Link key={crumb.id} href={crumb.href}>
              {crumb.name}
            </Link>
          ))}
        </div>
      </section>

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Folders</h2>
            <p className="muted">
              List view is canonical in Phase 2. Files and previews arrive in
              later phases.
            </p>
          </div>
          <span className="pill">
            {listing.childFolders.length} folder
            {listing.childFolders.length === 1 ? "" : "s"}
          </span>
        </div>

        {listing.childFolders.length === 0 ? (
          <div className="workspace-empty-state">
            <h3>Nothing here yet</h3>
            <p className="muted">
              Create the first child folder here. Uploads and file rows arrive
              in Phase 3.
            </p>
          </div>
        ) : (
          <div className="folder-list">
            {listing.childFolders.map((folder) => {
              const availableMoveTargetIds = new Set(
                listing.availableMoveTargetIdsByFolderId[folder.id] ?? [],
              );
              const availableMoveTargets = listing.moveTargets.filter(
                (target) => availableMoveTargetIds.has(target.id),
              );

              return (
                <article className="folder-row" key={folder.id}>
                  <div className="folder-row-head">
                    <div className="stack">
                      <Link
                        className="folder-link"
                        href={getFolderHref(folder)}
                      >
                        {folder.name}
                      </Link>
                      <p className="folder-meta">
                        Updated {formatDateTime(folder.updatedAt)}
                      </p>
                    </div>
                    <span className="pill">Folder</span>
                  </div>

                  <details className="folder-disclosure">
                    <summary>Manage folder</summary>
                    <div className="folder-disclosure-grid">
                      <form
                        action={`/api/library/folders/${folder.id}/rename`}
                        className="field"
                        method="post"
                      >
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={currentPath}
                        />
                        <label htmlFor={`rename-${folder.id}`}>Rename</label>
                        <div className="workspace-inline-fields">
                          <input
                            defaultValue={folder.name}
                            id={`rename-${folder.id}`}
                            name="name"
                            required
                          />
                          <button
                            className="button button-secondary"
                            type="submit"
                          >
                            Save
                          </button>
                        </div>
                      </form>

                      {availableMoveTargets.length > 0 ? (
                        <form
                          action={`/api/library/folders/${folder.id}/move`}
                          className="field"
                          method="post"
                        >
                          <input
                            name="redirectTo"
                            type="hidden"
                            value={currentPath}
                          />
                          <label htmlFor={`move-${folder.id}`}>Move</label>
                          <div className="workspace-inline-fields">
                            <select
                              id={`move-${folder.id}`}
                              name="destinationFolderId"
                            >
                              {availableMoveTargets.map((target) => (
                                <option key={target.id} value={target.id}>
                                  {target.pathLabel}
                                </option>
                              ))}
                            </select>
                            <button
                              className="button button-secondary"
                              type="submit"
                            >
                              Move
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="field">
                          <label>Move</label>
                          <span className="field-help">
                            No other valid destinations yet.
                          </span>
                        </div>
                      )}

                      <form
                        action={`/api/library/folders/${folder.id}/trash`}
                        className="field"
                        method="post"
                      >
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={currentPath}
                        />
                        <label>Trash</label>
                        <button className="button button-danger" type="submit">
                          Move subtree to trash
                        </button>
                      </form>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
