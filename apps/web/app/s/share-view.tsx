import React from "react";
import Link from "next/link";

import { TextFileViewer } from "@/app/text-file-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/time-provider";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { authService } from "@/server/auth/service";
import { ShareAudioPlayer } from "./share-audio-player";
import { ShareFolderList } from "./share-folder-list";
import type { FileSummary } from "@/server/files/types";
import { ShareError } from "@/server/sharing/errors";
import { isPublicShareFileNativeViewSafe } from "@/server/media/public-share-content-policy";
import type {
  PublicShareFilePreview,
  PublicShareResolution,
  ShareLinkSummary,
} from "@/server/sharing/types";

const pageMain =
  "mx-auto grid w-[min(600px,calc(100vw-48px))] gap-4 py-12 max-sm:w-[min(100vw-28px,600px)] max-sm:py-7";
const folderMain =
  "mx-auto grid w-[min(1080px,calc(100vw-48px))] gap-4 py-12 max-sm:w-[min(100vw-28px,1080px)] max-sm:py-7";
const mediaWidth = "w-[min(calc(60vh*16/9),90vw,1920px)]";

const SharedVia = () => (
  <p className="pt-2 text-center text-xs text-muted-foreground">
    Shared via{" "}
    <a
      className="text-foreground no-underline hover:underline"
      href="/"
      rel="noopener noreferrer"
    >
      Staaash
    </a>
  </p>
);

const Expiry = ({ expiresAt }: { expiresAt: Date | string }) => (
  <>
    <span className="font-medium text-foreground">
      {getRelativeExpiry(expiresAt)}
    </span>
    {" · "}
    <DateTime value={expiresAt} />
  </>
);

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
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      <span className="text-body font-light text-foreground">{name}</span>
      <span className="text-xs text-muted-foreground">shared with you</span>
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
  SHARE_STORAGE_UNAVAILABLE: {
    title: "Storage operation finishing",
    description:
      "This shared item is unavailable until storage recovery finishes.",
  },
  SHARE_TARGET_UNAVAILABLE: {
    title: "Shared item unavailable",
    description: "The owner has moved this item out of public availability.",
  },
};

export function ShareErrorView({ error }: { error: ShareError }) {
  const copy = shareErrorCopy[error.code];

  return (
    <main className={pageMain}>
      <ShareBrand />
      <Card className="items-start gap-4 p-6 max-sm:p-4.5">
        <Badge>Public share</Badge>
        <h1 className="m-0 text-lg font-semibold tracking-tight">
          {copy.title}
        </h1>
        <p className="m-0 text-muted-foreground">{copy.description}</p>
      </Card>
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
    <main
      className="relative flex min-h-screen w-full flex-col items-center justify-center p-6"
      data-share-locked
    >
      <div className="grid w-[min(340px,100%)] gap-5">
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        <form action={`/s/${encodeURIComponent(token)}/unlock`} method="post">
          <input name="redirectTo" type="hidden" value={redirectPath} />
          <label className="sr-only" htmlFor="share-password">
            Password
          </label>
          <InputGroup>
            <InputGroupInput
              id="share-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              required
            />
            <InputGroupAddon align="inline-end">
              <Button type="submit" size="sm">
                Unlock
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
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
  preview,
  searchParams,
  share,
}: {
  backHref?: string;
  backLabel?: string;
  contentHref: string;
  downloadHref?: string;
  file: FileSummary;
  headerLabel: string;
  preview?: PublicShareFilePreview | null;
  searchParams: Record<string, string | string[] | undefined>;
  share: Pick<ShareLinkSummary, "downloadDisabled" | "expiresAt">;
}) {
  const error = getSingleSearchParam(searchParams, "error");
  const success = getSingleSearchParam(searchParams, "success");
  const ext = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase()
    : null;
  const formatLabel = ext ?? file.mimeType;
  const safeNativeInline = isPublicShareFileNativeViewSafe(file, preview);
  const canViewTextSource =
    file.viewerKind === "text" && (safeNativeInline || !share.downloadDisabled);

  return (
    <main className="mx-auto flex min-h-screen w-[min(1080px,calc(100vw-48px))] flex-col items-center gap-4 pt-6 pb-12 max-sm:w-[min(100vw-28px,1080px)]">
      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      {/* Top bar: file title left, instance brand right */}
      <PageHeader
        className={`${mediaWidth} max-sm:flex-col-reverse`}
        title={file.name}
        description={<Expiry expiresAt={share.expiresAt} />}
        actions={<ShareBrand />}
      />

      {/* Content */}
      {file.viewerKind === "audio" && safeNativeInline ? (
        <ShareAudioPlayer src={contentHref} fileName={file.name} />
      ) : file.viewerKind === "pdf" && safeNativeInline ? (
        <embed
          src={contentHref}
          type="application/pdf"
          className="h-[75vh] w-full"
        />
      ) : canViewTextSource ? (
        <TextFileViewer contentHref={contentHref} />
      ) : (file.viewerKind === "image" || file.viewerKind === "video") &&
        safeNativeInline ? (
        <section className="flex w-fit max-w-[min(90vw,1920px)] items-center justify-center overflow-hidden rounded-xl border border-hairline bg-hover">
          {file.viewerKind === "image" ? (
            <img
              alt={file.name}
              src={contentHref}
              className="block max-h-[60vh] max-w-[min(90vw,1920px)] object-contain"
            />
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={contentHref}
              className="block max-h-[60vh] max-w-[min(90vw,1920px)]"
            >
              Your browser could not play this video inline.
            </video>
          )}
        </section>
      ) : null}

      {/* Actions row: meta left, download + back right */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${mediaWidth}`}
      >
        <p className="m-0 text-xs text-muted-foreground">
          {formatLabel} · {formatBytes(file.sizeBytes)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {backHref ? (
            <Button variant="secondary" render={<Link href={backHref} />}>
              {backLabel}
            </Button>
          ) : null}
          {!share.downloadDisabled && downloadHref ? (
            <Button render={<a href={downloadHref} />}>Download</Button>
          ) : share.downloadDisabled ? (
            <span className="text-xs text-muted-foreground italic">
              Downloads off
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-auto">
        <SharedVia />
      </div>
    </main>
  );
}

type ShareViewProps = {
  filePreview?: PublicShareFilePreview | null;
  resolution: PublicShareResolution;
  token: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export function ShareView({
  filePreview,
  resolution,
  token,
  searchParams,
}: ShareViewProps) {
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
        preview={filePreview}
        searchParams={searchParams}
        share={resolution.share}
      />
    );
  }

  return (
    <main className={folderMain}>
      <ShareBrand />

      <Card className="gap-4 p-6 max-sm:p-4.5">
        <PageHeader
          title={resolution.listing.currentFolder.name}
          meta={<Badge>Shared folder</Badge>}
          description={<Expiry expiresAt={resolution.share.expiresAt} />}
          actions={
            !resolution.share.downloadDisabled ? (
              <Button
                variant="secondary"
                render={<a href={`/s/${encodeURIComponent(token)}/archive`} />}
              >
                Download all
              </Button>
            ) : null
          }
        />
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        {resolution.share.downloadDisabled ? (
          <span className="text-label text-muted-foreground">
            Archive download is disabled for this link.
          </span>
        ) : null}
      </Card>

      {resolution.listing.breadcrumbs.length > 1 ? (
        <nav className="flex flex-wrap items-baseline" aria-label="Breadcrumb">
          {resolution.listing.breadcrumbs.map((crumb) => (
            <Link
              key={crumb.id}
              className="text-label text-muted-foreground transition-colors duration-150 after:px-1.5 after:font-light after:text-muted-foreground/30 after:content-['/'] hover:text-muted-foreground"
              href={crumb.href}
            >
              {crumb.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <ShareFolderList
        downloadDisabled={resolution.share.downloadDisabled}
        entries={[
          ...resolution.listing.childFolders.map((folder) => ({
            id: folder.id,
            kind: "folder" as const,
            name: folder.name,
            updatedAt: folder.updatedAt.toISOString(),
          })),
          ...resolution.listing.files.map((file) => ({
            id: file.id,
            kind: "file" as const,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            hasViewer: Boolean(file.viewerKind),
            updatedAt: file.updatedAt.toISOString(),
          })),
        ]}
        token={token}
      />

      <SharedVia />
    </main>
  );
}
