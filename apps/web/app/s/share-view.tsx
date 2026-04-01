import Link from "next/link";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { ShareError } from "@/server/sharing/errors";
import type { PublicShareResolution } from "@/server/sharing/types";

const formatBytes = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
    notation: value >= 1024 * 1024 * 1024 ? "standard" : "standard",
  }).format(value / (1024 * 1024)) + " MB";

const shareErrorCopy: Record<
  ShareError["code"],
  {
    title: string;
    description: string;
  }
> = {
  SHARE_ACCESS_DENIED: {
    title: "Location unavailable",
    description: "That folder is outside the shared subtree.",
  },
  SHARE_DOWNLOAD_DISABLED: {
    title: "Downloads disabled",
    description: "This shared link allows browsing, but not downloading.",
  },
  SHARE_EXPIRED: {
    title: "Link expired",
    description: "This shared link is no longer active.",
  },
  SHARE_INVALID: {
    title: "Link unavailable",
    description: "This shared link is not valid anymore.",
  },
  SHARE_NOT_FOUND: {
    title: "Link missing",
    description: "This shared link could not be found.",
  },
  SHARE_PASSWORD_INVALID: {
    title: "Password rejected",
    description: "That password did not unlock the shared link.",
  },
  SHARE_PASSWORD_REQUIRED: {
    title: "Password required",
    description: "Enter the password to continue to this shared item.",
  },
  SHARE_TARGET_UNAVAILABLE: {
    title: "Shared item unavailable",
    description: "The owner has moved this item out of public availability.",
  },
};

export function ShareErrorView({ error }: { error: ShareError }) {
  const copy = shareErrorCopy[error.code];

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">Public share</div>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.description}</p>
      </section>
    </main>
  );
}

type ShareViewProps = {
  resolution: PublicShareResolution;
  token: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function ShareView({
  resolution,
  token,
  searchParams,
}: ShareViewProps) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");
  const isLocked =
    resolution.access.requiresPassword && !resolution.access.isUnlocked;

  return (
    <main className="stack">
      <section className="panel stack">
        <div className="pill">{resolution.kind === "file" ? "Shared file" : "Shared folder"}</div>
        <h1>
          {resolution.kind === "file"
            ? resolution.file.name
            : resolution.listing.currentFolder.name}
        </h1>
        <p className="muted">
          {isLocked
            ? "This link is password-protected."
            : `Link expires ${formatDateTime(resolution.share.expiresAt)}.`}
        </p>
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      </section>

      {isLocked ? (
        <section className="panel stack">
          <h2>Unlock shared access</h2>
          <form
            action={`/s/${encodeURIComponent(token)}/unlock`}
            className="form-grid"
            method="post"
          >
            <input
              name="redirectTo"
              type="hidden"
              value={
                resolution.kind === "file"
                  ? `/s/${encodeURIComponent(token)}`
                  : resolution.listing.currentFolder.id ===
                      resolution.listing.rootFolder.id
                    ? `/s/${encodeURIComponent(token)}`
                    : `/s/${encodeURIComponent(token)}/f/${resolution.listing.currentFolder.id}`
              }
            />
            <div className="field">
              <label htmlFor="share-password">Password</label>
              <input
                id="share-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <button className="button" type="submit">
              Unlock
            </button>
          </form>
        </section>
      ) : null}

      {resolution.kind === "file" ? (
        <section className="panel stack">
          <h2>File details</h2>
          <p className="muted">
            {resolution.file.mimeType} • {formatBytes(resolution.file.sizeBytes)} •
            Updated {formatDateTime(resolution.file.updatedAt)}
          </p>
          {!isLocked && !resolution.share.downloadDisabled ? (
            <a
              className="button"
              href={`/s/${encodeURIComponent(token)}/download`}
            >
              Download file
            </a>
          ) : (
            <span className="field-help">
              {resolution.share.downloadDisabled
                ? "Downloads are disabled for this link."
                : "Unlock the link to access the file."}
            </span>
          )}
        </section>
      ) : (
        <>
          <section className="panel stack">
            <div className="workspace-breadcrumbs" aria-label="Breadcrumb">
              {resolution.listing.breadcrumbs.map((crumb) => (
                <Link key={crumb.id} href={crumb.href}>
                  {crumb.name}
                </Link>
              ))}
            </div>
            {!isLocked && !resolution.share.downloadDisabled ? (
              <a
                className="button"
                href={`/s/${encodeURIComponent(token)}/archive`}
              >
                Download folder archive
              </a>
            ) : (
              <span className="field-help">
                {resolution.share.downloadDisabled
                  ? "Archive download is disabled for this link."
                  : "Unlock the link to browse this folder."}
              </span>
            )}
          </section>

          {!isLocked ? (
            <>
              <section className="panel stack">
                <div className="split">
                  <div className="stack">
                    <h2>Folders</h2>
                    <p className="muted">This share exposes the full linked subtree.</p>
                  </div>
                  <span className="pill">
                    {resolution.listing.childFolders.length} folder
                    {resolution.listing.childFolders.length === 1 ? "" : "s"}
                  </span>
                </div>

                {resolution.listing.childFolders.length === 0 ? (
                  <div className="workspace-empty-state">
                    <h3>No child folders here</h3>
                    <p className="muted">This folder has no visible child folders.</p>
                  </div>
                ) : (
                  <div className="folder-list">
                    {resolution.listing.childFolders.map((folder) => (
                      <article className="folder-row" key={folder.id}>
                        <div className="folder-row-head">
                          <div className="stack">
                            <Link
                              className="folder-link"
                              href={`/s/${encodeURIComponent(token)}/f/${folder.id}`}
                            >
                              {folder.name}
                            </Link>
                            <p className="folder-meta">
                              Updated {formatDateTime(folder.updatedAt)}
                            </p>
                          </div>
                          <span className="pill">Folder</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel stack">
                <div className="split">
                  <div className="stack">
                    <h2>Files</h2>
                    <p className="muted">Files stay inside the linked subtree only.</p>
                  </div>
                  <span className="pill">
                    {resolution.listing.files.length} file
                    {resolution.listing.files.length === 1 ? "" : "s"}
                  </span>
                </div>

                {resolution.listing.files.length === 0 ? (
                  <div className="workspace-empty-state">
                    <h3>No files here</h3>
                    <p className="muted">This folder has no visible files.</p>
                  </div>
                ) : (
                  <div className="folder-list">
                    {resolution.listing.files.map((file) => (
                      <article className="folder-row" key={file.id}>
                        <div className="folder-row-head">
                          <div className="stack">
                            <h3 className="folder-link">{file.name}</h3>
                            <p className="folder-meta">
                              {file.mimeType} • {formatBytes(file.sizeBytes)} • Updated{" "}
                              {formatDateTime(file.updatedAt)}
                            </p>
                          </div>
                          <span className="pill">File</span>
                        </div>
                        {!resolution.share.downloadDisabled ? (
                          <a
                            className="button button-secondary"
                            href={`/s/${encodeURIComponent(token)}/files/${file.id}/download`}
                          >
                            Download
                          </a>
                        ) : (
                          <span className="field-help">
                            Downloads are disabled for this link.
                          </span>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
