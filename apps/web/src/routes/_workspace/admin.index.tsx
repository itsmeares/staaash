import { createFileRoute } from "@tanstack/react-router";

import { adminOverviewQuery } from "@/src/queries";
import { AdminOverviewPage } from "@/src/workspace/admin/overview";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminOverviewQuery),
  pendingComponent: WorkspaceLoading,
  component: AdminOverviewPage,
});
