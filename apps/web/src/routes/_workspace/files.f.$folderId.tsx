import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { filesQuery } from "@/src/queries";
import { FilesView } from "@/src/workspace/files/files-view";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

const STORAGE_BUSY = new Set([
  "STORAGE_MUTATION_IN_PROGRESS",
  "STORAGE_MUTATION_RECOVERING",
  "STORAGE_RECOVERY_REQUIRED",
]);

function FolderPage() {
  const { folderId } = Route.useParams();
  const { data } = useSuspenseQuery(filesQuery(folderId));
  return <FilesView {...data} currentPath={`/files/f/${folderId}`} />;
}

export const Route = createFileRoute("/_workspace/files/f/$folderId")({
  /**
   * The folder's listing, or the page that fits why it can't be shown:
   * storage busy, missing, or someone else's (which reads as missing).
   */
  // Redirects for missing, trashed, and unavailable folders before loading.
  // fallow-ignore-next-line complexity
  loader: async ({ context, params: { folderId } }) => {
    try {
      const props = await context.queryClient.ensureQueryData(
        filesQuery(folderId),
      );
      if (props.listing.currentFolder.isFilesRoot) {
        throw redirect({ to: "/files" });
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code && STORAGE_BUSY.has(error.code)) {
        throw redirect({
          to: "/files/storage-unavailable",
          search: { folderId },
        });
      }
      if (error.code === "FOLDER_NOT_FOUND" || error.code === "ACCESS_DENIED") {
        throw notFound();
      }
      throw redirect({
        href: `/files?error=${encodeURIComponent(error.message)}`,
      });
    }
  },
  pendingComponent: WorkspaceLoading,
  component: FolderPage,
});
