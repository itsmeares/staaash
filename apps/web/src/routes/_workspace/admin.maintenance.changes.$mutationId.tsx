import { createFileRoute, notFound } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { adminStorageChangeQuery } from "@/src/queries";
import { StorageChangePage } from "@/src/workspace/admin/storage-change";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute(
  "/_workspace/admin/maintenance/changes/$mutationId",
)({
  loader: async ({ context, params: { mutationId } }) => {
    try {
      await context.queryClient.fetchQuery(adminStorageChangeQuery(mutationId));
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "STORAGE_MUTATION_NOT_FOUND"
      ) {
        throw notFound();
      }
      throw error;
    }
  },
  pendingComponent: WorkspaceLoading,
  component: () => (
    <StorageChangePage mutationId={Route.useParams().mutationId} />
  ),
});
