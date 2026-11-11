import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";

import { adminStorageQuery } from "@/src/queries";
import { AdminStoragePage } from "@/src/workspace/admin/storage";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/storage")({
  validateSearch: z.object({ mutationId: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps: { mutationId } }) =>
    context.queryClient.fetchQuery(adminStorageQuery(mutationId)),
  pendingComponent: WorkspaceLoading,
  component: () => (
    <AdminStoragePage mutationId={Route.useSearch().mutationId} />
  ),
});
