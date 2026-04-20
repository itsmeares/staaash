import Link from "next/link";
import { notFound } from "next/navigation";

import { TextFileViewer } from "@/app/text-file-viewer";

import { formatDateTime } from "@/app/auth-ui";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { isLibraryError } from "@/server/library/errors";
import { getAccessiblePrivateFile } from "@/server/library/viewer";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";

export const dynamic = "force-dynamic";

type LibraryFileViewerPageProps = {
  params: Promise<{
    fileId: string;
  }>;
};

export default async function LibraryFileViewerPage({
  params,
}: LibraryFileViewerPageProps) {
  const { fileId } = await params;
  const session = await requireSignedInPageSession(
    `/sign-in?next=${encodeURIComponent(`/files/view/${fileId}`)}`,
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
      source: "library-file-viewer-page",
    });

    const backHref = file.folderId ? `/files/f/${file.folderId}` : "/files";
    const contentHref = `/api/files/files/${file.id}/content`;
    const downloadHref = `/api/files/files/${file.id}/download`;

    return (
      <main
        className="workspace-page"
        style={
          file.viewerKind === "pdf"
            ? { display: "flex", flexDirection: "column", height: "100%" }
            : undefined
        }
      >
        <div className="viewer-header">
          <div className="viewer-header-identity">
            <h1>{file.name}</h1>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              {file.mimeType}
              {" · "}
              Updated {formatDateTime(file.updatedAt)}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Link className="button button-secondary button-sm" href={backHref}>
              Back
            </Link>
            {file.viewerKind === "pdf" ? (
              <a
                className="button button-secondary button-sm"
                href={contentHref}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            ) : null}
            <a className="button button-sm" href={downloadHref}>
              Download
            </a>
          </div>
        </div>

        <div
          className="viewer-media"
          style={
            file.viewerKind === "audio" || file.viewerKind === "text"
              ? { minHeight: "auto", padding: "2rem" }
              : file.viewerKind === "pdf"
                ? { flex: 1, minHeight: 0 }
                : undefined
          }
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
          ) : file.viewerKind === "audio" ? (
            <audio
              controls
              preload="metadata"
              src={contentHref}
              style={{ width: "100%" }}
            />
          ) : file.viewerKind === "pdf" ? (
            <embed
              src={contentHref}
              type="application/pdf"
              style={{ width: "100%", height: "100%" }}
            />
          ) : file.viewerKind === "text" ? (
            <TextFileViewer contentHref={contentHref} />
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
        </div>
      </main>
    );
  } catch (error) {
    if (isLibraryError(error)) {
      notFound();
    }

    throw error;
  }
}
