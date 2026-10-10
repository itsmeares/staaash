import { notFound } from "next/navigation";
import { canHaveThumbnail } from "@staaash/db/viewer-contract";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { filesService } from "@/server/files/service";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";

import { StandaloneViewer } from "./standalone-viewer";

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
  const actor = { actorRole: session.user.role, actorUserId: session.user.id };

  try {
    const file = await getAccessiblePrivateFile({ ...actor, fileId });
    if (!file.viewerKind) notFound();

    await recordFileAccessBestEffort({
      ...actor,
      fileId: file.id,
      source: "files-file-viewer-page",
    });

    // Arrows move through the other viewable files in the same folder.
    const listing = await filesService
      .getFilesListing({ ...actor, folderId: file.folderId ?? undefined })
      .catch(() => null);
    const siblings = (listing?.files ?? [file]).flatMap((entry) =>
      entry.viewerKind && !entry.storageMutation
        ? [
            {
              id: entry.id,
              name: entry.name,
              mimeType: entry.mimeType,
              viewerKind: entry.viewerKind,
              thumbnailUrl: canHaveThumbnail(entry.mimeType, entry.name)
                ? `/api/files/files/${entry.id}/thumbnail`
                : null,
            },
          ]
        : [],
    );
    const files = siblings.some((entry) => entry.id === file.id)
      ? siblings
      : [
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            viewerKind: file.viewerKind,
            thumbnailUrl: null,
          },
        ];

    return (
      <StandaloneViewer
        backHref={file.folderId ? `/files/f/${file.folderId}` : "/files"}
        fileId={file.id}
        files={files}
      />
    );
  } catch (error) {
    if (isFilesError(error)) notFound();
    throw error;
  }
}
