import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { adminUsersQuery } from "@/src/queries";
import { AdminUsersPage } from "@/src/workspace/admin/users-page";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/users/")({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).catch(1).default(1),
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(adminUsersQuery),
  pendingComponent: WorkspaceLoading,
  component: () => <AdminUsersPage page={Route.useSearch().page} />,
});
