import Link from "next/link";
import { notFound } from "next/navigation";

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
    `/sign-in?next=${encodeURIComponent(`/library/files/${fileId}`)}`,
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

    const backHref = file.folderId ? `/library/f/${file.folderId}` : "/library";
    const contentHref = `/api/library/files/${file.id}/content`;
    const downloadHref = `/api/library/files/${file.id}/download`;

    return (
      <main className="stack">
        <section className="panel stack">
          <div className="pill">
            {file.viewerKind === "image" ? "Photo viewer" : "Video viewer"}
          </div>
          <div className="split">
            <div className="stack">
              <h1>{file.name}</h1>
              <p className="muted">
                {file.mimeType} • Updated {formatDateTime(file.updatedAt)}
              </p>
            </div>
            <div className="workspace-inline-fields">
              <Link className="button button-secondary" href={backHref}>
                Back
              </Link>
              <a className="button" href={downloadHref}>
                Download
              </a>
            </div>
          </div>
        </section>

        <section
          className="panel stack"
          style={{
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--color-surface-hover, #f3f4f6)",
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
      </main>
    );
  } catch (error) {
    if (isLibraryError(error)) {
      notFound();
    }

    throw error;
  }
}
