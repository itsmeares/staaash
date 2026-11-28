import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";

import { adminStorageQuery } from "@/src/queries";
import { StorageChangesPage } from "@/src/workspace/admin/storage-changes";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/maintenance/changes/")({
  validateSearch: z.object({ mutationId: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps: { mutationId } }) =>
    context.queryClient.fetchQuery(adminStorageQuery(mutationId)),
  pendingComponent: WorkspaceLoading,
  component: () => (
    <StorageChangesPage mutationId={Route.useSearch().mutationId} />
  ),
});
