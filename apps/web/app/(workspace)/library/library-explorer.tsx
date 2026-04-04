import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { env } from "@/lib/env";
import type { LibraryListing } from "@/server/library/types";
import type { ShareLibraryLookup, ShareLinkSummary } from "@/server/sharing";

import { LibraryUploadPanel } from "./library-upload-panel";

const getFolderHref = (folder: { id: string; isLibraryRoot: boolean }) =>
  folder.isLibraryRoot ? "/library" : `/library/f/${folder.id}`;

type LibraryExplorerProps = {
  listing: LibraryListing;
  currentPath: string;
  searchParams: Record<string, string | string[] | undefined>;
  shareLookup: ShareLibraryLookup;
  favoriteFileIds: string[];
  favoriteFolderIds: string[];
};

const shareStatusLabel: Record<ShareLinkSummary["status"], string> = {
  active: "Public link active",
  expired: "Public link expired",
  revoked: "Public link revoked",
  "target-unavailable": "Public link paused",
};

function ShareShortcut({
  currentPath,
  targetType,
  share,
  targetId,
}: {
  currentPath: string;
  targetType: "file" | "folder";
  share: ShareLinkSummary | null;
  targetId: string;
}) {
  return (
    <div className="field">
      <label>Public link</label>
      {share ? (
        <div className="stack">
          <span className="field-help">{shareStatusLabel[share.status]}</span>
          <div className="workspace-inline-fields">
            <Link
              className="button button-secondary"
              href={`/shared#${share.id}`}
            >
              Manage public link
            </Link>
            {share.status === "active" ? (
              <a
                className="button button-secondary"
                href={share.shareUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <form
          action="/api/shares"
          className="workspace-inline-form"
          method="post"
        >
          <input name="redirectTo" type="hidden" value={currentPath} />
          <input name="targetType" type="hidden" value={targetType} />
          <input
            name={targetType === "file" ? "fileId" : "folderId"}
            type="hidden"
            value={targetId}
          />
          <button className="button button-secondary" type="submit">
            Create public link
          </button>
        </form>
      )}
    </div>
  );
}

export function LibraryExplorer({
  listing,
  currentPath,
  searchParams,
  shareLookup,
  favoriteFileIds,
  favoriteFolderIds,
}: LibraryExplorerProps) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");
  const favoriteFileIdSet = new Set(favoriteFileIds);
  const favoriteFolderIdSet = new Set(favoriteFolderIds);

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
        <ShareShortcut
          currentPath={currentPath}
          share={shareLookup.currentFolderShare}
          targetId={listing.currentFolder.id}
          targetType="folder"
        />
      </section>

      <LibraryUploadPanel
        currentFolderId={listing.currentFolder.id}
        currentPath={currentPath}
        existingNames={[
          ...listing.childFolders.map((folder) => folder.name),
          ...listing.files.map((file) => file.name),
        ]}
        maxUploadBytes={env.MAX_UPLOAD_BYTES}
        timeoutMinutes={env.UPLOAD_TIMEOUT_MINUTES}
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Folders</h2>
            <p className="muted">
              Folders remain metadata-only paths. Physical originals stay pinned
              to immutable storage keys even when the logical tree changes.
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
              Create the first child folder here or upload files into this
              location.
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
                    <div className="workspace-inline-fields retrieval-inline-actions">
                      <span className="pill">Folder</span>
                      {favoriteFolderIdSet.has(folder.id) ? (
                        <span className="pill">Favorite</span>
                      ) : null}
                      <form
                        action={`/api/library/folders/${folder.id}/favorite`}
                        method="post"
                      >
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={currentPath}
                        />
                        <input
                          name="isFavorite"
                          type="hidden"
                          value={
                            favoriteFolderIdSet.has(folder.id)
                              ? "false"
                              : "true"
                          }
                        />
                        <button
                          className="button button-secondary"
                          type="submit"
                        >
                          {favoriteFolderIdSet.has(folder.id)
                            ? "Remove favorite"
                            : "Add favorite"}
                        </button>
                      </form>
                    </div>
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

                      <ShareShortcut
                        currentPath={currentPath}
                        share={shareLookup.sharesByFolderId[folder.id] ?? null}
                        targetId={folder.id}
                        targetType="folder"
                      />
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <h2>Files</h2>
            <p className="muted">
              Uploads stage under temporary storage, verify with SHA-256, then
              commit by immutable file ID.
            </p>
          </div>
          <span className="pill">
            {listing.files.length} file{listing.files.length === 1 ? "" : "s"}
          </span>
        </div>

        {listing.files.length === 0 ? (
          <div className="workspace-empty-state">
            <h3>No files in this folder yet</h3>
            <p className="muted">
              Use the upload panel to add files here. Replace and keep-both
              behavior is explicit when names collide.
            </p>
          </div>
        ) : (
          <div className="folder-list">
            {listing.files.map((file) => {
              const availableMoveTargets = listing.moveTargets.filter(
                (target) => target.id !== listing.currentFolder.id,
              );

              return (
                <article className="folder-row" key={file.id}>
                  <div className="folder-row-head">
                    <div className="stack">
                      <a
                        className="folder-link"
                        href={
                          file.viewerKind
                            ? `/library/files/${file.id}`
                            : `/api/library/files/${file.id}/download`
                        }
                      >
                        {file.name}
                      </a>
                      <p className="folder-meta">
                        {file.mimeType} • {Math.round(file.sizeBytes / 1024)} KB
                        • Updated {formatDateTime(file.updatedAt)}
                      </p>
                    </div>
                    <div className="workspace-inline-fields retrieval-inline-actions">
                      <span className="pill">File</span>
                      {favoriteFileIdSet.has(file.id) ? (
                        <span className="pill">Favorite</span>
                      ) : null}
                      {file.viewerKind ? (
                        <a
                          className="button button-secondary"
                          href={`/library/files/${file.id}`}
                        >
                          Open
                        </a>
                      ) : null}
                      <a
                        className="button button-secondary"
                        href={`/api/library/files/${file.id}/download`}
                      >
                        Download
                      </a>
                      <form
                        action={`/api/library/files/${file.id}/favorite`}
                        method="post"
                      >
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={currentPath}
                        />
                        <input
                          name="isFavorite"
                          type="hidden"
                          value={
                            favoriteFileIdSet.has(file.id) ? "false" : "true"
                          }
                        />
                        <button
                          className="button button-secondary"
                          type="submit"
                        >
                          {favoriteFileIdSet.has(file.id)
                            ? "Remove favorite"
                            : "Add favorite"}
                        </button>
                      </form>
                    </div>
                  </div>

                  <details className="folder-disclosure">
                    <summary>Manage file</summary>
                    <div className="folder-disclosure-grid">
                      <form
                        action={`/api/library/files/${file.id}/rename`}
                        className="field"
                        method="post"
                      >
                        <input
                          name="redirectTo"
                          type="hidden"
                          value={currentPath}
                        />
                        <label htmlFor={`rename-file-${file.id}`}>Rename</label>
                        <div className="workspace-inline-fields">
                          <input
                            defaultValue={file.name}
                            id={`rename-file-${file.id}`}
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
                          action={`/api/library/files/${file.id}/move`}
                          className="field"
                          method="post"
                        >
                          <input
                            name="redirectTo"
                            type="hidden"
                            value={currentPath}
                          />
                          <label htmlFor={`move-file-${file.id}`}>Move</label>
                          <div className="workspace-inline-fields">
                            <select
                              id={`move-file-${file.id}`}
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
                        action={`/api/library/files/${file.id}/trash`}
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
                          Move file to trash
                        </button>
                      </form>

                      <ShareShortcut
                        currentPath={currentPath}
                        share={shareLookup.sharesByFileId[file.id] ?? null}
                        targetId={file.id}
                        targetType="file"
                      />
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
