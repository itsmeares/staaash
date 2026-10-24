import React from "react";
import { formatBytes } from "@/lib/format-bytes";
import { AppLink } from "@/components/app-link";
import { Download } from "lucide-react";

import { DriveGlyph } from "@/components/drive-glyph";
import { EntryShell } from "@/components/public/entry-shell";
import { cn } from "@staaash/ui/utils";

import { TextFileViewer } from "@/src/text-file-viewer";
import { AudioPlayer } from "@/components/file-list/audio-player";
import { Button } from "@staaash/ui/components/button";
import { DayMonth } from "@/components/time-provider";
import { useQuery } from "@tanstack/react-query";

import { entryQuery } from "@/src/queries";
import { ShareFolderList } from "./share-folder-list";
import { SharePasswordForm } from "./share-password-form";
import type { ShareErrorCode } from "@/server/sharing/errors";
import type {
  PublicShareView,
  toPublicFile,
  toPublicShare,
} from "@/server/sharing/public-view";
import type { Plain } from "@/lib/plain";

type PublicFile = Plain<ReturnType<typeof toPublicFile>>;
type PublicShare = Plain<ReturnType<typeof toPublicShare>>;
type ShareError = { code: ShareErrorCode; message: string };

const useInstanceName = () =>
  useQuery(entryQuery).data?.instanceName ?? "Staaash";

/** Top right of every shared page: when the link stops, then Download. */
function ShareActions({
  expiresAt,
  downloadDisabled,
  downloadHref,
  label = "Download",
  children,
}: {
  expiresAt: Date | string;
  downloadDisabled: boolean;
  downloadHref?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <span className="text-label text-muted-foreground">
        Link expires <DayMonth value={expiresAt} />
      </span>
      {children}
      {downloadDisabled ? (
        <span className="text-label text-muted-foreground">
          Downloads are off
        </span>
      ) : downloadHref ? (
        <Button render={<a href={downloadHref} />}>
          <Download aria-hidden />
          {label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Every public page: the drive's name on top, the content, and a quiet
 * footer. Visitors see the drive, not an app chrome.
 */
function ShareShell({
  children,
  width = "wide",
}: {
  children: React.ReactNode;
  width?: "narrow" | "wide";
}) {
  const name = useInstanceName();
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

const shareErrorCopy: Partial<
  Record<
    ShareError["code"],
    {
      title: string;
      description: string;
    }
  >
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
  SHARE_STORAGE_UNAVAILABLE: {
    title: "Back in a moment",
    description:
      "The drive is finishing a storage task. Try again in a minute.",
  },
};

// Dead links all read the same, so a visitor can't tell which ones existed.
const DEAD_LINK = new Set<ShareError["code"]>([
  "SHARE_EXPIRED",
  "SHARE_INVALID",
  "SHARE_NOT_FOUND",
  "SHARE_TARGET_UNAVAILABLE",
]);

/** Before a visitor is let in, the page is the halftone, like sign-in. */
function HalftonePage({ children }: { children: React.ReactNode }) {
  return (
    <EntryShell instanceName={useInstanceName()}>
      <div className="grid justify-items-center gap-3 text-center [text-shadow:0_1px_12px_rgb(0_0_0/0.7)]">
        {children}
      </div>
    </EntryShell>
  );
}

export function ShareErrorView({ error }: { error: ShareError }) {
  if (DEAD_LINK.has(error.code)) {
    return (
      <HalftonePage>
        <h1 className="m-0 font-heading text-[clamp(2.25rem,6vw,3rem)] leading-tight font-normal tracking-tight">
          This link doesn&apos;t work
          <br />
          any more.
        </h1>
        <p className="m-0 max-w-90 text-body text-foreground/80">
          It may have expired or been turned off. Ask the person who sent it for
          a new one.
        </p>
      </HalftonePage>
    );
  }
  const copy = shareErrorCopy[error.code] ?? {
    title: "Something went wrong",
    description: "Try again in a minute.",
  };
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

export function ShareLockedView({ token }: { token: string }) {
  return (
    <HalftonePage>
      <div className="grid justify-items-center gap-3" data-share-locked>
        <h1 className="m-0 font-heading text-[clamp(2rem,5vw,2.5rem)] leading-tight font-normal tracking-tight">
          Something is waiting
          <br />
          for you.
        </h1>
        <p className="m-0 text-body text-foreground/80">
          Enter the password you were given.
        </p>
        <SharePasswordForm token={token} />
      </div>
    </HalftonePage>
  );
}

// The share page covers every viewer kind, password, expiry and download rule.
// fallow-ignore-next-line complexity
export function ShareFilePage({
  backHref,
  backLabel = "Back",
  contentHref,
  downloadHref,
  file,
  nativeInline: safeNativeInline,
  share,
}: {
  backHref?: string;
  backLabel?: string;
  contentHref: string;
  downloadHref?: string;
  file: PublicFile;
  /** Whether the browser may show the file itself; the server decides. */
  nativeInline: boolean;
  share: PublicShare;
}) {
  const canViewTextSource =
    file.viewerKind === "text" && (safeNativeInline || !share.downloadDisabled);

  return (
    <ShareShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 truncate font-heading text-headline font-semibold">
            {file.name}
          </h1>
          <p className="m-0 text-meta text-muted-foreground">
            {formatBytes(file.sizeBytes)}
          </p>
        </div>
        <ShareActions
          downloadDisabled={share.downloadDisabled}
          downloadHref={downloadHref}
          expiresAt={share.expiresAt}
        >
          {backHref ? (
            <Button render={<AppLink href={backHref} />} variant="outline">
              {backLabel}
            </Button>
          ) : null}
        </ShareActions>
      </div>

      {file.viewerKind === "audio" && safeNativeInline ? (
        <AudioPlayer name={file.name} src={contentHref} />
      ) : file.viewerKind === "pdf" && safeNativeInline ? (
        <embed
          src={contentHref}
          type="application/pdf"
          className="h-[75vh] w-full rounded-xl border border-border"
        />
      ) : canViewTextSource ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <TextFileViewer contentHref={contentHref} name={file.name} />
        </div>
      ) : (file.viewerKind === "image" || file.viewerKind === "video") &&
        safeNativeInline ? (
        <section className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-xl bg-black">
          {file.viewerKind === "image" ? (
            <>
              {/* The photo at its own size, on a blur of itself. */}
              <img
                alt=""
                aria-hidden
                src={contentHref}
                className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl"
              />
              <img
                alt={file.name}
                src={contentHref}
                className="relative block max-h-[72vh] max-w-full object-contain"
              />
            </>
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
  resolution: Plain<PublicShareView>;
  nativeInline: boolean;
  folderSizeBytes: number;
  token: string;
};

export function ShareView({
  resolution,
  nativeInline,
  folderSizeBytes,
  token,
}: ShareViewProps) {
  if (resolution.kind === "locked") return <ShareLockedView token={token} />;

  if (resolution.kind === "file") {
    return (
      <ShareFilePage
        contentHref={`/s/${encodeURIComponent(token)}/content`}
        downloadHref={`/s/${encodeURIComponent(token)}/download`}
        file={resolution.file}
        nativeInline={nativeInline}
        share={resolution.share}
      />
    );
  }

  const { listing, share } = resolution;
  return (
    <ShareShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          {listing.breadcrumbs.length > 1 ? (
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-baseline gap-1.5 text-meta text-muted-foreground"
            >
              {listing.breadcrumbs.slice(0, -1).map((crumb) => (
                <span className="flex items-baseline gap-1.5" key={crumb.id}>
                  <AppLink className="hover:text-foreground" href={crumb.href}>
                    {crumb.name}
                  </AppLink>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="m-0 truncate font-heading text-headline font-semibold">
            {listing.currentFolder.name}
          </h1>
          <p className="m-0 text-meta text-muted-foreground">
            {formatBytes(folderSizeBytes)}
          </p>
        </div>
        <ShareActions
          downloadDisabled={share.downloadDisabled}
          downloadHref={`/s/${encodeURIComponent(token)}/archive`}
          expiresAt={share.expiresAt}
          label="Download all"
        />
      </div>

      <ShareFolderList
        downloadDisabled={share.downloadDisabled}
        entries={[
          ...resolution.listing.childFolders.map((folder) => ({
            id: folder.id,
            kind: "folder" as const,
            name: folder.name,
            updatedAt: folder.updatedAt,
          })),
          ...resolution.listing.files.map((file) => ({
            id: file.id,
            kind: "file" as const,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            hasViewer: Boolean(file.viewerKind),
            updatedAt: file.updatedAt,
          })),
        ]}
        token={token}
      />
    </ShareShell>
  );
}
