import { notFound } from "next/navigation";
import { getViewerWindow } from "@/server/files/viewer-window";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { isFilesError } from "@/server/files/errors";
import { prismaFilesRepository } from "@/server/files/repository";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";

import { StandaloneViewer } from "./standalone-viewer";

export const dynamic = "force-dynamic";

type FilesFileViewerPageProps = {
  params: Promise<{
    fileId: string;
  }>;
};

// Missing, unavailable, unsupported and viewable files each go somewhere else.
// fallow-ignore-next-line complexity
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
      action: "opened",
    });

    const root = file.folderId
      ? null
      : await prismaFilesRepository.findFilesRoot!(session.user.id);
    const folderId = file.folderId ?? root!.id;
    const window = await getViewerWindow(
      session.user.id,
      folderId,
      {},
      file.id,
    );
    if (!window.files.some((entry) => entry.id === file.id)) notFound();

    return (
      <StandaloneViewer
        backHref={file.folderId ? `/files/f/${file.folderId}` : "/files"}
        fileId={file.id}
        files={window.files}
        start={window.start}
        total={window.total}
        folderId={folderId}
      />
    );
  } catch (error) {
    if (isFilesError(error)) notFound();
    throw error;
  }
}
