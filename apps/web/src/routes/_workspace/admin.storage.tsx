import { createFileRoute } from "@tanstack/react-router";

import { adminStorageQuery } from "@/src/queries";
import { AdminStoragePage } from "@/src/workspace/admin/storage";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/storage")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminStorageQuery),
  pendingComponent: WorkspaceLoading,
  component: AdminStoragePage,
});
