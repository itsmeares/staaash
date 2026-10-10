import React from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { DriveGlyph } from "@/components/drive-glyph";
import { cn } from "@/lib/utils";

import { TextFileViewer } from "@/app/text-file-viewer";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
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

const formatBytes = (value: number) => {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

function getRelativeExpiry(expiresAt: Date | string): string {
  const diffDays = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) return "Expired";
  if (diffDays === 1) return "Expires tomorrow";
  if (diffDays < 7) return `Expires in ${diffDays} days`;
  if (diffDays < 60) {
    const weeks = Math.ceil(diffDays / 7);
    return `Expires in ${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  return `Expires in ${Math.floor(diffDays / 30)} months`;
}

const Expiry = ({ expiresAt }: { expiresAt: Date | string }) => (
  <span title={new Date(expiresAt).toISOString()}>
    {getRelativeExpiry(expiresAt)}, <DateTime value={expiresAt} />
  </span>
);

/**
 * Every public page: the drive's name on top, the content, and a quiet
 * footer. Visitors see the drive, not an app chrome.
 */
async function ShareShell({
  children,
  width = "wide",
}: {
  children: React.ReactNode;
  width?: "narrow" | "wide";
}) {
  const setupState = await authService.getSetupState();
  const name = setupState.instanceName?.trim() || "Staaash";
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-5 py-4">
        <DriveGlyph />
        <span className="min-w-0 truncate font-heading text-lg font-medium">
          {name}
        </span>
        <span className="ms-auto text-meta text-muted-foreground">
          Shared with you
        </span>
      </header>
      <main
        className={cn(
          "mx-auto grid w-full flex-1 content-start gap-5 px-5 pt-4 pb-12",
          width === "narrow" ? "max-w-md" : "max-w-6xl",
        )}
      >
        {children}
      </main>
      <footer className="pb-6 text-center text-label text-muted-foreground">
        Shared with{" "}
        <a className="text-foreground hover:underline" href="/">
          Staaash
        </a>
      </footer>
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
    title: "This folder isn't part of the link",
    description:
      "The link only opens the folder that was shared and what's inside it.",
  },
  SHARE_DOWNLOAD_DISABLED: {
    title: "Downloads are off",
    description:
      "You can look at what's here, but this link doesn't allow downloads.",
  },
  SHARE_EXPIRED: {
    title: "This link has expired",
    description: "Ask the person who sent it for a new one.",
  },
  SHARE_INVALID: {
    title: "This link no longer works",
    description:
      "It may have been turned off. Ask the person who sent it for a new one.",
  },
  SHARE_NOT_FOUND: {
    title: "We couldn't find this link",
    description:
      "Check that the address is complete, or ask for the link again.",
  },
  SHARE_PASSWORD_INVALID: {
    title: "That password didn't work",
    description: "Check it and try again.",
  },
  SHARE_PASSWORD_REQUIRED: {
    title: "This link has a password",
    description: "Enter it to see what was shared.",
  },
  SHARE_STORAGE_UNAVAILABLE: {
    title: "Back in a moment",
    description:
      "The drive is finishing a storage task. Try again in a minute.",
  },
  SHARE_TARGET_UNAVAILABLE: {
    title: "This item isn't shared anymore",
    description: "The owner moved it or took it out of sharing.",
  },
};

export function ShareErrorView({ error }: { error: ShareError }) {
  const copy = shareErrorCopy[error.code];
  return (
    <ShareShell width="narrow">
      <div className="grid justify-items-center gap-2 pt-16 text-center">
        <h1 className="m-0 font-heading text-headline font-semibold">
          {copy.title}
        </h1>
        <p className="m-0 text-body text-muted-foreground">
          {copy.description}
        </p>
      </div>
    </ShareShell>
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
    <ShareShell width="narrow">
      <div className="grid gap-4 pt-16" data-share-locked>
        <div className="grid gap-1 text-center">
          <h1 className="m-0 font-heading text-headline font-semibold">
            This link has a password
          </h1>
          <p className="m-0 text-body text-muted-foreground">
            Enter it to see what was shared.
          </p>
        </div>
        {error ? <FlashMessage>{error}</FlashMessage> : null}
        {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
        <form action={`/s/${encodeURIComponent(token)}/unlock`} method="post">
          <input name="redirectTo" type="hidden" value={redirectPath} />
          <label className="sr-only" htmlFor="share-password">
            Password
          </label>
          <InputGroup>
            <InputGroupInput
              autoComplete="current-password"
              autoFocus
              id="share-password"
              name="password"
              placeholder="Password"
              required
              type="password"
            />
            <InputGroupAddon align="inline-end">
              <Button size="sm" type="submit">
                Open
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </ShareShell>
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
    <ShareShell>
      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 truncate font-heading text-headline font-semibold">
            {file.name}
          </h1>
          <p className="m-0 text-meta text-muted-foreground">
            {formatLabel?.toUpperCase()} · {formatBytes(file.sizeBytes)} ·{" "}
            <Expiry expiresAt={share.expiresAt} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {backHref ? (
            <Button render={<Link href={backHref} />} variant="outline">
              {backLabel}
            </Button>
          ) : null}
          {!share.downloadDisabled && downloadHref ? (
            <Button render={<a href={downloadHref} />}>
              <Download aria-hidden />
              Download
            </Button>
          ) : share.downloadDisabled ? (
            <span className="text-meta text-muted-foreground">
              Downloads are off
            </span>
          ) : null}
        </div>
      </div>

      {file.viewerKind === "audio" && safeNativeInline ? (
        <ShareAudioPlayer src={contentHref} fileName={file.name} />
      ) : file.viewerKind === "pdf" && safeNativeInline ? (
        <embed
          src={contentHref}
          type="application/pdf"
          className="h-[75vh] w-full rounded-xl border border-border"
        />
      ) : canViewTextSource ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <TextFileViewer contentHref={contentHref} />
        </div>
      ) : (file.viewerKind === "image" || file.viewerKind === "video") &&
        safeNativeInline ? (
        <section className="flex min-h-64 items-center justify-center overflow-hidden rounded-xl bg-black">
          {file.viewerKind === "image" ? (
            <img
              alt={file.name}
              src={contentHref}
              className="block max-h-[72vh] max-w-full object-contain"
            />
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={contentHref}
              className="block max-h-[72vh] max-w-full"
            >
              Your browser could not play this video inline.
            </video>
          )}
        </section>
      ) : (
        <p className="m-0 rounded-xl border border-dashed border-border px-4 py-10 text-center text-body text-muted-foreground">
          This file can't be shown here.
          {!share.downloadDisabled && downloadHref
            ? " Download it to open it."
            : ""}
        </p>
      )}
    </ShareShell>
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

  const { listing, share } = resolution;
  const itemCount = listing.childFolders.length + listing.files.length;
  return (
    <ShareShell>
      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          {listing.breadcrumbs.length > 1 ? (
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-baseline gap-1.5 text-meta text-muted-foreground"
            >
              {listing.breadcrumbs.slice(0, -1).map((crumb) => (
                <span className="flex items-baseline gap-1.5" key={crumb.id}>
                  <Link className="hover:text-foreground" href={crumb.href}>
                    {crumb.name}
                  </Link>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="m-0 truncate font-heading text-headline font-semibold">
            {listing.currentFolder.name}
          </h1>
          <p className="m-0 text-meta text-muted-foreground">
            {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
            <Expiry expiresAt={share.expiresAt} />
            {share.downloadDisabled ? " · Downloads are off" : ""}
          </p>
        </div>
        {!share.downloadDisabled ? (
          <Button
            render={<a href={`/s/${encodeURIComponent(token)}/archive`} />}
          >
            <Download aria-hidden />
            Download all
          </Button>
        ) : null}
      </div>

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
    </ShareShell>
  );
}
