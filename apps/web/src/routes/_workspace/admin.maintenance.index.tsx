import { createFileRoute } from "@tanstack/react-router";

import { adminMaintenanceQuery } from "@/src/queries";
import { MaintenancePage } from "@/src/workspace/admin/maintenance";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/maintenance/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminMaintenanceQuery),
  pendingComponent: WorkspaceLoading,
  component: MaintenancePage,
});
