import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WorkspacePage } from "../../../workspace-page";

import { TextFileViewer } from "@/app/text-file-viewer";

import { formatDateTime } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";

export const dynamic = "force-dynamic";

type FilesFileViewerPageProps = {
  params: Promise<{
    fileId: string;
  }>;
};

export default async function FilesFileViewerPage({
  params,
}: FilesFileViewerPageProps) {
  const { fileId } = await params;
  const session = await requireSignedInPageSession(
    `/?next=${encodeURIComponent(`/files/view/${fileId}`)}`,
  );

  try {
    const file = await getAccessiblePrivateFile({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      fileId,
    });

    if (!file.viewerKind) {
      notFound();
    }

    await recordFileAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      fileId: file.id,
      source: "files-file-viewer-page",
    });

    const backHref = file.folderId ? `/files/f/${file.folderId}` : "/files";
    const contentHref = `/api/files/files/${file.id}/content`;
    const downloadHref = `/api/files/files/${file.id}/download`;
    const userTimeZone = session.user.preferences?.timeZone;

    return (
      <WorkspacePage
        as="main"
        className={cn(
          file.viewerKind === "pdf" && "h-full grid-rows-[auto_1fr]",
        )}
      >
        <PageHeader
          divider
          title={file.name}
          description={
            <>
              {file.mimeType}
              {" · "}
              Updated {formatDateTime(file.updatedAt, userTimeZone)}
            </>
          }
          actions={
            <>
              <Button
                size="sm"
                variant="secondary"
                render={<Link href={backHref} />}
              >
                Back
              </Button>
              {file.viewerKind === "pdf" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  render={
                    <a href={contentHref} target="_blank" rel="noreferrer" />
                  }
                >
                  Open in new tab
                </Button>
              ) : null}
              <Button size="sm" render={<a href={downloadHref} />}>
                Download
              </Button>
            </>
          }
        />

        <div
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-xl border border-hairline bg-hover",
            file.viewerKind === "audio" || file.viewerKind === "text"
              ? "p-8"
              : file.viewerKind === "pdf"
                ? "min-h-0"
                : "rounded-none border-0 bg-transparent",
          )}
        >
          {file.viewerKind === "image" ? (
            <img
              alt={file.name}
              src={contentHref}
              className="block max-h-[75vh] max-w-full object-contain"
            />
          ) : file.viewerKind === "audio" ? (
            <audio
              controls
              preload="metadata"
              src={contentHref}
              className="w-full"
            />
          ) : file.viewerKind === "pdf" ? (
            <embed
              src={contentHref}
              type="application/pdf"
              className="h-full w-full"
            />
          ) : file.viewerKind === "text" ? (
            <TextFileViewer contentHref={contentHref} />
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={contentHref}
              className="block max-h-[75vh] max-w-full"
            >
              Your browser could not play this video inline.
            </video>
          )}
        </div>
      </WorkspacePage>
    );
  } catch (error) {
    if (isFilesError(error)) {
      notFound();
    }

    throw error;
  }
}
