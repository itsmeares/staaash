import { createFileRoute, notFound } from "@tanstack/react-router";

import { ApiError } from "@/lib/api";
import { adminUserQuery } from "@/src/queries";
import { AdminUserPage } from "@/src/workspace/admin/user-page";
import { WorkspaceLoading } from "@/src/workspace/workspace-loading";

export const Route = createFileRoute("/_workspace/admin/users/$userId")({
  loader: async ({ context, params: { userId } }) => {
    try {
      await context.queryClient.ensureQueryData(adminUserQuery(userId));
    } catch (error) {
      if (error instanceof ApiError && error.code === "USER_NOT_FOUND") {
        throw notFound();
      }
      throw error;
    }
  },
  pendingComponent: WorkspaceLoading,
  component: () => <AdminUserPage userId={Route.useParams().userId} />,
});
