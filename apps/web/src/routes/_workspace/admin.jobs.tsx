import { createFileRoute } from "@tanstack/react-router";

import { adminJobsQuery } from "@/src/queries";
import { AdminJobsPage } from "@/src/workspace/admin/jobs/jobs-page";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/jobs")({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminJobsQuery),
  pendingComponent: WorkspaceLoading,
  component: AdminJobsPage,
});
