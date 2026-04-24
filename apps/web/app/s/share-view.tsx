import React from "react";
import Link from "next/link";

import { TextFileViewer } from "@/app/text-file-viewer";

import {
  FlashMessage,
  formatDateTime,
  getSingleSearchParam,
} from "@/app/auth-ui";
import { authService } from "@/server/auth/service";
import { ShareAudioPlayer } from "./share-audio-player";
import type { LibraryFileSummary } from "@/server/library/types";
import { ShareError } from "@/server/sharing/errors";
import type {
  PublicShareResolution,
  ShareLinkSummary,
} from "@/server/sharing/types";

const formatBytes = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
    notation: "standard",
  }).format(value / (1024 * 1024)) + " MB";

function getRelativeExpiry(expiresAt: Date | string): string {
  const d = new Date(expiresAt);
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "expired";
  if (diffDays === 1) return "expires tomorrow";
  if (diffDays < 7) return `expires in ${diffDays} days`;
  if (diffDays < 60)
    return `expires in ${Math.ceil(diffDays / 7)} week${Math.ceil(diffDays / 7) === 1 ? "" : "s"}`;
  return `expires in ${Math.floor(diffDays / 30)} months`;
}

async function ShareBrand() {
  const setupState = await authService.getSetupState();
  const name = setupState.instanceName ?? "Staaash";
  return (
    <div className="share-brand">
      <span className="share-brand-wordmark">{name}</span>
      <span className="share-brand-sub">shared with you</span>
    </div>
  );
}

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
    <main className="share-page stack">
      <ShareBrand />
      <section className="panel stack">
        <div className="pill">Public share</div>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.description}</p>
      </section>
    </main>
  );
}

export function ShareLockedView({
  error,
  redirectPath,
  success,
  token,
}: {
  error: string | null;
  redirectPath: string;
  success: string | null;
  token: string;
}) {
  return (
    <main className="share-page stack">
      <ShareBrand />
      <section className="panel stack">
        <div className="pill">Protected share</div>
        <h1>Password required</h1>
        <p className="muted">Enter the password to access this shared item.</p>
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        <form
          action={`/s/${encodeURIComponent(token)}/unlock`}
          className="form-grid"
          method="post"
        >
          <input name="redirectTo" type="hidden" value={redirectPath} />
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
    </main>
  );
}

export function ShareFilePage({
  backHref,
  backLabel = "Back",
  contentHref,
  downloadHref,
  file,
  headerLabel,
  searchParams,
  share,
}: {
  backHref?: string;
  backLabel?: string;
  contentHref: string;
  downloadHref?: string;
  file: LibraryFileSummary;
  headerLabel: string;
  searchParams: Record<string, string | string[] | undefined>;
  share: Pick<ShareLinkSummary, "downloadDisabled" | "expiresAt">;
}) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");
  const relativeExpiry = getRelativeExpiry(share.expiresAt);
  const ext = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase()
    : null;
  const formatLabel = ext ?? file.mimeType;

  return (
    <main className="share-page stack">
      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      {/* Top bar: file title left, instance brand right */}
      <div className="sp-topbar">
        <div className="sp-hero">
          <h1 className="sp-file-title">{file.name}</h1>
          <p className="share-expiry-meta">
            <span className="share-expiry-highlight">{relativeExpiry}</span>
            {" · "}
            {formatDateTime(share.expiresAt)}
          </p>
        </div>
        <ShareBrand />
      </div>

      {/* Content */}
      {file.viewerKind === "audio" ? (
        <ShareAudioPlayer src={contentHref} fileName={file.name} />
      ) : file.viewerKind === "pdf" ? (
        <embed
          src={contentHref}
          type="application/pdf"
          style={{ width: "100%", height: "75vh" }}
        />
      ) : file.viewerKind === "text" ? (
        <TextFileViewer contentHref={contentHref} />
      ) : file.viewerKind === "image" || file.viewerKind === "video" ? (
        <section
          className="panel stack"
          style={{
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              "color-mix(in oklab, var(--foreground) 4%, var(--background))",
            minHeight: "60vh",
          }}
        >
          {file.viewerKind === "image" ? (
            <img
              alt={file.name}
              src={contentHref}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "75vh",
                objectFit: "contain",
              }}
            />
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={contentHref}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "75vh",
              }}
            >
              Your browser could not play this video inline.
            </video>
          )}
        </section>
      ) : null}

      {/* Actions row — meta left, download + back right */}
      <div className="sp-actions">
        <p className="sp-actions-meta">
          {formatLabel} · {formatBytes(file.sizeBytes)}
        </p>
        <div className="sp-actions-right">
          {backHref ? (
            <Link className="button button-secondary" href={backHref}>
              {backLabel}
            </Link>
          ) : null}
          {!share.downloadDisabled && downloadHref ? (
            <a className="button" href={downloadHref}>
              Download
            </a>
          ) : share.downloadDisabled ? (
            <span className="sp-dl-disabled">Downloads off</span>
          ) : null}
        </div>
      </div>

      <p className="share-page-footer">
        Shared via{" "}
        <a href="/" rel="noopener noreferrer">
          Staaash
        </a>
      </p>
    </main>
  );
}

type ShareViewProps = {
  resolution: PublicShareResolution;
  token: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function ShareView({ resolution, token, searchParams }: ShareViewProps) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");
  const isLocked =
    resolution.access.requiresPassword && !resolution.access.isUnlocked;
  const lockedRedirectPath =
    resolution.kind === "file"
      ? `/s/${encodeURIComponent(token)}`
      : resolution.listing.currentFolder.id === resolution.listing.rootFolder.id
        ? `/s/${encodeURIComponent(token)}`
        : `/s/${encodeURIComponent(token)}/f/${resolution.listing.currentFolder.id}`;

  if (isLocked) {
    return (
      <ShareLockedView
        error={error ?? null}
        redirectPath={lockedRedirectPath}
        success={success ?? null}
        token={token}
      />
    );
  }

  if (resolution.kind === "file") {
    return (
      <ShareFilePage
        contentHref={`/s/${encodeURIComponent(token)}/content`}
        downloadHref={`/s/${encodeURIComponent(token)}/download`}
        file={resolution.file}
        headerLabel="Shared file"
        searchParams={searchParams}
        share={resolution.share}
      />
    );
  }

  const relativeExpiry = getRelativeExpiry(resolution.share.expiresAt);

  return (
    <main className="share-page stack">
      <ShareBrand />

      <section className="panel stack">
        <div className="split">
          <div className="stack">
            <div className="pill">Shared folder</div>
            <h1>{resolution.listing.currentFolder.name}</h1>
            <p className="share-expiry-meta">
              <span className="share-expiry-highlight">{relativeExpiry}</span>
              {" · "}
              {formatDateTime(resolution.share.expiresAt)}
            </p>
          </div>
          {!resolution.share.downloadDisabled ? (
            <a
              className="button button-secondary"
              href={`/s/${encodeURIComponent(token)}/archive`}
            >
              Download all
            </a>
          ) : null}
        </div>
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        {resolution.share.downloadDisabled ? (
          <span className="field-help">
            Archive download is disabled for this link.
          </span>
        ) : null}
      </section>

      {resolution.listing.breadcrumbs.length > 1 ? (
        <div className="workspace-breadcrumbs" aria-label="Breadcrumb">
          {resolution.listing.breadcrumbs.map((crumb) => (
            <Link key={crumb.id} href={crumb.href}>
              {crumb.name}
            </Link>
          ))}
        </div>
      ) : null}

      <section className="panel stack">
        <div className="split">
          <h2>Folders</h2>
          <span className="pill">{resolution.listing.childFolders.length}</span>
        </div>

        {resolution.listing.childFolders.length === 0 ? (
          <p className="muted" style={{ fontSize: "13px" }}>
            No folders here.
          </p>
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
                    <p className="share-file-meta">
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
          <h2>Files</h2>
          <span className="pill">{resolution.listing.files.length}</span>
        </div>

        {resolution.listing.files.length === 0 ? (
          <p className="muted" style={{ fontSize: "13px" }}>
            No files here.
          </p>
        ) : (
          <div className="folder-list">
            {resolution.listing.files.map((file) => (
              <article className="folder-row" key={file.id}>
                <div className="folder-row-head">
                  <div className="stack">
                    <h3 className="folder-link">{file.name}</h3>
                    <p className="share-file-meta">
                      {file.mimeType} · {formatBytes(file.sizeBytes)} · updated{" "}
                      {formatDateTime(file.updatedAt)}
                    </p>
                  </div>
                  <div className="workspace-inline-fields retrieval-inline-actions">
                    {file.viewerKind ? (
                      <Link
                        className="button button-secondary"
                        href={`/s/${encodeURIComponent(token)}/files/${file.id}`}
                      >
                        Open
                      </Link>
                    ) : null}
                    {!resolution.share.downloadDisabled ? (
                      <a
                        className="button button-secondary"
                        href={`/s/${encodeURIComponent(token)}/files/${file.id}/download`}
                      >
                        Download
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="share-page-footer">
        Shared via{" "}
        <a href="/" rel="noopener noreferrer">
          Staaash
        </a>
      </p>
    </main>
  );
}
